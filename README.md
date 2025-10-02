<div align="center">
<img width="200" alt="CTC icon" src="./icons/icon.png" />
</div>

# Container Traffic Control

Container Traffic Control (CTC) is a Firefox extension that automatically manages which container websites open in, based on rules you define. Works with Firefox's [Multi-Account Containers](https://addons.mozilla.org/en-US/firefox/addon/multi-account-containers/).

## Why Use Container Traffic Control?

Other [container](https://github.com/kintesh/containerise) [extensions](https://github.com/mcortt/Conductor/tree/main) exist, but they often lack control when you need it most. You end up fighting the setup rather than using containers effortlessly.

This extension uses a rule-based mechanism designed for how containers are actually used in practice.

## Examples

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

## How It Works

1. CTC lists all your existing containers
2. Mark each container as "open" (accepts these URLs + any others) or "restricted" (only these URLs)
3. Add URL patterns—simple strings like `github.com` or regex like `/.*\.github\.com/`

Now use Firefox normally. CTC acts as traffic control, routing links to the right containers automatically.

<img width="1452" height="1146" alt="screenshot_20250928_002931@2x" src="https://github.com/user-attachments/assets/1e68dcaf-29f5-49eb-9017-9ffa0521d2a5" />
<img width="1628" height="2841" alt="screenshot_20250928_002932@2x" src="https://github.com/user-attachments/assets/696217c6-56f2-4aaf-a441-660c74f460c8" />


## Installation

Install from [addons.mozilla.org](https://addons.mozilla.org/en-US/firefox/addon/ctc/) directly


# Development

## Quick Start

1. Clone this repository
2. Install web-ext: `brew install web-ext`
3. Build and test: `make build && make test`
4. Run the extension: `make run`

## Available Commands

```bash
make help    # Show all available commands
make build   # Build extension package (default)
make test    # Run unit tests for rule engine
make lint    # Validate extension code and manifest
make run     # Run extension in Firefox for development
make clean   # Remove build artifacts
```

## Testing

```bash
make test  # Run rule engine tests
```

Tests cover pattern matching, rule evaluation, container switching, priority handling, and edge cases. Located in `test/rule-engine-test.js` (runnable as `node test/rule-engine-test.js`). No external dependencies.

## Manual Loading
Firefox → `about:debugging` → "This Firefox" → "Load Temporary Add-on" → select `manifest.json`

## Debugging
`about:debugging` → "Container Traffic Control" → "Inspect" (console logs in DevTools Console; storage in Storage tab)

For detailed development guidance, see [AGENTS.md](AGENTS.md).

## Changelog

See [CHANGELOG.md](CHANGELOG.md).

## License

This project is licensed under the Apache 2.0 License. See the [LICENSE](LICENSE) file for details.

For attribution notices and copyright information, see the [NOTICE](NOTICE) file.
