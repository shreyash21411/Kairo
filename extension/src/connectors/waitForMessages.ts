export function waitForChatGPTMessages(
    timeoutMs = 30000
): Promise<void> {
    return new Promise((resolve, reject) => {
        const selector = "[data-message-author-role]";

        if (document.querySelector(selector)) {
            resolve();
            return;
        }

        const observer = new MutationObserver(() => {
            if (document.querySelector(selector)) {
                observer.disconnect();
                resolve();
            }
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true,
        });

        window.setTimeout(() => {
            observer.disconnect();
            reject(
                new Error(
                    "Timed out waiting for ChatGPT messages"
                )
            );
        }, timeoutMs);
    });
}