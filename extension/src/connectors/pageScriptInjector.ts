/**
 * pageScriptInjector.ts
 *
 * Content-script utility that injects the page-context fetch
 * interceptor into the ChatGPT page's JavaScript world.
 *
 * WHY A SEPARATE <script> TAG?
 *   Chrome content scripts run in an "isolated world" — they share
 *   the DOM but NOT the JavaScript heap with the page. Wrapping
 *   window.fetch inside a content script only wraps the content
 *   script's own fetch, not the page's window.fetch. ChatGPT's API
 *   calls are therefore completely invisible to a content-script-level
 *   fetch wrapper.
 *
 *   The only way to intercept the PAGE's window.fetch is to run code
 *   in the page's JavaScript context. We achieve this by injecting a
 *   <script src="..."> element into the DOM — the browser loads and
 *   executes that resource in the page context.
 *
 * TIMING:
 *   This injector must be called as early as possible — ideally at
 *   document_start — so the interceptor is installed BEFORE ChatGPT's
 *   own JavaScript fires its first API request. We inject synchronously
 *   into document.documentElement when document.head is not yet ready.
 */

const INJECTOR_GUARD_ATTR =
    "data-ai-memory-injected";

/**
 * Injects `chatgptFetchInterceptor.ts` (compiled by CRXJS/Vite as an
 * IIFE) into the ChatGPT page context as a classic <script> element.
 *
 * Safe to call multiple times — the guard attribute prevents duplicate
 * injection.
 */
export function injectPageScript(): void {

    /*
     * ----------------------------------------------------------------
     * Guard: inject only once.
     * ----------------------------------------------------------------
     */
    if (
        document.querySelector(
            `script[${INJECTOR_GUARD_ATTR}]`
        )
    ) {
        console.log(
            "AI Memory: Page-context interceptor already injected — skipping"
        );

        return;
    }

    /*
     * ----------------------------------------------------------------
     * Resolve the extension-relative URL of the compiled interceptor.
     *
     * CRXJS rewrites chrome.runtime.getURL() calls at build time to
     * use the actual hashed output filename. The argument must match
     * exactly the path declared in manifest.json's
     * web_accessible_resources[].resources[].
     * ----------------------------------------------------------------
     */
    const scriptUrl = chrome.runtime.getURL(
        "assets/chatgptFetchInterceptor.js"
    );

    const script = document.createElement("script");

    script.setAttribute(INJECTOR_GUARD_ATTR, "true");
    script.src = scriptUrl;

    /*
     * Use "classic" (non-module) script so the IIFE executes
     * immediately without requiring ES module infrastructure
     * in the page.
     */
    script.type = "text/javascript";

    /*
     * ----------------------------------------------------------------
     * Inject into the earliest available parent element.
     *
     * At document_start:
     *   - document.head is null
     *   - document.body is null
     *   - document.documentElement is available
     *
     * Appending to documentElement is safe and fires the script
     * synchronously in browsers.
     * ----------------------------------------------------------------
     */
    const parent =
        document.head ??
        document.documentElement;

    parent.appendChild(script);

    console.log(
        "AI Memory: Page-context interceptor injected",
        scriptUrl
    );
}
