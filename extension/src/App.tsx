import { useEffect, useState, useCallback, useRef } from "react";
import MemoryToggle from "./components/MemoryToggle";
import ThemeToggle from "./components/ThemeToggle";
import Continuity from "./continuity/Continuity";
import Beru from "./continuity/Beru";
import BackendSettingsModal from "./components/BackendSettingsModal";
import "./App.css";
import {
  EPOCH_REGISTRY_KEY,
  PENDING_LIFECYCLE_TRANSITION_KEY,
  ACTIVE_EPOCH_KEY,
  getEpochRegistry,
  setEpochStatus,
  createEpochRecord,
} from "./storage/conversationStorage";
import {
  evaluateStartRecoveryPredicate,
  evaluateStopRecoveryPredicate,
  isValidEpochRecord,
} from "./continuity/captureLifecycle";
import type {
  PendingLifecycleTransition,
  LifecyclePingResponse,
} from "./continuity/captureTypes";

type ThemeMode = "dark" | "light";

/**
 * Popup-level lifecycle state. Distinct from the content-script state.
 * OFF:               Observer disconnection confirmed (or never started).
 * ON:                Observer attached; epoch active in registry.
 * TRANSITION_TO_ON:  Epoch written, pending CS acknowledgement.
 * TRANSITION_TO_OFF: Cutoff request dispatched, pending CS acknowledgement.
 * UNAVAILABLE:       Failed/timed-out/invalidated; observer state unknown.
 */
type LifecycleState =
  | "OFF"
  | "ON"
  | "TRANSITION_TO_ON"
  | "TRANSITION_TO_OFF"
  | "UNAVAILABLE";

const IPC_TIMEOUT_MS = 500;
const TRANSITION_EXPIRY_MS = 30_000;

function generateEpochId(): string {
  return crypto.randomUUID();
}

function generateTransitionId(): string {
  return crypto.randomUUID();
}

/** Dispatch a typed message to a tab and await response with timeout. */
async function sendToActiveTab<T>(
  tabId: number,
  message: object
): Promise<T | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), IPC_TIMEOUT_MS);
    try {
      chrome.tabs.sendMessage(tabId, message, (response: T) => {
        clearTimeout(timer);
        if (chrome.runtime.lastError) {
          resolve(null);
        } else {
          resolve(response ?? null);
        }
      });
    } catch {
      clearTimeout(timer);
      resolve(null);
    }
  });
}

/** Get the ID of the currently active ChatGPT tab, if any. */
async function getActiveChatGPTTabId(): Promise<number | null> {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs?.[0];
      if (tab?.id && tab.url?.includes("chatgpt.com")) {
        resolve(tab.id);
      } else {
        resolve(null);
      }
    });
  });
}


/** Remove the PendingLifecycleTransition from storage. */

async function clearPendingTransition(): Promise<void> {
  try {
    await chrome.storage.local.remove(PENDING_LIFECYCLE_TRANSITION_KEY);
  } catch {
    // Tolerate — epoch is already invalidated; next open re-executes idempotently.
  }
}

/**
 * Execute emergency epoch invalidation with verification.
 * Returns true only if invalidation was written AND verified in registry.
 */
async function executeEmergencyInvalidation(epochId: string): Promise<boolean> {
  const verified = await setEpochStatus(epochId, "invalidated", {
    invalidatedAt: Date.now(),
    reason: "emergency_invalidation",
  });
  if (!verified) {
    console.warn("[VZ-LIFECYCLE] Emergency invalidation could not be verified", { epochId });
  }
  return verified;
}

/**
 * Handle startup recovery from a persisted pendingLifecycleTransition.
 * Returns the resolved LifecycleState after recovery.
 */
