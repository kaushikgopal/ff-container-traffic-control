<div align="center">
<img width="200" alt="CTC icon" src="./icons/icon.png" />
</div>

# Container Traffic Control

Container Traffic Control (CTC) is a Firefox extension that automatically manages which container websites open in, based on rules you define. Works with Firefox's [Multi-Account Containers](https://addons.mozilla.org/en-US/firefox/addon/multi-account-containers/).

# Why Use Container Traffic Control?

Other [container](https://github.com/kintesh/containerise) [extensions](https://github.com/mcortt/Conductor/tree/main) exist, but they often lack control when you need it most. You end up fighting the setup rather than using containers effortlessly.

This extension uses a rule-based mechanism designed for how containers are actually used in practice.

### General Concept

[Firefox Containers](https://support.mozilla.org/en-US/kb/how-use-firefox-containers) let you open two Gmail tabs in the same window with different profiles—one for work, one for personal.

### Example 1: Multiple GitHub Profiles

You have work and personal GitHub accounts. Your work account uses SSO (Okta), and you want `github.com/company-name/*` links to open in your Work container while `github.com/username/*` opens in Personal.

When you click a GitHub link from email or Slack, your options without CTC are:
- Right-click → open in specific container
- Create new tab in that container → copy/paste the link

This gets tedious fast.

### Example 2: YouTube Premium

You have multiple Google profiles with separate containers. You subscribe to YouTube Premium on your personal account, so you want all YouTube links to open there (no ads), regardless of where you click them—work email, personal email, Slack, etc.

CTC automatically routes all YouTube links to your Personal container.

### Example 3: Google Docs Account Routing

You want `https://docs.google.com/document/u/0/*` to open in Personal and `https://docs.google.com/document/u/1/*` to open in Work.

CTC supports both simple URL patterns and regex, giving you precise control over routing.

These are the primary use cases. CTC also handles subtle scenarios like open/restricted containers and seamless redirects when switching containers.

# Features

- Intuitive Rule setup for Containers (explained below)
- Open all bookmarks in a container (right-click any bookmark folder)
- uses Firefox's native add-on sync across all platforms
- quick export/import of settings


## Intuitive Rule setup

1. CTC lists all your existing containers
2. Mark each container as "open" (accepts these URLs + any others) or "restricted" (only these URLs)
3. Add URL patterns—simple strings like `github.com` or regex like `/.*\.github\.com/`

Now use Firefox normally. CTC acts as traffic control, routing links to the right containers automatically.

<img width="1452" height="1146" alt="screenshot_20250928_002931@2x" src="https://github.com/user-attachments/assets/1e68dcaf-29f5-49eb-9017-9ffa0521d2a5" />
<img width="1628" height="2841" alt="screenshot_20250928_002932@2x" src="https://github.com/user-attachments/assets/696217c6-56f2-4aaf-a441-660c74f460c8" />

## Open All Bookmarks in Container

Right-click any bookmark folder and select "Open All in Container" to open all bookmarks in a specific container. Pick from No Container or any of your existing containers. This is useful when you have a folder of work-related bookmarks and want to open them all in your Work container at once.

# Installation & Development

Install from [addons.mozilla.org](https://addons.mozilla.org/en-US/firefox/addon/ctc/) directly

## Manual Loading

Firefox → `about:debugging` → "This Firefox" → "Load Temporary Add-on" → select `manifest.json`

## Debugging

`about:debugging` → "Container Traffic Control" → "Inspect" (console logs in DevTools Console; storage in Storage tab)

Options → “Enable debug logging” checkbox flips verbose console output on demand; it is unchecked by default to keep consoles quiet.

For detailed development guidance, see [AGENTS.md](AGENTS.md).

### Available Commands

```bash
make help    # Show all available commands
make build   # Build extension package (default)
make test    # Run unit tests for rule engine
make lint    # Validate extension code and manifest
make run     # Run extension in Firefox for development
make release # Tag the manifest version and push it to publish
make clean   # Remove build artifacts
```

### Quick Start

1. Clone this repository
2. Install web-ext: `brew install web-ext`
3. Build and test: `make build && make test`
4. Run the extension: `make run`

## On testing

```bash
make test  # Run rule engine tests
```

Tests cover pattern matching, rule evaluation, container switching, priority handling, and edge cases. Located in `test/rule-engine-test.js` (runnable as `node test/rule-engine-test.js`). No external dependencies.

## Releasing

Releases are automated with GitHub Actions. You never upload a package to addons.mozilla.org (AMO) by hand.

- **CI** (`.github/workflows/ci.yml`) runs `make test` and `make lint` on every push to `master` and on every pull request.
- **Release** (`.github/workflows/release.yml`) runs when a `v<version>` tag is pushed. It checks that the tag matches `manifest.json` and that `CHANGELOG.md` has an entry for that version. Then it runs the tests and lint, builds the package, and submits it to AMO on the listed channel. Last, it creates a GitHub release with the changelog entry and the built zip.
- The workflow does not wait for AMO review. Firefox users get the update after Mozilla approves it.

### Release a new version

1. Pick the next version. The format is `YY.M.N`: two-digit year, month, and release number in that month. Example: the first release in November 2026 is `26.11.1`.
2. Set `version` in `manifest.json`.
3. Add a `## [<version>] - <short title>` entry at the top of `CHANGELOG.md`. List each change as `- bug fix: ...` or `- feature: ...`.
4. Commit both files on `master` as `Release version <version>`.
5. Push `master`: `git push origin master`.
6. Wait for the CI run to pass: `gh run watch`.
7. Run `make release`.
8. Watch the release run: `gh run watch`.
9. Check the review status at https://addons.mozilla.org/en-US/developers/addon/ctc/versions.

`make release` refuses to tag unless all of these are true:

- You are on `master` with no uncommitted changes to tracked files.
- Local `master` matches `origin/master`.
- The tag `v<version>` does not exist yet.
- `CHANGELOG.md` has an entry for the version.
- The CI run for the current commit passed.

If the release run fails before the AMO submission, fix the cause, then delete the tag on GitHub and locally (`git push origin :v<version>` and `git tag -d v<version>`). Then run `make release` again. If AMO already accepted the version, bump the version instead. AMO never accepts the same version number twice.

### One-time setup

This setup is already done for this repository. Repeat it only if you rotate the AMO credentials.

1. Sign in at https://addons.mozilla.org/developers/addon/api/key/ and generate new credentials.
2. Create the GitHub environment `amo` (once): `gh api -X PUT repos/kaushikgopal/ff-container-traffic-control/environments/amo`.
3. Run `gh secret set AMO_JWT_ISSUER --env amo -R kaushikgopal/ff-container-traffic-control`, then paste the JWT issuer at the prompt.
4. Run `gh secret set AMO_JWT_SECRET --env amo -R kaushikgopal/ff-container-traffic-control`, then paste the JWT secret at the prompt.
5. Check both secrets: `gh secret list --env amo -R kaushikgopal/ff-container-traffic-control`.

NOTE: Paste secrets at the `gh` prompt. Do not pass them with `--body`, because the shell then saves them in its history.

## Changelog

See [CHANGELOG.md](CHANGELOG.md).

## License

This project is licensed under the Apache 2.0 License. See the [LICENSE](LICENSE) file for details.

For attribution notices and copyright information, see the [NOTICE](NOTICE) file.
