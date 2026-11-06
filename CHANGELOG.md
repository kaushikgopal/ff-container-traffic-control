# Changelog

All notable changes to Container Traffic Control will be documented in this
file.

## [26.11.1] - routing and rule-safety fixes

- bug fix: container switches no longer let unrelated tabs or retries skip
  routing; redirect loops between containers are bounded
- bug fix: closed tabs are no longer reopened by pending container switches
- bug fix: form submissions (POST) continue in the current tab instead of being
  reloaded without their data
- bug fix: routing recovers after a failed startup without a browser restart
- bug fix: rule and container changes made during a reload are no longer lost
- bug fix: rules for removed containers no longer block a valid match; renamed
  containers are picked up immediately
- bug fix: invalid import files no longer replace existing rules
- bug fix: saving the options page keeps rule order and precedence
- bug fix: overlapping saves no longer overwrite newer rules
- bug fix: an empty rule list can be saved
- bug fix: save validation now matches runtime pattern matching
- bug fix: bookmark menus drop removed containers after a restart
- bug fix: debug logging checkbox stays in sync with the saved setting

## [26.2.2] - open all bookmarks in container

- feature: right-click bookmark folders to open all bookmarks in a selected
  container ("Open All in Container" submenu)

## [26.2.1] - background tab fix

- bug fix: preserve background tab state when switching containers
  (Cmd+Shift+click now keeps tabs in background)

## [25.10.3] - cold start fix

- bug fix: fixed cold start issue where first redirect wouldn't apply container

## [25.10.2] - rule compression + debug log preferences

- feature: added rule compression using gzip to maximize storage capacity
- feature: debug logging toggle in options page to control verbose logging
- bug fix: prevent duplicate container switches in redirect chains with generic
  cooldown tracking

## [25.9.4] - export/import feature

- add: Export/import functionality for extension options

## [25.9.3] - refactor

- feat: simplified rules ui system
- fix: rules

## [25.9.2] - Initial Release

- [Read about](https://kau.sh/blog/container-traffic-control/) how I created
  this add-on here
