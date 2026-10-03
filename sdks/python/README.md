# Kairo Python SDK

Official Python client library for the [Kairo AI Memory Platform](https://kairo.ai).

Kairo gives AI applications, agents, and assistants persistent, searchable memory. Store facts, preferences, goals, context, and skills across sessions. Retrieve the most relevant memories for any query using semantic search backed by high-dimensional vector embeddings.

> **Version**: 0.1.0 (Developer Preview)
> **Requires**: Python 3.10+

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
- [Exception Handling & Rate Limits](#exception-handling--rate-limits)
- [Security Guidance](#security-guidance)
- [Local Development](#local-development)
- [Troubleshooting](#troubleshooting)
- [Models Reference](#models-reference)
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

- **Project A / alice** cannot see **Project A / bob**'s memories.
- **Project A / alice** cannot see **Project B / alice**'s memories.
- Neither `UserId`, `ProjectId`, nor `ScopeId` are caller-controlled SDK parameters.

---

## Authentication

Every request to the Kairo REST API is authenticated with your Project API key via HTTP Bearer authentication:

```http
Authorization: Bearer <Kairo API Key>
```

### Resolution Order

1. `api_key` constructor argument.
2. `KAIRO_API_KEY` environment variable.
3. If neither is set, raises `KairoAuthenticationError` before making any network call.

```bash
export KAIRO_API_KEY="kairo_live_REPLACE_WITH_YOUR_KEY"
```

```python
from kairo import Kairo

# Reads KAIRO_API_KEY from environment
client = Kairo()

# Or pass explicitly:
client = Kairo(api_key="kairo_live_REPLACE_WITH_YOUR_KEY")
```

---

## Actor-Based Memory Scoping

An **Actor ID** (`actor_id`) is your application's unique identifier for the user or entity who owns the memory.

- **Required on Create**: `client.memories.create(..., actor_id="user-123")`
- **Required on Search**: `client.memories.search(..., actor_id="user-123")`
- **Not a Credential**: Actor IDs partition data; they do not authenticate the user.
- **Not a Kairo User ID**: The internal Kairo `UserId` belongs to the project developer account.

---

## Installation

```bash
# From local repository:
pip install -e path/to/sdks/python

# Once published:
pip install kairo
```

**Requirements:**
- Python 3.10 or later
- [httpx](https://www.python-httpx.org/) ≥ 0.27.0

---

## Configuration

| Environment Variable | Description | Default |
|---|---|---|
| `KAIRO_API_KEY` | Project API key | *(None — required)* |
| `KAIRO_BASE_URL` | API base URL | `http://localhost:5171` |

---

## Quickstart

```python
import os
from kairo import Kairo

# Initialize client (reads KAIRO_API_KEY from environment)
client = Kairo()

# 1. Store a memory scoped to actor "user-123"
result = client.memories.create(
    content="User prefers concise explanations with code examples",
    memory_type="Preference",
    actor_id="user-123",
)

if result.is_duplicate:
    print(f"Duplicate detected: {result.duplicate_reason}")
else:
    print(f"Created memory ID: {result.memory.memory_id}")

# 2. Search memories semantically within the same actor scope
results = client.memories.search(
    query="What style of explanations does the user prefer?",
    actor_id="user-123",
    top_k=3,
)

print(f"Found {results.count} relevant memories:")
for m in results.memories:
    print(f"  [{m.similarity:.4f}] (ID: {m.memory_id}) {m.content}")
```

---

## Client Initialization

```python
from kairo import Kairo, KairoClient

# Minimal: reads KAIRO_API_KEY from environment, connects to http://localhost:5171
client = Kairo()

# Compatibility alias: KairoClient is identical to Kairo
client = KairoClient()

# Explicit API key:
client = Kairo(api_key="kairo_live_REPLACE_WITH_YOUR_KEY")

# Custom base URL (staging, self-hosted, local dev):
client = Kairo(
    api_key="kairo_live_REPLACE_WITH_YOUR_KEY",
    base_url="http://localhost:5171",
)

# Custom timeout (in seconds, default 30.0):
client = Kairo(
    api_key="kairo_live_REPLACE_WITH_YOUR_KEY",
    timeout=60.0,
)

# Context manager (automatically closes connection pool):
with Kairo() as client:
    memories = client.memories.list()
```

---

## Memory Operations (CRUD & Search)

### Supported Memory Types

| Value | Description |
|---|---|
| `Preference` | User preferences and settings |
| `Fact` | Factual statements about the user or domain |
| `Goal` | User goals and objectives |
| `Context` | Session or project state |
| `Skill` | User capabilities and proficiencies |
| `Relationship` | Relationships and social connections |
| `Other` | Miscellaneous durable information |

### Create a Memory

```python
result = client.memories.create(
    content="User works primarily in Python and TypeScript",
    memory_type="Fact",
    actor_id="user-123",
)

if result.is_duplicate:
    print(f"Already stored: {result.duplicate_reason}")
else:
    memory = result.memory
    print(f"Created memory {memory.memory_id} at {memory.created_at}")
```

### Get a Memory by ID

```python
memory = client.memories.get(memory_id=16)
print(f"[{memory.memory_id}] {memory.content} (Type: {memory.memory_type})")
```

### List All Memories

```python
memories = client.memories.list()
print(f"{len(memories)} active memories")
for m in memories:
    print(f"[{m.memory_id}] {m.memory_type}: {m.content}")
```

### Update a Memory

```python
updated = client.memories.update(
    memory_id=16,
    content="User works primarily in Python 3.12 and TypeScript 5",
    memory_type="Fact",
)
print(f"Updated at {updated.updated_at}")
```

### Delete (Soft-Deactivate) a Memory

```python
result = client.memories.delete(memory_id=16)
print(result.message)  # "Memory deactivated successfully"
```

> **Note**: Kairo performs **soft deletion**. The memory record remains preserved in the database marked `isActive = false`, and will no longer appear in list or search results.

### Search Memories (Semantic Vector Search)

```python
results = client.memories.search(
    query="What programming languages does the user work with?",
    actor_id="user-123",
    top_k=5,
)

print(f"Found {results.count} relevant memories:")
for m in results.memories:
    print(f"  [{m.similarity:.4f}] {m.content}")
```

- `top_k` must be an integer between 1 and 100 (defaults to 5).
- Search evaluates cosine similarity against memories within the specified `actor_id` scope.

### Conversational Ingestion (Automatic Extraction & Consolidation)

Pass conversation dialogues directly to Kairo. The backend automatically extracts salient memories, generates embeddings, retrieves candidate memories in the actor's scope, and applies AI consolidation:

```python
response = client.memories.ingest(
    actor_id="user-123",
    messages=[
        {"role": "user", "content": "I prefer PostgreSQL for backend applications."},
        {"role": "assistant", "content": "Got it, I will remember that."},
    ],
)

print(f"Processed: {response.processed}, Extracted: {response.extracted_count}")
for mem in response.memories:
    print(f"[{mem.action}] ID: {mem.memory_id} - {mem.content}")
```

#### Consolidation Actions:
- **`Add`**: A novel memory was extracted and stored.
- **`Update`**: An existing memory was superseded by updated or contradictory facts.
- **`Merge`**: An existing memory was enriched with complementary details.
- **`NoAction`**: Candidate was skipped due to exact/semantic duplication or lack of durable salience.

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

```python
from kairo import Kairo, KairoAgentMemory

client = Kairo()
agent = KairoAgentMemory(client, actor_id="user-123")

# 1. Store memory — automatically uses default actor_id="user-123"
result = agent.remember(
    content="User prefers PostgreSQL over MySQL",
    memory_type="Preference",
)

# 2. Recall memories — uses default actor_id="user-123"
context = agent.recall(query="What database does the user prefer?", top_k=5)
for m in context.memories:
    print(f"[{m.similarity:.4f}] {m.content}")

# 3. Per-call actor override — uses "user-456" for this call only
agent.remember(
    content="User prefers MongoDB",
    memory_type="Preference",
    actor_id="user-456",
)

# 4. Next call reverts to default "user-123"
default_context = agent.recall(query="database preference")

# 5. Update and forget
agent.update(memory_id=result.memory.memory_id, content="User prefers PostgreSQL 16", memory_type="Preference")
agent.forget(memory_id=result.memory.memory_id)
```

### Actor Resolution Rule

```
per-call actor_id  >  constructor default actor_id  >  KairoValidationError (HTTP 400)
```

If neither is provided, `KairoValidationError` is raised locally before any network call.

---

## Duplicate Detection & Conflicts

### Duplicate Memory Creation (`is_duplicate`)

When you attempt to create a memory with content that is an exact or semantic duplicate of an existing memory in the same scope:

- The server returns HTTP 200 with `{ "isDuplicate": true, "reason": "..." }`.
- `result.is_duplicate` is set to `True`.
- `result.memory` is `None`.
- `result.duplicate_reason` contains the server's explanation.
- **No exception is thrown.**

```python
result = client.memories.create(
    content="User prefers dark mode",
    memory_type="Preference",
    actor_id="user-123",
)
if result.is_duplicate:
    print(f"Skipped duplicate: {result.duplicate_reason}")
```

### HTTP 409 Conflict (`KairoConflictError`)

If a request produces an unresolvable resource conflict on the server, the SDK raises `KairoConflictError`.

---

## Exception Handling & Rate Limits

All SDK exceptions inherit from `KairoError`.

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

```python
from kairo import (
    Kairo,
    KairoError,
    KairoAuthenticationError,
    KairoNotFoundError,
    KairoValidationError,
    KairoConflictError,
    KairoRateLimitError,
    KairoConnectionError,
)

client = Kairo()

try:
    memory = client.memories.get(memory_id=999)
except KairoNotFoundError as err:
    print(f"Memory not found (HTTP {err.status_code})")
except KairoAuthenticationError as err:
    print(f"Authentication failed: Check KAIRO_API_KEY (HTTP {err.status_code})")
except KairoRateLimitError as err:
    print(f"Rate limited (HTTP {err.status_code}). Retry after {err.retry_after}s")
except KairoConflictError as err:
    print(f"Conflict error (HTTP {err.status_code}): {err.message}")
except KairoValidationError as err:
    print(f"Invalid input: {err.message}")
except KairoConnectionError as err:
    print(f"Could not connect to Kairo: {err.message}")
except KairoError as err:
    print(f"Kairo error: {err}")
```

### Rate Limiting & Retry-After

When the API returns HTTP 429:
- Raised as `KairoRateLimitError`.
- If the server sends a `Retry-After` header, it is exposed on `err.retry_after` (in seconds).
- The SDK does **not** automatically retry requests; your application can decide when and how to back off.

---

## Security Guidance

1. **Keep API Keys Server-Side**: Never expose your Kairo API key to client-side code, mobile applications, or public source control.
2. **Use Environment Variables**: Configure `KAIRO_API_KEY` using secure environment variables or secret vaults.
3. **Actor IDs Are Scoping Keys**: Actor IDs partition data within your project. Always validate that the current user owns the actor ID before passing it to Kairo.
4. **Clean Logging**: The SDK strips API keys from `repr(client)` and exception messages. Do not log raw HTTP request headers in your application logging.

---

## Local Development

During local development against a local Kairo instance:

```bash
# Set environment variables
export KAIRO_API_KEY="kairo_live_REPLACE_WITH_YOUR_KEY"
export KAIRO_BASE_URL="http://localhost:5171"
```

```python
from kairo import Kairo

client = Kairo()
print(f"Connected to {client._base_url}")
memories = client.memories.list()
print(f"Active memories: {len(memories)}")
```

---

## Troubleshooting

| Error / Issue | Common Cause | Resolution |
|---|---|---|
| **401 Unauthorized** (`KairoAuthenticationError`) | Invalid or revoked API key; missing `KAIRO_API_KEY`. | Verify the key against the Kairo dashboard and confirm `KAIRO_API_KEY` is set. |
| **403 Forbidden** (`KairoAuthorizationError`) | API key lacks permission for the resource. | Confirm the project and key roles. |
| **404 Not Found** (`KairoNotFoundError`) | Memory ID does not exist, was soft-deleted, or belongs to another project. | Verify the integer `memory_id` belongs to the authenticated project. |
| **409 Conflict** (`KairoConflictError`) | Conflicting concurrent state on the server. | Inspect error message and handle concurrency. |
| **429 Rate Limited** (`KairoRateLimitError`) | Request rate threshold exceeded. | Inspect `err.retry_after` and apply exponential backoff. |
| **Missing Actor ID** (`KairoValidationError`) | `actor_id` was omitted or empty in create/search. | Provide a valid `actor_id` or configure a default actor on `KairoAgentMemory`. |
| **Connection Refused** (`KairoConnectionError`) | Kairo backend is not running or wrong port. | Verify Kairo API is running at `http://localhost:5171`. |
| **No API Key Provided** on init | Neither `api_key=` nor `KAIRO_API_KEY` was provided. | Set `KAIRO_API_KEY` environment variable. |
| **ModuleNotFoundError: 'kairo'** | SDK not installed in active environment. | Run `pip install -e path/to/sdks/python`. |

---

## Models Reference

| Model | Attributes | Description |
|---|---|---|
| `Memory` | `memory_id`, `user_id`, `content`, `memory_type`, `is_active`, `created_at`, `updated_at` | Stored memory item |
| `CreateMemoryResult` | `memory`, `is_duplicate`, `duplicate_reason` | Result of `create()` |
| `RetrievedMemory` | `memory_id`, `content`, `memory_type`, `similarity` | Search result item with cosine score |
| `MemorySearchResponse` | `query`, `count`, `memories` | Response from `search()` |
| `DeleteMemoryResult` | `memory_id`, `message` | Result of `delete()` |

---

## Limitations & V1 Scope

- **Synchronous Transport**: Uses synchronous `httpx.Client`. Asynchronous support (`AsyncKairo`) is planned for a future release.
- **Soft Deletion**: Memories are deactivated, not physically deleted from the database.
- **Automated Scoping**: `MemoryScope` is managed internally from `(Project, Actor)`. Scope IDs are not exposed as user parameters.
- **Server-Side Embeddings**: Vector embeddings are generated server-side; raw vector floats are not returned.

---

## License

MIT
