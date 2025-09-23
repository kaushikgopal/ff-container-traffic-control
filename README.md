# Container Traffic Control

Container Traffic Control (CTC) is a Firefox extension that automatically manages which container websites open in, based on rules you define. It works with Firefox's [Multi-Account Containers](https://addons.mozilla.org/en-US/firefox/addon/multi-account-containers/) feature to provide enhanced privacy and organization.

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
3. **Finding a Match**: When switching containers, high-priority rules win, then first matching rule
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
2. Add rules with:
   - **Container**: Which container the rule applies to
   - **Action**: "Allow" (open container) or "Allow Only" (restricted container)
   - **URL Pattern**: Simple domain or advanced regex pattern (see examples below)
   - **High Priority**: Give this rule precedence over others
3. Click "Save Rules"

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
3. Run the extension: `cd src/ && web-ext run`
4. Firefox will launch with the extension loaded

## Alternative: Manual Loading
1. Open Firefox → `about:debugging`
2. Click "This Firefox" → "Load Temporary Add-on"
3. Select `src/manifest.json`

## Debugging
- Go to `about:debugging` → Find "Container Traffic Control" → Click "Inspect"
- Console logs appear in DevTools Console tab
- View extension storage in DevTools → Storage tab

For detailed development guidance, see [AGENTS.md](AGENTS.md)

## License

This project is licensed under the Apache 2.0 License. See the [LICENSE](LICENSE) file for details.

For attribution notices and copyright information, see the [NOTICE](NOTICE) file.
