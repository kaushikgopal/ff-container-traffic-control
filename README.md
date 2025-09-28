<div align="center">
<img width="200" alt="CTC icon" src="./icons/icon.png" />
</div>

# Container Traffic Control

Container Traffic Control (CTC) is a Firefox extension that automatically manages which container websites open in, based on rules you define. It works with Firefox's [Multi-Account Containers](https://addons.mozilla.org/en-US/firefox/addon/multi-account-containers/) feature to provide enhanced privacy and organization.

## Why Use Container Traffic Control?

There are [various](https://github.com/kintesh/containerise) [add-ons](https://github.com/mcortt/Conductor/tree/main) that attempt to control which websites open up in a container but it always felt lacking. Those few times you don't have control, you land up fighting the container setup more than just using it effortlessly for your privacy.

I created this extension based on my own experience of using containers and various other add-ons. I came up with this mechanism of setting rules because it felt closest to how i wanted to leverage and use Containers.

## How Container Traffic Control Works

- We list out all the existing containers
- You start by marking the container as "open" or "restricted"
- You provide a url pattern (either a simple url or complex regex - we accept both)

... now just use Firefox normally and CTC will add as a traffic controller for your websites and containers.

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

The extension includes a comprehensive test suite for rule evaluation logic:

```bash
# Run all tests
make test

# Tests cover:
# - Pattern matching (simple and regex patterns)
# - Rule evaluation scenarios
# - Container switching logic
# - Priority handling
# - Edge cases and error conditions
```

Tests are located in `test/rule-engine-test.js` and can be run independently with `node test/rule-engine-test.js`. The test framework is simple and doesn't require additional dependencies.

## Alternative: Manual Loading
1. Open Firefox → `about:debugging`
2. Click "This Firefox" → "Load Temporary Add-on"
3. Select `manifest.json` (in project root)

## Debugging
- Go to `about:debugging` → Find "Container Traffic Control" → Click "Inspect"
- Console logs appear in DevTools Console tab
- View extension storage in DevTools → Storage tab

For detailed development guidance, see [AGENTS.md](AGENTS.md)

## License

This project is licensed under the Apache 2.0 License. See the [LICENSE](LICENSE) file for details.

For attribution notices and copyright information, see the [NOTICE](NOTICE) file.
