---
name: Bug report
about: Report a bug or issue you're running into
title: ''
labels: ''
assignees: ''

---

# Bug description
A clear and concise description of what the bug is.

# Screenshots
If applicable, add screenshots to help explain your problem. A video is even better!

# Logs

The quickest way to get your issue addressed is provide useful logs. Here's how you can do that:

## I - Enable debug logging

1. open a new tab and enter `about:addons`
2. Container Traffic Control > 3 dots > **Preferences**
3. make sure "**Enable debug logging**" checkbox is checked

## II - attach console logs

1. open a new tab and enter `about:debugging#/runtime/this-firefox`
2. Container Traffic Control > **Inspect** - should open up the console
3. __Reproduce the bug or issue you're running into__
4. Right click anywhere in console hit "**save all messages to a file**"

Attach the file that gets downloaded to your computer with this issue.

## III - attach Rules json

1. open a new tab and enter `about:addons`
2. Container Traffic Control > 3 dots > **Preferences**
3. All the way at the bottom, locate **Import/Export Rules**
4. click Export > copy the `.json` that's displayed manually
5. Paste it with this ticket
