# Container Traffic Control: state machines

Scope: The original findings were traced against `5c4227c`; implementation status reflects HEAD `8a3a668`. This document changes no application or test code.

**CONFIRMED** means a concrete event path reaches the stated invalid state. It does not mean a live Firefox reproduction occurred.
Impact: **High** = wrong identity/container or lost rules; **Medium** = broken operation or inconsistent controls; **Low** = limited display/logging error.

## Firefox API facts and assumptions

- **A1 — Blocking requests:** Firefox accepts a Promise from a blocking `onBeforeRequest` listener. It holds the request until that Promise resolves. `{}` permits the original request; `{cancel:true}` cancels it. The listener here covers only `main_frame` requests (`src/background.js:40-44`). [API][before-request]
- **A2 — Tab creation:** `tabs.create({cookieStoreId})` selects the new tab's cookie store. The manifest supplies `cookies` permission (`manifest.json:13-21`). Creation resolves before page load completes. It does not certify successful navigation. The API supplies no HTTP method/body argument. [API][tabs-create]
- **A3 — Removal:** `tabs.remove()` returns a Promise and can reject. `tabs.onRemoved` reports tab closure. The documentation does not establish ordering between removal, an outstanding `tabs.get/create`, and webRequest callbacks. Findings do not require a particular `onRemoved` order. A pending JavaScript continuation has no automatic cancellation token. [Remove][tabs-remove], [event][tabs-removed]
- **A4 — Background lifetime:** This is a Firefox MV3 event page, not a service worker (`manifest.json:2,25-34`). In MV3, `persistent` defaults to false. Normal suspension discards JavaScript state; a later event reruns the scripts. Do not assume suspension interrupts an outstanding blocking request. [Manifest][background-manifest], [lifecycle][background-lifecycle]
- **A5 — Storage:** Sync quotas include the JSON-encoded value and key length: 8,192 bytes/item and 102,400 bytes total. Excess writes reject. `storage.onChanged` supplies old/new values. It does not serialize this extension's asynchronous decoders or writers. No finding assumes whether the event precedes the writer's Promise continuation. [Quotas][storage-sync], [event][storage-changed]
- **A6 — Menus:** Menu state survives event-page suspension, reloads, and browser sessions. Firefox persists menu state when `manifest.background` exists and `persistentBackground` is false; MV2 persistent backgrounds do not use this store. Menu IDs must be unique. `menus.create()` returns an ID, not a success Promise. Asynchronous failures use its callback and `runtime.lastError`. [Lifecycle][background-lifecycle], [API][menus-create], [parent implementation][menus-parent], [store implementation][menus-store]
- **A7 — Identities:** Names are mutable and need not be unique. Firefox's identity service rejects whitespace-only names, but does not reserve `No Container`, `constructor`, or `__proto__`. IDs come from each profile's `containers.json`; raw `cookieStoreId` values are not portable sync identities. Identity events can wake the page. [Service][identity-service], [event implementation][identity-api]

API checks use MDN and current Firefox source. Version-specific behavior outside these contracts remains a browser-test requirement.

## 1. Repository lifecycle

Each background/options context has its own `CtcRepo` (`src/ctc-repository.js:274-298`).

**States:** U = maps empty, `rules=[]`; LC = container load pending; LR = rule load pending; R = both loads succeed; E = initialization fails. Refresh states retain the preceding cache.

**Invariant:** A ready snapshot contains completed container and rule loads. An error must not masquerade as successful initialization. The code has no complete-snapshot generation or explicit ready flag. `#initializationFailed` records an error but no reader checks it (`src/ctc-repository.js:32-59,196-220,252-270`).

| From state | Event | Guard | Action | To state |
|---|---|---|---|---|
| U / R / E | `initialize()` | none | Await containers, then rules (`src/ctc-repository.js:196-204`) | LC, then LR |
| Any | `loadContainers()` | Container Promise exists | Set one reload flag and share the active Promise (`src/ctc-repository.js:84-87`) | Active query, then follow-up |
| LC | Container query succeeds | none | Rebuild both Maps synchronously; add built-in default (`src/ctc-repository.js:128-153`) | Container cache available |
| LC | Query succeeds or rejects | Reload was requested during the query | Run another query serially; a queued reload retries a rejected query (`src/ctc-repository.js:105-121`) | Follow-up LC |
| LC | Query rejects | No reload was requested during the query | Re-throw the query error; retain the previous cache (`src/ctc-repository.js:105-121`) | E / previous cache |
| Any | `loadRules()` | Rule Promise exists | Mark a follow-up reload; drain another read after the active load (`src/ctc-repository.js:151-189`) | Current load, then queued reload |
| LR | Decode succeeds | none | Replace rules; clear load Promise in `finally` (`src/ctc-repository.js:153-183`) | Rule cache available |
| LR | Both initialization loads finish | success | Clear failure flag; invoke each initializer's callback (`src/ctc-repository.js:201-211`) | R |
| LC / LR | Initialization rejects | none | Set failure flag; call error callback or reject (`src/ctc-repository.js:212-220`) | E; partial/old cache remains |
| U | Concurrent `getData()` calls | maps still empty | Each enters `initialize()`; component loads share Promises (`src/ctc-repository.js:252-265`) | Shared LC/LR work |
| R / LR / E with populated maps | `getData()` | map size > 0; rules not `undefined` | Return cache immediately, even during first rule load or after failure (`src/ctc-repository.js:254-261`) | Reported ready |
| R | Rules storage event | `sync` and `ctcRules` present | Reload rules; queue a following read if decoding is active; log reload errors (`src/background.js:49-54`; `src/ctc-repository.js:151-189`) | Rule refresh |
| R | Container create/remove/update | none | Reload containers; drain a serial follow-up if another event arrives during the query (`src/background.js:57-66`; `src/ctc-repository.js:84-121`) | Container refresh |

The `getData()` readiness predicate can expose initial `[]` during LR. The shipped options startup calls it once; background startup uses `initialize()`. No separate finding assumes a second shipped `getData()` caller. Concurrent direct `load*()` callers also bypass their own callbacks at the early-return branches; current event callers do not supply callbacks.

