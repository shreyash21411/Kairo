export const MESSAGE_SELECTOR = "[data-message-author-role]";

/**
 * Returns the number of currently rendered messages.
 */
export function getMessageCount(doc: Document = document): number {
    return doc.querySelectorAll(
        MESSAGE_SELECTOR
    ).length;
}

/**
 * Finds the scrollable ancestor of the first
 * rendered ChatGPT message.
 */
export function findScrollContainer(doc: Document = document): HTMLElement | null {
    const firstMessage = doc.querySelector(
        MESSAGE_SELECTOR
    );

    if (!firstMessage) {
        return null;
    }

    let current =
        firstMessage.parentElement;

    while (current) {
        const style =
            typeof window !== "undefined" && window.getComputedStyle
                ? window.getComputedStyle(current)
                : null;

        const scrollable =
            style &&
            (
                style.overflowY === "auto" ||
                style.overflowY === "scroll"
            ) &&
            current.scrollHeight >
            current.clientHeight;

        if (scrollable) {
            return current;
        }

        current = current.parentElement;
    }

    return null;
}

/**
 * Waits for the DOM message count to increase.
 */
export function waitForMoreMessages(
    previousCount: number,
    timeoutMs = 2500,
    doc: Document = document
): Promise<number> {
    return new Promise((resolve) => {
        let finished = false;

        const observer =
            new MutationObserver(() => {
                const currentCount =
                    getMessageCount(doc);

                if (
                    currentCount >
                    previousCount
                ) {
                    finish(currentCount);
                }
            });

        const timeout = setTimeout(() => {
            finish(getMessageCount(doc));
        }, timeoutMs);

        function finish(count: number) {
            if (finished) {
                return;
            }

            finished = true;

            observer.disconnect();
            clearTimeout(timeout);

            resolve(count);
        }

        const target = doc.body || (typeof document !== "undefined" ? document.body : null);
        if (target) {
            observer.observe(target, {
                childList: true,
                subtree: true,
            });
        } else {
            resolve(previousCount);
        }
    });
}

/**
 * Attempts to load older messages from ChatGPT.
 *
 * This function only makes older messages render.
 * It does NOT store or extract conversations.
 */
export async function loadChatGPTHistory(): Promise<void> {
    console.log(
        "AI Memory: Starting automatic ChatGPT history loading"
    );

    const scrollContainer =
        findScrollContainer();

    if (!scrollContainer) {
        console.log(
            "AI Memory: Could not find ChatGPT message scroll container"
        );

        return;
    }

    const initialCount =
        getMessageCount();

    console.log(
        "AI Memory: Initial rendered message count:",
        initialCount
    );

    /*
     * Remember the user's current position.
     */
    const originalScrollTop =
        scrollContainer.scrollTop;

    let previousCount =
        initialCount;

    let unchangedAttempts = 0;

    const MAX_UNCHANGED_ATTEMPTS = 5;

    while (
        unchangedAttempts <
        MAX_UNCHANGED_ATTEMPTS
    ) {
        /*
         * Move to the very top.
         */
        scrollContainer.scrollTop = 0;

        /*
         * Also trigger a scroll event.
         * Some virtualized UIs react to the event
         * rather than only to scrollTop.
         */
        scrollContainer.dispatchEvent(
            new Event("scroll", {
                bubbles: true,
            })
        );

        /*
         * Give ChatGPT time to render older messages.
         */
        await new Promise((resolve) =>
            setTimeout(resolve, 300)
        );

        const currentCount =
            await waitForMoreMessages(
                previousCount,
                2500
            );

        console.log(
            "AI Memory: History loading check:",
            {
                previousCount,
                currentCount,
            }
        );

        if (
            currentCount >
            previousCount
        ) {
            const loaded =
                currentCount -
                previousCount;

            console.log(
                "AI Memory: Older messages loaded:",
                loaded
            );

            previousCount =
                currentCount;

            unchangedAttempts = 0;

            /*
             * Continue because there may be
             * even more older messages.
             */
            continue;
        }

        unchangedAttempts++;

        console.log(
            "AI Memory: No older messages detected. Attempt:",
            unchangedAttempts
        );

        /*
         * Small delay before trying again.
         */
        await new Promise((resolve) =>
            setTimeout(resolve, 500)
        );
    }

    console.log(
        "AI Memory: Automatic history loading completed"
    );

    console.log(
        "AI Memory: Final rendered message count:",
        getMessageCount()
    );

    /*
     * Restore the user's position.
     */
    scrollContainer.scrollTop =
        originalScrollTop;

    scrollContainer.dispatchEvent(
        new Event("scroll", {
            bubbles: true,
        })
    );
}

