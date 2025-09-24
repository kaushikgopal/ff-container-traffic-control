# Container Traffic Control

Container Traffic Control (CTC) is a Firefox extension that automatically manages which container websites open in, based on rules you define. It works with Firefox's [Multi-Account Containers](https://addons.mozilla.org/en-US/firefox/addon/multi-account-containers/) feature to provide enhanced privacy and organization.

<img width="1450" height="2543" alt="screenshot_20250923_002913@2x" src="https://github.com/user-attachments/assets/bb0a9dbf-242e-43b8-96e8-cb7c397e9101" />


## Why Use Container Traffic Control?

- **Stay Organized**: Automatically open work sites in your Work container, social sites in Social container, etc.
- **Enhanced Privacy**: Keep different types of browsing completely separated
- **Smart Defaults**: Stay in your current container when possible, switch only when needed
- **Flexible Rules**: Create simple or complex patterns to match the sites you visit

There are [other](https://github.com/kintesh/containerise) [similar](https://github.com/mcortt/Conductor/tree/main) extensions, but CTC offers a unique rule system designed for clarity and predictable behavior.

## How Container Traffic Control Works

CTC uses a simple preference system:

1. **Stay Put**: If your current container accepts the URL, you stay there
2. **Restricted Containers**: If you're in a container with "Allow Only" rules and click a non-matching link, you'll be moved out
3. **Finding a Match**: When switching containers, high-priority rules win first
4. **Default**: If no rules match, opens in "No Container" (regular browsing)

## Rule Types

### Allow Rules (Open Containers)
- Container accepts specified URLs **plus any others**
- Example: Social container allows `facebook.com` but you can still browse other sites in it

### Allow Only Rules (Restricted Containers)
- Container **ONLY** accepts specified URLs
- Example: Work container only allows `company.com` - clicking other links moves you out
- **Important**: A container cannot mix "Allow" and "Allow Only" rules

## Example Scenarios

**Scenario 1: Stay in Current Container**
- You're in Personal container browsing GitHub
- Personal container has: Allow `github.com`
- Result: Stay in Personal (current container preference)

**Scenario 2: High Priority Selection**
- You're in No Container and click a GitHub link
- Rules: Work (Allow `github.com`, HIGH priority), Personal (Allow `github.com`, NORMAL)
- Result: Open in Work container (high priority wins)

**Scenario 3: Restricted Container Boot-Out**
- You're in Work container (Allow Only `work.com`)
- You click a Facebook link
- Result: Move to container that allows Facebook, or No Container if none match

## Installation

Install from [addons.mozilla.org](https://addons.mozilla.org/en-US/firefox/addon/container-traffic-control/) (coming soon)

## Setting Up Rules

1. Right-click the CTC icon → "Manage Extension" → "Options"
2. Configure containers:
   - **Type**: Choose "No Rule" (disabled), "🌐 Open", or "🔒 Restricted" for each container
   - **URL Patterns**: Add multiple URL patterns per container using the "+" button
   - **High Priority**: Set priority per URL pattern to override conflicts
   - **Clear**: Remove all URL patterns from a container
3. Click "Save Rules" (available at top and bottom of the page)

### Container Management
- **All containers** are shown by default, even unused ones
- **No Rule**: Container is inactive (no URL patterns will match)
- **🌐 Open**: Container accepts specified URLs plus any others
- **🔒 Restricted**: Container ONLY accepts specified URLs

## URL Patterns

CTC supports two pattern modes for maximum flexibility:

### Simple Patterns (Recommended)
Just type the domain or URL part you want to match:

- `github.com` - Matches any URL containing "github.com"
- `mail.google.com` - Matches Gmail URLs
- `facebook.com` - Matches Facebook URLs
- `company.com` - Matches your company's sites

### Advanced Patterns (Regex)
For complex matching, wrap patterns in forward slashes:

- `/.*\.google\.com/` - All Google subdomains (drive, mail, etc.)
- `/.*\.(facebook|twitter|instagram)\.com/` - Multiple social media sites
- `/^https:\/\/github\.com\/myusername/` - Only your GitHub repositories
- `/mail\..*/` - Any site starting with "mail."

### Which Should You Use?

- **Simple patterns** for most use cases - easier and more reliable
- **Advanced patterns** when you need precise control or complex matching

**Privacy Tip**: Use specific patterns when possible to maintain container isolation.

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