## 2. Background startup gate

**States:** starting, ready, failed, request released before ready. **Invariant:** A navigation requiring rules must not be authorized from an incomplete snapshot.

| From state | Event | Guard | Action | To state |
|---|---|---|---|---|
| New event-page instance | Scripts run | none | Start `initialize()`; set `isInitialized=false` (`src/background.js:72-86`) | Starting |
| Starting | Initialization resolves | none | Set `isInitialized=true` (`src/background.js:77-80`) | Ready |
| Starting | Initialization rejects | none | Log; clear the matching Promise so a later request can retry (`src/background.js:80-99`) | Failed |
| Starting | Request arrives | Promise exists | Race initialization against 500 ms (`src/background.js:152-159`) | Waiting request |
| Waiting request | Timer rejects | initialization still pending | Log; continue evaluation (`src/background.js:160-167`) | Released before ready, or evaluated from partial cache |
| Failed | Later request | not initialized | Start or join one shared initialization attempt, still raced against 500 ms (`src/background.js:80-99,155-173`) | Starting / waiting request |
| Ready | Normal suspension, then wake | event page reloads | Discard local flags/Maps; repeat startup (`manifest.json:25-34`; A4) | Starting |

## 3. Storage load, codec, and commit

**States:** absent/raw/JSON/gzip payload; reading; decoding; encoding; writing; committed; error. **Invariants:** Decode must finish before publication. Failed writes must preserve the previous committed cache. Rules require record validation, not merely an array check.

| From state | Event | Guard | Action | To state |
|---|---|---|---|---|
| Cache | Load | no existing load Promise | Read `ctcRules`; await decoder (`src/ctc-repository.js:172-180`) | Reading/decoding |
| Reading | Falsy value / raw array | format match | Return `[]` / array unchanged (`src/storage-compression.js:221-231`) | Decoded array |
| Reading | JSON string | no `gz:` prefix | Parse array or object's `rules` array; ignore version (`src/storage-compression.js:121-130,267-271`) | Decoded array / error |
| Reading | `gz:` string | both stream APIs exist | Base64 → Blob → gunzip → text → JSON (`src/storage-compression.js:234-264`) | Decoding → array / error |
| Reading | `gz:` string | stream APIs absent | Throw; do not publish empty rules (`src/storage-compression.js:235-241`) | Error; old cache retained |
| Draft array | Save/import passes validation | array supplied | JSON `{version:1,rules}` (`src/storage-compression.js:152-165`) | Encoding |
| Encoding | Capability check | stream APIs absent | Use plain JSON, without quota relief (`src/storage-compression.js:167-174`) | Encoded |
| Encoding | Capability check | stream APIs present | UTF-8 → gzip → Blob/FileReader → Base64 → `gz:` (`src/storage-compression.js:176-199`) | Encoded / error |
| Encoded | Storage write | none | Await `sync.set`; only then assign `this.rules` (`src/options.js:471-475`) | Committed / error |
| Writing | Quota/API rejection | A5 | Catch in save/import; retain draft and previous `this.rules` (`src/options.js:534-538,649-651`) | Error; retry available |
| Decoding snapshot | New storage event | existing load Promise | Queue another read after the active decode (`src/background.js:49-54`; `src/ctc-repository.js:151-189`) | Latest stored rules published: F3 fixed |

Compression fallback is not a save retry. A quota failure does not automatically retry uncompressed or delete existing rules. A user retry reruns encoding and the same write.

## 4. Per-request routing and tab lifetime

**States:** received, waiting, bypassed, reading tab, evaluated, creating replacement, close requested, original canceled, failed-open. Redirect-chain state is tracked per replacement tab.

**Invariants:** Authorization belongs to one request and source tab. Independent requests must not share authorization. A closed tab must not leave active replacement work. Each replacement chain stops at five hops within ten seconds. Creation success is not load success.

| From state | Event | Guard | Action | To state |
|---|---|---|---|---|
| Received | Startup check | not ready | Use machine 2 (`src/background.js:169-189`) | Waiting / processing |
| Processing | URL/tab check | privileged URL or tab ID -1 | Return `{}` (`src/background.js:193-197`) | Bypassed |
| Processing | Tab read | Valid nonprivileged request | Read the chain; register source-tab work; await `tabs.get()` (`src/background.js:198-205,337-352`) | Reading tab |
| Reading tab | Read fails or source closes | Lookup returns `null` or close event marks work | Return `{}`; do not invent a default tab (`src/background.js:118-128,203-205,337-352`) | Failed open; no replacement |
| Evaluated | Store IDs equal | none | Clear this tab's chain and return `{}` (`src/background.js:224-227`) | Original allowed |
| Evaluated | Store IDs differ | Method is not `GET` | Clear this tab's chain; warn and return `{}` (`src/background.js:233-239`) | Original allowed in source tab: F10 fixed |
| Evaluated | Switch required | GET; chain has fewer than five prior hops | Create the target-store tab and attach the incremented chain to its ID (`src/background.js:241-263`) | Creating replacement; chain follows new tab |
| Evaluated | Switch required | GET; chain already has five hops within its window | Warn and return `{}` without replacing the tab (`src/background.js:241-245`) | Original allowed; chain stopped |
| Creating replacement | Source closes during creation | `sourceClosed` is true | Remove replacement and its chain; return `{}` (`src/background.js:151-166,264-269`) | Failed open; source closure handled |
| Creating replacement | Creation resolves | Source remains open | Track replacement; await source removal (`src/background.js:257-284`) | Original canceled after replacement is ready |
| Source removal | Removal rejects | none | Log; remove replacement and its chain; return `{}` (`src/background.js:151-166,271-279`) | Original request allowed |
| Any awaited stage | Exception | caught | Log and return `{}`; release source work in `finally` (`src/background.js:285-290`) | Failed open |
| Any source work | Handler completes or fails | `finally` runs | Remove work item; delete empty tab entry (`src/background.js:144-149,288-290`) | No pending work |
| Pending source work | Source tab closes | Handler is not removing the source | Mark closed; remove any replacement and its chain (`src/background.js:118-128,151-166`) | Closed work |

