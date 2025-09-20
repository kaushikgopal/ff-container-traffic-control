// Shared utilities for Container Traffic Control
// This file provides common functions used across background and options scripts

const DEBUG = true; // Could be made configurable via storage in the future

/**
 * Creates bound console methods with CTC formatting and debug control
 * @returns {Object} Console object with CTC-prefixed methods
 */
function createCtcConsole() {
    const ctcConsole = {
        // Always-on methods (errors, warnings, important info)
        error: console.error.bind(console, '[CTC]'),
        warn: console.warn.bind(console, '[CTC]'),
        info: console.info.bind(console, '[CTC]'),

        // Debug-controlled methods (only active when DEBUG is true)
        log: DEBUG ? console.log.bind(console, '[CTC]') : () => {},
        debug: DEBUG ? console.log.bind(console, '[CTC DEBUG]') : () => {},

        // Utility methods for enhanced debugging
        table: DEBUG ? console.table.bind(console) : () => {},
        group: DEBUG ? console.group.bind(console, '[CTC]') : () => {},
        groupEnd: DEBUG ? console.groupEnd.bind(console) : () => {},
        groupCollapsed: DEBUG ? console.groupCollapsed.bind(console, '[CTC]') : () => {},
    };

    return ctcConsole;
}

// Create and export the console instance
const ctcConsole = createCtcConsole();

// Make available globally for both background and options scripts
if (typeof window !== 'undefined') {
    window.ctcConsole = ctcConsole;
} else {
    // For background scripts that might not have window object
    globalThis.ctcConsole = ctcConsole;
}
