import { useState, useRef, useEffect } from "react";
import {
  createArchiveFromInput,
  createArchiveFromCapturedConversation,
  parseAndValidateArchive,
  serializeArchive,
  type ContinuityArchive,
  type CompletenessStatus,
  type CapturedConversation,
} from "./archiveLifecycle.ts";
import {
  getActiveCaptureSession,
  clearActiveCaptureSession,
} from "../storage/conversationStorage.ts";
import { computeConversationMetrics } from "./captureLifecycle.ts";

interface ContinuityProps {
  memoryEnabled?: boolean;
  selectedProject?: string;
}

export default function Continuity({ selectedProject }: ContinuityProps) {
  // Manual import / paste state
  const [platform, setPlatform] = useState("chatgpt");
  const [title, setTitle] = useState("");
  const [completeness, setCompleteness] = useState<CompletenessStatus>("unknown");
  const [transcript, setTranscript] = useState("");
  const [showManualInput, setShowManualInput] = useState(false);

  // Active capture state
  const [activeCapture, setActiveCapture] = useState<CapturedConversation | null>(null);
  const [activeTabConvId, setActiveTabConvId] = useState<string | null>(null);
  const [activeTabUrl, setActiveTabUrl] = useState<string | null>(null);

  // Output archive state
  const [archive, setArchive] = useState<ContinuityArchive | null>(null);
  const [error, setError] = useState("");
  const [importError, setImportError] = useState("");
  const [status, setStatus] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [copiedId, setCopiedId] = useState(false);
  const [copiedPrompt, setCopiedPrompt] = useState(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Detect active browser tab
  useEffect(() => {
    if (typeof chrome !== "undefined" && chrome.tabs?.query) {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const tab = tabs[0];
        if (tab?.url) {
          setActiveTabUrl(tab.url);
          const match = tab.url.match(/chatgpt\.com\/c\/([a-zA-Z0-9_-]+)/);
          if (match) {
            setActiveTabConvId(match[1]);
          } else if (tab.url.includes("chatgpt.com")) {
            setActiveTabConvId("new-chat");
          } else {
            setActiveTabConvId(null);
          }
        }
      });
    }
  }, []);

  // Load active capture session from storage and listen for real-time updates
  useEffect(() => {
    let isMounted = true;

    async function loadActiveCapture() {
      try {
        const session = await getActiveCaptureSession();
        if (isMounted) {
          setActiveCapture(session);
        }
      } catch {
        // Standalone environments
      }
    }

    void loadActiveCapture();

    const handleStorageChange = (
      changes: { [key: string]: chrome.storage.StorageChange },
      areaName: string
    ) => {
      if (areaName === "local" && changes["activeCaptureSession"]) {
        const newSession = changes["activeCaptureSession"].newValue as CapturedConversation | undefined;
        if (isMounted) {
          setActiveCapture(newSession ?? null);
        }
      }
    };

    if (typeof chrome !== "undefined" && chrome.storage?.onChanged) {
      chrome.storage.onChanged.addListener(handleStorageChange);
    }

    return () => {
      isMounted = false;
      if (typeof chrome !== "undefined" && chrome.storage?.onChanged) {
        chrome.storage.onChanged.removeListener(handleStorageChange);
      }
    };
  }, []);

  // Determine current active session strictly for the active tab (prevents stale conversation metrics)
  const isCurrentTabSession = Boolean(
    activeCapture &&
      (!activeTabConvId ||
        activeTabConvId === "new-chat" ||
        activeCapture.id === activeTabConvId ||
        (activeCapture.url && activeTabUrl && activeCapture.url === activeTabUrl))
  );

  const establishedSession = isCurrentTabSession ? activeCapture : null;
  const metrics = computeConversationMetrics(establishedSession?.messages);

  // Copy Conversation ID action
  const handleCopyId = async (id: string) => {
    if (!id || id === "Unavailable") return;
    try {
      await navigator.clipboard.writeText(id);
      setCopiedId(true);
      setTimeout(() => setCopiedId(false), 2000);
    } catch {
      // Ignore clipboard permission errors
    }
  };

  // Copy Continuation Prompt action
  const handleCopyPrompt = async () => {
    if (!archive?.voidzone.instructions.transferPrompt) return;
    try {
      await navigator.clipboard.writeText(
        archive.voidzone.instructions.transferPrompt
      );
      setCopiedPrompt(true);
      setTimeout(() => setCopiedPrompt(false), 2000);
    } catch {
      // Ignore clipboard permission errors
    }
  };

  // Primary Action: Generate Archive from Active Capture
  const handleGenerateFromCapture = async () => {
    if (!establishedSession || establishedSession.messages.length === 0) {
      setError("No valid messages captured in the active conversation yet.");
      return;
    }

    setError("");
    setImportError("");
    setStatus("");
    setIsProcessing(true);

    try {
      const generated = await createArchiveFromCapturedConversation(
        establishedSession,
        {
          project: selectedProject
            ? { id: selectedProject, name: selectedProject }
            : undefined,
        }
      );
      setArchive(generated);
      setStatus(
        `Generated canonical archive (${generated.conversation.messages.length} messages, ${generated.completeness.status.toUpperCase()}, SHA-256 verified).`
      );
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Unable to create archive from captured conversation."
      );
    } finally {
      setIsProcessing(false);
    }
  };

  // Primary Action (Manual): Generate Archive from pasted transcript
  const handleGenerateManual = async () => {
    setError("");
    setImportError("");
    setStatus("");

    if (!transcript.trim()) {
      setError("Please paste a conversation transcript first.");
      return;
    }

    setIsProcessing(true);
    try {
      const generated = await createArchiveFromInput({
        rawTranscript: transcript,
        platform,
        title: title.trim() || undefined,
        completenessStatus: completeness,
        project: selectedProject
          ? { id: selectedProject, name: selectedProject }
          : undefined,
      });

      setArchive(generated);
      setStatus(
        `Generated canonical archive (${generated.conversation.messages.length} messages, ${generated.completeness.status.toUpperCase()}, SHA-256 verified).`
      );
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Failed to generate continuity archive."
      );
    } finally {
      setIsProcessing(false);
    }
  };

  // Export JSON file
  const handleExport = () => {
    if (!archive) return;
    try {
      const jsonString = serializeArchive(archive);
      const blob = new Blob([jsonString], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `voidzone-continuity-${archive.archiveId.slice(0, 8)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setStatus("Archive exported successfully as JSON.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to export archive.");
    }
  };

  // Import JSON file
  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setError("");
    setImportError("");
    setStatus("");
    setIsProcessing(true);

    try {
      const text = await file.text();
      const res = await parseAndValidateArchive(text);

      if (!res.success || !res.archive) {
        setImportError(
          `Import failed:\n${(res.errors || ["Invalid archive file."]).join("\n")}`
        );
        return;
      }

      setArchive(res.archive);
      setPlatform(res.archive.source.platform || "chatgpt");
      setTitle(res.archive.source.title || "");
      setTranscript(res.archive.rawTranscript);
      setCompleteness(res.archive.completeness.status);
      setStatus(
        `Imported archive successfully (${res.archive.conversation.messages.length} messages, ${res.archive.completeness.status.toUpperCase()}, SHA-256 verified).`
      );
    } catch (err) {
      setImportError(
        `File read error: ${err instanceof Error ? err.message : "Unknown error"}`
      );
    } finally {
      setIsProcessing(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  // Validate Integrity
  const handleValidateIntegrity = async () => {
    if (!archive) return;
    setError("");
    setStatus("");
    try {
      const res = await parseAndValidateArchive(serializeArchive(archive));
      if (res.success && res.integrityVerified) {
        setStatus("Integrity confirmed: SHA-256 matches canonical messages and transcript.");
      } else {
        setError(`Integrity check failed: ${(res.errors || []).join(", ")}`);
      }
    } catch (err) {
      setError(`Integrity error: ${err instanceof Error ? err.message : "Unknown"}`);
    }
  };

  const handleClearSession = async () => {
    try {
      await clearActiveCaptureSession();
    } catch {
      // Ignore storage errors
    }
    setActiveCapture(null);
    setStatus("Active capture session cleared.");
  };

  // Display conversation ID
  const displayConvId = establishedSession
    ? establishedSession.id
    : activeTabConvId && activeTabConvId !== "new-chat"
    ? activeTabConvId
    : "Unavailable";

  // Display source platform
  const displayPlatform = establishedSession
    ? establishedSession.platform.toUpperCase()
    : activeTabConvId
    ? "CHATGPT"
    : "MANUAL / INACTIVE";

  // Display conversation title
  const displayTitle = establishedSession?.title
    ? establishedSession.title
    : activeTabConvId === "new-chat"
    ? "New ChatGPT Session"
    : activeTabConvId
    ? `Active Chat (${activeTabConvId.slice(0, 8)}...)`
    : "No active conversation tab";

  // Capture Health state calculation
  const captureState = establishedSession?.state || "idle";
  const completenessStatus = establishedSession?.isComplete
    ? "COMPLETE"
    : establishedSession?.state === "interrupted"
    ? "PARTIAL (INTERRUPTED)"
    : establishedSession && establishedSession.messages.length > 0
    ? "PARTIAL"
    : "UNKNOWN";

  const completenessReason = establishedSession?.isComplete
    ? "Platform connector verified full conversation history."
    : establishedSession?.state === "interrupted"
    ? establishedSession.error || "Capture stream was interrupted."
    : establishedSession?.hasMoreHistory
    ? "Older conversation messages remain uncaptured on the platform."
    : establishedSession && establishedSession.messages.length > 0
    ? "Live session portion captured; full history boundaries unverified."
    : "No messages recorded for this tab yet.";

  return (
    <div className="vz-continuity-container">
      {/* 1. Active Conversation Panel */}
      <section className="vz-card vz-active-conv-card">
        <div className="vz-card-header">
          <div className="vz-badge-group">
            <span className="vz-badge vz-badge-platform">{displayPlatform}</span>
            <span
              className={`vz-badge ${
                captureState === "checkpoint_available"
                  ? "vz-badge-success"
                  : captureState === "response_in_progress"
                  ? "vz-badge-warning"
                  : captureState === "interrupted"
                  ? "vz-badge-danger"
                  : "vz-badge-neutral"
              }`}
            >
              ● {captureState.toUpperCase().replace("_", " ")}
            </span>
          </div>

          <button
            type="button"
            className="vz-btn-icon-subtle"
            onClick={() => handleCopyId(displayConvId)}
            title="Copy Active Conversation ID"
            disabled={displayConvId === "Unavailable"}
          >
            {copiedId ? "✓ Copied" : "📋 Copy ID"}
          </button>
        </div>

        <h3 className="vz-conv-title" title={displayTitle}>
          {displayTitle}
        </h3>

        <div className="vz-conv-id-row">
          <span className="vz-label-muted">ID:</span>
          <code className="vz-code-inline">{displayConvId}</code>
        </div>
      </section>

      {/* 2. Message Metric Cards */}
      <section className="vz-metrics-grid">
        <div className="vz-metric-card">
          <span className="vz-metric-label">HUMAN</span>
          <span className="vz-metric-value">{metrics.humanCount}</span>
        </div>

        <div className="vz-metric-card">
          <span className="vz-metric-label">AI / ASST</span>
          <span className="vz-metric-value">{metrics.assistantCount}</span>
        </div>

        <div className="vz-metric-card">
          <span className="vz-metric-label">TOTAL VALID</span>
          <span className="vz-metric-value">{metrics.totalValidCount}</span>
        </div>
      </section>

      {/* 3. Capture Health Panel */}
      <section className="vz-card vz-health-card">
        <div className="vz-health-header">
          <span className="vz-label-bold">CAPTURE HEALTH</span>
          <span
            className={`vz-badge-sm ${
              completenessStatus === "COMPLETE"
                ? "vz-badge-success"
                : completenessStatus.includes("PARTIAL")
                ? "vz-badge-warning"
                : "vz-badge-neutral"
            }`}
          >
            {completenessStatus}
          </span>
        </div>

        <p className="vz-health-reason">{completenessReason}</p>

        {establishedSession?.lastCheckpointAt && (
          <div className="vz-checkpoint-note">
            <span>Last Checkpoint:</span>
            <span>
              {new Date(establishedSession.lastCheckpointAt).toLocaleTimeString()}
            </span>
          </div>
        )}
      </section>

      {/* Feedback Banners */}
      {status && <div className="vz-banner vz-banner-success">{status}</div>}
      {error && <div className="vz-banner vz-banner-error">{error}</div>}
      {importError && (
        <div className="vz-banner vz-banner-error">{importError}</div>
      )}

      {/* 4. Primary Actions */}
      <div className="vz-actions-group">
        <button
          type="button"
          className="vz-btn-primary"
          onClick={handleGenerateFromCapture}
          disabled={
            isProcessing ||
            !establishedSession ||
            establishedSession.messages.length === 0
          }
        >
          ⚡ Generate Continuity Archive
        </button>

        <div className="vz-btn-row">
          <input
            ref={fileInputRef}
            type="file"
            accept=".json,application/json"
            style={{ display: "none" }}
            onChange={handleImportFile}
          />
          <button
            type="button"
            className="vz-btn-secondary"
            onClick={() => fileInputRef.current?.click()}
            disabled={isProcessing}
          >
            📂 Import JSON
          </button>

          <button
            type="button"
            className="vz-btn-secondary"
            onClick={handleExport}
            disabled={isProcessing || !archive}
          >
            💾 Export JSON
          </button>

          <button
            type="button"
            className="vz-btn-secondary"
            onClick={handleValidateIntegrity}
            disabled={isProcessing || !archive}
            title="Verify SHA-256 checksum against canonical fields"
          >
            🛡️ Verify
          </button>
        </div>
      </div>

      {/* 5. Manual Fallback Accordion */}
      <div className="vz-manual-accordion">
        <button
          type="button"
          className="vz-accordion-toggle"
          onClick={() => setShowManualInput(!showManualInput)}
        >
          <span>{showManualInput ? "▼" : "▶"} Manual Input / Pasted Transcript</span>
          <span className="vz-label-muted">Phase 1 Fallback</span>
        </button>

        {showManualInput && (
          <div className="vz-manual-content">
            <div className="vz-form-row">
              <label className="vz-form-label" htmlFor="vz-platform-select">
                Source Platform
              </label>
              <select
                id="vz-platform-select"
                className="vz-select"
                value={platform}
                onChange={(e) => setPlatform(e.target.value)}
              >
                <option value="chatgpt">ChatGPT</option>
                <option value="claude">Claude</option>
                <option value="other">Other</option>
              </select>
            </div>

            <div className="vz-form-row">
              <label className="vz-form-label" htmlFor="vz-title-input">
                Conversation Title
              </label>
              <input
                id="vz-title-input"
                className="vz-input"
                type="text"
                placeholder="Title or topic..."
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </div>

            <div className="vz-form-row">
              <label className="vz-form-label" htmlFor="vz-completeness-select">
                Completeness Declaration
              </label>
              <select
                id="vz-completeness-select"
                className="vz-select"
                value={completeness}
                onChange={(e) =>
                  setCompleteness(e.target.value as CompletenessStatus)
                }
              >
                <option value="unknown">Unknown (Unverified)</option>
                <option value="partial">Partial (Incomplete)</option>
                <option value="complete">Complete (Full Transcript)</option>
              </select>
            </div>

            <div className="vz-form-row">
              <label className="vz-form-label" htmlFor="vz-transcript-area">
                Raw Transcript Text
              </label>
              <textarea
                id="vz-transcript-area"
                className="vz-textarea"
                rows={5}
                placeholder="Paste conversation transcript here..."
                value={transcript}
                onChange={(e) => setTranscript(e.target.value)}
              />
            </div>

            <button
              type="button"
              className="vz-btn-secondary vz-btn-full"
              onClick={handleGenerateManual}
              disabled={isProcessing}
            >
              Generate from Manual Transcript
            </button>
          </div>
        )}
      </div>

      {/* 6. Archive Preview */}
      {archive && (
        <section className="vz-card vz-preview-card">
          <div className="vz-card-header">
            <span className="vz-label-bold">CONTINUITY ARCHIVE PREVIEW</span>
            <span className="vz-badge vz-badge-success">
              {archive.completeness.status.toUpperCase()}
            </span>
          </div>

          <div className="vz-preview-meta">
            <div>
              <span className="vz-label-muted">Archive ID:</span>{" "}
              <code>{archive.archiveId.slice(0, 13)}...</code>
            </div>
            <div>
              <span className="vz-label-muted">Platform:</span>{" "}
              <strong>{archive.source.platform}</strong>
            </div>
            <div>
              <span className="vz-label-muted">Messages:</span>{" "}
              <strong>{archive.conversation.messages.length}</strong>
            </div>
            <div>
              <span className="vz-label-muted">SHA-256:</span>{" "}
              <code title={archive.integrity.sourceHash}>
                {archive.integrity.sourceHash.slice(0, 16)}...
              </code>
            </div>
          </div>

          <div className="vz-preview-section">
            <div className="vz-preview-section-header">
              <span className="vz-label-sm">TRANSFER PROMPT</span>
              <button
                type="button"
                className="vz-btn-icon-subtle"
                onClick={handleCopyPrompt}
              >
                {copiedPrompt ? "✓ Copied" : "📋 Copy Prompt"}
              </button>
            </div>
            <pre className="vz-prompt-box">
              {archive.voidzone.instructions.transferPrompt}
            </pre>
          </div>

          <div className="vz-preview-section">
            <span className="vz-label-sm">CANONICAL MESSAGES</span>
            <div className="vz-messages-scroll">
              {archive.conversation.messages.map((m) => (
                <div key={m.id} className="vz-message-item">
                  <div className="vz-message-meta">
                    <span
                      className={`vz-role-tag vz-role-${m.role}`}
                    >
                      {m.role.toUpperCase()}
                    </span>
                    <span className="vz-msg-seq">#{m.sequence}</span>
                    {m.timestamp && (
                      <span className="vz-msg-time">
                        {new Date(m.timestamp).toLocaleTimeString()}
                      </span>
                    )}
                  </div>
                  <div className="vz-message-text">{m.content}</div>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* Active capture reset button */}
      {activeCapture && (
        <div className="vz-footer-actions">
          <button
            type="button"
            className="vz-btn-link"
            onClick={handleClearSession}
          >
            Clear Active Capture Session Cache
          </button>
        </div>
      )}
    </div>
  );
}