### Source-tab work tracking

Source-tab work exists only while a handler depends on its source tab. Completed work leaves no cooldown record. A separate redirect chain follows replacement tabs (`src/background.js:101-115,248-263`).

| State | Event | Guard | Action | To state |
|---|---|---|---|---|
| No work for tab | Request accepted | `tabId` is valid | Add a work item to `pendingRedirects` (`src/background.js:131-141,199-201`) | Pending source work |
| Replacement created | Source closes | `sourceClosed` is true | Remove replacement and its chain; allow original request (`src/background.js:151-166,264-269`) | Closed work released |
| Any source work | Handler completes or fails | `finally` runs | Remove work item; delete empty tab entry (`src/background.js:144-149,288-290`) | No pending work |
| Pending source work | Source tab closes | Handler is not removing the source | Mark closed; remove any replacement and its chain (`src/background.js:118-128,151-166`) | Closed work |
| Pending source work | Replacement creation fails | error | Return `{}`; `finally` releases the work item (`src/background.js:257-290`) | No pending work |
| Any source work | Source removal fails | error | Remove replacement and its chain; return `{}` (`src/background.js:151-166,271-279`) | No replacement |

### Replacement-chain bounds

**States:** no chain, active chain, expired chain, stopped request. Each chain is keyed by its replacement tab. It does not suppress an unrelated tab.

| From state | Event | Guard | Action | To state |
|---|---|---|---|---|
| No / expired chain | GET needs a switch | No live chain entry | Create a replacement with hop 1 and a new 10-second window (`src/background.js:108-115,248-263`) | Active chain on replacement tab |
| Active chain | GET needs a switch | Under five hops and within 10 seconds | Create a replacement with hop + 1; keep the original start time (`src/background.js:108-115,241-263`) | Active chain on replacement tab |
| Active chain | GET needs a switch | Five hops reached within 10 seconds | Warn and keep the request in its current tab (`src/background.js:241-245`) | Stopped request; chain expires on next lookup or tab removal deletes its entry |
| Active chain | Same-store, non-GET, or privileged request | Route branch runs | Clear the source tab's chain (`src/background.js:193-195,224-239`) | No chain |
| Active chain | Tab removed | `tabs.onRemoved` fires | Delete that tab's chain entry (`src/background.js:118-120`) | No chain |

NOTE: The unrelated, uncalled `pruneTrackingMaps()` helper remains in `src/background.js:297-323`. Its body references removed timestamp Maps and expiry constants. No declarations or call sites exist in the file. Calling it raises `ReferenceError`; the active redirect flow does not call it.

## 5. Rule decision and pattern machines

**States:** current candidate, must leave, matched candidates, stay, switch, fallback. **Invariants:** Restricted containers reject nonmatching navigation. Every selected identity must exist. Rule order must survive storage/UI round trips.

| From state | Event | Guard | Action | To state |
|---|---|---|---|---|
| Wrapper | Evaluate | ≤ 1 mapped name or nonarray rules | Return current store (`src/background.js:369-384`) | Stay |
| Current candidate | Restriction check | current name is not `No Container`; restricted rules exist | Test all current-container patterns (`src/rule-engine.js:62-67`) | Current candidate / must leave |
| Current candidate | Restriction check | no current pattern matches | Set candidate to `null` (`src/rule-engine.js:68-70`) | Must leave |
| Current / must leave | Candidate scan | Live target exists and pattern matches | Append name, priority, and index (`src/rule-engine.js:88-97`) | Matched candidates |
| Matched candidates | Select | current candidate matches | Return current name, including over other high-priority rules (`src/rule-engine.js:116-119`) | Stay |
| Matched candidates | Select | priority match exists | Return first priority match (`src/rule-engine.js:121-126`) | Switch candidate |
| Matched candidates | Select | ordinary match exists | Return first match (`src/rule-engine.js:129-132`) | Switch candidate |
| No matches | Select | candidate survives / was cleared | Return current / `No Container` (`src/rule-engine.js:135-137`) | Stay / leave to default |
| Selected name | Resolve store | Same as current name / literal `No Container` / other live name | Preserve current store / return default / map live name (`src/background.js:351-358`) | Stay / default / selected live store |
| Pattern | Match | falsy | Return false (`src/pattern-matching.js:19-20`) | No match |
| Pattern | Match | slash-wrapped, length > 2 | Compile inner text and test (`src/pattern-matching.js:24-32`) | Match / no match |
| Pattern | Match | otherwise | Substring test; invalid types/regex return false after catch (`src/pattern-matching.js:33-42`) | Match / no match |

Current-container precedence agrees with the options explanation (`src/options.html:69-73`). An arbitrary broad regex such as `/.*/` is not itself a forbidden transition. Neither is substring matching a hostname-security guarantee.

## 6. Container event distribution

**States:** synchronized snapshots, container reload pending, renamed/stale, removed target retained. **Invariant:** Repository maps and menu labels refresh on identity changes. Open options pages lack an identity listener and can retain stale groups.

| From state | Event | Guard | Action | To state |
|---|---|---|---|---|
| Synchronized | Create/remove/update | Background listener runs | Start a repository container reload (`src/background.js:57-66`) | Reload pending |
| Reload pending | Another identity event | Container query is active | Record a follow-up query; retry after the current query rejects (`src/ctc-repository.js:84-121`) | Follow-up reload pending |
| Any | Create/remove/update | Menu listener runs | Queue/coalesce rebuild; remove owned parent subtree and recreate children (`src/bookmark-menu.js:29-63,213-237`) | Menu rebuilding |
| Any | Identity change while options is open | none | No options identity listener or reload (`src/options.js:47-57,121-140`) | Old options groups remain: partial ISSUE-4 |
| Reload pending | Query returns duplicate names | allowed by Firefox, A7 | Last live identity wins the name-to-ID map; reverse map retains each ID (`src/ctc-repository.js:120-133`) | New-tab target remains ambiguous: partial ISSUE-4 |
| Reload pending | Removed identity absent | none | Rebuild Maps; keep name-based stored rules (`src/ctc-repository.js:113-133`) | Unresolved rules remain dormant |