async function recoverPendingTransition(
  pending: PendingLifecycleTransition
): Promise<LifecycleState> {
  const now = Date.now();

  const storageSnapshot = await chrome.storage.local.get([
    EPOCH_REGISTRY_KEY,
    ACTIVE_EPOCH_KEY,
    "activeCaptureSession",
    "memoryEnabled",
  ]);

  const storage = {
    activeCaptureSession: storageSnapshot.activeCaptureSession,
    activeEpoch: storageSnapshot[ACTIVE_EPOCH_KEY],
    epochRegistry: storageSnapshot[EPOCH_REGISTRY_KEY],
  };

  if (pending.type === "start_capture") {
    const outcome = evaluateStartRecoveryPredicate(storage, pending, now);
    switch (outcome.status) {
      case "complete":
        await clearPendingTransition();
        return "ON";

      case "expired":
      case "invalid_epoch":
      case "corrupted_session": {
        // Attempt invalidation; retain pending record if not verified; advance to UNAVAILABLE
        const verified = await executeEmergencyInvalidation(pending.targetEpochId);
        if (verified) {
          await clearPendingTransition();
        }
        // Always UNAVAILABLE — observer state unconfirmed
        await chrome.storage.local.set({ memoryEnabled: false, [ACTIVE_EPOCH_KEY]: null });
        return "UNAVAILABLE";
      }

      case "pending_resumable":
        // Genuine still-pending — keep state as TRANSITION_TO_ON for next user action
        return "TRANSITION_TO_ON";
    }
  }

  if (pending.type === "stop_capture") {
    const outcome = evaluateStopRecoveryPredicate(storage, pending, now);
    switch (outcome.status) {
      case "complete":
        await clearPendingTransition();
        return "OFF";

      case "session_cutoff_registry_pending": {
        // CS confirmed cutoff but registry wasn't updated before popup closed
        const epochId = pending.targetEpochId;
        const registry = await getEpochRegistry();
        const rec = registry[epochId];
        if (isValidEpochRecord(rec)) {
          const closedOk = await setEpochStatus(epochId, "closed", {
            closedAt: Date.now(),
          });
          if (closedOk) {
            await clearPendingTransition();
            await chrome.storage.local.set({ memoryEnabled: false, [ACTIVE_EPOCH_KEY]: null });
            return "OFF";
          }
        }
        // Fall through to UNAVAILABLE if verification failed
        return "UNAVAILABLE";
      }

      case "expired":
      case "cutoff_failed": {
        const verified = await executeEmergencyInvalidation(pending.targetEpochId);
        if (verified) {
          // Preserve recovery information — do not clear active capture session
          await clearPendingTransition();
        }
        await chrome.storage.local.set({ memoryEnabled: false, [ACTIVE_EPOCH_KEY]: null });
        return "UNAVAILABLE";
      }
    }
  }

  // emergency_seal or unknown type → UNAVAILABLE
  const verified = await executeEmergencyInvalidation(pending.targetEpochId);
  if (verified) {
    await clearPendingTransition();
  }
  await chrome.storage.local.set({ memoryEnabled: false, [ACTIVE_EPOCH_KEY]: null });
  return "UNAVAILABLE";
}

