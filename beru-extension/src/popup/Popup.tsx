import React, { useState, useEffect } from "react";
import "./popup.css";

export const Popup: React.FC = () => {
  const [micAuthorized, setMicAuthorized] = useState<boolean>(false);
  const [continuousListening, setContinuousListening] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<string>("");
  const [activeTabUrl, setActiveTabUrl] = useState<string>("");

  useEffect(() => {
    // 1. Check storage for microphone authorization and listening settings
    if (typeof chrome !== "undefined" && chrome.storage?.local) {
      chrome.storage.local.get(["beruMicAuthorized", "beruContinuousListening"], (res) => {
        setMicAuthorized(Boolean(res.beruMicAuthorized));
        setContinuousListening(Boolean(res.beruContinuousListening));
      });
    }

    // 2. Query active tab to check if user is on ChatGPT or Claude
    if (typeof chrome !== "undefined" && chrome.tabs?.query) {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]?.url) {
          setActiveTabUrl(tabs[0].url);
        }
      });
    }
  }, []);

  const openPermissionPage = () => {
    if (typeof chrome !== "undefined") {
      if (chrome.runtime?.openOptionsPage) {
        chrome.runtime.openOptionsPage();
      } else {
        chrome.tabs.create({ url: chrome.runtime.getURL("permission.html") });
      }
    }
  };

  const handleToggleListening = (e: React.ChangeEvent<HTMLInputElement>) => {
    const enabled = e.target.checked;
    setContinuousListening(enabled);
    if (typeof chrome !== "undefined" && chrome.storage?.local) {
      chrome.storage.local.set({ beruContinuousListening: enabled });
    }
    flashMessage(enabled ? "Listening enabled" : "Listening disabled");
  };

  const flashMessage = (msg: string) => {
    setStatusMessage(msg);
    setTimeout(() => setStatusMessage(""), 3500);
  };

  const sendCommandToActiveTab = (action: string, command?: string) => {
    if (typeof chrome === "undefined" || !chrome.tabs?.query) {
      flashMessage("Extension API unavailable");
      return;
    }

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const activeTab = tabs[0];
      if (!activeTab?.id) {
        flashMessage("No active tab found");
        return;
      }

      chrome.tabs.sendMessage(
        activeTab.id,
        { action, command },
        (response) => {
          if (chrome.runtime.lastError) {
            flashMessage("Open ChatGPT or Claude to use BERU");
          } else if (response?.success) {
            flashMessage("Command sent to page");
          }
        }
      );
    });
  };

  const isSupportedPage =
    activeTabUrl.includes("chatgpt.com") || activeTabUrl.includes("claude.ai");

  return (
    <div className="beru-popup-container">
      {/* Header */}
      <header className="beru-header">
        <div className="beru-brand">
          <div className="beru-logo-orb" />
          <div className="beru-brand-text">
            <h1>BERU</h1>
            <span>Voice Assistant</span>
          </div>
        </div>
        <div className="beru-badge">v0.1.0</div>
      </header>

      {/* Mic Status */}
      <div className="beru-card">
        <div className="beru-card-row">
          <span className="beru-card-label">Microphone Status</span>
          <span className={`beru-status-val ${micAuthorized ? "status-ok" : "status-warn"}`}>
            {micAuthorized ? "● Ready" : "● Not Authorized"}
          </span>
        </div>
        {!micAuthorized && (
          <button
            type="button"
            className="beru-btn-warning"
            onClick={openPermissionPage}
          >
            Authorize Microphone Access
          </button>
        )}
      </div>

      {/* Continuous Listening */}
      <div className="beru-card">
        <label className="switch-label">
          <div>
            <div style={{ fontWeight: 600, fontSize: "12px" }}>Continuous Listening</div>
            <div style={{ fontSize: "11px", color: "var(--vz-text-muted)" }}>
              Wake on "Hey Beru"
            </div>
          </div>
          <input
            type="checkbox"
            className="switch-input"
            checked={continuousListening}
            onChange={handleToggleListening}
          />
          <span className="switch-slider" />
        </label>
      </div>

      {/* Quick Actions */}
      <div className="beru-actions-grid">
        <button
          type="button"
          className="beru-btn-secondary"
          onClick={() => sendCommandToActiveTab("EXECUTE_COMMAND", "get chat file")}
          title="Download the active ChatGPT conversation as raw JSON"
        >
          📄 Get Chat File
        </button>
        <button
          type="button"
          className="beru-btn-secondary"
          onClick={() => sendCommandToActiveTab("EXECUTE_COMMAND", "give this file to claude")}
          title="Copy context to clipboard and launch Claude"
        >
          🚀 Give to Claude
        </button>
      </div>

      <button
        type="button"
        className="beru-btn-primary"
        onClick={() => sendCommandToActiveTab("TOGGLE_BERU")}
      >
        🎙️ Toggle Floating Orb
      </button>

      {/* Status feedback */}
      <div className="beru-status-msg">{statusMessage}</div>

      {/* Shortcut Guidance */}
      <div className="beru-hotkey-bar">
        <span>Hotkey:</span>
        <kbd>Alt+Shift+B</kbd>
        <span>to summon anywhere</span>
      </div>

      {/* Page indicator */}
      {!isSupportedPage && (
        <div style={{ fontSize: "11px", color: "var(--vz-amber)", textAlign: "center" }}>
          Notice: Navigate to ChatGPT or Claude to use in-page voice commands.
        </div>
      )}

      <footer className="beru-footer">
        VOIDZONE Ecosystem · Independent Assistant
      </footer>
    </div>
  );
};

