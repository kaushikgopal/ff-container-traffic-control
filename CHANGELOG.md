# Changelog

All notable changes to Container Traffic Control will be documented in this
file.

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
