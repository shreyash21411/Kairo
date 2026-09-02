export function createMessageId(
    role: string,
    content: string
): string {
    const normalizedContent = content.trim();

    let hash = 0;

    const value = `${role}:${normalizedContent}`;

    for (let i = 0; i < value.length; i++) {
        hash =
            (hash << 5) -
            hash +
            value.charCodeAt(i);

        hash |= 0;
    }

    return `message-${Math.abs(hash)}`;
}