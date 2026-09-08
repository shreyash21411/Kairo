# @kairo/sdk

Official Node.js/TypeScript SDK for the [Kairo AI Memory Platform](https://kairo.ai).

Kairo gives AI applications, agents, and assistants persistent, searchable memory. Store facts, preferences, goals, and context — and retrieve the most relevant memories for any query using semantic search backed by real AI embeddings.

> **Version**: 0.1.0 (Developer Preview)

---

## Installation

> The SDK is not yet published to npm. Install from the repository for local development:

```bash
cd path/to/sdks/node
npm install
npm run build
npm install /path/to/sdks/node
```

Once published to npm:

```bash
npm install @kairo/sdk
```

**Requires Node.js 18 or later** (uses native `fetch`).

---

## Authentication

Every Kairo API call is authenticated with your API key.

**Recommended — environment variable:**

```bash
export KAIRO_API_KEY="kairo_live_xxx"
```

```typescript
import { Kairo } from "@kairo/sdk";

const kairo = new Kairo({
    apiKey: process.env.KAIRO_API_KEY!,
});
```

**Explicit value:**

```typescript
const kairo = new Kairo({
    apiKey: "kairo_live_xxx",
});
```

> ⚠️ Never hard-code API keys in source files or commit them to version control.

---

## Client Initialization

```typescript
import { Kairo } from "@kairo/sdk";

// Minimal — reads key from environment
const kairo = new Kairo({
    apiKey: process.env.KAIRO_API_KEY!,
});

// With custom base URL (staging, self-hosted, local dev)
const kairo = new Kairo({
    apiKey: process.env.KAIRO_API_KEY!,
    baseUrl: "http://localhost:5171",
});

// With custom timeout (milliseconds, default 30000)
const kairo = new Kairo({
    apiKey: process.env.KAIRO_API_KEY!,
    timeout: 60_000,
});
```

---

## Memory Operations

### Create a memory

```typescript
const result = await kairo.memories.create({
    content: "User works primarily in TypeScript and prefers strict mode",
    memoryType: "Fact",
});

if (result.isDuplicate) {
    console.log("Duplicate detected:", result.duplicateReason);
} else {
    const memory = result.memory!;
    console.log("Created memory:", memory.memoryId);
}
```

**Supported memory types:**

| Value | Description |
|---|---|
| `"Preference"` | User preferences and settings |
| `"Fact"` | Factual information about the user |
| `"Goal"` | User goals and objectives |
| `"Context"` | Session or project context |
| `"Skill"` | User skills and expertise |
| `"Relationship"` | Relationship and social context |
| `"Other"` | Miscellaneous |

### Duplicate detection

When you submit content that is an exact or semantic duplicate of an existing memory, the backend does not create a new record:

```typescript
const result = await kairo.memories.create({
    content: "User prefers dark mode",
    memoryType: "Preference",
});

if (result.isDuplicate) {
    console.log("Already stored:", result.duplicateReason);
} else {
    console.log("New memory:", result.memory!.memoryId);
}
```

### Get a memory

```typescript
const memory = await kairo.memories.get(17);

console.log(memory.memoryId);   // 17
console.log(memory.content);
console.log(memory.memoryType);
console.log(memory.isActive);
console.log(memory.createdAt);
```

### List memories

```typescript
const memories = await kairo.memories.list();

console.log(`${memories.length} active memories`);
for (const memory of memories) {
    console.log(`[${memory.memoryId}] ${memory.memoryType}: ${memory.content}`);
}
```

### Update a memory

```typescript
const updated = await kairo.memories.update(17, {
    content: "User strongly prefers dark mode across all applications",
    memoryType: "Preference",
});

console.log("Updated at:", updated.updatedAt);
```

### Delete (deactivate) a memory

```typescript
const result = await kairo.memories.delete(17);
console.log(result.message);
```

> Kairo performs **soft deletion**. The memory record is preserved in the database
> and marked inactive. It will no longer appear in list or search results.

### Search memories (semantic)

```typescript
const results = await kairo.memories.search({
    query: "What programming languages does the user know?",
    topK: 5,
});

console.log(`Found ${results.count} relevant memories`);
for (const m of results.memories) {
    console.log(`  [${m.similarity.toFixed(4)}] ${m.content}`);
}
```

`topK` must be between 1 and 100. Defaults to 5.

---

## Error Handling

```typescript
import {
    Kairo,
    KairoError,
    KairoAuthenticationError,
    KairoNotFoundError,
    KairoValidationError,
    KairoServerError,
    KairoConnectionError,
} from "@kairo/sdk";

const kairo = new Kairo({ apiKey: process.env.KAIRO_API_KEY! });

try {
    const memory = await kairo.memories.get(999999);
} catch (err) {
    if (err instanceof KairoNotFoundError) {
        console.log("Memory not found.");
    } else if (err instanceof KairoAuthenticationError) {
        console.log("Invalid or expired API key.");
    } else if (err instanceof KairoValidationError) {
        console.log("Bad request:", err.message);
    } else if (err instanceof KairoConnectionError) {
        console.log("Could not reach Kairo API:", err.message);
    } else if (err instanceof KairoError) {
        console.log("Kairo error:", err.message);
    }
}
```

**Exception hierarchy:**

```
KairoError
├── KairoAuthenticationError    (HTTP 401)
├── KairoAuthorizationError     (HTTP 403)
├── KairoNotFoundError          (HTTP 404)
├── KairoValidationError        (HTTP 400)
├── KairoRateLimitError         (HTTP 429)
├── KairoServerError            (HTTP 5xx)
└── KairoConnectionError        (network / timeout)
```

---

## TypeScript Types

All SDK methods are fully typed. You can import types for use in your own code:

```typescript
import type {
    Memory,
    MemoryType,
    RetrievedMemory,
    MemorySearchResponse,
    CreateMemoryResult,
    DeleteMemoryResult,
} from "@kairo/sdk";
```

---

## Requirements

- Node.js 18 or later (native `fetch` required)
- TypeScript 5.x (for development / type checking)

---

## License

MIT