export interface DomHistoryRecoveryOptions {
    maxAttempts?: number;
    maxConsecutiveUnchanged?: number;
    waitTimeoutMs?: number;
}

export interface DomHistoryRecoveryResult {
    recoveredCount: number;
    totalVisibleCount: number;
    limitReached: boolean;
    status: "partial" | "no_more_history" | "container_not_found";
}

/**
 * Recovers older historical messages incrementally by pulsing the conversation scroll container upward.
 * Honors configurable safety limits (default 10, capped at 20), requires consecutive unchanged attempts
 * before declaring the beginning of history, reports partial status conservatively, and restores user scroll position.
 */
export async function recoverOlderHistoryViaDomScroll(
    doc: Document = document,
    optionsOrMaxAttempts: number | DomHistoryRecoveryOptions = 10
): Promise<DomHistoryRecoveryResult> {
    const scrollContainer = findScrollContainer(doc);
    if (!scrollContainer) {
        return {
            recoveredCount: 0,
            totalVisibleCount: getMessageCount(doc),
            limitReached: false,
            status: "container_not_found",
        };
    }

    const options: DomHistoryRecoveryOptions =
        typeof optionsOrMaxAttempts === "number"
            ? { maxAttempts: optionsOrMaxAttempts }
            : optionsOrMaxAttempts;

    const rawMax = options.maxAttempts ?? 10;
    const maxAttempts = Math.min(Math.max(rawMax, 1), 20);
    const maxUnchanged = options.maxConsecutiveUnchanged ?? 2;
    const waitTimeoutMs = options.waitTimeoutMs ?? 1500;

    const initialCount = getMessageCount(doc);
    const originalScrollTop = scrollContainer.scrollTop;
    let previousCount = initialCount;
    let attempts = 0;
    let consecutiveUnchanged = 0;

    while (attempts < maxAttempts) {
        attempts++;
        // Pulse scroll to top to trigger virtual list loading
        scrollContainer.scrollTop = 0;
        scrollContainer.dispatchEvent(new Event("scroll", { bubbles: true }));

        await new Promise((resolve) => setTimeout(resolve, 300));
        const currentCount = await waitForMoreMessages(previousCount, waitTimeoutMs, doc);

        if (currentCount > previousCount) {
            previousCount = currentCount;
            consecutiveUnchanged = 0;
        } else {
            consecutiveUnchanged++;
            if (consecutiveUnchanged >= maxUnchanged) {
                // Reliable stopping condition reached
                break;
            }
        }
    }

    // Always restore the user's scroll position without interfering with interaction
    scrollContainer.scrollTop = originalScrollTop;
    scrollContainer.dispatchEvent(new Event("scroll", { bubbles: true }));

    const totalVisible = getMessageCount(doc);
    const recovered = totalVisible - initialCount;
    const limitReached = attempts >= maxAttempts;
    const beginningReached = consecutiveUnchanged >= maxUnchanged && !limitReached;

    return {
        recoveredCount: recovered,
        totalVisibleCount: totalVisible,
        limitReached,
        status: limitReached
            ? "partial"
            : (beginningReached || recovered === 0 ? "no_more_history" : "partial"),
    };
}
