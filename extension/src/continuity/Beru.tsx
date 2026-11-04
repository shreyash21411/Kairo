/**
 * Beru.tsx
 *
 * BERU — Bridged Engagement and Recall Unit
 * An isolated voice agent feature within VOIDZONE providing:
 * 1. Wake-word detection: "Hey Beru", "Beru"
 * 2. Voice export: "Get/download me the chat file" (Standalone Conversation JSON)
 * 3. Cross-platform transfer: "Give this file to Claude" (Opens Claude & transfers context)
 * 4. Stop listening / Mute control
 *
 * Strict Architectural Boundaries:
 * - Decoupled from Meta Memory and Continuity engines.
 * - Reuses existing standalone conversation JSON generation (rawConversationExport.ts).
 * - Never modifies source transcripts or replaces raw JSON with continuity archives.
 * - Audio is never stored or transmitted.
 */

import { useState, useEffect, useRef, useCallback } from "react";
import {
  parseBeruVoiceCommand,
  executeGetChatFile,
  executeTransferToClaude,
  CLAUDE_NEW_CHAT_URL,
} from "./beruVoiceCommands.ts";
import {
  getActiveCaptureSession,
  getLatestConversation,
} from "../storage/conversationStorage.ts";
import type { RawConversationExport } from "./rawConversationExport.ts";
import type { CapturedConversation } from "./captureTypes.ts";
import { beruChat } from "../services/voidzoneBackendClient.ts";
import type { BeruMessageItem } from "../services/voidzoneTypes.ts";

interface BeruProps {
  beruEnabled: boolean;
  selectedProject?: string;
  projectContext?: string;
}

type BeruState = "idle" | "listening" | "processing" | "speaking" | "error";

const MAX_HISTORY = 10;

