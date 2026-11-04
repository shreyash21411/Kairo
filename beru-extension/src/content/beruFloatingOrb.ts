/**
 * beruFloatingOrb.ts
 *
 * BERU Content Script — Floating Siri-like Wake-up Orb:
 * - Injected into ChatGPT (https://chatgpt.com/*) and Claude (https://claude.ai/*).
 * - Uses Shadow DOM to isolate styles completely from host page CSS.
 * - Inactive: Visually hidden (zero distraction, zero overlay).
 * - Active: Displays a glowing, animated Siri-like orb indicator.
 * - Handles local speech recognition for "Hey Beru", "Get chat file", "Give to Claude".
 * - Extracts conversation directly from active ChatGPT DOM.
 */

import {
  parseBeruVoiceCommand,
  executeGetChatFile,
  executeTransferToClaude,
  type RawConversationExport,
} from "../commands/beruVoiceCommands.ts";
import type { CapturedConversation, NormalizedCaptureMessage } from "../export/captureTypes.ts";

type OrbState = "hidden" | "listening" | "processing" | "speaking" | "success" | "error";

class BeruFloatingAssistant {
  private container: HTMLDivElement | null = null;
  private shadow: ShadowRoot | null = null;
  private state: OrbState = "hidden";
  private statusText: string = "";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private recognition: any = null;
  private isListeningActive: boolean = false;
  private latestExport: RawConversationExport | null = null;
  private synth: SpeechSynthesis | null = null;

  constructor() {
    if (typeof window !== "undefined" && typeof window.speechSynthesis !== "undefined") {
      this.synth = window.speechSynthesis;
    }
  }

