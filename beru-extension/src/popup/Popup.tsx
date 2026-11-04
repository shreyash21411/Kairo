import React, { useState, useEffect } from "react";
import "./popup.css";

type AssistantState =
  | "permission_required"
  | "idle"
  | "listening"
  | "processing"
  | "speaking"
  | "completed"
  | "error";

export const Popup: React.FC = () => {
  const [micAuthorized, setMicAuthorized] = useState<boolean>(false);
  const [listeningEnabled, setListeningEnabled] = useState<boolean>(false);
  const [assistantState, setAssistantState] = useState<AssistantState>("idle");
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [menuOpen, setMenuOpen] = useState<boolean>(false);
  const [quickFeedback, setQuickFeedback] = useState<string>("");

  // Sync state from storage and background
  const syncState = () => {
    if (typeof chrome === "undefined" || !chrome.storage?.local) return;

    chrome.storage.local.get(
      ["beruMicAuthorized", "beruListeningEnabled", "beruAssistantState", "beruLastError"],
      (res) => {
        const authorized = Boolean(res.beruMicAuthorized);
        const enabled = Boolean(res.beruListeningEnabled);
        const storedState = (res.beruAssistantState as AssistantState) || "idle";
        const lastErr = typeof res.beruLastError === "string" ? res.beruLastError : "";

        setMicAuthorized(authorized);
        setErrorMessage(lastErr);

        if (!authorized) {
          setListeningEnabled(false);
          setAssistantState("permission_required");
        } else if (enabled) {
          setListeningEnabled(true);
          setAssistantState(
            storedState === "processing" || storedState === "speaking" || storedState === "completed"
              ? storedState
              : "listening"
          );
        } else {
          setListeningEnabled(false);
          setAssistantState(storedState === "error" ? "error" : "idle");
        }
      }
    );
  };

  useEffect(() => {
    syncState();

    // Listen for real-time storage changes from background / offscreen
    if (typeof chrome !== "undefined" && chrome.storage?.onChanged) {
      const listener = () => syncState();
      chrome.storage.onChanged.addListener(listener);
      return () => {
        chrome.storage.onChanged.removeListener(listener);
      };
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
    const desired = e.target.checked;

    if (desired && !micAuthorized) {
      openPermissionPage();
      return;
    }

    setListeningEnabled(desired);
    if (typeof chrome !== "undefined" && chrome.runtime?.sendMessage) {
      chrome.runtime.sendMessage(
        { action: "SET_LISTENING", enabled: desired },
        (response) => {
          if (!response?.success) {
            syncState();
          }
        }
      );
    }
  };

  const showFeedback = (msg: string) => {
    setQuickFeedback(msg);
    setTimeout(() => setQuickFeedback(""), 2500);
  };

  const sendActionToTab = (intentType: string) => {
    if (typeof chrome === "undefined" || !chrome.tabs?.query) return;

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const activeTab = tabs[0];
      if (!activeTab?.id) {
        showFeedback("No active tab found");
        return;
      }

      chrome.tabs.sendMessage(
        activeTab.id,
        { action: "EXECUTE_INTENT", intent: { type: intentType } },
        (res) => {
          if (chrome.runtime.lastError) {
            showFeedback("Open ChatGPT or Claude to run");
          } else if (res?.success) {
            showFeedback("Command sent");
            setMenuOpen(false);
          }
        }
      );
    });
  };

  // Derive display status
  const getDisplayStatus = (): { title: string; desc: string } => {
    if (quickFeedback) {
      return { title: quickFeedback, desc: "Direct command" };
    }

    switch (assistantState) {
      case "permission_required":
        return {
          title: "Permission Required",
          desc: "Microphone authorization needed to listen",
        };
      case "listening":
        return {
          title: 'Listening for "Hey Beru"',
          desc: "Active in background & supported tabs",
        };
      case "processing":
        return {
          title: "Processing…",
          desc: "Executing your command",
        };
      case "speaking":
        return {
          title: "Speaking…",
          desc: "BERU is responding",
        };
      case "completed":
        return {
          title: "Completed",
          desc: "Handoff finished successfully",
        };
      case "error":
        return {
          title: "Notice",
          desc: errorMessage || "Recognition paused. Toggle to retry.",
        };
      case "idle":
      default:
        return {
          title: "Sleeping",
          desc: 'Toggle switch to listen for "Hey Beru"',
        };
    }
  };

  const { title, desc } = getDisplayStatus();

  const getOrbClass = (): string => {
    switch (assistantState) {
      case "listening":
        return "orb-listening";
      case "processing":
        return "orb-processing";
      case "speaking":
        return "orb-speaking";
      case "completed":
        return "orb-completed";
      case "permission_required":
      case "error":
        return "orb-permission";
      case "idle":
      default:
        return "orb-sleeping";
    }
  };

  return (
    <div className="beru-app">
      {/* Header */}
      <header className="beru-header">
        <div className="beru-brand">
          <div className="beru-brand-orb" />
          <span className="beru-brand-title">BERU</span>
          <span className="beru-version-badge">v0.1.0</span>
        </div>
        <button
          type="button"
          className="beru-icon-btn"
          onClick={() => setMenuOpen(!menuOpen)}
          title="Settings & Quick Actions"
          aria-label="Settings"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </button>
      </header>

      {/* Main Central Stage */}
      <main className="beru-stage">
        <div className="beru-orb-wrap">
          {assistantState === "listening" && <div className="orb-aura-listening" />}
          {assistantState === "processing" && <div className="orb-aura-processing" />}
          <div className={`beru-central-orb ${getOrbClass()}`}>
            {assistantState === "speaking" && <span style={{ fontSize: "22px" }}>🔊</span>}
            {assistantState === "processing" && <span style={{ fontSize: "20px" }}>⏳</span>}
            {assistantState === "completed" && <span style={{ fontSize: "22px" }}>✓</span>}
            {assistantState === "permission_required" && <span style={{ fontSize: "20px" }}>🔒</span>}
          </div>
        </div>

        <h2 className="beru-status-title">{title}</h2>
        <p className="beru-status-desc">{desc}</p>
      </main>

      {/* Primary Controls */}
      <section className="beru-controls">
        {!micAuthorized ? (
          <button type="button" className="beru-btn-auth" onClick={openPermissionPage}>
            ✦ Authorize Microphone
          </button>
        ) : (
          <label className="beru-toggle-bar">
            <div className="beru-toggle-info">
              <span className="beru-toggle-label">Wake on "Hey Beru"</span>
              <span className="beru-toggle-sub">
                {listeningEnabled ? "Continuous wake-word active" : "Listening disabled"}
              </span>
            </div>
            <div className="beru-switch">
              <input
                type="checkbox"
                checked={listeningEnabled}
                onChange={handleToggleListening}
              />
              <span className="beru-switch-slider" />
            </div>
          </label>
        )}

        <div className="beru-footer-bar">
          <span>Hotkey:</span>
          <kbd>Alt+Shift+B</kbd>
          <span>to summon</span>
        </div>
      </section>

      {/* Popover Settings / Action Menu */}
      {menuOpen && (
        <div className="beru-popover">
          <div className="beru-popover-header">
            <span className="beru-popover-title">Actions &amp; Settings</span>
            <button
              type="button"
              className="beru-icon-btn"
              onClick={() => setMenuOpen(false)}
              aria-label="Close menu"
            >
              ✕
            </button>
          </div>

          <div className="beru-menu-list">
            <button
              type="button"
              className="beru-menu-item"
              onClick={() => sendActionToTab("get_chat_file")}
            >
              <div className="beru-menu-item-content">
                <span>📄</span>
                <span>Get Chat File</span>
              </div>
              <span style={{ fontSize: "11px", color: "var(--text-tertiary)" }}>Raw JSON</span>
            </button>

            <button
              type="button"
              className="beru-menu-item"
              onClick={() => sendActionToTab("transfer_to_claude")}
            >
              <div className="beru-menu-item-content">
                <span>🚀</span>
                <span>Transfer to Claude</span>
              </div>
              <span style={{ fontSize: "11px", color: "var(--text-tertiary)" }}>Handoff</span>
            </button>

            <button
              type="button"
              className="beru-menu-item"
              onClick={() => {
                setMenuOpen(false);
                openPermissionPage();
              }}
            >
              <div className="beru-menu-item-content">
                <span>🎙️</span>
                <span>Microphone Settings</span>
              </div>
              <span style={{ fontSize: "11px", color: micAuthorized ? "var(--emerald)" : "var(--rose)" }}>
                {micAuthorized ? "Active ✓" : "Grant"}
              </span>
            </button>

            <div className="beru-menu-item" style={{ cursor: "default" }}>
              <div className="beru-menu-item-content">
                <span>⌨️</span>
                <span>Global Shortcut</span>
              </div>
              <span className="beru-kbd-badge">Alt+Shift+B</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
