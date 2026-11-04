import React, { useState, useEffect } from "react";
import {
  getBackendConfig,
  saveBackendConfig,
  checkLiveness,
  DEFAULT_BACKEND_URL,
} from "../services/voidzoneBackendClient.ts";

interface BackendSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function BackendSettingsModal({
  isOpen,
  onClose,
}: BackendSettingsModalProps) {
  const [baseUrl, setBaseUrl] = useState(DEFAULT_BACKEND_URL);
  const [apiKey, setApiKey] = useState("");
  const [showApiKey, setShowApiKey] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<{
    success: boolean;
    message: string;
  } | null>(null);
  const [saveStatus, setSaveStatus] = useState("");

  useEffect(() => {
    if (isOpen) {
      void getBackendConfig().then((cfg) => {
        setBaseUrl(cfg.backendBaseUrl || DEFAULT_BACKEND_URL);
        setApiKey(cfg.kairoApiKey || "");
        setTestResult(null);
        setSaveStatus("");
      });
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleTestConnection = async () => {
    setIsTesting(true);
    setTestResult(null);
    setSaveStatus("");
    try {
      const res = await checkLiveness(baseUrl);
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
    await saveBackendConfig({
      backendBaseUrl: baseUrl,
      kairoApiKey: apiKey,
    });
    setSaveStatus("Settings saved successfully.");
    setTimeout(() => {
      onClose();
    }, 800);
  };

  return (
    <div className="vz-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="vz-settings-title">
      <div className="vz-modal-card">
        <div className="vz-modal-header">
          <h3 id="vz-settings-title" className="vz-modal-title">
            ⚙️ Backend Settings
          </h3>
          <button
            type="button"
            className="vz-btn-icon-subtle"
            onClick={onClose}
            aria-label="Close settings"
          >
            ✕
          </button>
        </div>

        <form onSubmit={handleSave} className="vz-modal-body">
          <p className="vz-modal-description">
            Configure connection to your local ASP.NET Core backend (<code>Kairo.API</code>).
            The backend manages Meta Model API keys internally in .NET User Secrets.
          </p>

          <div className="vz-form-row">
            <label className="vz-form-label" htmlFor="vz-backend-url-input">
              Backend Base URL
            </label>
            <input
              id="vz-backend-url-input"
              className="vz-input"
              type="text"
              placeholder="http://localhost:5171"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              required
            />
          </div>

          <div className="vz-form-row">
            <div className="vz-label-with-action">
              <label className="vz-form-label" htmlFor="vz-api-key-input">
                Kairo API Key
              </label>
              <button
                type="button"
                className="vz-btn-link-sm"
                onClick={() => setShowApiKey(!showApiKey)}
              >
                {showApiKey ? "Hide" : "Show"}
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
              Personal developer key generated via <code>POST /api/v1/api-keys</code>.
            </span>
          </div>

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

