# Kairo SDK & Agent Integration Developer Guide

Complete developer guide for the official **Kairo Python SDK**, **Node.js/TypeScript SDK**, and **Agent Integration V1**.

---

## Table of Contents

1. [What is Kairo?](#1-what-is-kairo)
2. [Architecture & Mental Model](#2-architecture--mental-model)
3. [Authentication Model](#3-authentication-model)
4. [Actor-Based Memory Scoping](#4-actor-based-memory-scoping)
5. [Installation](#5-installation)
6. [Configuration & Environment](#6-configuration--environment)
7. [Python SDK Quickstart & Usage](#7-python-sdk-quickstart--usage)
8. [Node.js / TypeScript SDK Quickstart & Usage](#8-nodejs--typescript-sdk-quickstart--usage)
9. [Agent Integration V1](#9-agent-integration-v1)
10. [Memory Operations (CRUD & Semantic Search)](#10-memory-operations-crud--semantic-search)
11. [Duplicate Detection & Conflict Handling](#11-duplicate-detection--conflict-handling)
12. [Error Handling & Exception Hierarchy](#12-error-handling--exception-hierarchy)
13. [Rate Limiting & Retry-After](#13-rate-limiting--retry-after)
14. [Security Guidance & Best Practices](#14-security-guidance--best-practices)
15. [Local Development Guide](#15-local-development-guide)
16. [Troubleshooting Guide](#16-troubleshooting-guide)
17. [Current Limitations & V1 Scope Boundaries](#17-current-limitations--v1-scope-boundaries)

---

## 1. What is Kairo?

**Kairo** is a persistent memory platform built specifically for AI agents, assistants, and applications. 

Standard LLM interactions are stateless: every request starts with a blank slate unless context is manually injected into the prompt. Kairo solves this by providing:

- **Persistent Memory Storage**: Store facts, preferences, goals, context, and skills across sessions.
- **Semantic Vector Search**: Retrieve the most relevant memories for any query using high-dimensional cosine similarity embeddings.
- **Duplicate & Conflict Prevention**: Detect exact and semantic duplicates automatically so your memory store does not accumulate redundant entries.
- **Strict Tenant & Actor Isolation**: Partition memory scopes safely across projects and individual end-users.

Kairo acts as the **durable memory subsystem** for your application. Your application or agent decides *what* to remember and *when* to recall; Kairo handles persistence, indexing, similarity evaluation, and retrieval.

---

## 2. Architecture & Mental Model

Kairo enforces a strict hierarchical isolation model:

```
Developer Account
       ↓
    Project                  (Identified by Kairo API Key)
       ↓
  MemoryScope                (Resolved automatically: Project + Actor)
       ↓
    Memory                   (Individual stored memory items)
```

### The Scoping Formula

$$\text{MemoryScope} = \text{Project} + \text{Actor}$$

- **Project**: Determined by your Kairo API key. All operations executed with a project's API key belong to that project.
- **Actor**: Supplied by your application (e.g., `user-123`, `tenant-abc`, `agent-session-42`). It represents the identity of the end-user or entity whose memories are being managed.
- **MemoryScope**: Resolved internally by Kairo from the combination of Project and Actor.
- **Memory**: The individual memory entries. Memories stored under one scope are completely isolated from all other scopes.

### Scope Isolation Example

Consider two projects and two users:

```
Project A (API Key A)
 ├── Actor "alice"
 │    ├── Memory 1 ("Prefers dark mode")
 │    └── Memory 2 ("Primary language: Python")
 └── Actor "bob"
      └── Memory 3 ("Prefers light mode")

Project B (API Key B)
 └── Actor "alice"
      └── Memory 4 ("Uses vim keybindings")
```

- **Project A / alice** is strictly isolated from **Project A / bob**. Searches executed for Bob will never return Alice's memories.
- **Project A / alice** is strictly isolated from **Project B / alice**. Even if both projects use the same actor identifier string (`alice`), they map to different projects and distinct memory scopes.
- **Authority Boundaries**: Neither `UserId`, `ProjectId`, nor `ScopeId` are caller-controlled parameters in the SDK. The backend derives the project from the API key and resolves the scope from `(Project, Actor)`.

---

## 3. Authentication Model

Every request to the Kairo REST API is authenticated using standard HTTP Bearer authentication:

```http
Authorization: Bearer <Kairo API Key>
```

### API Key Resolution Order

Both SDKs resolve the API key in the following priority order:

1. **Explicit parameter** passed to the client constructor (`api_key` in Python, `apiKey` in Node).
2. **Environment variable** named `KAIRO_API_KEY`.
3. If neither is present, the SDK raises an immediate `KairoAuthenticationError` before making any network request.

### Example Configuration

#### Python
```python
import os
from kairo import Kairo

# Option 1: Reads KAIRO_API_KEY from environment
client = Kairo()

# Option 2: Explicit parameter
client = Kairo(api_key="kairo_live_REPLACE_WITH_YOUR_KEY")
```

#### Node / TypeScript
```typescript
import { Kairo } from "@kairo/sdk";

// Option 1: Reads KAIRO_API_KEY from environment
const client = new Kairo();

// Option 2: Explicit parameter
const client = new Kairo({
  apiKey: "kairo_live_REPLACE_WITH_YOUR_KEY"
});
```

> [!IMPORTANT]
> The API key authorizes the *application* and identifies the *project*. It is a secret credential and must never be exposed to end-users or client-side browser code.

---

## 4. Actor-Based Memory Scoping

### What is an Actor ID?

An **Actor ID** (`actor_id` in Python, `actorId` in Node) is your application's unique identifier for the entity owning the memory. Typical examples:

- An application user ID: `"user-48291"`
- An organization or tenant ID: `"org-alpha"`
- An autonomous agent session ID: `"session-agent-99"`

### What Actor ID is NOT

- **NOT an authentication credential**: Supplying an Actor ID does not authenticate a user.
- **NOT a Kairo User ID**: The Kairo `UserId` is an internal identifier belonging to the developer account owning the API key.
- **NOT a secret**: Actor IDs are partitioning keys, not passwords or tokens.

### Enforced Rules

1. When creating a memory (`memories.create`), `actor_id` / `actorId` is **required**.
2. When searching memories (`memories.search`), `actor_id` / `actorId` is **required**.
3. Passing an empty or whitespace-only actor identifier triggers a `KairoValidationError` before any HTTP call is made.

---

## 5. Installation

### Python SDK

**Prerequisites**: Python 3.10 or later.

Install from the repository:
```bash
pip install -e path/to/sdks/python
```

When published to PyPI:
```bash
pip install kairo
```

Dependencies: `httpx>=0.27.0`.

### Node / TypeScript SDK

**Prerequisites**: Node.js 18.0.0 or later (uses native `fetch`).

Install from the repository:
```bash
cd path/to/sdks/node
npm install
npm run build
npm install /path/to/sdks/node
```

When published to npm:
```bash
npm install @kairo/sdk
```

Dependencies: zero runtime dependencies (uses native `fetch` and standard web APIs).

---

## 6. Configuration & Environment

### Environment Variables

| Variable | Description | Default |
|---|---|---|
| `KAIRO_API_KEY` | Kairo Project API key | *(None — required)* |
| `KAIRO_BASE_URL` | Base URL of the Kairo REST API | `http://localhost:5171` |

### Client Constructor Options

#### Python (`Kairo`)
| Parameter | Type | Default | Description |
|---|---|---|---|
| `api_key` | `Optional[str]` | `os.environ.get("KAIRO_API_KEY")` | Project API key |
| `base_url` | `Optional[str]` | `os.environ.get("KAIRO_BASE_URL")` or `http://localhost:5171` | API base URL |
| `timeout` | `float` | `30.0` | HTTP request timeout in seconds |

#### Node / TypeScript (`KairoConfig`)
| Property | Type | Default | Description |
|---|---|---|---|
| `apiKey` | `string` | `process.env.KAIRO_API_KEY` | Project API key |
| `baseUrl` | `string` | `process.env.KAIRO_BASE_URL` or `http://localhost:5171` | API base URL |
| `timeout` | `number` | `30000` | HTTP request timeout in milliseconds |

---

## 7. Python SDK Quickstart & Usage

### Complete Minimal Example

```python
import os
from kairo import Kairo

# Initialize client (reads KAIRO_API_KEY from environment)
client = Kairo()

# 1. Create a memory scoped to actor "user-123"
result = client.memories.create(
    content="User prefers concise explanations with code snippets",
    memory_type="Preference",
    actor_id="user-123",
)

if result.is_duplicate:
    print(f"Duplicate detected: {result.duplicate_reason}")
else:
    print(f"Created memory ID: {result.memory.memory_id}")

# 2. Search memories semantically within the same actor scope
search_response = client.memories.search(
    query="What kind of explanations does the user prefer?",
    actor_id="user-123",
    top_k=5,
)

print(f"Found {search_response.count} memories:")
for item in search_response.memories:
    print(f"  [{item.similarity:.4f}] (ID: {item.memory_id}) {item.content}")
```

### Context Manager Support

The Python client manages an internal connection pool via `httpx.Client`. You can use it as a context manager to ensure clean teardown:

```python
with Kairo(api_key="kairo_live_REPLACE_WITH_YOUR_KEY") as client:
    memories = client.memories.list()
```

### Compatibility Alias

`KairoClient` is an alias for `Kairo`:
```python
from kairo import KairoClient

client = KairoClient()
```

---

## 8. Node.js / TypeScript SDK Quickstart & Usage

### Complete Minimal Example

```typescript
import { Kairo } from "@kairo/sdk";

// Initialize client (reads KAIRO_API_KEY from environment)
const client = new Kairo();

async function main() {
  // 1. Create a memory scoped to actor "user-123"
  const result = await client.memories.create({
    content: "User prefers concise explanations with code snippets",
    memoryType: "Preference",
    actorId: "user-123",
  });

  if (result.isDuplicate) {
    console.log("Duplicate detected:", result.duplicateReason);
  } else {
    console.log("Created memory ID:", result.memory!.memoryId);
  }

  // 2. Search memories semantically within the same actor scope
  const searchResponse = await client.memories.search({
    query: "What kind of explanations does the user prefer?",
    actorId: "user-123",
    topK: 5,
  });

  console.log(`Found ${searchResponse.count} memories:`);
  for (const item of searchResponse.memories) {
    console.log(`  [${item.similarity.toFixed(4)}] (ID: ${item.memoryId}) ${item.content}`);
  }
}

main().catch(console.error);
```

### TypeScript Typings

All request and response shapes are fully typed:
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
} from "@kairo/sdk";
```

### Compatibility Alias

`KairoClient` is an alias for `Kairo`:
```typescript
import { KairoClient } from "@kairo/sdk";

const client = new KairoClient();
```

---

## 9. Agent Integration V1

`KairoAgentMemory` provides a thin, developer-friendly facade tailored for AI agent workflows. It translates agent actions into Kairo memory operations:

| Agent Method | Delegated SDK Operation | Purpose |
|---|---|---|
| `remember()` | `client.memories.create()` | Store durable information after conversation |
| `recall()` | `client.memories.search()` | Retrieve context before generating LLM prompt |
| `update()` | `client.memories.update()` | Refine or correct an existing memory |
| `forget()` | `client.memories.delete()` | Soft-deactivate a memory that is no longer valid |

### Architectural Boundary

```
      AI Agent (LLM Loop / Prompt Construction)
                         ↓
                 KairoAgentMemory
                         ↓
               Kairo SDK (memories.*)
                         ↓
             Kairo REST API (HTTP 5171)
                         ↓
    Memory Engine / Vector Embeddings / SQL Store
```

- **Kairo owns**: Persistence, duplicate detection, vector embeddings, similarity scoring, scoping, and soft deletion.
- **Your Agent owns**: Determining what information is durable, constructing prompts, calling LLMs, and deciding when to recall.
- `KairoAgentMemory` does **not** make LLM calls or manage chat completions.

### Default Actor & Per-Call Override

You can configure a default `actor_id` / `actorId` on the agent memory adapter. Every call to `remember()` or `recall()` will automatically use this default, while still allowing a per-call override for multi-user or multi-tenant agents.

#### Python Agent Example

```python
from kairo import Kairo, KairoAgentMemory

client = Kairo()
agent_memory = KairoAgentMemory(client, actor_id="user-123")

# Uses default actor "user-123"
agent_memory.remember(
    content="User is building a microservice in Go",
    memory_type="Context",
)

# Recall using default actor "user-123"
context = agent_memory.recall(query="What technology is the user using?", top_k=3)

# Per-call override: specify a different actor for this call only
agent_memory.remember(
    content="User prefers dark theme",
    memory_type="Preference",
    actor_id="user-456",  # Overrides default for this call only
)

# The next call reverts to default "user-123"
context_default = agent_memory.recall(query="theme preference")
```

#### Node / TypeScript Agent Example

```typescript
import { Kairo, KairoAgentMemory } from "@kairo/sdk";

const client = new Kairo();
const agentMemory = new KairoAgentMemory(client, { actorId: "user-123" });

// Uses default actor "user-123"
await agentMemory.remember({
  content: "User is building a microservice in Go",
  memoryType: "Context",
});

// Recall using default actor "user-123"
const context = await agentMemory.recall({
  query: "What technology is the user using?",
  topK: 3,
});

// Per-call override: specify a different actor for this call only
await agentMemory.remember({
  content: "User prefers dark theme",
  memoryType: "Preference",
  actorId: "user-456", // Overrides default for this call only
});

// The next call reverts to default "user-123"
const contextDefault = await agentMemory.recall({ query: "theme preference" });
```

### Actor Resolution Rule

```
Per-call actor_id  >  Constructor default actor_id  >  KairoValidationError (HTTP 400)
```

If neither a per-call actor nor a constructor default actor is present, the adapter raises `KairoValidationError` before making any network call.

---

## 10. Memory Operations (CRUD & Semantic Search)

### Valid Memory Types

Kairo supports the following memory classification values:

- `Preference`: User settings, interface choices, formatting preferences.
- `Fact`: Immutable or established facts about the user or project.
- `Goal`: Desired objectives, milestones, or target outcomes.
- `Context`: Working session details, active environments, ongoing tasks.
- `Skill`: User technical proficiencies, domain capabilities.
- `Relationship`: Social, team, or entity connections.
- `Other`: Unclassified or general durable information.

### 1. Create Memory

- **Endpoint**: `POST /api/v1/memories`
- **Required fields**: `content` (string, max 10,000 chars), `memory_type` / `memoryType`, `actor_id` / `actorId`.

```python
# Python
result = client.memories.create(
    content="Prefers automated integration tests",
    memory_type="Preference",
    actor_id="user-123",
)
```

```typescript
// Node
const result = await client.memories.create({
  content: "Prefers automated integration tests",
  memoryType: "Preference",
  actorId: "user-123",
});
```

### 2. Get Memory by ID

- **Endpoint**: `GET /api/v1/memories/{memoryId}`
- **Parameter**: `memory_id` / `memoryId` (positive integer).

```python
# Python
memory = client.memories.get(memory_id=42)
print(memory.memory_id, memory.content, memory.created_at)
```

```typescript
// Node
const memory = await client.memories.get(42);
console.log(memory.memoryId, memory.content, memory.createdAt);
```

### 3. List Memories

- **Endpoint**: `GET /api/v1/memories`
- Returns all active memories for the authenticated user/project, ordered newest-first.

```python
# Python
memories = client.memories.list()
for m in memories:
    print(f"[{m.memory_id}] {m.memory_type}: {m.content}")
```

```typescript
// Node
const memories = await client.memories.list();
for (const m of memories) {
  console.log(`[${m.memoryId}] ${m.memoryType}: ${m.content}`);
}
```

### 4. Update Memory

- **Endpoint**: `PUT /api/v1/memories/{memoryId}`
- Replaces content and type; regenerates vector embedding; archives the prior version.

```python
# Python
updated = client.memories.update(
    memory_id=42,
    content="Prefers automated integration tests using pytest",
    memory_type="Preference",
)
```

```typescript
// Node
const updated = await client.memories.update(42, {
  content: "Prefers automated integration tests using pytest",
  memoryType: "Preference",
});
```

### 5. Delete (Soft-Deactivate) Memory

- **Endpoint**: `DELETE /api/v1/memories/{memoryId}`
- Performs **soft deletion**. The memory record remains in the database with `isActive = false`, excluded from list and search operations.

```python
# Python
result = client.memories.delete(memory_id=42)
print(result.message)  # "Memory deactivated successfully"
```

```typescript
// Node
const result = await client.memories.delete(42);
console.log(result.message); // "Memory deactivated successfully"
```

### 6. Semantic Search

- **Endpoint**: `POST /api/v1/memories/search`
- **Required fields**: `query` (natural language string), `actor_id` / `actorId`.
- **Optional fields**: `top_k` / `topK` (integer 1–100, default 5).

```python
# Python
response = client.memories.search(
    query="What testing strategy was mentioned?",
    actor_id="user-123",
    top_k=5,
)
for item in response.memories:
    print(f"Score {item.similarity:.4f}: {item.content}")
```

```typescript
// Node
const response = await client.memories.search({
  query: "What testing strategy was mentioned?",
  actorId: "user-123",
  topK: 5,
});
for (const item of response.memories) {
  console.log(`Score ${item.similarity.toFixed(4)}: ${item.content}`);
}
```

---

## 11. Duplicate Detection & Conflict Handling

Kairo prevents memory clutter through server-side exact and semantic deduplication.

### Duplicate Creation (`is_duplicate`)

When `memories.create` receives content that matches an existing active memory within the same scope:

- The server returns HTTP 200 with `{ "isDuplicate": true, "reason": "..." }`.
- The SDK returns a `CreateMemoryResult` where `is_duplicate` / `isDuplicate` is `True` / `true`, `memory` is `None` / `null`, and `duplicate_reason` / `duplicateReason` contains the explanation.
- **No exception is raised** for normal deduplication; callers check `result.is_duplicate`.

```python
# Python
result = client.memories.create(
    content="User prefers dark mode",
    memory_type="Preference",
    actor_id="user-123",
)
if result.is_duplicate:
    print(f"Skipped duplicate: {result.duplicate_reason}")
else:
    print(f"Created: {result.memory.memory_id}")
```

```typescript
// Node
const result = await client.memories.create({
  content: "User prefers dark mode",
  memoryType: "Preference",
  actorId: "user-123",
});
if (result.isDuplicate) {
  console.log("Skipped duplicate:", result.duplicateReason);
} else {
  console.log("Created:", result.memory!.memoryId);
}
```

### HTTP 409 Conflict (`KairoConflictError`)

If a request creates an unresolvable resource conflict on the server, the API returns HTTP 409, which the SDK surfaces as `KairoConflictError`.

---

## 12. Error Handling & Exception Hierarchy

All SDK exceptions derive from `KairoError`.

```
KairoError
 ├── KairoValidationError        (HTTP 400 or client-side validation)
 ├── KairoAuthenticationError    (HTTP 401: missing/invalid API key)
 ├── KairoAuthorizationError     (HTTP 403: forbidden action)
 ├── KairoNotFoundError          (HTTP 404: memory does not exist or out of scope)
 ├── KairoConflictError          (HTTP 409: resource conflict)
 ├── KairoRateLimitError         (HTTP 429: rate limit exceeded)
 ├── KairoServerError            (HTTP 5xx: unexpected server error)
 └── KairoConnectionError        (Network failure, DNS error, timeout)
```

### Catching Exceptions

#### Python Example
```python
from kairo import (
    Kairo,
    KairoError,
    KairoNotFoundError,
    KairoAuthenticationError,
    KairoRateLimitError,
    KairoValidationError,
    KairoConnectionError,
)

client = Kairo()

try:
    memory = client.memories.get(memory_id=99999)
except KairoNotFoundError as err:
    print(f"Memory not found (HTTP {err.status_code}): {err.message}")
except KairoAuthenticationError as err:
    print(f"Auth error (HTTP {err.status_code}): Check KAIRO_API_KEY")
except KairoRateLimitError as err:
    print(f"Rate limited. Retry after {err.retry_after} seconds.")
except KairoValidationError as err:
    print(f"Validation failure: {err.message}")
except KairoConnectionError as err:
    print(f"Network error: Could not connect to Kairo API at {client._base_url}")
except KairoError as err:
    print(f"General Kairo error: {err}")
```

#### Node / TypeScript Example
```typescript
import {
  Kairo,
  KairoError,
  KairoNotFoundError,
  KairoAuthenticationError,
  KairoRateLimitError,
  KairoValidationError,
  KairoConnectionError,
} from "@kairo/sdk";

const client = new Kairo();

try {
  const memory = await client.memories.get(99999);
} catch (err) {
  if (err instanceof KairoNotFoundError) {
    console.log(`Memory not found (HTTP ${err.statusCode}): ${err.message}`);
  } else if (err instanceof KairoAuthenticationError) {
    console.log(`Auth error (HTTP ${err.statusCode}): Check KAIRO_API_KEY`);
  } else if (err instanceof KairoRateLimitError) {
    console.log(`Rate limited. Retry after ${err.retryAfter} seconds.`);
  } else if (err instanceof KairoValidationError) {
    console.log(`Validation failure: ${err.message}`);
  } else if (err instanceof KairoConnectionError) {
    console.log("Network error: Could not connect to Kairo API");
  } else if (err instanceof KairoError) {
    console.log("General Kairo error:", err.message);
  }
}
```

---

## 13. Rate Limiting & Retry-After

When the Kairo API rate limit is exceeded, the server responds with HTTP 429 and includes a `Retry-After` header indicating how many seconds to wait.

### SDK Behavior

- Surfaced as `KairoRateLimitError`.
- Structured attribute:
  - Python: `err.retry_after` (`Optional[int]`)
  - Node: `err.retryAfter` (`number | undefined`)
- **No Automatic Retries**: The SDK does *not* silently retry requests in the background. Your application retains full control over backoff, queuing, or retry strategy.

### Implementing Backoff

```python
import time
from kairo import Kairo, KairoRateLimitError

def safe_search(client, query, actor_id):
    for attempt in range(3):
        try:
            return client.memories.search(query=query, actor_id=actor_id)
        except KairoRateLimitError as err:
            wait_time = err.retry_after or (2 ** attempt)
            print(f"Rate limited; waiting {wait_time}s...")
            time.sleep(wait_time)
    raise RuntimeError("Exceeded maximum retry attempts")
```

---

## 14. Security Guidance & Best Practices

1. **Keep API Keys Server-Side**: The Kairo API key grants full access to your project's memory store. Never embed it in mobile clients, browser single-page applications, or public repositories.
2. **Use Environment Variables**: Store `KAIRO_API_KEY` in environment variables, secret managers (e.g., AWS Secrets Manager, Azure Key Vault, HashiCorp Vault), or `.env` files that are ignored in `.gitignore`.
3. **Actor IDs Are Not Credentials**: Actor IDs partition memory scopes. Do not use unvalidated user input as an Actor ID without verifying that the authenticated session owns that actor identity.
4. **Never Log Secrets**: The SDK automatically masks the API key in object string representations (`repr(client)` and `client.toString()`), but make sure your own logging middleware does not dump request headers.
5. **Enforce Least Privilege**: Use distinct projects (and distinct API keys) for development, staging, and production environments.

---

## 15. Local Development Guide

### Running Locally Against Kairo API

During local development, the Kairo backend API defaults to:
```
http://localhost:5171
```

Both SDKs are preconfigured to connect to `http://localhost:5171` by default.

### Step-by-Step Setup

1. **Start the Kairo Backend**:
   Ensure the .NET backend is running on port 5171 (e.g., `dotnet run --project backend/Kairo.API`).

2. **Obtain an API Key**:
   Create a development project or generate an API key from your local development instance.

3. **Configure Environment Variables**:
   ```bash
   # Windows (PowerShell)
   $env:KAIRO_API_KEY="kairo_live_REPLACE_WITH_YOUR_KEY"
   $env:KAIRO_BASE_URL="http://localhost:5171"

   # Linux / macOS
   export KAIRO_API_KEY="kairo_live_REPLACE_WITH_YOUR_KEY"
   export KAIRO_BASE_URL="http://localhost:5171"
   ```

4. **Verify Connectivity**:

   **Python test script**:
   ```python
   from kairo import Kairo

   client = Kairo()
   memories = client.memories.list()
   print(f"Connected! {len(memories)} active memories in project.")
   ```

   **Node test script**:
   ```typescript
   import { Kairo } from "@kairo/sdk";

   const client = new Kairo();
   client.memories.list().then(memories => {
     console.log(`Connected! ${memories.length} active memories in project.`);
   });
   ```

---

## 16. Troubleshooting Guide

| Issue / Error | Likely Cause | Recommended Action |
|---|---|---|
| **401 Unauthorized** (`KairoAuthenticationError`) | Invalid, expired, or missing API key; missing `Bearer` scheme. | Verify `KAIRO_API_KEY` is set correctly and has not been revoked. |
| **403 Forbidden** (`KairoAuthorizationError`) | API key lacks permission for the requested operation or resource. | Check project permissions or generate a new API key with appropriate role. |
| **404 Not Found** (`KairoNotFoundError`) | Memory ID does not exist, was soft-deleted, or belongs to another project. | Verify the integer `memory_id` / `memoryId`. Confirm the memory belongs to the authenticated project. |
| **409 Conflict** (`KairoConflictError`) | Request conflicts with current database state. | Inspect the error message. Ensure concurrent updates to the same resource are sequenced. |
| **429 Rate Limited** (`KairoRateLimitError`) | Project request threshold exceeded. | Inspect `err.retry_after` (Python) or `err.retryAfter` (Node). Pause execution or implement exponential backoff. |
| **Missing Actor ID** (`KairoValidationError`) | `actor_id` / `actorId` was not provided or was empty string. | Ensure every `create` and `search` call provides a non-empty `actor_id` / `actorId`, or configure a default actor on `KairoAgentMemory`. |
| **Incorrect Base URL** (`KairoConnectionError`) | Client connecting to wrong port (e.g., 5000 instead of 5171) or offline service. | Set `KAIRO_BASE_URL="http://localhost:5171"` or verify the target service is reachable. |
| **Missing API Key** on client init | Neither constructor argument nor `KAIRO_API_KEY` was found. | Supply `api_key` / `apiKey` in constructor or define `KAIRO_API_KEY` in environment. |
| **Python Package Not Found** | SDK not installed in active virtual environment. | Run `pip install -e sdks/python` within your activated virtual environment. |
| **Node Build / Type Error** | Missing build artifacts in `dist/` or incompatible Node version. | Run `npm run build` in `sdks/node`. Ensure Node.js is version 18.0.0 or higher. |

---

## 17. Current Limitations & V1 Scope Boundaries

1. **Synchronous Transport in Python**: The Python SDK currently uses synchronous `httpx.Client`. An `asyncio`-native client (`AsyncKairo`) is planned for a future release.
2. **Soft Deletion Only**: `memories.delete()` deactivates memory records. Permanent hard deletion is not exposed through the SDK.
3. **No Direct Scope Management**: Memory scopes are resolved automatically from `(Project, Actor)`. Applications cannot manually create, alter, or list raw `MemoryScope` database rows.
4. **No Direct Embedding Access**: Embeddings are generated server-side. The raw high-dimensional vector arrays are not returned in SDK models.
5. **No Local Caching**: Every SDK call makes a direct network round-trip to the Kairo REST API.
