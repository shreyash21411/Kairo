import React, { useState, useEffect } from "react";
import {
  getBackendConfig,
  saveBackendConfig,
  checkLiveness,
} from "../services/voidzoneBackendClient.ts";
import { BACKEND_DEPLOYMENT_STATUS } from "../config/backendConfig.ts";

interface BackendSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

/** SVG eye icon — open (password visible) */
function EyeOpenIcon() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

/** SVG eye-off icon — closed (password hidden) */
function EyeOffIcon() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  );
}

export default function BackendSettingsModal({
  isOpen,
  onClose,
}: BackendSettingsModalProps) {
  const [apiKey, setApiKey] = useState("");
  const [showApiKey, setShowApiKey] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<
    "unknown" | "connected" | "disconnected"
  >("unknown");
  const [testResult, setTestResult] = useState<{
    success: boolean;
    message: string;
  } | null>(null);
  const [saveStatus, setSaveStatus] = useState("");

  // Load saved API key on open; always reset show state to hidden.
  useEffect(() => {
    if (isOpen) {
      setShowApiKey(false);
      setTestResult(null);
      setSaveStatus("");
      setConnectionStatus("unknown");
      void getBackendConfig().then((cfg) => {
        setApiKey(cfg.kairoApiKey || "");
      });
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleTestConnection = async () => {
    setIsTesting(true);
    setTestResult(null);
    setSaveStatus("");
    try {
      const res = await checkLiveness();
      setConnectionStatus(res.success ? "connected" : "disconnected");
      setTestResult({
        success: res.success,
        message: res.message,
      });
    } finally {
      setIsTesting(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaveStatus("");
    // Only save the API key — URL is not user-configurable.
    await saveBackendConfig({ kairoApiKey: apiKey });
    setSaveStatus("Settings saved.");
    setTimeout(() => {
      onClose();
    }, 800);
  };

  const statusDotColor =
    connectionStatus === "connected"
      ? "var(--vz-success)"
      : connectionStatus === "disconnected"
      ? "var(--vz-danger)"
      : "var(--vz-text-muted)";

  const statusLabel =
    connectionStatus === "connected"
      ? "Connected"
      : connectionStatus === "disconnected"
      ? "Disconnected"
      : "Not tested";

  const deploymentNote =
    BACKEND_DEPLOYMENT_STATUS === "development"
      ? "Development mode · local server"
      : BACKEND_DEPLOYMENT_STATUS === "pending"
      ? "⚠ Production deployment pending"
      : "Production";

  return (
    <div
      className="vz-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="vz-settings-title"
    >
      <div className="vz-modal-card">
        <div className="vz-modal-header">
          <h3 id="vz-settings-title" className="vz-modal-title">
            Backend Settings
          </h3>
          <button
            type="button"
            className="vz-btn-icon-subtle"
            onClick={onClose}
            aria-label="Close settings"
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSave} className="vz-modal-body scrollbar-hidden">
          {/* Backend connection status row */}
          <div className="vz-settings-status-row">
            <span className="vz-form-label">Backend</span>
            <div className="vz-settings-status-info">
              <span
                className="vz-settings-status-dot"
                style={{ background: statusDotColor }}
                aria-hidden="true"
              />
              <span className="vz-settings-status-label">{statusLabel}</span>
              <span className="vz-settings-status-deploy">
                {deploymentNote}
              </span>
            </div>
          </div>

          {/* Kairo API Key input */}
          <div className="vz-form-row">
            <div className="vz-label-with-action">
              <label className="vz-form-label" htmlFor="vz-api-key-input">
                Kairo API Key
              </label>
              <button
                type="button"
                className="vz-btn-eye"
                onClick={() => setShowApiKey((v) => !v)}
                title={showApiKey ? "Hide API key" : "Show API key"}
                aria-label={showApiKey ? "Hide API key" : "Show API key"}
                aria-pressed={showApiKey}
              >
                {showApiKey ? <EyeOpenIcon /> : <EyeOffIcon />}
              </button>
            </div>
            <input
              id="vz-api-key-input"
              className="vz-input vz-input-mono"
              type={showApiKey ? "text" : "password"}
              placeholder="kro_live_..."
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
            <span className="vz-input-hint">
              Personal developer key — generated via your VOIDZONE account.
            </span>
          </div>

          {/* Test / save feedback */}
          {testResult && (
            <div
              className={`vz-banner ${
                testResult.success ? "vz-banner-success" : "vz-banner-error"
              }`}
            >
              {testResult.success ? "✓ " : "⚠ "}
              {testResult.message}
            </div>
          )}

          {saveStatus && (
            <div className="vz-banner vz-banner-success">{saveStatus}</div>
          )}

          <div className="vz-modal-footer">
            <button
              type="button"
              className="vz-btn-secondary"
              onClick={handleTestConnection}
              disabled={isTesting}
            >
              {isTesting ? "Testing..." : "Test Connection"}
            </button>
            <div className="vz-btn-group-right">
              <button
                type="button"
                className="vz-btn-subtle"
                onClick={onClose}
              >
                Cancel
              </button>
              <button type="submit" className="vz-btn-primary">
                Save
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