export default function Beru({
  beruEnabled,
  selectedProject,
  projectContext,
}: BeruProps) {
  const [beruState, setBeruState] = useState<BeruState>("idle");
  const [continuousListening, setContinuousListening] = useState(false);
  const [currentTranscript, setCurrentTranscript] = useState("");
  const [statusMessage, setStatusMessage] = useState("");
  const [error, setError] = useState("");
  const [history, setHistory] = useState<BeruMessageItem[]>([]);
  const [textInput, setTextInput] = useState("");
  const [speechSupported, setSpeechSupported] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);

  // Transfer and export tracking state
  const [latestExport, setLatestExport] = useState<RawConversationExport | null>(null);
  const [latestExportFilename, setLatestExportFilename] = useState("");
  const [claudeTransferPrompt, setClaudeTransferPrompt] = useState("");
  const [claudeTransferSuccess, setClaudeTransferSuccess] = useState(false);
  const [copiedPrompt, setCopiedPrompt] = useState(false);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recognitionRef = useRef<any>(null);
  const synthRef = useRef<SpeechSynthesis | null>(null);
  const beruStateRef = useRef<BeruState>("idle");
  const continuousListeningRef = useRef<boolean>(false);
  const latestExportRef = useRef<RawConversationExport | null>(null);

  useEffect(() => {
    beruStateRef.current = beruState;
  }, [beruState]);

  useEffect(() => {
    continuousListeningRef.current = continuousListening;
  }, [continuousListening]);

  useEffect(() => {
    latestExportRef.current = latestExport;
  }, [latestExport]);

  // Initialize Speech APIs
  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any;
    const SpeechRec = w.SpeechRecognition || w.webkitSpeechRecognition;
    setSpeechSupported(typeof SpeechRec !== "undefined");
    if (typeof window.speechSynthesis !== "undefined") {
      synthRef.current = window.speechSynthesis;
    }
  }, []);

  const stopSpeaking = useCallback(() => {
    if (synthRef.current && synthRef.current.speaking) {
      synthRef.current.cancel();
    }
    setIsSpeaking(false);
  }, []);

  const speakResponse = useCallback(
    (text: string, onEndCallback?: () => void) => {
      if (!synthRef.current || !text) {
        if (onEndCallback) onEndCallback();
        return;
      }
      stopSpeaking();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 1.0;
      utterance.pitch = 1.0;
      utterance.onstart = () => {
        setIsSpeaking(true);
        setBeruState("speaking");
      };
      utterance.onend = () => {
        setIsSpeaking(false);
        setBeruState(continuousListeningRef.current ? "listening" : "idle");
        if (onEndCallback) onEndCallback();
      };
      utterance.onerror = () => {
        setIsSpeaking(false);
        setBeruState(continuousListeningRef.current ? "listening" : "idle");
        if (onEndCallback) onEndCallback();
      };
      synthRef.current.speak(utterance);
    },
    [stopSpeaking]
  );

  /**
   * Resolves the active ChatGPT conversation.
   * Checks active capture session first, falling back to latest stored conversation.
   */
  const resolveCurrentSession = useCallback(async (): Promise<CapturedConversation | null> => {
    try {
      const active = await getActiveCaptureSession();
      if (active && Array.isArray(active.messages) && active.messages.length > 0) {
        return active;
      }
    } catch {
      // Storage lookup fallback
    }

    try {
      const latest = await getLatestConversation();
      if (latest && Array.isArray(latest.messages) && latest.messages.length > 0) {
        return {
          id: latest.id,
          platform: latest.platform || "chatgpt",
          title: latest.title || "ChatGPT conversation",
          url: latest.url || null,
          messages: latest.messages.map((m, idx) => ({
            id: m.id || `msg-${idx + 1}`,
            sequence: idx + 1,
            role: m.role as "user" | "assistant",
            content: m.content,
            timestamp: m.timestamp ?? null,
          })),
          state: "completed",
          hasMoreHistory: false,
          isComplete: latest.completeness === "complete",
          completenessStatus: latest.completeness === "complete" ? "complete" : "partial",
          capturedAt: latest.capturedAt || new Date().toISOString(),
          lastCheckpointAt: latest.capturedAt || null,
        };
      }
    } catch {
      // Fallback exhausted
    }

    return null;
  }, []);

  /**
   * Executes the "Get / download chat file" command.
   */
  const handleGetChatFile = useCallback(async () => {
    setBeruState("processing");
    setError("");
    setStatusMessage("Retrieving current conversation...");

    const session = await resolveCurrentSession();
    const result = executeGetChatFile(session, true);

    if (result.success && result.exportData) {
      setLatestExport(result.exportData);
      setLatestExportFilename(result.filename || "voidzone-conversation-raw.json");
      setStatusMessage(result.message);

      const assistantMsg: BeruMessageItem = {
        role: "assistant",
        content: `Downloaded: ${result.filename} (${result.exportData.messageCount} messages).`,
      };
      setHistory((prev) => [...prev, assistantMsg].slice(-MAX_HISTORY));

      speakResponse(result.spokenText);
    } else {
      setError(result.message);
      setStatusMessage("");
      speakResponse(result.spokenText);
    }
  }, [resolveCurrentSession, speakResponse]);

  /**
   * Executes the "Give this file to Claude" command.
   */
  const handleTransferToClaude = useCallback(async () => {
    setBeruState("processing");
    setError("");
    setStatusMessage("Preparing transfer to Claude...");

    let exportToTransfer = latestExportRef.current;

    // If no export exists yet, automatically generate it from current session
    if (!exportToTransfer) {
      const session = await resolveCurrentSession();
      const getResult = executeGetChatFile(session, false);
      if (getResult.success && getResult.exportData) {
        exportToTransfer = getResult.exportData;
        setLatestExport(exportToTransfer);
        setLatestExportFilename(getResult.filename || "voidzone-conversation-raw.json");
      } else {
        const errorMsg =
          "No conversation file available to transfer. Please capture a ChatGPT conversation first.";
        setError(errorMsg);
        setStatusMessage("");
        speakResponse("I couldn't find a conversation file to transfer. Please make sure you have an active ChatGPT session.");
        return;
      }
    }

    const transferResult = await executeTransferToClaude(exportToTransfer, true);

    if (transferResult.success) {
      setClaudeTransferPrompt(transferResult.continuationPrompt);
      setClaudeTransferSuccess(true);
      setStatusMessage(transferResult.message);

      const assistantMsg: BeruMessageItem = {
        role: "assistant",
        content: `Transferred to Claude: Context copied to clipboard for https://claude.ai/new.`,
      };
      setHistory((prev) => [...prev, assistantMsg].slice(-MAX_HISTORY));

      speakResponse(transferResult.spokenText);
    } else {
      setError(transferResult.message);
      setStatusMessage("");
      speakResponse(transferResult.spokenText);
    }
  }, [resolveCurrentSession, speakResponse]);

  /**
   * Process raw spoken text or typed input through BERU command orchestrator.
   */
  const processInput = useCallback(
    async (rawText: string) => {
      const trimmed = rawText.trim();
      if (!trimmed) return;

      const userItem: BeruMessageItem = { role: "user", content: trimmed };
      setHistory((prev) => [...prev, userItem].slice(-MAX_HISTORY));

      const intent = parseBeruVoiceCommand(trimmed);

      switch (intent.type) {
        case "wake_word": {
          setStatusMessage("BERU is listening...");
          speakResponse("I'm listening.");
          break;
        }

        case "get_chat_file": {
          await handleGetChatFile();
          break;
        }

        case "transfer_to_claude": {
          await handleTransferToClaude();
          break;
        }

        case "stop_listening": {
          setContinuousListening(false);
          stopListening();
          setStatusMessage("Stopped listening.");
          speakResponse("Stopped listening.");
          break;
        }

        case "general_query":
        default: {
          // If the backend BERU service is enabled, route general query to Meta AI
          if (beruEnabled) {
            setBeruState("processing");
            setError("");
            try {
              const res = await beruChat({
                message: trimmed,
                projectId: selectedProject || undefined,
                projectContext: projectContext || undefined,
                history: history.slice(-MAX_HISTORY),
              });
              const assistantItem: BeruMessageItem = {
                role: "assistant",
                content: res.reply,
              };
              setHistory((prev) => [...prev, assistantItem].slice(-MAX_HISTORY));
              speakResponse(res.reply);
            } catch (err) {
              const errorMsg =
                err instanceof Error ? err.message : "BERU could not respond.";
              setError(errorMsg);
              speakResponse("I encountered an error processing your query.");
            }
          } else {
            // Backend AI disabled: provide clear voice guidance on supported commands
            const guidance = `I heard: "${trimmed}". You can say "Get my chat file" to export this conversation, or "Give this file to Claude" to transfer it.`;
            const assistantItem: BeruMessageItem = {
              role: "assistant",
              content: guidance,
            };
            setHistory((prev) => [...prev, assistantItem].slice(-MAX_HISTORY));
            speakResponse(guidance);
          }
          break;
        }
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [beruEnabled, handleGetChatFile, handleTransferToClaude, history, projectContext, selectedProject, speakResponse]
  );

  const startListening = useCallback(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any;
    const SpeechRec = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!SpeechRec) return;

    stopSpeaking();
    setBeruState("listening");
    setCurrentTranscript("");
    setError("");

    const recognition = new SpeechRec();
    recognition.lang = "en-US";
    recognition.continuous = false;
    recognition.interimResults = false;
    recognitionRef.current = recognition;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    recognition.onresult = (event: any) => {
      const text: string = event.results[0]?.[0]?.transcript ?? "";
      setCurrentTranscript(text);
      if (text.trim()) {
        void processInput(text);
      } else {
        setBeruState(continuousListeningRef.current ? "listening" : "idle");
      }
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    recognition.onerror = (event: any) => {
      if (event.error !== "aborted" && event.error !== "no-speech") {
        setError(`Microphone error: ${event.error as string}`);
        setBeruState("error");
      } else {
        setBeruState(continuousListeningRef.current ? "listening" : "idle");
      }
    };

    recognition.onend = () => {
      // In continuous wake-word mode, restart recognition automatically if not speaking or processing
      if (
        continuousListeningRef.current &&
        beruStateRef.current !== "processing" &&
        beruStateRef.current !== "speaking"
      ) {
        try {
          recognition.start();
        } catch {
          setBeruState("idle");
        }
      } else if (beruStateRef.current === "listening") {
        setBeruState("idle");
      }
    };

    try {
      recognition.start();
    } catch {
      setBeruState("idle");
    }
  }, [processInput, stopSpeaking]);

  const stopListening = useCallback(() => {
    if (recognitionRef.current) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-call
        recognitionRef.current.abort();
      } catch {
        // Ignore abort failures
      }
      recognitionRef.current = null;
    }
    setBeruState("idle");
  }, []);

  const toggleContinuousMode = () => {
    const nextMode = !continuousListening;
    setContinuousListening(nextMode);
    if (nextMode) {
      startListening();
      setStatusMessage("Wake-word listening active. Say 'Hey Beru' anytime.");
    } else {
      stopListening();
      setStatusMessage("");
    }
  };

  const handleTextSend = () => {
    if (!textInput.trim()) return;
    const text = textInput.trim();
    setTextInput("");
    void processInput(text);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") handleTextSend();
  };

  const clearConversation = () => {
    stopSpeaking();
    setHistory([]);
    setCurrentTranscript("");
    setError("");
    setStatusMessage("");
    setLatestExport(null);
    setLatestExportFilename("");
    setClaudeTransferSuccess(false);
    setBeruState("idle");
  };

  const copyTransferPromptAgain = async () => {
    if (!claudeTransferPrompt) return;
    try {
      await navigator.clipboard.writeText(claudeTransferPrompt);
      setCopiedPrompt(true);
      setTimeout(() => setCopiedPrompt(false), 2000);
    } catch {
      // Clipboard fallback
    }
  };

  return (
    <section className="vz-card vz-beru-card" aria-label="BERU Voice Assistant">
      <div className="vz-card-header">
        <div className="vz-beru-header-title">
          <span className="vz-label-bold">🎙 BERU</span>
          <span className="vz-badge-sm vz-badge-accent">Chat Transfer</span>
        </div>
        <div className="vz-meta-card-actions">
          {history.length > 0 && (
            <button
              type="button"
              className="vz-btn-icon-subtle"
              onClick={clearConversation}
              title="Clear conversation"
            >
              🗑
            </button>
          )}
          <span
            className={`vz-beru-status-dot vz-beru-status-${beruState}`}
            title={`Status: ${beruState}`}
            aria-hidden="true"
          />
        </div>
      </div>

      {/* Voice Transfer Quick Actions Banner */}
      <div className="vz-beru-quick-actions">
        <button
          type="button"
          className="vz-btn-secondary vz-btn-xs"
          onClick={() => void handleGetChatFile()}
          disabled={beruState === "processing"}
          title="Voice command: 'Hey Beru, get me the chat file'"
        >
          📄 Get Chat File
        </button>
        <button
          type="button"
          className="vz-btn-secondary vz-btn-xs"
          onClick={() => void handleTransferToClaude()}
          disabled={beruState === "processing"}
          title="Voice command: 'Hey Beru, give this file to Claude'"
        >
          🚀 Give File to Claude
        </button>
        {speechSupported && (
          <button
            type="button"
            className={`vz-btn-xs ${continuousListening ? "vz-btn-primary" : "vz-btn-secondary"}`}
            onClick={toggleContinuousMode}
            title="Toggle wake-word 'Hey Beru' detection"
          >
            {continuousListening ? "🔴 Wake-Word Active" : "👂 Enable 'Hey Beru'"}
          </button>
        )}
      </div>

      {/* Wake-Word & Voice Status Bar */}
      {beruState === "listening" && (
        <div className="vz-beru-status-row vz-status-listening" aria-live="polite">
          <span className="vz-beru-listening-indicator">🔴 Listening for: &ldquo;Hey Beru&rdquo;…</span>
        </div>
      )}

      {beruState === "processing" && (
        <div className="vz-beru-status-row" aria-live="polite">
          <span className="vz-spinner" /> Processing voice command…
        </div>
      )}

      {beruState === "speaking" && (
        <div className="vz-beru-status-row vz-status-speaking" aria-live="polite">
          <span className="vz-beru-speaking-indicator">🔊 BERU Speaking…</span>
        </div>
      )}

      {statusMessage && (
        <div className="vz-beru-status-message" aria-live="polite">
          {statusMessage}
        </div>
      )}

      {error && (
        <div className="vz-error-box" role="alert">
          {error}
        </div>
      )}

      {/* Standalone Conversation Export Card (Generated by BERU) */}
      {latestExport && (
        <div className="vz-beru-file-card">
          <div className="vz-beru-file-header">
            <span className="vz-label-bold">📄 STANDALONE CONVERSATION JSON</span>
            <span className="vz-badge-sm vz-badge-neutral">100% Offline</span>
          </div>
          <div className="vz-meta-highlight-box">
            <div className="vz-meta-field">
              <span className="vz-meta-label">FILENAME</span>
              <div className="vz-meta-val-emphasis">{latestExportFilename}</div>
            </div>
            <div className="vz-meta-field">
              <span className="vz-meta-label">CONVERSATION</span>
              <div className="vz-meta-val-next">
                {latestExport.conversationTitle} ({latestExport.messageCount} messages)
              </div>
            </div>
          </div>
          <div className="vz-btn-row">
            <button
              type="button"
              className="vz-btn-secondary vz-btn-xs"
              onClick={() => void handleGetChatFile()}
            >
              📥 Download Again
            </button>
            <button
              type="button"
              className="vz-btn-primary vz-btn-xs"
              onClick={() => void handleTransferToClaude()}
            >
              🚀 Transfer to Claude Now
            </button>
          </div>
        </div>
      )}

      {/* Claude Transfer Success Banner */}
      {claudeTransferSuccess && (
        <div className="vz-beru-transfer-card">
          <div className="vz-beru-transfer-header">
            <span className="vz-label-bold">✓ TRANSFERRED TO CLAUDE</span>
            <span className="vz-badge-sm vz-badge-success">Ready</span>
          </div>
          <p className="vz-meta-text">
            Opened <code>{CLAUDE_NEW_CHAT_URL}</code> in a new tab. The verified conversation transcript has been copied to your clipboard.
          </p>
          <div className="vz-meta-val-next">
            👉 <strong>Next Step:</strong> Switch to Claude and press <strong>Ctrl+V</strong> (or Cmd+V) to continue your conversation.
          </div>
          <div className="vz-btn-row">
            <button
              type="button"
              className="vz-btn-secondary vz-btn-xs"
              onClick={() => void copyTransferPromptAgain()}
            >
              {copiedPrompt ? "✓ Copied!" : "📋 Copy Context Again"}
            </button>
            <button
              type="button"
              className="vz-btn-secondary vz-btn-xs"
              onClick={() => {
                if (typeof window !== "undefined") {
                  window.open(CLAUDE_NEW_CHAT_URL, "_blank");
                }
              }}
            >
              🔗 Re-open Claude Tab
            </button>
          </div>
        </div>
      )}

      {/* Spoken Transcript Preview */}
      {currentTranscript && beruState !== "idle" && (
        <div className="vz-beru-transcript">
          <span className="vz-meta-label">YOU SAID</span>
          <p className="vz-meta-text">{currentTranscript}</p>
        </div>
      )}

      {/* Conversation History */}
      {history.length > 0 && (
        <div className="vz-beru-history" aria-label="Conversation history">
          {history.map((item, i) => (
            <div key={i} className={`vz-beru-msg vz-beru-msg-${item.role}`}>
              <span className="vz-beru-msg-label">
                {item.role === "user" ? "You" : "BERU"}
              </span>
              <p className="vz-beru-msg-content">{item.content}</p>
            </div>
          ))}
        </div>
      )}

      {/* Voice Controls */}
      <div className="vz-btn-row vz-beru-controls">
        {speechSupported ? (
          <>
            {beruState === "listening" ? (
              <button
                type="button"
                className="vz-btn-secondary vz-beru-stop-btn"
                onClick={stopListening}
              >
                ⏹ Stop Listening
              </button>
            ) : (
              <button
                type="button"
                className="vz-btn-primary vz-beru-speak-btn"
                onClick={startListening}
                disabled={beruState === "processing" || beruState === "speaking"}
              >
                🎤 Speak: &ldquo;Hey Beru&rdquo;
              </button>
            )}
            {isSpeaking && (
              <button
                type="button"
                className="vz-btn-secondary"
                onClick={stopSpeaking}
              >
                🔇 Stop Speaking
              </button>
            )}
          </>
        ) : (
          <span className="vz-label-muted">
            Voice input unavailable in this browser. Use text or action buttons.
          </span>
        )}
      </div>

      {/* Text fallback input */}
      <div className="vz-beru-text-row">
        <input
          type="text"
          className="vz-input vz-beru-text-input"
          placeholder={
            speechSupported
              ? "Or type e.g. 'Get chat file', 'Give to Claude'…"
              : "Type a command e.g. 'Get chat file', 'Give to Claude'…"
          }
          value={textInput}
          onChange={(e) => setTextInput(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={beruState === "listening" || beruState === "processing"}
          aria-label="Message or command to BERU"
        />
        <button
          type="button"
          className="vz-btn-secondary"
          onClick={handleTextSend}
          disabled={
            !textInput.trim() ||
            beruState === "listening" ||
            beruState === "processing"
          }
        >
          Send
        </button>
      </div>

      {/* Privacy & Browser Disclosure */}
      <p className="vz-beru-disclosure">
        Speech recognition uses your browser&apos;s voice API, which may process audio via browser provider services. Audio is never stored or recorded by VOIDZONE. Cross-platform transfer to Claude requires your explicit voice command or button confirmation.
      </p>
    </section>
  );
}
