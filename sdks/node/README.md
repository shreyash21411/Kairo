# @kairo/sdk

Official Node.js and TypeScript SDK for the [Kairo AI Memory Platform](https://kairo.ai).

Kairo gives AI applications, agents, and assistants persistent, searchable memory. Store facts, preferences, goals, context, and skills across sessions. Retrieve the most relevant memories for any query using semantic search backed by high-dimensional vector embeddings.

> **Version**: 0.1.0 (Developer Preview)
> **Requires**: Node.js 18.0.0 or later (uses native `fetch`)

---

## Table of Contents

- [Architecture & Mental Model](#architecture--mental-model)
- [Authentication](#authentication)
- [Actor-Based Memory Scoping](#actor-based-memory-scoping)
- [Installation](#installation)
- [Configuration](#configuration)
- [Quickstart](#quickstart)
- [Client Initialization](#client-initialization)
- [Memory Operations (CRUD & Search)](#memory-operations-crud--search)
- [Agent Integration V1](#agent-integration-v1)
- [Duplicate Detection & Conflicts](#duplicate-detection--conflicts)
- [Error Handling & Rate Limits](#error-handling--rate-limits)
- [Security Guidance](#security-guidance)
- [Local Development](#local-development)
- [Troubleshooting](#troubleshooting)
- [TypeScript Types Reference](#typescript-types-reference)
- [Limitations & V1 Scope](#limitations--v1-scope)

---

## Architecture & Mental Model

Kairo enforces strict tenant and actor memory isolation:

```
Developer Account
       ↓
    Project                  (Identified by Kairo API Key)
       ↓
  MemoryScope                (Resolved automatically: Project + Actor)
       ↓
    Memory                   (Individual stored memory items)
```

$$\text{MemoryScope} = \text{Project} + \text{Actor}$$

- **Project**: Determined by your API key. Every request sent with this API key operates within that project.
- **Actor**: Supplied by your application (e.g., `"user-123"`, `"agent-session-42"`). Identifies the end-user or agent session.
- **MemoryScope**: Resolved automatically by the Kairo backend from `(Project, Actor)`.
- **Memory**: The stored memory items within that scope. Memories in one scope are invisible to all other scopes.

### Multi-Tenant Example

```
Project A (API Key A)
 ├── Actor "alice"  →  Memory 1, Memory 2
 └── Actor "bob"    →  Memory 3

Project B (API Key B)
 └── Actor "alice"  →  Memory 4
```

- **Project A / alice** cannot access **Project A / bob**'s memories.
- **Project A / alice** cannot access **Project B / alice**'s memories.
- Neither `userId`, `projectId`, nor `scopeId` are caller-controlled SDK parameters.

---

## Authentication

Every request to the Kairo REST API is authenticated with your Project API key via HTTP Bearer authentication:

```http
Authorization: Bearer <Kairo API Key>
```

### Resolution Order

1. `apiKey` constructor option in `KairoConfig`.
2. `KAIRO_API_KEY` environment variable.
3. If neither is present, throws `KairoAuthenticationError` before making any network call.

```bash
export KAIRO_API_KEY="kairo_live_REPLACE_WITH_YOUR_KEY"
```

```typescript
import { Kairo } from "@kairo/sdk";

// Reads KAIRO_API_KEY from environment
const client = new Kairo();

// Or pass explicitly:
const client = new Kairo({
  apiKey: "kairo_live_REPLACE_WITH_YOUR_KEY",
});
```

---

## Actor-Based Memory Scoping

An **Actor ID** (`actorId`) is your application's unique identifier for the user or entity who owns the memory.

- **Required on Create**: `client.memories.create({ ..., actorId: "user-123" })`
- **Required on Search**: `client.memories.search({ ..., actorId: "user-123" })`
- **Not a Credential**: Actor IDs partition data; they do not authenticate the user.
- **Not a Kairo User ID**: The internal Kairo `userId` belongs to the project developer account.

---

## Installation

```bash
# From local repository:
cd path/to/sdks/node
npm install
npm run build
npm install /path/to/sdks/node

# Once published:
npm install @kairo/sdk
```

**Requirements:**
- Node.js 18.0.0 or later (native `fetch` supported out of the box)
- TypeScript 5.0+ (optional, for type checking)

---

## Configuration

| Environment Variable | Description | Default |
|---|---|---|
| `KAIRO_API_KEY` | Project API key | *(None — required)* |
| `KAIRO_BASE_URL` | API base URL | `http://localhost:5171` |

---

## Quickstart

```typescript
import { Kairo } from "@kairo/sdk";

// Initialize client (reads KAIRO_API_KEY from environment)
const client = new Kairo();

async function main() {
  // 1. Store a memory scoped to actor "user-123"
  const result = await client.memories.create({
    content: "User prefers concise TypeScript examples with strict typing",
    memoryType: "Preference",
    actorId: "user-123",
  });

  if (result.isDuplicate) {
    console.log("Duplicate detected:", result.duplicateReason);
  } else {
    console.log("Created memory ID:", result.memory!.memoryId);
  }

  // 2. Search memories semantically within the same actor scope
  const results = await client.memories.search({
    query: "What style of code examples does the user prefer?",
    actorId: "user-123",
    topK: 3,
  });

  console.log(`Found ${results.count} relevant memories:`);
  for (const m of results.memories) {
    console.log(`  [${m.similarity.toFixed(4)}] (ID: ${m.memoryId}) ${m.content}`);
  }
}

main().catch(console.error);
```

---

## Client Initialization

```typescript
import { Kairo, KairoClient } from "@kairo/sdk";

// Minimal: reads KAIRO_API_KEY from environment, connects to http://localhost:5171
const client = new Kairo();

// Compatibility alias: KairoClient is identical to Kairo
const aliasClient = new KairoClient();

// Explicit API key:
const client = new Kairo({
  apiKey: "kairo_live_REPLACE_WITH_YOUR_KEY",
});

// Custom base URL (staging, self-hosted, local dev):
const client = new Kairo({
  apiKey: "kairo_live_REPLACE_WITH_YOUR_KEY",
  baseUrl: "http://localhost:5171",
});

// Custom timeout (in milliseconds, default 30000):
const client = new Kairo({
  apiKey: "kairo_live_REPLACE_WITH_YOUR_KEY",
  timeout: 60_000,
});
```

---

## Memory Operations (CRUD & Search)

### Supported Memory Types

| Value | Description |
|---|---|
| `"Preference"` | User preferences and settings |
| `"Fact"` | Factual statements about the user or domain |
| `"Goal"` | User goals and objectives |
| `"Context"` | Session or project state |
| `"Skill"` | User capabilities and proficiencies |
| `"Relationship"` | Relationships and social connections |
| `"Other"` | Miscellaneous durable information |

### Create a Memory

```typescript
const result = await client.memories.create({
  content: "User works primarily in TypeScript and Node.js",
  memoryType: "Fact",
  actorId: "user-123",
});

if (result.isDuplicate) {
  console.log("Already stored:", result.duplicateReason);
} else {
  const memory = result.memory!;
  console.log(`Created memory ${memory.memoryId} at ${memory.createdAt}`);
}
```

### Get a Memory by ID

```typescript
const memory = await client.memories.get(16);
console.log(`[${memory.memoryId}] ${memory.content} (Type: ${memory.memoryType})`);
```

### List All Memories

```typescript
const memories = await client.memories.list();
console.log(`${memories.length} active memories`);
for (const m of memories) {
  console.log(`[${m.memoryId}] ${m.memoryType}: ${m.content}`);
}
```

### Update a Memory

```typescript
const updated = await client.memories.update(16, {
  content: "User works primarily in TypeScript 5 and Node.js 20",
  memoryType: "Fact",
});
console.log(`Updated at ${updated.updatedAt}`);
```

### Delete (Soft-Deactivate) a Memory

```typescript
const result = await client.memories.delete(16);
console.log(result.message); // "Memory deactivated successfully"
```

> **Note**: Kairo performs **soft deletion**. The memory record remains preserved in the database marked `isActive = false`, and will no longer appear in list or search results.

### Search Memories (Semantic Vector Search)

```typescript
const results = await client.memories.search({
  query: "What programming languages does the user work with?",
  actorId: "user-123",
  topK: 5,
});

console.log(`Found ${results.count} relevant memories:`);
for (const m of results.memories) {
  console.log(`  [${m.similarity.toFixed(4)}] ${m.content}`);
}
```

- `topK` must be an integer between 1 and 100 (defaults to 5).
- Search evaluates cosine similarity against memories within the specified `actorId` scope.

---

## Agent Integration V1

`KairoAgentMemory` is a thin adapter over the Kairo SDK tailored for AI agent loops. It introduces natural agent verbs (`remember`, `recall`, `update`, `forget`) and manages a default actor ID.

### Architecture

```
Agent Loop (LLM / Prompts)
        ↓
 KairoAgentMemory           (Thin adapter)
        ↓
  Kairo SDK (memories.*)
        ↓
 Kairo REST API             (http://localhost:5171)
        ↓
  Vector Embeddings / SQL Storage
```

- **Kairo owns**: Persistence, vector embeddings, deduplication, semantic search, and isolation.
- **Agent owns**: Deciding what to remember, when to recall, prompt synthesis, and LLM calls.

### Default Actor & Per-Call Override

```typescript
import { Kairo, KairoAgentMemory } from "@kairo/sdk";

const client = new Kairo();
const agent = new KairoAgentMemory(client, { actorId: "user-123" });

// 1. Store memory — automatically uses default actorId="user-123"
const result = await agent.remember({
  content: "User prefers PostgreSQL over MySQL",
  memoryType: "Preference",
});

// 2. Recall memories — uses default actorId="user-123"
const context = await agent.recall({
  query: "What database does the user prefer?",
  topK: 5,
});
for (const m of context.memories) {
  console.log(`[${m.similarity.toFixed(4)}] ${m.content}`);
}

// 3. Per-call actor override — uses "user-456" for this call only
await agent.remember({
  content: "User prefers MongoDB",
  memoryType: "Preference",
  actorId: "user-456",
});

// 4. Next call reverts to default "user-123"
const defaultContext = await agent.recall({ query: "database preference" });

// 5. Update and forget
await agent.update(result.memory!.memoryId, {
  content: "User prefers PostgreSQL 16",
  memoryType: "Preference",
});
await agent.forget(result.memory!.memoryId);
```

### Actor Resolution Rule

```
per-call actorId  >  constructor default actorId  >  KairoValidationError (HTTP 400)
```

If neither is provided, `KairoValidationError` is thrown locally before any network call.

---

## Duplicate Detection & Conflicts

### Duplicate Memory Creation (`isDuplicate`)

When you attempt to create a memory with content that is an exact or semantic duplicate of an existing memory in the same scope:

- The server returns HTTP 200 with `{ "isDuplicate": true, "reason": "..." }`.
- `result.isDuplicate` is set to `true`.
- `result.memory` is `null`.
- `result.duplicateReason` contains the server's explanation.
- **No exception is thrown.**

```typescript
const result = await client.memories.create({
  content: "User prefers dark mode",
  memoryType: "Preference",
  actorId: "user-123",
});
if (result.isDuplicate) {
  console.log("Skipped duplicate:", result.duplicateReason);
}
```

### HTTP 409 Conflict (`KairoConflictError`)

If a request produces an unresolvable resource conflict on the server, the SDK throws `KairoConflictError`.

---

## Error Handling & Rate Limits

All SDK errors inherit from `KairoError`.

```
KairoError
├── KairoValidationError        (HTTP 400)
├── KairoAuthenticationError    (HTTP 401)
├── KairoAuthorizationError     (HTTP 403)
├── KairoNotFoundError          (HTTP 404)
├── KairoConflictError          (HTTP 409)
├── KairoRateLimitError         (HTTP 429)
├── KairoServerError            (HTTP 5xx)
└── KairoConnectionError        (Network / timeout)
```

### Example

```typescript
import {
  Kairo,
  KairoError,
  KairoAuthenticationError,
  KairoNotFoundError,
  KairoValidationError,
  KairoConflictError,
  KairoRateLimitError,
  KairoConnectionError,
} from "@kairo/sdk";

const client = new Kairo();

try {
  const memory = await client.memories.get(999);
} catch (err) {
  if (err instanceof KairoNotFoundError) {
    console.log(`Memory not found (HTTP ${err.statusCode})`);
  } else if (err instanceof KairoAuthenticationError) {
    console.log(`Authentication failed: Check KAIRO_API_KEY (HTTP ${err.statusCode})`);
  } else if (err instanceof KairoRateLimitError) {
    console.log(`Rate limited (HTTP ${err.statusCode}). Retry after ${err.retryAfter}s`);
  } else if (err instanceof KairoConflictError) {
    console.log(`Conflict error (HTTP ${err.statusCode}): ${err.message}`);
  } else if (err instanceof KairoValidationError) {
    console.log(`Invalid input: ${err.message}`);
  } else if (err instanceof KairoConnectionError) {
    console.log(`Could not connect to Kairo: ${err.message}`);
  } else if (err instanceof KairoError) {
    console.log("Kairo error:", err.message);
  }
}
```

### Rate Limiting & Retry-After

When the API returns HTTP 429:
- Thrown as `KairoRateLimitError`.
- If the server sends a `Retry-After` header, it is exposed on `err.retryAfter` (in seconds).
- The SDK does **not** automatically retry requests; your application can decide when and how to back off.

---

## Security Guidance

1. **Keep API Keys Server-Side**: Never expose your Kairo API key to client-side browser code, mobile apps, or public source control.
2. **Use Environment Variables**: Configure `KAIRO_API_KEY` using secure environment variables or secret vaults.
3. **Actor IDs Are Scoping Keys**: Actor IDs partition data within your project. Always validate that the current user owns the actor ID before passing it to Kairo.
4. **Clean Logging**: The SDK strips API keys from `client.toString()` and error messages. Do not log raw HTTP request headers in your application logging.

---

## Local Development

During local development against a local Kairo instance:

```bash
# Set environment variables
export KAIRO_API_KEY="kairo_live_REPLACE_WITH_YOUR_KEY"
export KAIRO_BASE_URL="http://localhost:5171"
```

```typescript
import { Kairo } from "@kairo/sdk";

const client = new Kairo();
client.memories.list().then(memories => {
  console.log(`Connected! Active memories: ${memories.length}`);
});
```

---

## Troubleshooting

| Error / Issue | Common Cause | Resolution |
|---|---|---|
| **401 Unauthorized** (`KairoAuthenticationError`) | Invalid or revoked API key; missing `KAIRO_API_KEY`. | Verify the key against the Kairo dashboard and confirm `KAIRO_API_KEY` is set. |
| **403 Forbidden** (`KairoAuthorizationError`) | API key lacks permission for the resource. | Confirm the project and key roles. |
| **404 Not Found** (`KairoNotFoundError`) | Memory ID does not exist, was soft-deleted, or belongs to another project. | Verify the integer `memoryId` belongs to the authenticated project. |
| **409 Conflict** (`KairoConflictError`) | Conflicting concurrent state on the server. | Inspect error message and handle concurrency. |
| **429 Rate Limited** (`KairoRateLimitError`) | Request rate threshold exceeded. | Inspect `err.retryAfter` and apply exponential backoff. |
| **Missing Actor ID** (`KairoValidationError`) | `actorId` was omitted or empty in create/search. | Provide a valid `actorId` or configure a default actor on `KairoAgentMemory`. |
| **Connection Refused** (`KairoConnectionError`) | Kairo backend is not running or wrong port. | Verify Kairo API is running at `http://localhost:5171`. |
| **No API Key Provided** on init | Neither `apiKey` nor `KAIRO_API_KEY` was provided. | Set `KAIRO_API_KEY` environment variable. |
| **Build / Type Error** | Missing build artifacts in `dist/`. | Run `npm run build` in `sdks/node`. Ensure Node.js is version 18.0.0 or higher. |

---

## TypeScript Types Reference

You can import all types directly from `@kairo/sdk`:

```typescript
import type {
  Memory,
  MemoryType,
  RetrievedMemory,
  MemorySearchResponse,
  CreateMemoryRequest,
  UpdateMemoryRequest,
  MemorySearchRequest,
  CreateMemoryResult,
  DeleteMemoryResult,
  KairoConfig,
  KairoAgentMemoryOptions,
} from "@kairo/sdk";
```

---

## Limitations & V1 Scope

- **Soft Deletion**: Memories are deactivated, not physically deleted from the database.
- **Automated Scoping**: `MemoryScope` is managed internally from `(Project, Actor)`. Scope IDs are not exposed as user parameters.
- **Server-Side Embeddings**: Vector embeddings are generated server-side; raw vector floats are not returned.
- **Direct HTTP Round-Trips**: No local caching is performed; every call is an authoritative round-trip to the API.

---

## License

MIT