## 7. Options edit, validation, save, import, and export

**States:** loading, clean, dirty, inline-valid/invalid, validating, encoding/writing, saved, error, exported. Clean/dirty are implicit comparisons, not stored flags. Controls remain enabled during asynchronous work.

**Invariants:** The displayed saved state matches the committed snapshot. A valid runtime pattern passes save validation. Saving unchanged controls preserves routing precedence. An empty rule set is a valid committed state.

| From state | Event | Guard | Action | To state |
|---|---|---|---|---|
| New options page | DOM loaded | none | Bind controls; subscribe to debug preference changes; call `getData()` (`src/options.js:30-55,657-659`) | Loading |
| Loading | Data callback | success | Assign containers/rules; group rules by container and render (`src/options.js:104-113,124-140`) | Clean-looking grouped view |
| Loading | Data callback | failure | Show reload error (`src/options.js:115-118`) | Error |
| Clean / dirty | Select `no-rule` / Clear | none | Remove rows; set disabled type (`src/options.js:217-241,270-282`) | Dirty |
| Clean / dirty | Enable type / Add / Delete | none | Add blank row; delete or clear final row (`src/options.js:230-266`) | Dirty |
| Dirty | Pattern input | slash-wrapped / literal | Compile inner regex / accept literal (`src/options.js:286-309`) | Inline-valid/invalid |
| Any editor state | Save click | none | Collect grouped rows; trim; omit blank patterns and `no-rule` groups (`src/options.js:356-392,480-485`) | Validating |
| Validating | Empty collection | length = 0 | Encode and write the empty rule set (`src/options.js:491-521`) | Saved |
| Validating | Rule checks | errors / warnings | Block malformed records; permit warnings (`src/options.js:397-466,498-517`) | Error / encoding |
| Validating | Checks pass | No local commit active | Acquire the local commit lock; encode/write snapshot; assign `this.rules` after success (`src/options.js:526-540,553-577`) | Saved; commit lock released |
| Writing | Another save/import reaches commit | Local commit active | Reject the second commit; retain its draft (`src/options.js:526-540,574-577,697-703`) | Active commit only; cross-page stale writes remain |
| Import | Text supplied | parses as array | Validate record shape, actions, and patterns; persist replacement (`src/options.js:579-632`) | Writing |
| Import writing | Write succeeds | none | Rerender grouped view; clear input (`src/options.js:636-646`) | Saved-looking view |
| Save/import writing | Encode/write rejects | none | Show error; retain draft; release local commit lock (`src/options.js:526-540,597-602,720-723`) | Error; retry available |
| Any | Export click | Collected rule fields or order differ from saved rules | Reject export and ask the user to save (`src/options.js:612-627`) | Error |
| Any | Export click | Rule fields/order match; omitted saved priority counts as false | Display saved JSON (`src/options.js:612-638`) | Exported |
| Clean / dirty | Another context writes rules | none | No rules storage listener refreshes or invalidates this editor | Stale editor: partial ISSUE-6 |

The validator checks record shape, required field types, allowed actions, optional Boolean `highPriority`, mixed open/restricted types, restricted `*`, slash-delimited regex syntax, and duplicate-priority warnings. It does not require container names to match live identities (`src/options.js:426-520`).

## 8. Debug preference synchronization

**States:** default false, initial read pending, enabled/disabled, write pending, write failed. Each options context synchronizes its checkbox from the shared preference (`src/logging.js:31-32`).

**Invariant:** Checkbox, local flag, and committed preference agree after initialization or a storage event, unless a toggle write fails and restores the committed value.

| From state | Event | Guard | Action | To state |
|---|---|---|---|---|
| Default false | Script loads | storage supported | Start asynchronous get; register watcher (`src/logging.js:126-143,185-186`) | Read pending |
| Read pending | Get resolves | stored value exactly true | Set local flag and notify options checkbox (`src/logging.js:132-143`) | Enabled/disabled |
| Any local flag | Storage change | `sync`, matching key | Set local flag and notify options checkbox (`src/logging.js:155-174`) | Preference synchronized |
| Options startup | Checkbox setup | checkbox exists | Copy current flag; later read/change notifications keep it current (`src/options.js:60-69,94-118`) | Checkbox synchronized |
| Checkbox changed | Toggle | none | Write preference; on success update flag and checkbox (`src/options.js:76-103`) | Write pending → synchronized |
| Write pending | Write rejects | none | Restore committed checkbox/flag value; show error (`src/options.js:100-108`) | Write failed |
| Any | Direct `setDebugLoggingEnabled()` | Boolean changes | Change local flag only; no storage write (`src/logging.js:112-119`) | Context-local override |

Errors/warnings/info remain enabled regardless of the flag. Only log/debug/table emitters use it (`src/logging.js:66-75`). The setter changes only the local flag; storage listeners synchronize persisted changes.

## 9. Bookmark menus and open-all

**States:** creation submitted, population pending, populated, rebuilding, persisted-without-local-IDs, shown/hidden, visibility lookup, opening folder, partially opened, done/error. Rebuilds are serialized and reconcile the owned parent subtree (`src/bookmark-menu.js:14-63,213-240`).

**Invariants:** The cleanup IDs represent successful current children exactly once. Removed identities have no selectable menu. A fresh event-page instance removes stale owned children before repopulating.

