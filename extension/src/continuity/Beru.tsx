/**
 * Beru.tsx
 *
 * BERU — Bridged Engagement and Recall Unit
 * An isolated voice agent feature within VOIDZONE.
 *
 * Architecture guarantees:
 * - Feature-flag gated via beruEnabled prop (default disabled).
 * - Uses browser SpeechRecognition (webkitSpeechRecognition) for STT.
 * - Uses browser SpeechSynthesis for TTS.
 * - Audio is never stored or transmitted; only the transcribed text is sent to backend.
 * - Communicates with POST /api/voidzone/beru/chat via beruChat() client function.
 * - Does NOT touch Memory or Continuity services.
 * - Meta API key stays server-side.
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { beruChat } from "../services/voidzoneBackendClient";
import type { BeruMessageItem } from "../services/voidzoneTypes";
import { VoidzoneApiError } from "../services/voidzoneTypes";

interface BeruProps {
  beruEnabled: boolean;
  selectedProject?: string;
  projectContext?: string;
}

type BeruState = "idle" | "listening" | "processing" | "speaking" | "error";

const MAX_HISTORY = 10;

export default function Beru({ beruEnabled, selectedProject, projectContext }: BeruProps) {
  const [beruState, setBeruState] = useState<BeruState>("idle");
  const [currentTranscript, setCurrentTranscript] = useState("");
  const [error, setError] = useState("");
  const [history, setHistory] = useState<BeruMessageItem[]>([]);
  const [textInput, setTextInput] = useState("");
  const [speechSupported, setSpeechSupported] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recognitionRef = useRef<any>(null);
  const synthRef = useRef<SpeechSynthesis | null>(null);
  const beruStateRef = useRef<BeruState>("idle");

  // Keep ref in sync with state for event handlers that close over stale state
  useEffect(() => {
    beruStateRef.current = beruState;
  }, [beruState]);

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
    (text: string) => {
      if (!synthRef.current || !text) return;
      stopSpeaking();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 1.0;
      utterance.pitch = 1.0;
      utterance.onstart = () => setIsSpeaking(true);
      utterance.onend = () => {
        setIsSpeaking(false);
        setBeruState("idle");
      };
      utterance.onerror = () => {
        setIsSpeaking(false);
        setBeruState("idle");
      };
      synthRef.current.speak(utterance);
    },
    [stopSpeaking]
  );

  const sendMessage = useCallback(
    async (message: string) => {
      if (!message.trim()) return;
      setBeruState("processing");
      setError("");

      const userItem: BeruMessageItem = { role: "user", content: message.trim() };

      try {
        const res = await beruChat({
          message: message.trim(),
          projectId: selectedProject || undefined,
          projectContext: projectContext || undefined,
          history: history.slice(-MAX_HISTORY),
        });

        const assistantItem: BeruMessageItem = { role: "assistant", content: res.reply };
        setHistory((prev) => [...prev, userItem, assistantItem].slice(-MAX_HISTORY));
        setBeruState("speaking");
        speakResponse(res.reply);
      } catch (err) {
        setHistory((prev) => [...prev, userItem].slice(-MAX_HISTORY));
        const msg =
          err instanceof VoidzoneApiError
            ? err.message
            : err instanceof Error
            ? err.message
            : "BERU failed to respond. Please try again.";
        setError(msg);
        setBeruState("error");
      }
    },
    [history, selectedProject, projectContext, speakResponse]
  );

  const startListening = useCallback(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any;
    const SpeechRec = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!SpeechRec) return;

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
        sendMessage(text);
      } else {
        setBeruState("idle");
      }
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    recognition.onerror = (event: any) => {
      if (event.error !== "aborted") {
        setError(`Microphone error: ${event.error as string}`);
        setBeruState("error");
      } else {
        setBeruState("idle");
      }
    };

    recognition.onend = () => {
      if (beruStateRef.current === "listening") {
        setBeruState("idle");
      }
    };

    recognition.start();
  }, [sendMessage]);

  const stopListening = useCallback(() => {
    if (recognitionRef.current) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call
      recognitionRef.current.abort();
      recognitionRef.current = null;
    }
    setBeruState("idle");
  }, []);

  const handleTextSend = () => {
    if (!textInput.trim()) return;
    setCurrentTranscript(textInput.trim());
    sendMessage(textInput.trim());
    setTextInput("");
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") handleTextSend();
  };

  const clearConversation = () => {
    stopSpeaking();
    setHistory([]);
    setCurrentTranscript("");
    setError("");
    setBeruState("idle");
  };

  if (!beruEnabled) {
    return (
      <section className="vz-card vz-beru-card vz-beru-disabled">
        <div className="vz-card-header">
          <span className="vz-label-bold">🎙 BERU — Voice Agent</span>
          <span className="vz-badge-sm vz-badge-neutral">Disabled</span>
        </div>
        <p className="vz-meta-text vz-beru-disabled-text">
          BERU is currently disabled. Enable it via backend configuration (
          <code>Beru:Enabled = true</code>) to activate.
        </p>
      </section>
    );
  }

  return (
    <section className="vz-card vz-beru-card">
      <div className="vz-card-header">
        <span className="vz-label-bold">🎙 BERU — Voice Agent</span>
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
            aria-hidden="true"
          />
        </div>
      </div>

      {/* Privacy disclosure */}
      <p className="vz-beru-disclosure">
        Speech recognition uses your browser&apos;s built-in voice API, which may send audio to
        the browser provider&apos;s servers. Only transcribed text is sent to the VOIDZONE
        backend.
      </p>

      {/* Conversation history */}
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

      {/* Status indicators */}
      {beruState === "listening" && (
        <div className="vz-beru-status-row" aria-live="polite">
          <span className="vz-beru-listening-indicator">🔴 Listening…</span>
        </div>
      )}

      {beruState === "processing" && (
        <div className="vz-beru-status-row" aria-live="polite">
          <span className="vz-spinner" /> Processing…
        </div>
      )}

      {currentTranscript && beruState !== "idle" && (
        <div className="vz-beru-transcript">
          <span className="vz-meta-label">YOU SAID</span>
          <p className="vz-meta-text">{currentTranscript}</p>
        </div>
      )}

      {error && (
        <div className="vz-error-box" role="alert">
          {error}
        </div>
      )}

      {/* Voice controls */}
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
                🎤 Speak to BERU
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
            Voice input unavailable in this browser. Use text input below.
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
              ? "Or type a message…"
              : "Type a message (voice unavailable)…"
          }
          value={textInput}
          onChange={(e) => setTextInput(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={beruState === "listening" || beruState === "processing"}
          aria-label="Message to BERU"
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
    </section>
  );
}
