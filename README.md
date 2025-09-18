# Container Traffic Control

This is a Firefox addon (extension) that helps you define rules which will control which container a website opens in. [Multi-Account Containers](https://addons.mozilla.org/en-US/firefox/addon/multi-account-containers/) is a unique feature of Firefox that provides [Total Cookie Protection](https://support.mozilla.org/en-US/kb/introducing-total-cookie-protection-standard-mode).

There are [some](https://github.com/kintesh/containerise) [other](https://github.com/mcortt/Conductor/tree/main) add-ons that achieve very similar functionality, but I haven't found one that fit my logical flow of rules.

I eventually wrote this add-on to scratch my own itch and is hopefully simple enough for most people to understand and use.

# How to Use CTC

# Installing the add-on

Install the official extension from [addons.mozilla.org](https://addons.mozilla.org/en-US/firefox/addon/container-traffic-control/).

# Development

## Quick Start

1. Clone this repository
2. Load the extension in Firefox using one of the methods below
3. The extension will log "Container Traffic Control add-on loaded" to the console

## Loading the Extension

### Method 1: Temporary Installation (Quick Testing)
1. Open Firefox
2. Navigate to `about:debugging`
3. Click "This Firefox" in the left sidebar
4. Click "Load Temporary Add-on"
5. Navigate to the `src/` folder and select `manifest.json`
6. Extension loads immediately (removed on Firefox restart)

### Method 2: Using web-ext (Recommended for Development)
1. Install web-ext:
   ```bash
   # macOS
   brew install web-ext

   # Alternative via npm
   npm install -g web-ext
   ```

2. Run from the `src/` directory:
   ```bash
   cd src/
   web-ext run
   ```
   This launches Firefox with auto-installation and hot reloading.

## Debugging

### Console Logs
1. Go to `about:debugging`
2. Find "Container Traffic Control" and click "Inspect"
3. Open Console tab to see background script logs

### Extension Storage
- Use Firefox DevTools → Storage tab to inspect extension data
- Or programmatically: `browser.storage.local.get()`

### Common Issues
- **Permission errors**: Check `manifest.json` permissions match your API usage
- **Console not showing logs**: Ensure you're inspecting the background script, not content script
- **Extension not loading**: Verify `manifest.json` syntax and required fields

## Development Workflow

1. Make changes to source files
2. If using `web-ext run`: Changes auto-reload
3. If using temporary installation: Go to `about:debugging` → Reload extension
4. Check console for errors
5. Test functionality

## Testing Container APIs

The extension has access to Firefox's Contextual Identities API:
- `browser.contextualIdentities.query()` - List containers
- `browser.contextualIdentities.create()` - Create containers
- `browser.tabs.create({cookieStoreId})` - Open tab in specific container

## License

This project is licensed under the Apache 2.0 License. See the [LICENSE](LICENSE) file for details.

For attribution notices and copyright information, see the [NOTICE](NOTICE) file.