| From state | Event | Guard | Action | To state |
|---|---|---|---|---|
| Script startup | Top-level initialization | every event-page instance | Queue a rebuild; remove the persisted parent subtree; recreate parent/default/separator, then query containers (`src/bookmark-menu.js:29-63,225-245`) | Population pending |
| Population pending | Container query resolves | none | Await each child creation; record successes and log individual failures (`src/bookmark-menu.js:69-91`) | Populated |
| Populated | Identity create/remove/update | none | Queue/coalesce rebuilds and reconcile owned subtree (`src/bookmark-menu.js:29-63,213-237`) | Rebuilding |
| Rebuilding | Another identity event | rebuild active | Queue latest container snapshot; do not start concurrent rebuild (`src/bookmark-menu.js:29-63`) | Rebuild queued |
| Populated | Event page sleeps | A4/A6 | Browser keeps menus; local array disappears (`src/bookmark-menu.js:8`) | Persisted-without-local-IDs |
| Persisted-without-local-IDs | Wake | none | Remove owned parent subtree, then recreate current children (`src/bookmark-menu.js:213-237`) | Reconciled |
| Shown/hidden | `menus.onShown` | Bookmark context and ID | Await an active rebuild, then read the bookmark and test for a missing URL (`src/bookmark-menu.js:98-109`) | Visibility lookup |
| Visibility lookup | Bookmark read succeeds | none | Await `menus.update(visible)`, then await `menus.refresh()` (`src/bookmark-menu.js:107-118`) | Shown/hidden |
| Visibility lookup | Read, update, or refresh rejects | Any awaited step | Catch and log; no rejection escapes. Visibility may be applied if refresh fails (`src/bookmark-menu.js:103-120`) | Error / partial state |
| Menu click | Our item and bookmark ID | accepted IDs | Read folder, then immediate children only (`src/bookmark-menu.js:98-115,147-157`) | Collecting URLs |
| Collecting URLs | Children read | valid URL filter | Exclude javascript/place/file and most about URLs (`src/bookmark-menu.js:159-179`) | URL list / empty |
| URL list | Open next item | index < length | Await `tabs.create`; first active; indices ≥ 10 discarded (`src/bookmark-menu.js:123-136`) | Opening next / done |
| Opening | Creation rejects | e.g. identity removed | Log and abort remaining loop; keep prior tabs (`src/bookmark-menu.js:138-140`) | Partially opened/error |
| Partial/error | User clicks again | none | Restart from first URL; no progress cursor | New batch; possible duplicate prefix |

Discarded tabs load only when activated (A2). Normal loaded bookmark tabs still pass through background routing. No manual-container bypass exists. Folder traversal is intentionally nonrecursive.

## Findings

The findings below record confirmed behavior on the original baseline `5c4227c`. Current status and regression evidence reflect HEAD `8a3a668`. Historical reproduction steps describe the original defects, not current behavior.

### F1 — Cooldowns authorize unrelated or retried requests — High — CONFIRMED
Verification: **FIXED** — Source-tab work replaces global cooldown authorization. The ISSUE-1 background suite also stops cross-container redirect cycles after five replacement hops (`test/background-issue-1-test.js`).

1. Tab A requests a URL assigned to Work from the default store.
2. The handler records URL and default→Work timestamps before awaiting creation (`src/background.js:269-282`).
3. Within two seconds, independent tab B requests that URL and returns `{}` before tab/rule evaluation (`src/background.js:221-225`).
4. Alternatively, B requests a different Work URL within 1.5 seconds and returns `{}` at the global pair check (`src/background.js:252-263`).

B loads in the wrong identity. A delayed creation is not required. If A's creation rejects, its request also proceeds incorrectly, and a retry remains suppressed. Same-tab retries within one second also return `{}` (`src/background.js:202-207,295-300`). These are request authorizations, not safe duplicate cancellations.

### F2 — Startup fails open and the advertised navigation retry does not exist — High — CONFIRMED
Verification: **FIXED, with fail-open timeout retained** — Failed initialization retries once for concurrent later requests. Requests still continue after the existing 500 ms timeout (`test/background-issue-7-test.js`).

1. A page wake starts initialization (`src/background.js:77-86`).
2. Container/rule loading takes over 500 ms; a matching navigation reaches the timer (`src/background.js:152-166`).
3. Evaluation sees empty maps or incomplete rules and permits the original store (`src/background.js:373-384`; `src/ctc-repository.js:34,198-199`).

A second path persists after an error: initialization rejects, its catch clears the Promise, and all later navigations skip the guarded wait. No code starts another initialization (`src/background.js:82-85,152-167`). A later successful rule reload does not repair a failed container load. A normal page restart retries, but the comment promising next-navigation recovery at `src/background.js:375` is false.

### F3 — Storage invalidation during decoding is lost — High — CONFIRMED
Verification: **FIXED** — A storage event during decoding queues a follow-up read; failed loads recover, and listener errors are handled (`test/repository-issue-2-test.js`).

1. A save of R1 triggers `loadRules()`; `sync.get` returns R1.
2. Gzip decoding awaits Blob/stream work (`src/storage-compression.js:252-264`).
3. A second save or sync update commits R2 and dispatches `storage.onChanged`.
4. Its listener calls `loadRules()`, which returns the existing R1 Promise (`src/background.js:49-52`; `src/ctc-repository.js:148-150`).
5. R1 publishes and the Promise clears; no following read occurs (`src/ctc-repository.js:153-180`).

Storage contains R2 while routing uses R1 until another event or page restart. Updated restrictions can remain inactive indefinitely. This sequence starts after the first read completes; it requires no undocumented ordering between that read and the second write.

### F4 — Names alias distinct identities and do not survive rename coherently — High — CONFIRMED
Verification: **PARTIAL** — Existing tabs retain their identity, rename events refresh maps, and container invalidations during active or rejected queries trigger a serial reload. Duplicate names still leave new-tab routing ambiguous; open options pages keep stale groups (`test/background-issue-4-test.js`).

1. Work identity C1 owns matching rules.
2. Firefox creates C2 with the same name Work (A7).
3. Repository loading sets Work→C2 while both reverse entries say Work (`src/ctc-repository.js:125-128`).
4. A matching request in C1 returns the name Work, then resolves it to C2 (`src/rule-engine.js:116-119`; `src/background.js:398-403`).

The request switches accounts despite a stay decision. A separate reachable transition uses rename: `onUpdated` rebuilds the menu but never the background repository (`src/background.js:55-61`; `src/bookmark-menu.js:194-196`). After the next restart/reload, rules still use the old name, so restrictions no longer bind the renamed identity. Options pages also retain old groups. The reserved label `No Container` can overwrite the built-in forward entry (`src/ctc-repository.js:120-127`).

