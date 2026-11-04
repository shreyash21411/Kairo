/**
 * background.ts
 *
 * BERU Service Worker (Manifest V3)
 * Orchestrates offscreen speech recognition, tab communication, hotkey triggers,
 * and authoritative assistant state synchronization.
 */

import { parseBeruVoiceCommand } from "../commands/beruVoiceCommands.ts";

const OFFSCREEN_DOCUMENT_PATH = "offscreen.html";

/**
 * Checks if an offscreen document currently exists.
 */
async function hasOffscreenDocument(): Promise<boolean> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const runtime = chrome.runtime as any;
  if (typeof runtime.getContexts === "function") {
    const contexts = await runtime.getContexts({
      contextTypes: ["OFFSCREEN_DOCUMENT"],
    });
    return contexts.length > 0;
  }
  return false;
}

/**
 * Ensures an offscreen document is created for speech recognition.
 */
async function ensureOffscreenDocument(): Promise<void> {
  if (await hasOffscreenDocument()) {
    return;
  }

  // Create offscreen document with USER_MEDIA reason
  await chrome.offscreen.createDocument({
    url: OFFSCREEN_DOCUMENT_PATH,
    reasons: ["USER_MEDIA" as chrome.offscreen.Reason],
    justification: "Run SpeechRecognition for BERU wake-word and voice commands",
  });
}

/**
 * Closes the offscreen document if open.
 */
async function closeOffscreenDocument(): Promise<void> {
  if (await hasOffscreenDocument()) {
    try {
      await chrome.offscreen.closeDocument();
    } catch {
      // ignore
    }
  }
}

/**
 * Enables or disables continuous wake-word listening.
 */
async function setListening(enabled: boolean): Promise<{ success: boolean; reason?: string }> {
  const data = await chrome.storage.local.get(["beruMicAuthorized"]);

  if (enabled) {
    if (!data.beruMicAuthorized) {
      await chrome.storage.local.set({
        beruListeningEnabled: false,
        beruAssistantState: "permission_required",
        beruLastError: "Microphone permission required",
      });
      return { success: false, reason: "permission_required" };
    }

    try {
      await ensureOffscreenDocument();
      // Wait brief moment for offscreen to initialize listener
      await new Promise((resolve) => setTimeout(resolve, 150));
      await chrome.runtime.sendMessage({
        target: "offscreen",
        action: "START_LISTENING",
      });

      await chrome.storage.local.set({
        beruListeningEnabled: true,
        beruAssistantState: "listening",
        beruLastError: null,
      });

      return { success: true };
    } catch (err: any) {
      await chrome.storage.local.set({
        beruListeningEnabled: false,
        beruAssistantState: "error",
        beruLastError: err?.message || "Failed to start listening",
      });
      return { success: false, reason: err?.message };
    }
  } else {
    try {
      if (await hasOffscreenDocument()) {
        await chrome.runtime.sendMessage({
          target: "offscreen",
          action: "STOP_LISTENING",
        }).catch(() => {});
        await closeOffscreenDocument();
      }
    } catch {
      // ignore
    }

    await chrome.storage.local.set({
      beruListeningEnabled: false,
      beruAssistantState: "idle",
      beruLastError: null,
    });

    return { success: true };
  }
}

/**
 * Relays an action to the currently active tab.
 */
async function sendToActiveTab(message: any): Promise<any> {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) {
      return await chrome.tabs.sendMessage(tab.id, message);
    }
  } catch {
    // Content script may not be loaded on unsupported pages
  }
  return null;
}

// Global hotkey handler: Alt+Shift+B
chrome.commands.onCommand.addListener(async (command) => {
  if (command === "activate-beru") {
    await sendToActiveTab({ action: "TOGGLE_BERU" });
  }
});

// Runtime message listener
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  // Voice input detected by offscreen SpeechRecognition
  if (message?.type === "VOICE_INPUT_DETECTED") {
    const transcript = message.transcript || "";
    const intent = parseBeruVoiceCommand(transcript);

    switch (intent.type) {
      case "wake_word":
        void sendToActiveTab({ action: "WAKE_UP", intent });
        void chrome.storage.local.set({ beruAssistantState: "listening" });
        break;

      case "get_chat_file":
      case "transfer_to_claude":
        void sendToActiveTab({ action: "EXECUTE_INTENT", intent });
        void chrome.storage.local.set({ beruAssistantState: "processing" });
        break;

      case "stop_listening":
        void setListening(false);
        void sendToActiveTab({ action: "WAKE_OFF" });
        break;

      default:
        // Other speech can be routed if wake word was previously triggered
        break;
    }

    sendResponse({ received: true });
    return true;
  }

  // State updates from offscreen document
  if (message?.type === "OFFSCREEN_STATE_CHANGE") {
    const state = message.state;
    const error = message.error;
    void chrome.storage.local.set({
      beruAssistantState: state,
      beruLastError: error,
    });
    sendResponse({ ack: true });
    return true;
  }

  // Toggle or set listening state from popup
  if (message?.action === "SET_LISTENING") {
    setListening(Boolean(message.enabled)).then(sendResponse);
    return true; // async
  }

  // Check current listening status
  if (message?.action === "GET_LISTENING_STATUS") {
    chrome.storage.local.get(
      ["beruMicAuthorized", "beruListeningEnabled", "beruAssistantState", "beruLastError"],
      (res) => {
        sendResponse({
          micAuthorized: Boolean(res.beruMicAuthorized),
          listeningEnabled: Boolean(res.beruListeningEnabled),
          assistantState: res.beruAssistantState || "idle",
          lastError: res.beruLastError || null,
        });
      }
    );
    return true;
  }

  // Open Claude new chat
  if (message?.type === "OPEN_CLAUDE") {
    const url = message.url || "https://claude.ai/new";
    chrome.tabs.create({ url }, (tab) => {
      sendResponse({ success: true, tabId: tab?.id });
    });
    return true;
  }

  // Open microphone authorization page
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

// Startup & install initialization
chrome.runtime.onInstalled.addListener(async () => {
  const data = await chrome.storage.local.get(["beruMicAuthorized", "beruListeningEnabled"]);
  if (!data.beruMicAuthorized) {
    await chrome.storage.local.set({
      beruMicAuthorized: false,
      beruListeningEnabled: false,
      beruAssistantState: "permission_required",
    });
  } else if (data.beruListeningEnabled) {
    // Resume listening if previously opted-in
    await setListening(true);
  } else {
    await chrome.storage.local.set({
      beruAssistantState: "idle",
    });
  }
});
