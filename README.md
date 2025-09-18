# Container Traffic Control

This is a Firefox addon (extension) that helps you define rules which will control which container a website opens in. [Multi-Account Containers](https://addons.mozilla.org/en-US/firefox/addon/multi-account-containers/) is a unique feature of Firefox that provides [Total Cookie Protection](https://support.mozilla.org/en-US/kb/introducing-total-cookie-protection-standard-mode).

There are [some](https://github.com/kintesh/containerise) [other](https://github.com/mcortt/Conductor/tree/main) add-ons that achieve very similar functionality, but I haven't found one that fit my logical flow of rules.

I eventually wrote this add-on to scratch my own itch and is hopefully simple enough for most people to understand and use.

# How to Use CTC

# Installing the add-on

Install the official extension from [addons.mozilla.org](https://addons.mozilla.org/en-US/firefox/addon/container-traffic-control/).

# Development

To run an example extension:

1. Open Firefox and load the about:debugging page. Click [Load Temporary Add-on](https://developer.mozilla.org/en-US/Add-ons/WebExtensions/Temporary_Installation_in_Firefox) and select the `manifest.json` file within the folder of an example extension.
2. Install the [web-ext](https://developer.mozilla.org/en-US/Add-ons/WebExtensions/Getting_started_with_web-ext) tool. At the command line, open the example extension's folder and type web-ext run. This launches Firefox and installs the extension automatically. This tool provides some additional development features, such as [automatic reloading](https://developer.mozilla.org/en-US/Add-ons/WebExtensions/Getting_started_with_web-ext#Automatic_extension_reloading).

```
# for macOS
brew install web-ext
```

## License

This project is licensed under the Apache 2.0 License. See the [LICENSE](LICENSE) file for details.

For attribution notices and copyright information, see the [NOTICE](NOTICE) file.
