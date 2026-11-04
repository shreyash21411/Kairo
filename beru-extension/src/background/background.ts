/**
 * background.ts
 *
 * BERU Service Worker (Manifest V3)
 * Handles global keyboard shortcuts, tab navigation, and inter-component messaging.
 */

chrome.commands.onCommand.addListener(async (command) => {
  if (command === "activate-beru") {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.id) {
        chrome.tabs.sendMessage(tab.id, { action: "TOGGLE_BERU" }).catch(() => {
          // Content script may not be loaded on this tab
        });
      }
    } catch (err) {
      console.warn("[BERU] Failed to activate via hotkey:", err);
    }
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "OPEN_CLAUDE") {
    const url = message.url || "https://claude.ai/new";
    chrome.tabs.create({ url }, (tab) => {
      sendResponse({ success: true, tabId: tab?.id });
    });
    return true; // async
  }

  if (message?.type === "OPEN_PERMISSION_PAGE") {
    if (chrome.runtime.openOptionsPage) {
      chrome.runtime.openOptionsPage();
    } else {
      chrome.tabs.create({ url: chrome.runtime.getURL("permission.html") });
    }
    sendResponse({ success: true });
    return true;
  }

  return false;
});