function App() {
  const [lifecycleState, setLifecycleState] = useState<LifecycleState>("OFF");
  const [selectedProject, setSelectedProject] = useState("");
  // Feature-flag: enabled via backend Beru:Enabled config (defaults false)
  const [beruEnabled] = useState(false);
  const [theme, setTheme] = useState<ThemeMode>("dark");
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  // Prevent concurrent lifecycle operations
  const lifecycleBusyRef = useRef(false);

  // Derive memoryEnabled for child components
  const memoryEnabled = lifecycleState === "ON";

  /** Startup: load initial state and recover any pending transition. */
  useEffect(() => {
    if (typeof chrome === "undefined" || !chrome.storage?.local) return;

    chrome.storage.local.get(
      [
        "memoryEnabled",
        "selectedProject",
        "vzTheme",
        PENDING_LIFECYCLE_TRANSITION_KEY,
        ACTIVE_EPOCH_KEY,
      ],
      async (result) => {
        if (typeof result.selectedProject === "string") {
          setSelectedProject(result.selectedProject);
        }
        if (result.vzTheme === "light" || result.vzTheme === "dark") {
          setTheme(result.vzTheme);
        } else {
          setTheme("dark");
        }

        const pending = result[PENDING_LIFECYCLE_TRANSITION_KEY] as
          | PendingLifecycleTransition
          | undefined;

        if (pending && typeof pending === "object" && pending.targetEpochId) {
          // There was an incomplete transition — run recovery
          const recovered = await recoverPendingTransition(pending);
          setLifecycleState(recovered);
        } else if (result.memoryEnabled === true) {
          setLifecycleState("ON");
        } else if (result.memoryEnabled === false) {
          setLifecycleState("OFF");
        } else {
          // undefined / first install — fail closed
          setLifecycleState("OFF");
        }
      }
    );
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  /**
   * Initiate ON transition:
   * 1. Write epoch + pendingLifecycleTransition + memoryEnabled:true atomically.
   * 2. Dispatch START_CAPTURE_SESSION to CS with 500ms timeout.
   * 3. On ack: advance to ON, clear pending.
   * 4. On timeout/failure: emergency invalidation → UNAVAILABLE (never OFF).
   */
  const initiateOnTransition = useCallback(async () => {
    if (lifecycleBusyRef.current) return;
    lifecycleBusyRef.current = true;

    const epochId = generateEpochId();
    const transitionId = generateTransitionId();
    const now = Date.now();

    const pending: PendingLifecycleTransition = {
      transitionId,
      type: "start_capture",
      targetEpochId: epochId,
      initiatedAt: now,
      expiresAt: now + TRANSITION_EXPIRY_MS,
    };

    setLifecycleState("TRANSITION_TO_ON");

    try {
      // Write atomically: epoch registry, pending transition, memoryEnabled, activeEpoch
      await chrome.storage.local.set({
        memoryEnabled: true,
        [ACTIVE_EPOCH_KEY]: epochId,
        [PENDING_LIFECYCLE_TRANSITION_KEY]: pending,
      });
      const epochCreated = await createEpochRecord(epochId);
      if (!epochCreated) {
        // Storage write failure → fail closed to UNAVAILABLE (never OFF)
        console.warn("[VZ-LIFECYCLE] Failed to create epoch record — aborting ON transition");
        await chrome.storage.local.set({ memoryEnabled: false, [ACTIVE_EPOCH_KEY]: null });
        await clearPendingTransition();
        setLifecycleState("UNAVAILABLE");
        lifecycleBusyRef.current = false;
        return;
      }

      // Dispatch START_CAPTURE_SESSION
      const tabId = await getActiveChatGPTTabId();
      if (tabId === null) {
        console.warn("[VZ-LIFECYCLE] No active ChatGPT tab for START_CAPTURE_SESSION");
        const verified = await executeEmergencyInvalidation(epochId);
        if (verified) await clearPendingTransition();
        await chrome.storage.local.set({ memoryEnabled: false, [ACTIVE_EPOCH_KEY]: null });
        setLifecycleState("UNAVAILABLE");
        lifecycleBusyRef.current = false;
        return;
      }

      const ack = await sendToActiveTab<{ success: boolean; epochId?: string }>(tabId, {
        type: "START_CAPTURE_SESSION",
        epochId,
      });

      if (ack?.success === true && ack.epochId === epochId) {
        await clearPendingTransition();
        setLifecycleState("ON");
      } else {
        // Timeout or failure — observer state unconfirmed → UNAVAILABLE, never OFF
        console.warn("[VZ-LIFECYCLE] START_CAPTURE_SESSION timeout or failure", { ack });
        const verified = await executeEmergencyInvalidation(epochId);
        if (verified) await clearPendingTransition();
        await chrome.storage.local.set({ memoryEnabled: false, [ACTIVE_EPOCH_KEY]: null });
        setLifecycleState("UNAVAILABLE");
      }
    } catch (err) {
      console.error("[VZ-LIFECYCLE] ON transition error", err);
      await executeEmergencyInvalidation(epochId).catch(() => {});
      await chrome.storage.local.set({ memoryEnabled: false, [ACTIVE_EPOCH_KEY]: null });
      setLifecycleState("UNAVAILABLE");
    } finally {
      lifecycleBusyRef.current = false;
    }
  }, []);

  /**
   * Initiate OFF transition:
   * 1. Write pendingLifecycleTransition(stop_capture) + memoryEnabled:false.
   * 2. Dispatch PRIVACY_CUTOFF_REQUEST to CS with 500ms timeout.
   * 3. On ack: close epoch, clear pending → OFF (confirmed observer disconnect).
   * 4. On timeout: emergency invalidation → UNAVAILABLE (observer disconnect unconfirmed).
   */
  const initiateOffTransition = useCallback(async () => {
    if (lifecycleBusyRef.current) return;
    lifecycleBusyRef.current = true;

    const storageSnapshot = await chrome.storage.local.get([ACTIVE_EPOCH_KEY]);
    const epochId = storageSnapshot[ACTIVE_EPOCH_KEY] as string | null;

    if (!epochId) {
      // Already off
      await chrome.storage.local.set({ memoryEnabled: false });
      setLifecycleState("OFF");
      lifecycleBusyRef.current = false;
      return;
    }

    const transitionId = generateTransitionId();
    const now = Date.now();
    const pending: PendingLifecycleTransition = {
      transitionId,
      type: "stop_capture",
      targetEpochId: epochId,
      initiatedAt: now,
      expiresAt: now + TRANSITION_EXPIRY_MS,
    };

    setLifecycleState("TRANSITION_TO_OFF");

    try {
      await chrome.storage.local.set({
        memoryEnabled: false,
        [ACTIVE_EPOCH_KEY]: null,
        [PENDING_LIFECYCLE_TRANSITION_KEY]: pending,
      });

      const tabId = await getActiveChatGPTTabId();
      if (tabId === null) {
        // CS unreachable — emergency invalidation; UNAVAILABLE (not OFF)
        const verified = await executeEmergencyInvalidation(epochId);
        if (verified) {
          // Preserve recovery information — do not clear active capture session
          await clearPendingTransition();
        }
        setLifecycleState("UNAVAILABLE");
        lifecycleBusyRef.current = false;
        return;
      }

      const ack = await sendToActiveTab<{ success: boolean; error?: string }>(tabId, {
        type: "PRIVACY_CUTOFF_REQUEST",
        epochId,
      });

      if (ack?.success === true) {
        // CS confirmed observer disconnect and verified cutoff snapshot persistence
        const closed = await setEpochStatus(epochId, "closed", { closedAt: Date.now() });
        if (!closed) {
          // Registry update failed — cannot claim confirmed OFF
          console.warn("[VZ-LIFECYCLE] Epoch registry close failed after cutoff ack");
          setLifecycleState("UNAVAILABLE");
        } else {
          // Read-back verify the closed status in registry
          const registry = await getEpochRegistry();
          if (registry[epochId]?.status === "closed") {
            await clearPendingTransition();
            setLifecycleState("OFF");
          } else {
            console.warn("[VZ-LIFECYCLE] Epoch registry verification failed after close");
            setLifecycleState("UNAVAILABLE");
          }
        }
      } else {
        // Timeout or failure — observer disconnection unconfirmed or cutoff unverified → UNAVAILABLE, never OFF
        console.warn("[VZ-LIFECYCLE] PRIVACY_CUTOFF_REQUEST failed or timed out — observer/cutoff unverified", { ack });
        const verified = await executeEmergencyInvalidation(epochId);
        if (verified) {
          // Preserve recovery information — do not clear active capture session
          await clearPendingTransition();
        }
        setLifecycleState("UNAVAILABLE");
      }
    } catch (err) {
      console.error("[VZ-LIFECYCLE] OFF transition error", err);
      await executeEmergencyInvalidation(epochId).catch(() => {});
      setLifecycleState("UNAVAILABLE");
    } finally {
      lifecycleBusyRef.current = false;
    }
  }, []);

  /**
   * From UNAVAILABLE: send LIFECYCLE_PING to confirm CS reachability and observer state
   * before attempting fresh ON transition.
   */
  const handleUnavailableRetry = useCallback(async () => {
    if (lifecycleBusyRef.current) return;
    lifecycleBusyRef.current = true;
    try {
      const tabId = await getActiveChatGPTTabId();
      if (tabId === null) {
        console.warn("[VZ-LIFECYCLE] LIFECYCLE_PING: no active ChatGPT tab");
        lifecycleBusyRef.current = false;
        return;
      }
      const ping = await sendToActiveTab<LifecyclePingResponse>(tabId, {
        type: "LIFECYCLE_PING",
      });
      if (
        ping &&
        ping.alive === true &&
        (ping.state === "idle" || ping.state === "quiescent") &&
        !ping.observerAttached
      ) {
        // CS is reachable and observer is definitely disconnected — safe to start
        lifecycleBusyRef.current = false;
        await initiateOnTransition();
      } else {
        console.warn("[VZ-LIFECYCLE] LIFECYCLE_PING failed or CS in non-recoverable state", { ping });
        lifecycleBusyRef.current = false;
      }
    } catch {
      lifecycleBusyRef.current = false;
    }
  }, [initiateOnTransition]);

  const handleMemoryChange = useCallback(
    async (enabled: boolean) => {
      if (enabled) {
        if (lifecycleState === "UNAVAILABLE") {
          await handleUnavailableRetry();
        } else if (lifecycleState === "OFF") {
          await initiateOnTransition();
        }
        // Idempotent: already ON or transitioning — ignore
      } else {
        if (lifecycleState === "ON") {
          await initiateOffTransition();
        } else if (lifecycleState === "UNAVAILABLE") {
          // Already off-equivalent; confirm state
          setLifecycleState("UNAVAILABLE");
        }
        // Idempotent: already OFF or transitioning — ignore
      }
    },
    [lifecycleState, initiateOnTransition, initiateOffTransition, handleUnavailableRetry]
  );

  const handleProjectChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const projectId = event.target.value;
    setSelectedProject(projectId);
    if (typeof chrome !== "undefined" && chrome.storage?.local) {
      chrome.storage.local.set({ selectedProject: projectId });
    }
  };

  const handleThemeChange = (newTheme: ThemeMode) => {
    setTheme(newTheme);
    if (typeof chrome !== "undefined" && chrome.storage?.local) {
      chrome.storage.local.set({ vzTheme: newTheme });
    }
  };

  const statusLabel =
    lifecycleState === "ON"
      ? "CAPTURE ACTIVE"
      : lifecycleState === "UNAVAILABLE"
      ? "CAPTURE UNAVAILABLE"
      : lifecycleState === "TRANSITION_TO_ON" || lifecycleState === "TRANSITION_TO_OFF"
      ? "UPDATING..."
      : "CAPTURE PAUSED";

  const statusClass =
    lifecycleState === "ON"
      ? "vz-status-live"
      : lifecycleState === "UNAVAILABLE"
      ? "vz-status-unavailable"
      : "vz-status-standby";

  const statusTitle =
    lifecycleState === "ON"
      ? "Background capture listener is active and monitoring AI conversations"
      : lifecycleState === "UNAVAILABLE"
      ? "Capture is in an uncertain state. The tab may be unreachable. Reload the ChatGPT tab or toggle Capture to retry."
      : "Background capture listener is paused";

  return (
    <div className="vz-app scrollbar-hidden">
      {/* 1. Top Header */}
      <header className="vz-header">
        <div className="vz-brand">
          <div className="vz-logo-mark">V</div>
          <div className="vz-brand-text">
            <span className="vz-wordmark">VOIDZONE</span>
            <span className="vz-tagline">CONTINUITY</span>
          </div>
        </div>

        <div className="vz-header-actions">
          <button
            type="button"
            className="vz-btn-icon-subtle"
            onClick={() => setIsSettingsOpen(true)}
            title="Backend Settings"
            aria-label="Open Backend Settings"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="3"/>
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
            </svg>          </button>
          <span
            className={`vz-status-pill ${statusClass}`}
            title={statusTitle}
          >
            <span className="vz-status-dot" />
            {statusLabel}
          </span>
        </div>
      </header>

      {/* 2. Control Strip (Project, Theme, Continuous Capture) */}
      <section className="vz-controls-bar" aria-label="Extension controls">
        <div className="vz-control-item vz-control-project">
          <label className="vz-control-label" htmlFor="vz-project-select">
            Project
          </label>
          <select
            id="vz-project-select"
            className="vz-select"
            value={selectedProject}
            onChange={handleProjectChange}
          >
            <option value="">Default Project</option>
            <option value="ai-job-agent">AI Job Agent</option>
            <option value="test-project">Test Project</option>
          </select>
        </div>

        <div className="vz-control-item vz-control-theme">
          <ThemeToggle theme={theme} onChange={handleThemeChange} />
        </div>

        <div className="vz-control-item vz-control-toggle">
          <span className="vz-control-label">Continuous</span>
          <MemoryToggle
            enabled={memoryEnabled}
            onChange={handleMemoryChange}
          />
        </div>
      </section>

      {/* UNAVAILABLE banner */}
      {lifecycleState === "UNAVAILABLE" && (
        <div
          className="vz-unavailable-banner"
          role="alert"
          aria-live="assertive"
        >
          ⚠ Capture is in an uncertain state. Reload the ChatGPT tab and
          toggle Capture to retry.
        </div>
      )}

      {/* 3–8. Main Continuity Interface */}
      <main className="vz-main">
        <Continuity
          memoryEnabled={memoryEnabled}
          selectedProject={selectedProject}
        />
      </main>

      {/* BERU Voice Agent Section */}
      <section className="vz-beru-section">
        <Beru
          beruEnabled={beruEnabled}
          selectedProject={selectedProject || undefined}
        />
      </section>

      {/* 9. Product Footer */}
      <footer className="vz-footer">
        <span>VOIDZONE · CONTINUITY</span>
      </footer>

      {/* Backend Settings Dialog */}
      <BackendSettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
      />
    </div>
  );
}

export default App;
