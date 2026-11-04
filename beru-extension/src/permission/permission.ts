/**
 * permission.ts
 *
 * Handles 1-click microphone permission acquisition for the BERU extension.
 */

document.addEventListener("DOMContentLoaded", () => {
  const grantBtn = document.getElementById("grant-btn") as HTMLButtonElement | null;
  const statusMsg = document.getElementById("status-msg") as HTMLDivElement | null;

  if (!grantBtn || !statusMsg) return;

  // Check if previously authorized
  if (typeof chrome !== "undefined" && chrome.storage?.local) {
    chrome.storage.local.get(["beruMicAuthorized"], (res) => {
      if (res.beruMicAuthorized) {
        statusMsg.textContent = "Microphone is already authorized and ready!";
        statusMsg.className = "status success";
        grantBtn.textContent = "Re-test Microphone Access";
      }
    });
  }

  grantBtn.addEventListener("click", async () => {
    grantBtn.disabled = true;
    statusMsg.textContent = "Requesting permission… Please click 'Allow' in the browser prompt.";
    statusMsg.className = "status";

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // Stop tracks immediately after granting
      stream.getTracks().forEach((track) => track.stop());

      if (typeof chrome !== "undefined" && chrome.storage?.local) {
        await chrome.storage.local.set({
          beruMicAuthorized: true,
          beruAssistantState: "idle",
          beruLastError: null,
        });

        // Trigger background listening activation
        chrome.runtime.sendMessage({ action: "SET_LISTENING", enabled: true }).catch(() => {});
      }

      statusMsg.textContent = "Microphone access granted successfully! BERU is ready.";
      statusMsg.className = "status success";
      grantBtn.textContent = "Microphone Enabled ✓";

      setTimeout(() => {
        statusMsg.textContent = "You may now close this tab and return to ChatGPT or Claude.";
      }, 2500);
    } catch (err) {
      console.error("[BERU Permission Error]", err);
      grantBtn.disabled = false;
      const isDenied = (err as Error).name === "NotAllowedError";
      statusMsg.textContent = isDenied
        ? "Microphone access was denied. Please click the camera/mic icon in Chrome's address bar to reset."
        : `Could not access microphone: ${(err as Error).message || "Unknown error"}`;
      statusMsg.className = "status error";
    }
  });
});
