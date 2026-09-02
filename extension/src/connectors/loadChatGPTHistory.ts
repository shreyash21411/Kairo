const MESSAGE_SELECTOR = "[data-message-author-role]";

/**
 * Returns the number of currently rendered messages.
 */
function getMessageCount(): number {
    return document.querySelectorAll(
        MESSAGE_SELECTOR
    ).length;
}

/**
 * Finds the scrollable ancestor of the first
 * rendered ChatGPT message.
 */
function findScrollContainer(): HTMLElement | null {
    const firstMessage = document.querySelector(
        MESSAGE_SELECTOR
    );

    if (!firstMessage) {
        return null;
    }

    let current =
        firstMessage.parentElement;

    while (current) {
        const style =
            window.getComputedStyle(current);

        const scrollable =
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
function waitForMoreMessages(
    previousCount: number,
    timeoutMs = 2500
): Promise<number> {
    return new Promise((resolve) => {
        let finished = false;

        const observer =
            new MutationObserver(() => {
                const currentCount =
                    getMessageCount();

                if (
                    currentCount >
                    previousCount
                ) {
                    finish(currentCount);
                }
            });

        const timeout = setTimeout(() => {
            finish(getMessageCount());
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

        observer.observe(document.body, {
            childList: true,
            subtree: true,
        });
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