  public init() {
    if (document.getElementById("beru-assistant-root")) return;

    this.container = document.createElement("div");
    this.container.id = "beru-assistant-root";
    this.container.style.cssText = "position: fixed; z-index: 2147483647; bottom: 24px; right: 24px; pointer-events: none;";
    this.shadow = this.container.attachShadow({ mode: "open" });

    this.render();
    document.body.appendChild(this.container);

    // Listen for extension messages (e.g. from popup or background hotkey)
    if (typeof chrome !== "undefined" && chrome.runtime?.onMessage) {
      chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
        if (message?.action === "TOGGLE_BERU") {
          this.toggleListening();
          sendResponse({ success: true, state: this.state });
        } else if (message?.action === "EXECUTE_COMMAND") {
          void this.handleCommand(message.command);
          sendResponse({ success: true });
        }
      });
    }

    // Auto-check if continuous listening was previously opted-in
    if (typeof chrome !== "undefined" && chrome.storage?.local) {
      chrome.storage.local.get(["beruContinuousListening"], (res) => {
        if (res.beruContinuousListening) {
          this.startListening();
        }
      });
    }
  }

  private render() {
    if (!this.shadow) return;

    const isVisible = this.state !== "hidden";
    this.container!.style.pointerEvents = isVisible ? "auto" : "none";

    this.shadow.innerHTML = `
      <style>
        :host {
          all: initial;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        }

        .beru-wrapper {
          display: flex;
          flex-direction: column;
          align-items: flex-end;
          gap: 10px;
          transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
          opacity: ${isVisible ? "1" : "0"};
          transform: ${isVisible ? "translateY(0) scale(1)" : "translateY(20px) scale(0.85)"};
          pointer-events: ${isVisible ? "auto" : "none"};
        }

        /* Siri-like Floating Orb */
        .beru-orb-container {
          position: relative;
          width: 58px;
          height: 58px;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
        }

        .beru-orb {
          width: 52px;
          height: 52px;
          border-radius: 50%;
          background: radial-gradient(circle at 35% 35%, #38bdf8 0%, #6366f1 45%, #ec4899 75%, #0f172a 100%);
          box-shadow: 0 4px 24px rgba(99, 102, 241, 0.45), 0 0 12px rgba(56, 189, 248, 0.5);
          position: relative;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: transform 0.25s ease, box-shadow 0.25s ease;
          animation: beru-glow 3s infinite alternate ease-in-out;
        }

        .beru-orb:hover {
          transform: scale(1.06);
          box-shadow: 0 6px 30px rgba(99, 102, 241, 0.65), 0 0 18px rgba(236, 72, 153, 0.6);
        }

        .beru-orb::after {
          content: "";
          position: absolute;
          inset: 2px;
          border-radius: 50%;
          border: 1.5px solid rgba(255, 255, 255, 0.3);
          pointer-events: none;
        }

        /* Pulsing Aura Ring */
        .beru-ring {
          position: absolute;
          inset: -4px;
          border-radius: 50%;
          border: 2px solid transparent;
          border-top-color: #38bdf8;
          border-right-color: #ec4899;
          border-bottom-color: #a855f7;
          pointer-events: none;
          opacity: 0.8;
          animation: beru-spin 2s linear infinite;
        }

        /* Dynamic State Variations */
        .state-listening .beru-orb {
          animation: beru-pulse-listening 1.3s infinite ease-in-out;
          box-shadow: 0 0 28px rgba(56, 189, 248, 0.7);
        }

        .state-processing .beru-orb {
          background: radial-gradient(circle at 35% 35%, #fbbf24 0%, #3b82f6 50%, #8b5cf6 100%);
          animation: beru-spin 1.5s linear infinite;
        }

        .state-speaking .beru-orb {
          background: radial-gradient(circle at 35% 35%, #10b981 0%, #3b82f6 60%, #6366f1 100%);
          animation: beru-pulse-speaking 0.9s infinite alternate;
        }

        .state-success .beru-orb {
          background: radial-gradient(circle at 35% 35%, #10b981 0%, #059669 80%, #064e3b 100%);
          box-shadow: 0 0 28px rgba(16, 185, 129, 0.8);
        }

        .state-error .beru-orb {
          background: radial-gradient(circle at 35% 35%, #ef4444 0%, #b91c1c 80%, #7f1d1d 100%);
          box-shadow: 0 0 28px rgba(239, 68, 68, 0.8);
        }

        /* Floating Pill Banner */
        .beru-pill {
          background: rgba(15, 23, 42, 0.92);
          backdrop-filter: blur(12px);
          -webkit-backdrop-filter: blur(12px);
          border: 1px solid rgba(255, 255, 255, 0.12);
          border-radius: 20px;
          padding: 8px 14px;
          color: #f8fafc;
          font-size: 12px;
          font-weight: 500;
          box-shadow: 0 8px 32px rgba(0, 0, 0, 0.35);
          display: flex;
          align-items: center;
          gap: 8px;
          max-width: 280px;
          line-height: 1.35;
        }

        .beru-icon {
          font-size: 14px;
        }

        .beru-close {
          background: transparent;
          border: none;
          color: #94a3b8;
          font-size: 14px;
          cursor: pointer;
          padding: 0 2px;
          line-height: 1;
        }

        .beru-close:hover {
          color: #f8fafc;
        }

        @keyframes beru-glow {
          0% { transform: scale(1); filter: brightness(1); }
          100% { transform: scale(1.03); filter: brightness(1.15); }
        }

        @keyframes beru-spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }

        @keyframes beru-pulse-listening {
          0% { transform: scale(0.96); box-shadow: 0 0 16px rgba(56, 189, 248, 0.4); }
          50% { transform: scale(1.06); box-shadow: 0 0 32px rgba(56, 189, 248, 0.8), 0 0 45px rgba(236, 72, 153, 0.5); }
          100% { transform: scale(0.96); box-shadow: 0 0 16px rgba(56, 189, 248, 0.4); }
        }

        @keyframes beru-pulse-speaking {
          0% { transform: scale(0.97); }
          100% { transform: scale(1.05); }
        }
      </style>

      <div class="beru-wrapper state-${this.state}">
        ${
          this.statusText
            ? `
          <div class="beru-pill">
            <span class="beru-icon">${this.getStatusIcon()}</span>
            <span>${this.statusText}</span>
            <button class="beru-close" id="beru-dismiss" title="Dismiss">✕</button>
          </div>
        `
            : ""
        }
        <div class="beru-orb-container" id="beru-orb-btn" title="BERU Assistant (Click to Stop)">
          <div class="beru-ring"></div>
          <div class="beru-orb">
            <span style="font-size: 18px; filter: drop-shadow(0 1px 2px rgba(0,0,0,0.5));">🎙</span>
          </div>
        </div>
      </div>
    `;

    this.shadow.getElementById("beru-orb-btn")?.addEventListener("click", () => {
      this.toggleListening();
    });

    this.shadow.getElementById("beru-dismiss")?.addEventListener("click", () => {
      this.setState("hidden", "");
    });
  }

  private getStatusIcon(): string {
    switch (this.state) {
      case "listening":
        return "🔴";
      case "processing":
        return "⏳";
      case "speaking":
        return "🔊";
      case "success":
        return "✓";
      case "error":
        return "⚠️";
      default:
        return "🎙";
    }
  }

  private setState(state: OrbState, text: string = "") {
    this.state = state;
    this.statusText = text;
    this.render();
  }

  public toggleListening() {
    if (this.isListeningActive) {
      this.stopListening();
    } else {
      this.startListening();
    }
  }

  public startListening() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any;
    const SpeechRec = w.SpeechRecognition || w.webkitSpeechRecognition;

    if (!SpeechRec) {
      this.setState("error", "SpeechRecognition unavailable in this browser.");
      return;
    }

    try {
      this.recognition = new SpeechRec();
      this.recognition.lang = "en-US";
      this.recognition.continuous = true;
      this.recognition.interimResults = false;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      this.recognition.onresult = (event: any) => {
        const last = event.results.length - 1;
        const transcript = event.results[last][0]?.transcript || "";
        if (transcript.trim()) {
          void this.handleCommand(transcript.trim());
        }
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      this.recognition.onerror = (event: any) => {
        if (event.error === "not-allowed") {
          this.setState("error", "Microphone access blocked. Click extension icon to grant.");
          this.isListeningActive = false;
        } else if (event.error !== "no-speech") {
          this.setState("error", `Mic error: ${event.error as string}`);
        }
      };

      this.recognition.onend = () => {
        if (this.isListeningActive) {
          try {
            this.recognition.start();
          } catch {
            this.isListeningActive = false;
            this.setState("hidden");
          }
        }
      };

      this.recognition.start();
      this.isListeningActive = true;
      this.setState("listening", 'Listening for "Hey Beru"…');
    } catch {
      this.setState("error", "Could not start microphone.");
      this.isListeningActive = false;
    }
  }

  public stopListening() {
    this.isListeningActive = false;
    if (this.recognition) {
      try {
        this.recognition.abort();
      } catch {
        // ignore
      }
      this.recognition = null;
    }
    this.setState("hidden", "");
  }

  private speak(text: string, onEnd?: () => void) {
    if (!this.synth) {
      if (onEnd) onEnd();
      return;
    }
    this.synth.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1.0;
    utterance.pitch = 1.0;
    utterance.onstart = () => {
      this.setState("speaking", text);
    };
    utterance.onend = () => {
      if (onEnd) onEnd();
      else if (this.isListeningActive) {
        this.setState("listening", 'Listening for "Hey Beru"…');
      } else {
        setTimeout(() => this.setState("hidden", ""), 3000);
      }
    };
    this.synth.speak(utterance);
  }

  public async handleCommand(speechText: string) {
    const intent = parseBeruVoiceCommand(speechText);

    switch (intent.type) {
      case "wake_word": {
        this.setState("listening", 'I\'m listening…');
        this.speak("I'm listening.");
        break;
      }

      case "get_chat_file": {
        this.setState("processing", "Retrieving chat transcript…");
        this.speak("Preparing your conversation file.", async () => {
          const session = this.extractCurrentChatGPTConversation();
          const result = executeGetChatFile(session, true);
          if (result.success && result.exportData) {
            this.latestExport = result.exportData;
            this.setState("success", `Downloaded: ${result.filename}`);
            this.speak(result.spokenText);
          } else {
            this.setState("error", result.message);
            this.speak(result.spokenText);
          }
        });
        break;
      }

      case "transfer_to_claude": {
        this.setState("processing", "Preparing transfer to Claude…");
        this.speak("Opening Claude and transferring context.", async () => {
          let exp = this.latestExport;
          if (!exp) {
            const session = this.extractCurrentChatGPTConversation();
            const getRes = executeGetChatFile(session, false);
            if (getRes.success && getRes.exportData) {
              exp = getRes.exportData;
              this.latestExport = exp;
            }
          }

          if (exp) {
            const res = await executeTransferToClaude(exp, true);
            this.setState("success", "Transferred! Paste (Ctrl+V) in Claude.");
            this.speak(res.spokenText);
          } else {
            this.setState("error", "No active conversation found to transfer.");
            this.speak("I couldn't find a conversation to transfer.");
          }
        });
        break;
      }

      case "stop_listening": {
        this.stopListening();
        this.speak("Stopped listening.");
        break;
      }

      default:
        // Optional general response
        break;
    }
  }

  /**
   * Safely extracts conversation turns directly from the live ChatGPT DOM.
   */
  private extractCurrentChatGPTConversation(): CapturedConversation | null {
    try {
      const titleElem = document.querySelector("title");
      const title = titleElem ? titleElem.innerText.replace(/ - ChatGPT.*$/, "").trim() : "ChatGPT Conversation";

      const turns = document.querySelectorAll('article[data-testid^="conversation-turn-"], div[data-message-author-role]');
      if (!turns || turns.length === 0) return null;

      const messages: NormalizedCaptureMessage[] = [];
      let seq = 1;

      turns.forEach((turn) => {
        const roleAttr = turn.getAttribute("data-message-author-role");
        const isAssistant = roleAttr === "assistant" || turn.querySelector('[data-message-author-role="assistant"]') !== null;
        const role = isAssistant ? "assistant" : "user";

        const textContent = (turn as HTMLElement).innerText?.trim();
        if (textContent) {
          messages.push({
            id: `msg-${seq}`,
            sequence: seq++,
            role,
            content: textContent,
            timestamp: new Date().toISOString(),
          });
        }
      });

      if (messages.length === 0) return null;

      return {
        id: "chatgpt-live-session",
        platform: "chatgpt",
        title: title || "ChatGPT Conversation",
        url: window.location.href,
        messages,
        state: "completed",
        hasMoreHistory: false,
        isComplete: true,
        completenessStatus: "complete",
        capturedAt: new Date().toISOString(),
        lastCheckpointAt: new Date().toISOString(),
      };
    } catch {
      return null;
    }
  }
}

// Instantiate and initialize floating assistant
const beru = new BeruFloatingAssistant();
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => beru.init());
} else {
  beru.init();
}

