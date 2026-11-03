/**
 * detectConversationPage
 *
 * Returns true when the current page is a ChatGPT conversation page
 * that should be observed for capture.
 *
 * Matched routes:
 *   /c/<id>  — authoritative conversation with a known UUID
 *   /        — root route where a new conversation may be started
 *              (provisional-session behavior applies)
 *
 * The root route is included so that messages typed on `/` are captured
 * as a provisional session before ChatGPT assigns a real conversation ID.
 */
export function detectConversationPage(): boolean {
  const path = window.location.pathname;

  // Authoritative conversation route
  if (path.startsWith("/c/")) {
    return true;
  }

  // Root route — new conversation started from home
  if (path === "/" || path === "") {
    return true;
  }

  return false;
}
