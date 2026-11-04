/**
 * offscreen.ts
 *
 * BERU Offscreen Document (Manifest V3)
 * Runs on the extension origin (chrome-extension://<id>) where microphone access
 * has been authorized. Houses SpeechRecognition to provide continuous wake-word
 * detection without requiring host-page microphone permissions.
 */

interface SpeechRecognitionEvent {
  resultIndex: number;
  results: {
    length: number;
    [index: number]: {
      [index: number]: {
        transcript: string;
      };
      isFinal: boolean;
    };
  };
}

interface SpeechRecognitionErrorEvent {
  error: string;
  message?: string;
}

// Global state within offscreen document
let recognition: any = null;
let isListeningDesired = false;
let isStarting = false;
let isRunning = false;
let restartTimeoutId: number | null = null;
let consecutiveErrors = 0;
const MAX_CONSECUTIVE_ERRORS = 5;

/**
 * Initializes and starts speech recognition.
 */
function startRecognition(): void {
  if (isRunning || isStarting) {
    return;
  }

  // Clear any pending restart timer
  if (restartTimeoutId !== null) {
    clearTimeout(restartTimeoutId);
    restartTimeoutId = null;
  }

  const SpeechRec = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
  if (!SpeechRec) {
    notifyState("error", "SpeechRecognition is not supported in this browser.");
    return;
  }

  isStarting = true;

  try {
    if (recognition) {
      try {
        recognition.abort();
      } catch {
        // ignore
      }
      recognition = null;
    }

    recognition = new SpeechRec();
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.lang = "en-US";

    recognition.onstart = () => {
      isStarting = false;
      isRunning = true;
      consecutiveErrors = 0;
      notifyState("listening");
    };

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      consecutiveErrors = 0;
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0]?.transcript || "";
        if (transcript.trim()) {
          chrome.runtime.sendMessage({
            type: "VOICE_INPUT_DETECTED",
            transcript: transcript.trim(),
          }).catch(() => {
            // Background worker may be cycling
          });
        }
      }
    };

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      const err = event.error;

      if (err === "no-speech") {
        // Expected when user pauses; do not report as fatal error
        return;
      }

      if (err === "aborted") {
        // Recognition was cleanly aborted
        return;
      }

      consecutiveErrors++;

      if (err === "not-allowed" || err === "service-not-allowed") {
        isListeningDesired = false;
        notifyState("permission_required", "Microphone access blocked.");
        chrome.storage.local.set({
          beruMicAuthorized: false,
          beruListeningEnabled: false,
          beruAssistantState: "permission_required",
          beruLastError: "Microphone access blocked",
        });
        return;
      }

      if (err === "audio-capture") {
        notifyState("error", "Microphone unavailable or in use by another app.");
        return;
      }

      if (err === "network") {
        // Transient network issue connecting to speech service
        notifyState("error", "Network issue connecting to speech recognition service.");
        return;
      }

      notifyState("error", `Speech recognition error: ${err}`);
    };

    recognition.onend = () => {
      isRunning = false;
      isStarting = false;

      // If continuous listening is still desired, schedule restart with backoff
      if (isListeningDesired) {
        if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
          isListeningDesired = false;
          notifyState("error", "Too many speech recognition errors. Please re-enable.");
          chrome.storage.local.set({
            beruListeningEnabled: false,
            beruAssistantState: "error",
            beruLastError: "Too many consecutive recognition errors",
          });
          return;
        }

        const delay = consecutiveErrors === 0 ? 300 : Math.min(1000 * Math.pow(2, consecutiveErrors - 1), 8000);
        restartTimeoutId = window.setTimeout(() => {
          if (isListeningDesired) {
            startRecognition();
          }
        }, delay);
      } else {
        notifyState("idle");
      }
    };

    recognition.start();
  } catch (err: any) {
    isStarting = false;
    isRunning = false;
    notifyState("error", `Could not start speech recognition: ${err?.message || "Unknown error"}`);
  }
}

/**
 * Stops speech recognition completely.
 */
function stopRecognition(): void {
  isListeningDesired = false;
  isStarting = false;

  if (restartTimeoutId !== null) {
    clearTimeout(restartTimeoutId);
    restartTimeoutId = null;
  }

  if (recognition) {
    try {
      recognition.abort();
    } catch {
      // ignore
    }
    recognition = null;
  }

  isRunning = false;
  notifyState("idle");
}

/**
 * Sends state update to runtime/background.
 */
function notifyState(state: string, error?: string): void {
  chrome.runtime.sendMessage({
    type: "OFFSCREEN_STATE_CHANGE",
    state,
    error: error || null,
  }).catch(() => {
    // Ignore runtime messaging errors if background is sleeping
  });
}

// Listen for messages from background service worker
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.target !== "offscreen") {
    return false;
  }

  switch (message.action) {
    case "START_LISTENING":
      isListeningDesired = true;
      consecutiveErrors = 0;
      startRecognition();
      sendResponse({ success: true, isRunning });
      break;

    case "STOP_LISTENING":
      stopRecognition();
      sendResponse({ success: true, isRunning: false });
      break;

    case "CHECK_STATUS":
      sendResponse({
        success: true,
        isRunning,
        isStarting,
        isListeningDesired,
      });
      break;

    default:
      break;
  }

  return true;
});
