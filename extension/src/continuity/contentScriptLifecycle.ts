/**
 * contentScriptLifecycle.ts
 *
 * Robust lifecycle management, extension context validity detection,
 * teardown coordination, and unsaved message preservation across
 * extension reloads, service worker restarts, and context invalidations.
 */

import type { CapturedConversation } from "./captureTypes.ts";

/**
 * Prefix used for DOM sessionStorage preservation of unsaved capture sessions.
 * sessionStorage survives extension reload within the same tab, preventing data loss.
 */
export const PENDING_SESSION_STORAGE_PREFIX = "vz_pending_session_";

/**
 * Custom event name dispatched across content script generations
 * to cleanly retire older orphaned instances.
 */
export const CONTENT_SCRIPT_REINIT_EVENT = "VOIDZONE_CONTENT_SCRIPT_REINIT";

/**
 * Safely checks if the current execution context has a valid extension runtime.
 * In Chrome MV3, once the extension reloads or updates, accessing chrome.runtime.id
 * will either throw an "Extension context invalidated" error or return undefined.
 */
export function isExtensionContextValid(): boolean {
  try {
    if (typeof chrome === "undefined" || !chrome) {
      return false;
    }
    if (chrome.runtime) {
      return typeof chrome.runtime.id === "string" && chrome.runtime.id.length > 0;
    }
    return Boolean(chrome.storage);
  } catch {
    return false;
  }
}

/**
 * Detects if an error is specifically an extension context invalidation.
 */
export function isExtensionContextInvalidatedError(error: unknown): boolean {
  if (!error) return false;
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "object" && error !== null && "message" in error
      ? String((error as { message: unknown }).message)
      : String(error);

  const lower = message.toLowerCase();
  return (
    lower.includes("extension context invalidated") ||
    lower.includes("context invalidated") ||
    lower.includes("context_invalidated")
  );
}

/**
 * Manages the content script instance lifecycle, state transitions,
 * and safe disposal of listeners and pending tasks upon context invalidation.
 */
export class ContentScriptLifecycle {
  public readonly lifecycleId: string;
  private disposed = false;
  private disposedReason: string | null = null;
  private disposedAt: number | null = null;
  private teardownCallbacks: (() => void)[] = [];

  constructor(idPrefix = "cs") {
    this.lifecycleId = `${idPrefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  }

  /**
   * Returns true if the lifecycle instance is active and extension runtime is valid.
   * If runtime invalidation is detected, automatically triggers disposal.
   */
  public isAlive(): boolean {
    if (this.disposed) {
      return false;
    }
    if (!isExtensionContextValid()) {
      this.dispose("Extension context invalidated during liveness check");
      return false;
    }
    return true;
  }

  public isDisposed(): boolean {
    return this.disposed;
  }

  public getDisposedReason(): string | null {
    return this.disposedReason;
  }

  public getDisposedAt(): number | null {
    return this.disposedAt;
  }

  /**
   * Registers a teardown hook (e.g. event listener removal, timer clearing)
   * to be executed when the instance is disposed.
   */
  public onTeardown(callback: () => void): void {
    if (this.disposed) {
      try {
        callback();
      } catch {
        // Ignored
      }
      return;
    }
    this.teardownCallbacks.push(callback);
  }

  /**
   * Disposes the content script instance, detaches listeners,
   * and prevents any further interaction with extension APIs.
   */
  public dispose(reason: string): void {
    if (this.disposed) return;
    this.disposed = true;
    this.disposedReason = reason;
    this.disposedAt = Date.now();

    console.warn(`[VZ-CAPTURE-DEBUG] Extension context invalidated (${reason}). Disposing content script. Please refresh the ChatGPT tab to initialize the new extension context.`, {
      lifecycleId: this.lifecycleId,
    });

    for (const callback of this.teardownCallbacks) {
      try {
        callback();
      } catch {
        // Ignored during teardown
      }
    }
    this.teardownCallbacks = [];
  }
}

/**
 * Safely preserves an in-memory capture session into DOM sessionStorage
 * so that messages captured right before context invalidation are not lost.
 */
export function preservePendingSessionInDOM(session: CapturedConversation): boolean {
  try {
    if (typeof window !== "undefined" && window.sessionStorage) {
      const key = `${PENDING_SESSION_STORAGE_PREFIX}${session.id}`;
      window.sessionStorage.setItem(key, JSON.stringify(session));
      console.log("[VZ-CAPTURE-DEBUG] Preserved pending session in DOM sessionStorage", {
        conversationId: session.id,
        messageCount: session.messages.length,
      });
      return true;
    }
  } catch (err) {
    console.warn("[VZ-CAPTURE-DEBUG] Failed to preserve session in DOM sessionStorage", {
      conversationId: session.id,
      error: err instanceof Error ? err.message : String(err),
    });
  }
  return false;
}

/**
 * Recovers any pending sessions preserved in DOM sessionStorage.
 * Removes them from sessionStorage once recovered to prevent repeated ingestion.
 */
export function recoverPendingSessionsFromDOM(): CapturedConversation[] {
  const recovered: CapturedConversation[] = [];
  try {
    if (typeof window !== "undefined" && window.sessionStorage) {
      const keysToRemove: string[] = [];
      for (let i = 0; i < window.sessionStorage.length; i++) {
        const key = window.sessionStorage.key(i);
        if (key && key.startsWith(PENDING_SESSION_STORAGE_PREFIX)) {
          const raw = window.sessionStorage.getItem(key);
          if (raw) {
            try {
              const parsed = JSON.parse(raw) as CapturedConversation;
              if (parsed && typeof parsed.id === "string" && Array.isArray(parsed.messages)) {
                recovered.push(parsed);
                keysToRemove.push(key);
              }
            } catch {
              keysToRemove.push(key);
            }
          }
        }
      }
      for (const key of keysToRemove) {
        window.sessionStorage.removeItem(key);
      }
    }
  } catch {
    // sessionStorage access may be restricted
  }
  return recovered;
}
