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
  getConversation,
} from "../storage/conversationStorage.ts";
import {
  computeConversationMetrics,
  isSessionMatchingActiveTab,
  buildRawTranscriptFromMessages,
} from "./captureLifecycle.ts";
import {
  extractMemory,
  generateContinuity,
} from "../services/voidzoneBackendClient.ts";
import {
  type MetaMemoryResult,
  type MetaContinuityResult,
  VoidzoneApiError,
} from "../services/voidzoneTypes.ts";
import {
  createRawConversationFromCaptured,
  createRawConversationFromTranscript,
  generateSafeRawExportFilename,
  serializeRawConversation,
  type RawConversationExport,
} from "./rawConversationExport.ts";

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
  // Conversation ID visibility — hidden by default for privacy
  const [showConvId, setShowConvId] = useState(false);

  // Output archive state
  const [archive, setArchive] = useState<ContinuityArchive | null>(null);
  const [error, setError] = useState("");
  const [importError, setImportError] = useState("");
  const [status, setStatus] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [copiedId, setCopiedId] = useState(false);
  const [copiedPrompt, setCopiedPrompt] = useState(false);

  // Meta Model API state
  const [isExtractingMemory, setIsExtractingMemory] = useState(false);
  const [isGeneratingContinuity, setIsGeneratingContinuity] = useState(false);
  const [memoryResult, setMemoryResult] = useState<MetaMemoryResult | null>(null);
  const [continuityResult, setContinuityResult] = useState<MetaContinuityResult | null>(null);
  const [copiedMetaPrompt, setCopiedMetaPrompt] = useState(false);

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

  // If the active tab has an authoritative conversation ID that does not match activeCapture,
  // query stored conversations so historical chats can be viewed without leaking or cross-contaminating.
  const [storedTabConversation, setStoredTabConversation] = useState<CapturedConversation | null>(null);

  useEffect(() => {
    let isMounted = true;
    if (activeTabConvId && activeTabConvId !== "new-chat" && (!activeCapture || activeCapture.id !== activeTabConvId)) {
      void getConversation(activeTabConvId).then((conv) => {
        if (isMounted && conv) {
          setStoredTabConversation({
            id: conv.id,
            platform: conv.platform || "chatgpt",
            title: conv.title || "ChatGPT conversation",
            url: conv.url || null,
            messages: (conv.messages || []).map((m, idx) => ({
              id: m.id,
              sequence: idx + 1,
              role: m.role,
              content: m.content,
              timestamp: m.timestamp ?? null,
            })),
            state: "completed",
            hasMoreHistory: false,
            isComplete: conv.completeness === "complete",
            completenessStatus: conv.completeness === "complete" ? "complete" : "partial",
            capturedAt: conv.capturedAt || new Date().toISOString(),
            lastCheckpointAt: conv.capturedAt || null,
          });
        } else if (isMounted) {
          setStoredTabConversation(null);
        }
      });
    }
    return () => {
      isMounted = false;
    };
  }, [activeTabConvId, activeCapture]);

  // Determine current active session strictly for the active tab (prevents cross-conversation contamination)
  const isCurrentTabSession = isSessionMatchingActiveTab(
    activeCapture,
    activeTabUrl,
    activeTabConvId
  );

  const establishedSession = isCurrentTabSession
    ? activeCapture
    : (isSessionMatchingActiveTab(storedTabConversation, activeTabUrl, activeTabConvId)
        ? storedTabConversation
        : null);
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
      const sessionToArchive = {
        ...establishedSession,
        id:
          establishedSession.id && establishedSession.id !== "new-chat"
            ? establishedSession.id
            : activeTabConvId && activeTabConvId !== "new-chat"
            ? activeTabConvId
            : establishedSession.id,
      };

      const generated = await createArchiveFromCapturedConversation(
        sessionToArchive,
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

  // Meta AI Memory Engine Extraction
  const handleExtractMemory = async () => {
    const hasCaptured = establishedSession && establishedSession.messages.length > 0;
    const hasManual = transcript.trim().length > 0;

    if (!hasCaptured && !hasManual) {
      setError("At least one conversation message or manual transcript is required for memory extraction.");
      return;
    }

    setError("");
    setImportError("");
    setStatus("");
    setIsExtractingMemory(true);

    try {
      const rawTranscript = hasCaptured
        ? buildRawTranscriptFromMessages(establishedSession!.messages, establishedSession!.platform)
        : transcript;

      const messages = hasCaptured
        ? establishedSession!.messages.map((m) => ({ role: m.role, content: m.content }))
        : undefined;

      const response = await extractMemory({
        rawTranscript,
        messages,
      });

      setMemoryResult(response.result);
      setStatus(
        `Extracted project memory via Meta AI (${response.result.decisions.length} decisions, ${response.result.requirements.length} requirements).`
      );
    } catch (cause) {
      if (cause instanceof VoidzoneApiError) {
        setError(cause.message);
      } else {
        setError(cause instanceof Error ? cause.message : "Failed to extract project memory.");
      }
    } finally {
      setIsExtractingMemory(false);
    }
  };

  // Meta AI Continuity Engine State Generation
  const handleGenerateMetaContinuity = async () => {
    const hasCaptured = establishedSession && establishedSession.messages.length > 0;
    const hasManual = transcript.trim().length > 0;

    if (!hasCaptured && !hasManual) {
      setError("At least one conversation message or manual transcript is required for continuity generation.");
      return;
    }

    setError("");
    setImportError("");
    setStatus("");
    setIsGeneratingContinuity(true);

    try {
      const rawTranscript = hasCaptured
        ? buildRawTranscriptFromMessages(establishedSession!.messages, establishedSession!.platform)
        : transcript;

      const sourcePlatform = establishedSession?.platform || platform || "chatgpt";
      const sourceTitle = establishedSession?.title || title || "Untitled conversation";

      const response = await generateContinuity({
        rawTranscript,
        platform: sourcePlatform,
        title: sourceTitle,
      });

      setContinuityResult(response.result);
      setStatus(
        `Generated continuity state via Meta AI for: "${response.result.currentObjective || response.result.projectName}".`
      );
    } catch (cause) {
      if (cause instanceof VoidzoneApiError) {
        setError(cause.message);
      } else {
        setError(cause instanceof Error ? cause.message : "Failed to generate continuity state.");
      }
    } finally {
      setIsGeneratingContinuity(false);
    }
  };

  const buildEnrichedContinuityPrompt = (res: MetaContinuityResult, rawTx: string) => {
    return [
      "Continue the following work using the supplied project continuity state and conversation context.",
      "",
      "=== META AI CONTINUITY STATE ===",
      `Project: ${res.projectName || "Default"}`,
      `Current Objective: ${res.currentObjective || "In progress"}`,
      `Recommended Next Action: ${res.recommendedNextAction || "Review outstanding tasks"}`,
      "",
      "Important Decisions:",
      ...(res.importantDecisions.length > 0
        ? res.importantDecisions.map((d) => `- ${d}`)
        : ["- (None explicitly noted)"]),
      "",
      "Hard Constraints:",
      ...(res.constraints.length > 0
        ? res.constraints.map((c) => `- ${c}`)
        : ["- (None explicitly noted)"]),
      "",
      "Known Blockers:",
      ...(res.blockers.length > 0
        ? res.blockers.map((b) => `- ${b}`)
        : ["- None"]),
      "",
      "Technical Context:",
      res.technicalContext || "(Standard development environment)",
      "",
      "SOURCE TRANSCRIPT",
      "-----------------",
      rawTx,
    ].join("\n");
  };

  const handleCopyMetaPrompt = async () => {
    if (!continuityResult) return;
    const hasCaptured = establishedSession && establishedSession.messages.length > 0;
    const rawTx = hasCaptured
      ? buildRawTranscriptFromMessages(establishedSession!.messages, establishedSession!.platform)
      : transcript;

    const enriched = buildEnrichedContinuityPrompt(continuityResult, rawTx);
    try {
      await navigator.clipboard.writeText(enriched);
      setCopiedMetaPrompt(true);
      setTimeout(() => setCopiedMetaPrompt(false), 2000);
    } catch {
      // Ignore clipboard error
    }
  };

  const handleApplyContinuityToArchive = async () => {
    if (!continuityResult) return;
    if (!establishedSession || establishedSession.messages.length === 0) {
      setError("Active conversation session required to generate canonical archive.");
      return;
    }

    const rawTx = buildRawTranscriptFromMessages(establishedSession.messages, establishedSession.platform);
    const enriched = buildEnrichedContinuityPrompt(continuityResult, rawTx);

    setIsProcessing(true);
    setError("");
    setStatus("");

    try {
      const sessionToArchive = {
        ...establishedSession,
        id:
          establishedSession.id && establishedSession.id !== "new-chat"
            ? establishedSession.id
            : activeTabConvId && activeTabConvId !== "new-chat"
            ? activeTabConvId
            : establishedSession.id,
      };

      const generated = await createArchiveFromCapturedConversation(
        sessionToArchive,
        {
          customTransferPrompt: enriched,
          project: selectedProject
            ? { id: selectedProject, name: selectedProject }
            : undefined,
        }
      );
      setArchive(generated);
      setStatus("Archive transfer prompt enriched with Meta AI Continuity State (Schema 1.0 verified).");
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Unable to create archive with enriched continuity prompt."
      );
    } finally {
      setIsProcessing(false);
    }
  };

  // Export JSON file (Full Continuity Archive — Mode A)
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
      // Safe download lifecycle: allow browser download manager to initiate before revoking
      setTimeout(() => {
        try {
          if (a.parentNode) {
            document.body.removeChild(a);
          }
          URL.revokeObjectURL(url);
        } catch {
          // Tolerate cleanup errors
        }
      }, 1000);
      setStatus("Archive exported successfully as JSON.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to export archive.");
    }
  };

  // Export Standalone Raw Conversation JSON (Mode B — no AI or Continuity Engine data)
  const handleExportRawConversation = () => {
    setError("");
    setStatus("");

    try {
      let rawExport: RawConversationExport;

      if (establishedSession && establishedSession.messages.length > 0) {
        rawExport = createRawConversationFromCaptured(establishedSession);
      } else if (transcript.trim()) {
        rawExport = createRawConversationFromTranscript(transcript, {
          platform,
          title: title.trim() || undefined,
          completeness,
        });
      } else {
        setError("No conversation messages available to export.");
        return;
      }

      const jsonString = serializeRawConversation(rawExport);
      const blob = new Blob([jsonString], { type: "application/json;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = generateSafeRawExportFilename(
        rawExport.conversationTitle,
        rawExport.conversationId
      );
      document.body.appendChild(a);
      a.click();
      // Safe download lifecycle: allow browser download manager to initiate before revoking
      setTimeout(() => {
        try {
          if (a.parentNode) {
            document.body.removeChild(a);
          }
          URL.revokeObjectURL(url);
        } catch {
          // Tolerate cleanup errors
        }
      }, 1000);
      setStatus(
        `Conversation exported successfully as raw JSON (${rawExport.messageCount} messages).`
      );
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to export raw conversation JSON."
      );
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
    ? establishedSession.id === "provisional-tab" || establishedSession.id === "new-chat"
      ? "Pending (Resolving ID...)"
      : establishedSession.id
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

  const sessionStatusLabel =
    captureState === "checkpoint_available"
      ? "SESSION READY"
      : captureState === "response_in_progress"
      ? "STREAMING"
      : captureState === "interrupted"
      ? "INTERRUPTED"
      : "SESSION IDLE";

  const sessionStatusTitle =
    captureState === "checkpoint_available"
      ? "Session checkpoint recorded and ready for archive"
      : captureState === "response_in_progress"
      ? "Assistant response is actively streaming"
      : captureState === "interrupted"
      ? "Capture stream was interrupted"
      : "No messages captured for this conversation yet";

  const completenessReason = establishedSession?.isComplete
    ? "Platform connector verified full conversation history."
    : establishedSession?.state === "interrupted"
    ? establishedSession.error || "Capture stream was interrupted."
    : establishedSession?.hasMoreHistory
    ? "Older conversation messages remain uncaptured on the platform."
    : establishedSession && establishedSession.messages.length > 0
    ? "Live session portion captured; full history boundaries unverified."
    : "Completeness unverified: awaiting conversation activity on this tab.";

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
              title={sessionStatusTitle}
            >
              ● {sessionStatusLabel}
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
          {showConvId ? (
            <code className="vz-code-inline">{displayConvId}</code>
          ) : (
            <span className="vz-conv-id-masked">
              {displayConvId === "Unavailable" || displayConvId.startsWith("Pending")
                ? displayConvId
                : "••••••••••••••••"}
            </span>
          )}
          <button
            type="button"
            className="vz-btn-eye"
            onClick={() => setShowConvId((v) => !v)}
            title={showConvId ? "Hide conversation ID" : "Reveal conversation ID"}
            aria-label={showConvId ? "Hide conversation ID" : "Reveal conversation ID"}
            aria-pressed={showConvId}
            disabled={displayConvId === "Unavailable" || displayConvId.startsWith("Pending")}
          >
            {showConvId ? (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                <circle cx="12" cy="12" r="3"/>
              </svg>
            ) : (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>
                <line x1="1" y1="1" x2="23" y2="23"/>
              </svg>
            )}
          </button>
        </div>

        {(!establishedSession || establishedSession.messages.length === 0) && (
          <div className="vz-session-hint">
            Session idle · Send or receive a message in the chat tab to begin capture
          </div>
        )}
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
        {/* Meta Model API Operations */}
        <div className="vz-meta-actions-strip">
          <button
            type="button"
            className="vz-btn-meta vz-btn-meta-memory"
            onClick={handleExtractMemory}
            disabled={
              isExtractingMemory ||
              isGeneratingContinuity ||
              isProcessing ||
              (!establishedSession?.messages.length && !transcript.trim())
            }
            title="Extract structured decisions, requirements, tasks, and constraints using Meta AI"
          >
            {isExtractingMemory ? "⏳ Extracting Memory..." : "🧠 Extract Memory (Meta AI)"}
          </button>

          <button
            type="button"
            className="vz-btn-meta vz-btn-meta-continuity"
            onClick={handleGenerateMetaContinuity}
            disabled={
              isExtractingMemory ||
              isGeneratingContinuity ||
              isProcessing ||
              (!establishedSession?.messages.length && !transcript.trim())
            }
            title="Synthesize project objective, blockers, and next action using Meta AI"
          >
            {isGeneratingContinuity ? "⏳ Generating State..." : "⚡ Continuity State (Meta AI)"}
          </button>
        </div>

        <button
          type="button"
          className="vz-btn-primary"
          onClick={handleGenerateFromCapture}
          disabled={
            isProcessing ||
            isExtractingMemory ||
            isGeneratingContinuity ||
            !establishedSession ||
            establishedSession.messages.length === 0
          }
          title={
            !establishedSession || establishedSession.messages.length === 0
              ? "At least one message is required to generate a continuity archive"
              : "Generate canonical archive from captured conversation"
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

        {/* Standalone Raw Conversation JSON Export (Mode B) */}
        <div className="vz-raw-export-card">
          <div className="vz-raw-export-header">
            <span className="vz-label-bold">STANDALONE TRANSCRIPT EXPORT</span>
          </div>
          <p className="vz-raw-export-desc">
            Download only your conversation transcript as JSON. No AI-generated memory or continuity data is included.
          </p>
          <button
            type="button"
            className="vz-btn-secondary vz-btn-raw-export"
            onClick={handleExportRawConversation}
            disabled={
              isProcessing ||
              isExtractingMemory ||
              isGeneratingContinuity ||
              (!establishedSession?.messages.length && !transcript.trim())
            }
            title="Download conversation transcript as standalone JSON (no AI data)"
          >
            📄 Download Conversation JSON
          </button>
        </div>
      </div>

      {/* Meta AI Continuity State Card */}
      {continuityResult && (
        <section className="vz-card vz-meta-result-card vz-meta-continuity-card">
          <div className="vz-card-header">
            <span className="vz-label-bold">⚡ META AI CONTINUITY STATE</span>
            <div className="vz-meta-card-actions">
              <span className="vz-badge-sm vz-badge-neutral">
                {continuityResult.tokenUsage.totalTokens} tokens
              </span>
              <button
                type="button"
                className="vz-btn-icon-subtle"
                onClick={() => setContinuityResult(null)}
                title="Dismiss"
              >
                ✕
              </button>
            </div>
          </div>

          <div className="vz-meta-highlight-box">
            <div className="vz-meta-field">
              <span className="vz-meta-label">CURRENT OBJECTIVE</span>
              <div className="vz-meta-val-emphasis">
                {continuityResult.currentObjective || "In progress"}
              </div>
            </div>
            <div className="vz-meta-field">
              <span className="vz-meta-label">RECOMMENDED NEXT ACTION</span>
              <div className="vz-meta-val-next">
                👉 {continuityResult.recommendedNextAction || "Continue active session"}
              </div>
            </div>
          </div>

          {continuityResult.importantDecisions.length > 0 && (
            <div className="vz-meta-section">
              <span className="vz-meta-label">BINDING DECISIONS ({continuityResult.importantDecisions.length})</span>
              <ul className="vz-meta-list">
                {continuityResult.importantDecisions.map((dec, i) => (
                  <li key={i}>{dec}</li>
                ))}
              </ul>
            </div>
          )}

          {continuityResult.constraints.length > 0 && (
            <div className="vz-meta-section">
              <span className="vz-meta-label">CONSTRAINTS</span>
              <ul className="vz-meta-list vz-meta-constraints">
                {continuityResult.constraints.map((c, i) => (
                  <li key={i}>{c}</li>
                ))}
              </ul>
            </div>
          )}

          {continuityResult.blockers.length > 0 && (
            <div className="vz-meta-section">
              <span className="vz-meta-label">KNOWN BLOCKERS</span>
              <ul className="vz-meta-list vz-meta-blockers">
                {continuityResult.blockers.map((b, i) => (
                  <li key={i}>{b}</li>
                ))}
              </ul>
            </div>
          )}

          {continuityResult.technicalContext && (
            <div className="vz-meta-section">
              <span className="vz-meta-label">TECHNICAL CONTEXT</span>
              <p className="vz-meta-text">{continuityResult.technicalContext}</p>
            </div>
          )}

          <div className="vz-btn-row vz-meta-action-row">
            <button
              type="button"
              className="vz-btn-secondary"
              onClick={handleCopyMetaPrompt}
            >
              {copiedMetaPrompt ? "✓ Copied Prompt" : "📋 Copy Restore Prompt"}
            </button>
            <button
              type="button"
              className="vz-btn-secondary"
              onClick={handleApplyContinuityToArchive}
              disabled={isProcessing || !establishedSession || establishedSession.messages.length === 0}
              title="Apply synthesized state as the transfer prompt in the canonical archive"
            >
              ⚡ Apply to Archive
            </button>
          </div>
        </section>
      )}

      {/* Meta AI Memory Extraction Card */}
      {memoryResult && (
        <section className="vz-card vz-meta-result-card vz-meta-memory-card">
          <div className="vz-card-header">
            <span className="vz-label-bold">🧠 META AI PROJECT MEMORY</span>
            <div className="vz-meta-card-actions">
              <span className="vz-badge-sm vz-badge-neutral">
                {memoryResult.tokenUsage.totalTokens} tokens
              </span>
              <button
                type="button"
                className="vz-btn-icon-subtle"
                onClick={() => setMemoryResult(null)}
                title="Dismiss"
              >
                ✕
              </button>
            </div>
          </div>

          {memoryResult.decisions.length > 0 && (
            <div className="vz-meta-section">
              <span className="vz-meta-label">DECISIONS ({memoryResult.decisions.length})</span>
              <ul className="vz-meta-list">
                {memoryResult.decisions.map((d, i) => (
                  <li key={i}>{d}</li>
                ))}
              </ul>
            </div>
          )}

          {memoryResult.requirements.length > 0 && (
            <div className="vz-meta-section">
              <span className="vz-meta-label">REQUIREMENTS ({memoryResult.requirements.length})</span>
              <ul className="vz-meta-list">
                {memoryResult.requirements.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
            </div>
          )}

          {memoryResult.constraints.length > 0 && (
            <div className="vz-meta-section">
              <span className="vz-meta-label">CONSTRAINTS</span>
              <ul className="vz-meta-list vz-meta-constraints">
                {memoryResult.constraints.map((c, i) => (
                  <li key={i}>{c}</li>
                ))}
              </ul>
            </div>
          )}

          {memoryResult.pendingTasks.length > 0 && (
            <div className="vz-meta-section">
              <span className="vz-meta-label">PENDING TASKS ({memoryResult.pendingTasks.length})</span>
              <ul className="vz-meta-list">
                {memoryResult.pendingTasks.map((t, i) => (
                  <li key={i}>{t}</li>
                ))}
              </ul>
            </div>
          )}

          {memoryResult.technicalContext && (
            <div className="vz-meta-section">
              <span className="vz-meta-label">TECHNICAL CONTEXT</span>
              <p className="vz-meta-text">{memoryResult.technicalContext}</p>
            </div>
          )}

          {memoryResult.projectFacts.length > 0 && (
            <div className="vz-meta-section">
              <span className="vz-meta-label">PROJECT FACTS</span>
              <ul className="vz-meta-list">
                {memoryResult.projectFacts.map((f, i) => (
                  <li key={i}>{f}</li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

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