### F5 — Removed targets win selection, then silently become the default store — High — CONFIRMED
Verification: **FIXED** — Candidate ranking excludes removed targets, so a later live match wins (`test/background-issue-4-test.js`).

1. Rules contain first `Removed: shared.example`, then `Work: shared.example`.
2. The user removes Removed; container reload removes its Map entry but leaves rules (`src/background.js:59-60`; `src/ctc-repository.js:113-128`).
3. A default-store request matches both rules.
4. The engine chooses Removed without consulting its `containerMap` argument (`src/rule-engine.js:35,88-97,129-132`).
5. The wrapper resolves the missing name to `firefox-default`, ignoring the live Work match (`src/background.js:403`).

Deleting a container or accepting an import with unknown names reaches this state without corrupt storage.

### F6 — Malformed import can replace all working rules with unusable records — High — CONFIRMED
Verification: **FIXED** — Import rejects malformed records without replacing committed rules. Prototype-like names and patterns remain safe, and legacy records without `highPriority` remain accepted (`test/options-state-machines-test.js`).

1. The user imports `[{}]` into an existing configuration.
2. The array gate passes; the validator accepts missing fields because `new RegExp(undefined)` succeeds (`src/options.js:404-444,605-612`).
3. The codec validates only the outer array and preserves `{}` (`src/storage-compression.js:158-165`).
4. Import replaces `ctcRules` before rendering (`src/options.js:631-637`).

The background now matches no pattern, so previous routing disappears (`src/pattern-matching.js:20`). Unsupported actions with valid patterns also pass validation and remain routing candidates because the engine ignores action during candidate collection (`src/rule-engine.js:89-95`). No external storage manipulation is necessary.

### F7 — Stale editors and overlapping commits overwrite newer rules — High — CONFIRMED
Verification: **PARTIAL** — A local lock prevents overlapping Save/Import commits and failed drafts can be retried. Separate stale editors and cross-profile writes remain outside that guard (`test/options-state-machines-test.js`).

1. Options pages A and B load R0 (`src/options.js:104-113`).
2. A saves R1 successfully (`src/options.js:471-475`).
3. B has no rules-change listener and edits its R0 snapshot.
4. B saves its entire array, replacing R1 without a revision check (`src/options.js:46-55,471-475`).

Unrelated changes from A are lost. Firefox Sync can produce the same stale-editor path (A5). Within one page, Save/Import controls also permit concurrent encoding and writes (`src/options.js:47-50`). An older large encode can finish after a newer small encode and commit last. Retrying a failed old snapshot has no stale-write guard. The two-page path requires no reordered API completions.

### F8 — Grouped rendering changes rule precedence on an unchanged save — High — CONFIRMED
Verification: **FIXED** — An unchanged grouped save preserves precedence, and export ignores JSON property-order differences (`test/options-state-machines-test.js`).

1. Import `[A:other.example, B:shared.example, A:shared.example]` with equal priorities.
2. From the default store, `shared.example` initially selects B by rule index (`src/rule-engine.js:129-132`).
3. Options renders groups in container order A, B (`src/options.js:124-140`).
4. Save collects `[A:other.example, A:shared.example, B:shared.example]` (`src/options.js:360-390`).
5. The next request selects A, although no control changed.

The same reorder can occur on the first save after loading existing rules. Export first reports unsaved changes because it compares raw JSON (`src/options.js:553-558`). Saving to satisfy that message changes routing. JSON property order can separately cause that false dirty result.

### F9 — Work for a closed source tab creates a replacement anyway — Medium — CONFIRMED
Verification: **FIXED** — Failed lookup or source closure creates no lasting replacement. Rejected source removal cleans up the replacement and lets the original request continue (`test/background-issue-1-test.js`).

1. A request awaits `tabs.get(A)` (`src/background.js:227-229,355`).
2. The user closes A before the read completes; the read rejects.
3. `getTabInfo()` invents a default-store, active tab (`src/background.js:361-364`).
4. A matching rule creates a foreground replacement (`src/background.js:235-238,277-282`).
5. Removing A rejects, but the Promise is not awaited or caught (`src/background.js:287`).

The closed tab reappears as a new tab. Closure after a successful read but before creation completes has the same missing ownership check. No removal-event ordering is required (A3).

### F10 — Switching a form request drops its method and body — Medium — CONFIRMED
Verification: **FIXED by preserving the original request** — Non-GET requests that need a switch continue in the source tab. The handler does not replay the body, remove the source, or cancel the request (`test/background-issue-8-test.js`).

1. A top-level form POST targets a URL assigned to a different container.
2. The `main_frame` listener accepts the POST; it has no method guard (`src/background.js:40-44,139-140,247-248`).
3. Replacement creation supplies only the URL/store/display fields (`src/background.js:277-282`; A2).
4. The handler closes the original tab and cancels the POST (`src/background.js:284-291`).

The replacement HTTP navigation uses GET; the submitted body is lost. The code neither requests `requestBody` nor has an API path to replay it safely. This is operation loss, not evidence that Firefox replays POST credentials across containers.

### F11 — Clear-all cannot commit the empty rule set — Medium — CONFIRMED
Verification: **FIXED** — Save persists `[]`; repeated save and reload preserve the empty rule set (`test/options-state-machines-test.js`).

1. The user clears every group or selects `no-rule` for each (`src/options.js:222-225,270-282`).
2. Collection returns `[]` (`src/options.js:367-369,380-389`).
3. Save warns and returns without writing (`src/options.js:487-491`).
4. Repeated Save has the same result; reload restores all old rules.

The empty state is valid: importing `[]` writes it, and the decoder returns it for absent storage (`src/options.js:605-632`; `src/storage-compression.js:222-223`). The UI cannot complete its own clear transition. Blank enabled groups can also remain displayed after a successful partial save although no rule represents them.

### F12 — Ordinary object keys make legal names and patterns unsafe — Medium — CONFIRMED
Verification: **FIXED** — `__proto__` and `constructor` container names and patterns pass safely without prototype mutation or rendering exceptions (`test/options-state-machines-test.js`).

