export function detectConversationPage(): boolean {
    const path = window.location.pathname;

    return path.startsWith("/c/");
}