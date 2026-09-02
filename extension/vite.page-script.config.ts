/**
 * vite.page-script.config.ts
 *
 * Separate Vite build configuration for the page-context fetch
 * interceptor only.
 *
 * WHY SEPARATE?
 *   Rolldown (Vite 8's bundler) does not support IIFE format in
 *   multi-input builds. The main vite.config.ts uses @crxjs/vite-plugin
 *   which adds multiple entry points. Running the interceptor in its
 *   own isolated build gives Rolldown a single-entry context where
 *   IIFE output is fully supported.
 *
 * OUTPUT:
 *   dist/assets/chatgptFetchInterceptor.js  (IIFE, fixed filename)
 *
 * This output path is referenced by:
 *   - manifest.json   web_accessible_resources[].resources[]
 *   - pageScriptInjector.ts  chrome.runtime.getURL(...)
 */

import { defineConfig } from "vite";

export default defineConfig({
    build: {
        /*
         * Write into the public/ directory so Vite's static asset
         * copying places it at dist/assets/chatgptFetchInterceptor.js.
         *
         * This also satisfies CRXJS's web_accessible_resources
         * resolution — it checks both the project root AND the public
         * directory for listed assets.
         */
        outDir: "public/assets",

        /*
         * public/assets/ should be cleaned on each page-script build
         * to avoid stale IIFE versions.
         */
        emptyOutDir: false,

        lib: {
            /*
             * Single entry point: Rolldown is happy with IIFE here
             * because there is nothing else to code-split.
             */
            entry:
                "src/page-scripts/chatgptFetchInterceptor.ts",

            /*
             * IIFE = Immediately Invoked Function Expression.
             * The entire module is wrapped in a self-calling function.
             * The browser executes it as soon as the <script> loads,
             * without needing ES module infrastructure on the page.
             */
            formats: ["iife"],

            /*
             * A global name is required by Rolldown for IIFE bundles
             * even when the script exports nothing.
             */
            name: "AIMemoryFetchInterceptor",

            /*
             * Fixed, non-hashed output filename.
             * outDir is already public/assets/, so the final path
             * relative to the project is:
             *   public/assets/chatgptFetchInterceptor.js
             * which Vite copies to:
             *   dist/assets/chatgptFetchInterceptor.js
             */
            fileName: () =>
                "chatgptFetchInterceptor.js",
        },

        rollupOptions: {
            output: {
                /*
                 * Belt-and-suspenders: prevent dynamic imports from
                 * splitting the output across multiple files.
                 */
                inlineDynamicImports: true,
            },
        },
    },
});