1. A legal container named `__proto__` gets an open rule, or the user imports that rule (A7).
2. The validator uses inherited `containerRules['__proto__']` (`src/options.js:404-408`).
3. `open++` writes `Object.prototype.open = NaN`; `ruleNumbers.push` then throws (`src/options.js:409-414`).
4. The operation reports failure, but the prototype mutation remains in that options context.

A high-priority literal pattern `constructor` also throws when the inherited function receives `.push()` (`src/options.js:448-455`). Rendering uses another inherited-key dictionary (`src/options.js:128-134`). These are local mutation/save failures; no broader privilege exploit is established.

### F13 — Save validation disagrees with the runtime pattern machine — Medium — CONFIRMED
Verification: **FIXED** — Save and Import accept literal metacharacters and valid wrapped regexes, and reject invalid wrapped regexes (`test/options-state-machines-test.js`).

1. Enter literal `foo[`: inline validation accepts it, and runtime substring matching supports it (`src/options.js:305-309`; `src/pattern-matching.js:33-35`).
2. Save compiles the whole literal as regex and rejects it (`src/options.js:439-442`).

The reverse path also occurs. The three-character pattern slash–backslash–slash, JSON-encoded as `"/\\/"`, fails inline inner-regex validation. Save compiles its whole text successfully and persists it. Runtime strips the slashes, rejects the trailing escape, and returns false (`src/options.js:294-303,439-440`; `src/pattern-matching.js:29-42`). Thus a saved rule can be visibly invalid and never route.

### F14 — Menu state survives restart, but its cleanup inventory does not — Medium — CONFIRMED
Verification: **FIXED** — Startup removes persisted children for deleted identities. Overlapping events use the latest snapshot, and `onShown` awaits rebuild and visibility updates with handled failures (`test/bookmark-menu-test.js`).

1. Container X has a custom menu child; the event page suspends.
2. Firefox removes X and wakes its persistent `onRemoved` listeners (A4/A6/A7).
3. The new script starts with `containerMenuIds=[]` (`src/bookmark-menu.js:8`).
4. Startup and removal rebuild queries contain only live containers (`src/bookmark-menu.js:39,48,190-191,198-210`).
5. Neither query reconstructs X's ID, so no removal call targets its persistent child.

X remains selectable; clicking it causes invalid-store tab creation to fail. Existing IDs also get unchecked duplicate creation attempts (A6). Independently, two overlapping rebuilds can both remove the old IDs, reset the array, query the same live identities, then push duplicate IDs (`src/bookmark-menu.js:50-60,198-210`). Asynchronous create failures do not reach the surrounding `try/catch` because `menus.create()` returns an ID.

### F15 — The debug checkbox stops reflecting the preference — Low — CONFIRMED
Verification: **FIXED** — Initial preference reads, cross-context changes, and failed toggles keep the checkbox, local flag, and committed value aligned (`test/options-state-machines-test.js`).

1. An options page copies the current local flag once (`src/options.js:60-69`).
2. Another page changes the stored preference.
3. This page's logging watcher updates its flag but not its checkbox (`src/logging.js:155-174`).

The displayed control and actual logging disagree indefinitely. Startup can reach the same mismatch when the preference read completes after checkbox setup (`src/logging.js:132-134,185`; `src/options.js:42,66-68`).

## Proposed issues

Current status: ISSUE-1, ISSUE-2, ISSUE-3, ISSUE-5, and ISSUE-7 through ISSUE-12 are fixed. ISSUE-4 and ISSUE-6 are partial; see the remaining cases below.

**Regression suites:** `make test` runs `test/background-issue-1-test.js`, `test/repository-issue-2-test.js`, `test/options-state-machines-test.js`, `test/background-issue-4-test.js`, `test/background-issue-7-test.js`, `test/background-issue-8-test.js`, and `test/bookmark-menu-test.js`, plus rule-engine and compression tests. These Node tests do not replace a later Firefox smoke test.

| Priority / issue | Status | Confirmed findings | Minimal fix scope | Regression test approach through `make test` |
|---|---|---|---|---|
| P1 — **ISSUE-1: Scope redirect work to its source request** | Fixed (`35e36ce`) | F1, F9 | Track only in-flight source-tab work; release it on completion or failure. Bound replacement chains to five hops per tab within ten seconds. | `test/background-issue-1-test.js`: independent tabs; creation failure then retry; source closes during lookup/creation; rejected source removal; cross-container cycle stops at five replacement hops. |
| P1 — **ISSUE-2: Retain rule reload invalidations** | Fixed | F3 | Queue a following read when a storage event occurs during an active decode; handle listener-side reload rejection. | `test/repository-issue-2-test.js`: pause R1 decode, signal R2, then assert the following read publishes R2; cover failed-load recovery and listener errors. |
| P1 — **ISSUE-3: Reject malformed records and use safe dictionaries** | Fixed | F6, F12 | Validate imported record shape and actions before writing; use safe dictionaries for user-controlled names and patterns. Preserve legacy omitted-priority compatibility. | `test/options-state-machines-test.js`: reject malformed records without replacing committed rules; exercise `__proto__`, `constructor`, and missing `highPriority`. |
| P1 — **ISSUE-4: Resolve live names without violating stay decisions** | Partial (`85076ac`) | F4, F5 | Refresh maps on `onUpdated`; preserve current store and built-in default mapping; drain in-flight container invalidations serially, including after a rejected query; exclude unresolved candidates. Duplicate-name routing and stale open options groups remain. | `test/background-issue-4-test.js`: removed first candidate falls through; existing tabs in duplicate-name identities stay; rename refreshes maps during an active query; rejected query retries after invalidation; custom `No Container` cannot replace default. |
| P1 — **ISSUE-5: Preserve order during grouped editing** | Fixed | F8 | Preserve rule order through grouped collection and compare record values without treating property order as edits. | `test/options-state-machines-test.js`: import A-other/B-shared/A-shared, export and save unchanged, and assert B remains the winner; vary JSON property order. |
| P1 — **ISSUE-6: Prevent overlapping editor commits** | Partial | F7, local overlap subpath | A local operation lock prevents overlapping Save/Import and retains failed drafts. Separate stale editors and cross-profile writes remain; `storage.sync` has no transaction guarantee. | `test/options-state-machines-test.js`: attempt Save/Save and Save/Import while the first encode waits; cover failed writes and deliberate retry. |
| P2 — **ISSUE-7: Retry initialization after failure** | Fixed | F2, missing-retry subpath | Retry failed initialization once for concurrent later requests. Preserve the existing 500 ms fail-open timeout. | `test/background-issue-7-test.js`: fail the first load and assert concurrent requests share one retry; separately confirm delayed initialization still fails open at 500 ms. |
| P2 — **ISSUE-8: Prevent URL-only replay of non-GET requests** | Fixed | F10 | For a request that needs a switch, allow non-GET to continue in its source tab. Do not replay its body as GET, remove the source, or cancel the request. | `test/background-issue-8-test.js`: switching POST creates no replacement and preserves the source; normal GET still creates a replacement. |
| P2 — **ISSUE-9: Save intentional empty rules** | Fixed | F11 | Persist `[]` through the existing save path; keep this separate from blank-row UI behavior. | `test/options-state-machines-test.js`: clear the last rule, save twice, reload, and assert committed rules remain empty. |
| P2 — **ISSUE-10: Make save validation use runtime pattern syntax** | Fixed | F13 | Compile only slash-delimited inner regex text and accept other strings as literals. | `test/options-state-machines-test.js`: accept literal `foo[`; reject invalid wrapped regex through Save and Import; round-trip valid wrapped regex and literals. |
| P2 — **ISSUE-11: Reconcile the owned menu subtree** | Fixed (`8a3a668`) | F14 | Serialize/coalesce rebuilds; remove and recreate only the owned parent subtree; record only successful children. Make `onShown` await active rebuilds, `menus.update`, and `menus.refresh` in one error handler. | `test/bookmark-menu-test.js`: remove X while the first page sleeps; overlap identity events; verify unique children and handled creation errors; assert `onShown` waits for rebuild and menu updates and handles update failure. |
| P3 — **ISSUE-12: Refresh the debug checkbox from preference state** | Fixed | F15 | Update the control after initial preference load and later preference changes; restore committed state after write failure. | `test/options-state-machines-test.js`: delay the initial read, deliver another page's change, and reject a toggle write; assert control, flag, and committed value agree. |

