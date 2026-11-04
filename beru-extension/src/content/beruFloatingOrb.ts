/**
 * beruFloatingOrb.ts
 *
 * BERU Content Script — Floating Siri-like Wake-up Orb:
 * - Injected into ChatGPT (https://chatgpt.com/*) and Claude (https://claude.ai/*).
 * - Uses Shadow DOM to isolate styles completely from host page CSS.
 * - Inactive: Visually hidden (zero distraction, zero overlay, pointer-events: none).
 * - Active: Displays a glowing, animated Siri-like orb indicator.
 * - Awakened by "Hey Beru" / "Hi Beru" / "Hello Beru" / "Beru" or hotkey Alt+Shift+B.
 * - Extracts conversation directly from active ChatGPT DOM.
 * - Handles download of standalone JSON and clipboard transfer to Claude.
 */

import {
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
  private latestExport: RawConversationExport | null = null;
  private synth: SpeechSynthesis | null = null;
  private autoHideTimer: number | null = null;

  constructor() {
    if (typeof window !== "undefined" && typeof window.speechSynthesis !== "undefined") {
      this.synth = window.speechSynthesis;
    }
  }

  public init(): void {
    if (document.getElementById("beru-assistant-root")) return;

    this.container = document.createElement("div");
    this.container.id = "beru-assistant-root";
    this.container.style.cssText =
      "position: fixed; z-index: 2147483647; bottom: 24px; right: 24px; pointer-events: none;";
    this.shadow = this.container.attachShadow({ mode: "open" });

    this.render();
    document.body.appendChild(this.container);

    // Listen for extension messages (from background or hotkey)
    if (typeof chrome !== "undefined" && chrome.runtime?.onMessage) {
      chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
        if (message?.action === "WAKE_UP") {
          this.wakeUp();
          sendResponse({ success: true, state: this.state });
          return true;
        }

        if (message?.action === "WAKE_OFF") {
          this.hide();
          sendResponse({ success: true });
          return true;
        }

        if (message?.action === "EXECUTE_INTENT") {
          void this.handleIntent(message.intent);
          sendResponse({ success: true });
          return true;
        }

        if (message?.action === "TOGGLE_BERU") {
          this.toggleAssistant();
          sendResponse({ success: true, state: this.state });
          return true;
        }

        return false;
      });
    }
  }

  public wakeUp(): void {
    this.clearAutoHide();
    this.setState("listening", "I'm listening…");
    this.speak("I'm listening.");
  }

  public hide(): void {
    this.clearAutoHide();
    if (this.synth) {
      this.synth.cancel();
    }
    this.setState("hidden", "");
  }

  public toggleAssistant(): void {
    if (this.state === "hidden") {
      this.wakeUp();
    } else {
      this.hide();
    }
  }

  private clearAutoHide(): void {
    if (this.autoHideTimer !== null) {
      clearTimeout(this.autoHideTimer);
      this.autoHideTimer = null;
    }
  }

  private scheduleAutoHide(delayMs: number = 3500): void {
    this.clearAutoHide();
    this.autoHideTimer = window.setTimeout(() => {
      this.hide();
    }, delayMs);
  }

  private setState(state: OrbState, text: string = ""): void {
    this.state = state;
    this.statusText = text;
    this.render();

    // Notify background of assistant state for popup synchronization
    if (typeof chrome !== "undefined" && chrome.runtime?.sendMessage) {
      chrome.runtime.sendMessage({
        type: "ASSISTANT_STATE_UPDATE",
        state: state === "hidden" ? "idle" : state,
      }).catch(() => {});
    }
  }

  private render(): void {
    if (!this.shadow) return;

    const isVisible = this.state !== "hidden";
    this.container!.style.pointerEvents = isVisible ? "auto" : "none";

    this.shadow.innerHTML = `
      <style>
        :host {
          all: initial;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
        }

        .beru-wrapper {
          display: flex;
          flex-direction: column;
          align-items: flex-end;
          gap: 12px;
          transition: opacity 0.28s cubic-bezier(0.16, 1, 0.3, 1), transform 0.28s cubic-bezier(0.16, 1, 0.3, 1);
          opacity: ${isVisible ? "1" : "0"};
          transform: ${isVisible ? "translateY(0) scale(1)" : "translateY(16px) scale(0.9)"};
          pointer-events: ${isVisible ? "auto" : "none"};
        }

        /* Siri-like Floating Orb */
        .beru-orb-container {
          position: relative;
          width: 56px;
          height: 56px;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
        }

        .beru-orb {
          width: 50px;
          height: 50px;
          border-radius: 50%;
          background: radial-gradient(circle at 35% 35%, #38bdf8 0%, #6366f1 45%, #ec4899 75%, #0b0f19 100%);
          box-shadow: 0 4px 20px rgba(99, 102, 241, 0.4), 0 0 16px rgba(56, 189, 248, 0.5);
          position: relative;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: transform 0.2s ease, box-shadow 0.2s ease;
          animation: beru-breathe 2.8s infinite alternate ease-in-out;
        }

        .beru-orb:hover {
          transform: scale(1.06);
          box-shadow: 0 6px 24px rgba(99, 102, 241, 0.6), 0 0 20px rgba(236, 72, 153, 0.6);
        }

        /* Spinning Aura Ring */
        .beru-aura {
          position: absolute;
          inset: -4px;
          border-radius: 50%;
          background: conic-gradient(from 0deg, #38bdf8, #818cf8, #f472b6, #38bdf8);
          opacity: 0.6;
          filter: blur(4px);
          animation: beru-spin 3s linear infinite;
          z-index: -1;
        }

        @keyframes beru-spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }

        @keyframes beru-breathe {
          0% {
            transform: scale(0.97);
            box-shadow: 0 4px 16px rgba(99, 102, 241, 0.4), 0 0 12px rgba(56, 189, 248, 0.4);
          }
          100% {
            transform: scale(1.03);
            box-shadow: 0 8px 28px rgba(99, 102, 241, 0.65), 0 0 24px rgba(244, 114, 182, 0.7);
          }
        }

        /* Status Toast Pill */
        .beru-toast {
          background: rgba(11, 14, 22, 0.88);
          backdrop-filter: blur(14px);
          -webkit-backdrop-filter: blur(14px);
          border: 1px solid rgba(255, 255, 255, 0.12);
          border-radius: 20px;
          padding: 8px 16px;
          color: #f3f4f6;
          font-size: 13px;
          font-weight: 500;
          display: flex;
          align-items: center;
          gap: 8px;
          box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
          max-width: 280px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .beru-status-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: ${this.getStatusDotColor()};
          box-shadow: 0 0 8px ${this.getStatusDotColor()};
          animation: ${this.state === "listening" ? "beru-pulse-dot 1.2s infinite" : "none"};
        }

        @keyframes beru-pulse-dot {
          0%, 100% { transform: scale(0.9); opacity: 0.8; }
          50% { transform: scale(1.25); opacity: 1; }
        }

        .beru-close-btn {
          background: transparent;
          border: none;
          color: #94a3b8;
          cursor: pointer;
          font-size: 12px;
          padding: 2px 4px;
          margin-left: 4px;
          line-height: 1;
        }

        .beru-close-btn:hover {
          color: #fff;
        }
      </style>

      <div class="beru-wrapper">
        ${
          this.statusText
            ? `
          <div class="beru-toast">
            <div class="beru-status-dot"></div>
            <span>${this.statusText}</span>
            <button class="beru-close-btn" id="beru-dismiss" title="Dismiss">✕</button>
          </div>
        `
            : ""
        }
        <div class="beru-orb-container" id="beru-orb-btn" title="BERU Assistant (Click to dismiss)">
          <div class="beru-aura"></div>
          <div class="beru-orb">
            <span style="font-size: 16px; filter: drop-shadow(0 1px 2px rgba(0,0,0,0.5));">${this.getStatusIcon()}</span>
          </div>
        </div>
      </div>
    `;

    this.shadow.getElementById("beru-orb-btn")?.addEventListener("click", () => {
      this.hide();
    });

    this.shadow.getElementById("beru-dismiss")?.addEventListener("click", () => {
      this.hide();
    });
  }

  private getStatusDotColor(): string {
    switch (this.state) {
      case "listening":
        return "#38bdf8"; // Cyan
      case "processing":
        return "#fbbf24"; // Amber
      case "speaking":
        return "#c084fc"; // Purple
      case "success":
        return "#34d399"; // Emerald
      case "error":
        return "#f87171"; // Rose
      default:
        return "#94a3b8";
    }
  }

  private getStatusIcon(): string {
    switch (this.state) {
      case "listening":
        return "🎙️";
      case "processing":
        return "⏳";
      case "speaking":
        return "🔊";
      case "success":
        return "✓";
      case "error":
        return "⚠️";
      default:
        return "✦";
    }
  }

  private speak(text: string, onEnd?: () => void): void {
    if (!this.synth) {
      if (onEnd) onEnd();
      return;
    }

    this.synth.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1.05;
    utterance.pitch = 1.0;

    utterance.onstart = () => {
      this.setState("speaking", text);
    };

    utterance.onend = () => {
      if (onEnd) {
        onEnd();
      } else {
        this.scheduleAutoHide(3000);
      }
    };

    this.synth.speak(utterance);
  }

  public async handleIntent(intent: any): Promise<void> {
    if (!intent) return;

    switch (intent.type) {
      case "wake_word":
        this.wakeUp();
        break;

      case "get_chat_file": {
        this.clearAutoHide();
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
        this.clearAutoHide();
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
        this.hide();
        this.speak("Stopped listening.");
        break;
      }

      default:
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

      const turns = document.querySelectorAll(
        'article[data-testid^="conversation-turn-"], div[data-message-author-role]'
      );
      if (!turns || turns.length === 0) return null;

      const messages: NormalizedCaptureMessage[] = [];
      let seq = 1;

      turns.forEach((turn) => {
        const roleAttr = turn.getAttribute("data-message-author-role");
        const isAssistant =
          roleAttr === "assistant" || turn.querySelector('[data-message-author-role="assistant"]') !== null;
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
