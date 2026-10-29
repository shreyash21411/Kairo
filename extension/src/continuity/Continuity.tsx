import { useState, useRef } from "react";
import {
  createArchiveFromInput,
  parseAndValidateArchive,
  serializeArchive,
  type ContinuityArchive,
  type CompletenessStatus,
} from "./archiveLifecycle.ts";

export default function Continuity() {
  const [platform, setPlatform] = useState("Claude");
  const [title, setTitle] = useState("");
  const [completeness, setCompleteness] = useState<CompletenessStatus>("unknown");
  const [transcript, setTranscript] = useState("");
  const [archive, setArchive] = useState<ContinuityArchive | null>(null);
  const [error, setError] = useState("");
  const [importError, setImportError] = useState("");
  const [status, setStatus] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const handleGenerate = async () => {
    setError("");
    setImportError("");
    setStatus("");
    setIsProcessing(true);

    try {
      const generated = await createArchiveFromInput({
        platform,
        title,
        rawTranscript: transcript,
        completenessStatus: completeness,
      });

      setArchive(generated);
      setStatus(
        `Continuity archive created (${generated.conversation.messages.length} messages, hash verified).`
      );
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Unable to create the continuity archive."
      );
    } finally {
      setIsProcessing(false);
    }
  };

  const handleCopyPrompt = async () => {
    if (!archive) return;

    try {
      await navigator.clipboard.writeText(
        archive.voidzone.instructions.transferPrompt
      );
      setStatus("Continuation prompt copied.");
      setError("");
      setImportError("");
    } catch {
      setError("Clipboard access failed. You can export the JSON instead.");
      setStatus("");
    }
  };

  const handleExportJson = () => {
    if (!archive) return;

    const jsonString = serializeArchive(archive);
    const blob = new Blob([jsonString], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.download = "voidzone-continuity.json";
    link.click();

    URL.revokeObjectURL(url);
    setStatus("JSON export requested (voidzone-continuity.json).");
    setError("");
  };

  const handleFileImport = async (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Clear only the import-specific error; leave the existing archive and its
    // status intact so a previously loaded archive remains visible if this
    // import attempt fails.
    setImportError("");
    setIsProcessing(true);

    try {
      const text = await file.text();
      const importResult = await parseAndValidateArchive(text);

      if (!importResult.success || !importResult.archive) {
        // Show import error WITHOUT touching archive state.
        setImportError(
          `Import rejected:\n${importResult.errors.join("\n")}`
        );
        return;
      }

      // Only replace the archive state after a successful validation.
      const importedArchive = importResult.archive;
      setArchive(importedArchive);
      setPlatform(importedArchive.source.platform || "Claude");
      setTitle(importedArchive.source.title || "");
      setTranscript(importedArchive.rawTranscript);
      setCompleteness(importedArchive.completeness.status);
      setImportError("");
      setError("");

      setStatus(
        importResult.wasMigrated
          ? "Legacy package imported and upgraded to canonical v1.0 archive."
          : `Valid archive imported (${importedArchive.conversation.messages.length} messages, integrity verified).`
      );
    } catch (cause) {
      // File-read failure: show import error, preserve existing archive.
      setImportError(
        cause instanceof Error
          ? `File read error: ${cause.message}`
          : "Failed to read the imported archive file."
      );
    } finally {
      setIsProcessing(false);
      // Reset input value so same file can be re-selected if desired.
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  return (
    <section className="continuity-view">
      <div className="section-header">
        <h2>Continuity</h2>
        <span className="section-description">
          Carry your work into another AI conversation.
        </span>
      </div>

      <div className="continuity-import-bar">
        <input
          ref={fileInputRef}
          type="file"
          id="continuity-file-input"
          accept=".json,application/json"
          style={{ display: "none" }}
          onChange={handleFileImport}
        />
        <button
          className="continuity-button continuity-button-secondary continuity-button-small"
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={isProcessing}
        >
          📂 Import Archive (.json)
        </button>
      </div>

      <label className="continuity-label" htmlFor="continuity-platform">
        Source platform
      </label>
      <select
        id="continuity-platform"
        className="select"
        value={platform}
        onChange={(event) => setPlatform(event.target.value)}
      >
        <option value="Claude">Claude</option>
        <option value="ChatGPT">ChatGPT</option>
        <option value="Gemini">Gemini</option>
        <option value="Other">Other</option>
      </select>

      <label className="continuity-label" htmlFor="continuity-title">
        Conversation or project title
      </label>
      <input
        id="continuity-title"
        className="continuity-input"
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        placeholder="e.g. VOIDZONE hackathon"
      />

      <label className="continuity-label" htmlFor="continuity-completeness">
        Capture completeness
      </label>
      <select
        id="continuity-completeness"
        className="select"
        value={completeness}
        onChange={(event) =>
          setCompleteness(event.target.value as CompletenessStatus)
        }
      >
        <option value="unknown">Unknown (default for pasted text)</option>
        <option value="partial">Partial conversation</option>
        <option value="complete">Complete conversation (verified)</option>
      </select>

      <label className="continuity-label" htmlFor="continuity-transcript">
        Conversation transcript
      </label>
      <textarea
        id="continuity-transcript"
        className="continuity-textarea"
        value={transcript}
        onChange={(event) => setTranscript(event.target.value)}
        placeholder="Paste conversation text here (e.g. Human: ... Claude: ...). Remove anything you don't want to transfer."
        rows={8}
      />

      <p className="continuity-help">
        This version processes pasted text locally in the extension. It validates
        schema integrity, hashes content using SHA-256, and operates completely offline
        without calling an external AI model.
      </p>

      <button
        className="continuity-button"
        type="button"
        onClick={handleGenerate}
        disabled={!transcript.trim() || isProcessing}
      >
        {isProcessing ? "Processing..." : "Generate continuity package"}
      </button>

      {error && <pre className="continuity-error" role="alert">{error}</pre>}
      {importError && (
        <pre className="continuity-error continuity-error-import" role="alert">
          {importError}
        </pre>
      )}
      {status && <p className="continuity-status" role="status">{status}</p>}

      {archive && (
        <div className="continuity-result">
          <h3>Package preview</h3>

          <div className="continuity-badges">
            <span className="continuity-badge">
              Format: {archive.format} v{archive.schemaVersion}
            </span>
            <span
              className={`continuity-badge ${
                archive.completeness.status === "complete"
                  ? "continuity-badge-success"
                  : "continuity-badge-warning"
              }`}
            >
              Completeness: {archive.completeness.status.toUpperCase()}
            </span>
            <span className="continuity-badge continuity-badge-success">
              SHA-256: {archive.integrity.sourceHash.slice(0, 12)}... (Verified)
            </span>
          </div>

          <p>
            Source: {archive.source.platform} · {archive.source.title}
          </p>
          <p>
            Messages: {archive.conversation.messages.length} structured turn(s) ·{" "}
            {archive.rawTranscript.length.toLocaleString()} characters
          </p>
          <p className="continuity-help">
            Reason: {archive.completeness.reason}
          </p>

          <label className="continuity-label" htmlFor="continuity-prompt">
            Review and edit the transfer prompt
          </label>
          <textarea
            id="continuity-prompt"
            className="continuity-textarea"
            value={archive.voidzone.instructions.transferPrompt}
            rows={8}
            onChange={(event) => {
              const updatedPrompt = event.target.value;
              setArchive({
                ...archive,
                voidzone: {
                  ...archive.voidzone,
                  instructions: {
                    ...archive.voidzone.instructions,
                    transferPrompt: updatedPrompt,
                    isEdited: true,
                  },
                },
              });
            }}
          />

          <div className="continuity-actions">
            <button
              className="continuity-button"
              type="button"
              onClick={handleCopyPrompt}
            >
              Copy continuation prompt
            </button>
            <button
              className="continuity-button continuity-button-secondary"
              type="button"
              onClick={handleExportJson}
            >
              Export JSON
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