### Deferred

- **Fail-closed startup and a visible navigation-retry page — design choice / feature; needs user decision.** Initialization retries after failure; the existing 500 ms timeout remains fail-open.
- **Portable identity registry, local binding migration, and explicit profile mapping — broad feature; needs user decision.** Name-based rules enable sync across profiles. F4/F5 have smaller live-map and selection repairs.
- **Automatic rule migration after rename — design choice; needs user decision.** Renaming a container changes its name-based rule target. Refreshing live maps is a bug fix; silently rewriting synced rules changes their meaning in other profiles.
- **Duplicate-name/default-label ambiguity policy — design choice; needs user decision.** Preserve existing-tab identity and the built-in default now. Choosing which same-named identity receives a new routed tab needs an explicit policy, not an unannounced identity-system rewrite.
- **Multi-editor stale-write rejection and a background commit broker — larger feature; needs user decision.** Local overlapping commits are prevented. Separate stale editors still need a conflict policy; an event listener or pre-save read is not atomic compare-and-set.
- **Cross-profile transactional merge — inherent platform limit plus feature.** `storage.sync` cannot supply compare-and-set. Do not promise that a same-profile broker prevents cross-profile overwrites.
- **Transparent POST body replay and a form-resubmission error page — platform limit / feature.** The current policy allows a switching non-GET request in its source tab; transparent body replay is not attempted.
- **Blank enabled-group normalization — separate UI behavior.** F11's empty-array repair does not require rerendering or rejecting all blank groups.
- **General repository generations, request-state-machine replacement, or DOM/browser framework — broad rewrites.** Add only state needed for the named failing schedules.
- **Serializing debug toggle writes — separate overlap safeguard.** Preference-to-control updates are synchronized. The tests do not establish a need for a new global preference framework.

## Validation and limits

- **Verified at HEAD (`8a3a668`):** `make test` and `make lint` pass.
- **Verified:** Regression suites cover redirect isolation and cleanup, rule reload invalidation, live target selection, initialization retry with the 500 ms fail-open, non-GET source-tab behavior, malformed imports, editor concurrency, precedence, empty rules, pattern syntax, menu reconciliation, and debug preference synchronization.
- **Not run:** Manual Firefox smoke test.
- **API verification:** Current MDN contracts and Firefox source support the API facts above. Actual event schedules still need Firefox smoke tests.
- **Next check:** Verify actual tab and menu event traces in Firefox.
- **Excluded:** Mid-request suspension loss, a claimed redirect deadlock, strict cross-API callback order, and an unbounded idle Map leak. The reviewed contracts do not establish those failures.
- No standalone SUSPECTED finding is retained. Findings require the concrete paths above, not only comments or hypothetical API behavior.

[before-request]: https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/webRequest/onBeforeRequest
[tabs-create]: https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/tabs/create
[tabs-remove]: https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/tabs/remove
[tabs-removed]: https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/tabs/onRemoved
[background-manifest]: https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/background
[background-lifecycle]: https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Background_scripts
[storage-sync]: https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/storage/sync
[storage-changed]: https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/storage/onChanged
[menus-create]: https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/menus/create
[menus-child]: https://github.com/mozilla-firefox/firefox/blob/main/browser/components/extensions/child/ext-menus.js
[identity-api]: https://github.com/mozilla-firefox/firefox/blob/main/toolkit/components/extensions/parent/ext-contextualIdentities.js
[identity-service]: https://github.com/mozilla-firefox/firefox/blob/main/toolkit/components/contextualidentity/ContextualIdentityService.sys.mjs
[menus-parent]: https://raw.githubusercontent.com/mozilla-firefox/firefox/main/browser/components/extensions/parent/ext-menus.js
[menus-store]: https://raw.githubusercontent.com/mozilla-firefox/firefox/main/toolkit/components/extensions/ExtensionMenus.sys.mjs
