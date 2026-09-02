import type {
    AIPlatformConnector,
    Platform,
} from "./types";

import {
    chatGPTConnector,
} from "./chatgpt";

const connectors = new Map<Platform, AIPlatformConnector>();

export function registerConnector(
    connector: AIPlatformConnector
): void {
    connectors.set(connector.platform, connector);
}

export function getConnector(
    platform: Platform
): AIPlatformConnector | undefined {
    return connectors.get(platform);
}

export function getRegisteredPlatforms(): Platform[] {
    return Array.from(connectors.keys());
}

registerConnector(chatGPTConnector);