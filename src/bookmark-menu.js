// Bookmark Context Menu for Container Opening
// Adds "Open All in Container" menu to bookmark folders

const BOOKMARK_MENU_ID = "ctc-open-all-in-container";
const LAZY_LOAD_THRESHOLD = 10;

// Track container menu item IDs for efficient updates
let containerMenuIds = [];

// ============================================================================
// MENU CREATION: Set up context menu structure on extension startup
// ============================================================================

function createBookmarkContextMenu() {
  // Parent menu item - only shows on bookmark folders
  browser.menus.create({
    id: BOOKMARK_MENU_ID,
    contexts: ["bookmark"],
    title: "Open All in Container"
  });

  // "No Container" option at top
  browser.menus.create({
    id: "ctc-no-container",
    parentId: BOOKMARK_MENU_ID,
    contexts: ["bookmark"],
    title: "No Container"
  });

  // Separator between "No Container" and actual containers
  browser.menus.create({
    id: "ctc-separator",
    parentId: BOOKMARK_MENU_ID,
    contexts: ["bookmark"],
    type: "separator"
  });

  // Populate with available containers
  populateContainerMenuItems();
}

// ============================================================================
// CONTAINER SUBMENU: Dynamically populate with available containers
// ============================================================================

async function populateContainerMenuItems() {
  try {
    const containers = await browser.contextualIdentities.query({});

    for (const container of containers) {
      browser.menus.create({
        id: container.cookieStoreId,
        parentId: BOOKMARK_MENU_ID,
        contexts: ["bookmark"],
        title: container.name,
        icons: {
          16: `resource://usercontext-content/${container.icon}.svg`
        }
      });
      containerMenuIds.push(container.cookieStoreId);
    }
  } catch (error) {
    ctcConsole.error("Failed to populate container menu:", error);
  }
}

// ============================================================================
// DYNAMIC MENU UPDATES: Show/hide based on bookmark type (folder vs single)
// ============================================================================

browser.menus.onShown.addListener(async (info) => {
  if (!info.contexts.includes("bookmark") || !info.bookmarkId) {
    return;
  }

  try {
    const [bookmark] = await browser.bookmarks.get(info.bookmarkId);
    // Folders don't have a url property - more reliable than checking type
    const isFolder = !bookmark.url;

    ctcConsole.log(`Bookmark menu check: id=${info.bookmarkId}, url=${bookmark.url}, type=${bookmark.type}, isFolder=${isFolder}`);

    // Hide menu for single bookmarks (they already have container options)
    browser.menus.update(BOOKMARK_MENU_ID, {
      visible: isFolder
    });

    browser.menus.refresh();
  } catch (error) {
    ctcConsole.error("Failed to update bookmark menu visibility:", error);
  }
});

// ============================================================================
// CLICK HANDLER: Open bookmarks in selected container
// ============================================================================

browser.menus.onClicked.addListener(async (info) => {
  // Only handle our menu items
  if (!info.bookmarkId) {
    return;
  }

  // Check if this is our menu or a child of it
  const isOurMenu = info.menuItemId === BOOKMARK_MENU_ID ||
                    info.menuItemId === "ctc-no-container" ||
                    info.parentMenuItemId === BOOKMARK_MENU_ID;

  if (!isOurMenu) {
    return;
  }

  try {
    // Get bookmark URLs from folder
    const urls = await getBookmarkUrlsFromFolder(info.bookmarkId);

    if (urls.length === 0) {
      ctcConsole.log("No bookmarks to open in folder");
      return;
    }

    // Determine container
    const cookieStoreId = info.menuItemId === "ctc-no-container"
      ? "firefox-default"
      : info.menuItemId;

    ctcConsole.info(`Opening ${urls.length} bookmarks in container: ${cookieStoreId}`);

    // Open tabs
    for (let i = 0; i < urls.length; i++) {
      await browser.tabs.create({
        url: urls[i],
        cookieStoreId: cookieStoreId === "firefox-default" ? undefined : cookieStoreId,
        active: i === 0,  // First tab is active
        discarded: i >= LAZY_LOAD_THRESHOLD  // Lazy-load after threshold
      });
    }
  } catch (error) {
    ctcConsole.error("Failed to open bookmarks in container:", error);
  }
});

// ============================================================================
// HELPERS: Extract URLs from bookmark folder
// ============================================================================

async function getBookmarkUrlsFromFolder(bookmarkId) {
  try {
    const [bookmark] = await browser.bookmarks.get(bookmarkId);

    // Only process folders (folders don't have url property)
    if (bookmark.url) {
      return [];
    }

    // Get immediate children only (not recursive)
    const children = await browser.bookmarks.getChildren(bookmarkId);

    // Extract URLs, filtering out invalid ones
    const urls = children
      .map(child => child.url)
      .filter(url => url && isValidBookmarkUrl(url));

    return urls;
  } catch (error) {
    ctcConsole.error("Failed to get bookmark URLs:", error);
    return [];
  }
}

function isValidBookmarkUrl(url) {
  // Filter out non-openable URLs
  if (!url) return false;
  if (url.startsWith("javascript:")) return false;
  if (url.startsWith("place:")) return false;
  if (url.startsWith("file:")) return false;
  if (url.startsWith("about:") && url !== "about:blank") return false;

  return true;
}

// ============================================================================
// CONTAINER SYNC: Update menu when containers change
// ============================================================================

browser.contextualIdentities.onCreated.addListener(async () => {
  await rebuildContainerMenuItems();
});

browser.contextualIdentities.onRemoved.addListener(async () => {
  await rebuildContainerMenuItems();
});

browser.contextualIdentities.onUpdated.addListener(async () => {
  await rebuildContainerMenuItems();
});

async function rebuildContainerMenuItems() {
  // Remove existing container items
  for (const id of containerMenuIds) {
    try {
      await browser.menus.remove(id);
    } catch (e) {
      // Item may already be removed
    }
  }
  containerMenuIds = [];

  // Re-populate
  await populateContainerMenuItems();
}

// ============================================================================
// INITIALIZATION: Create menu on extension startup
// ============================================================================

createBookmarkContextMenu();
ctcConsole.info("[Bookmark Menu] Initialized");
