# Kairo AI Memory Platform (V1)

**Kairo** is an AI memory infrastructure platform that provides persistent, scoped, and searchable memory for LLM applications and autonomous AI agents.

Kairo enables AI assistants and agents to remember user facts, preferences, goals, and context across sessions and interactions. It features server-side conversational memory ingestion with automatic extraction, evolving fact consolidation, high-dimensional vector embeddings, and semantic search with AI relevance evaluation.

---

## Architecture & Mental Model

Kairo enforces strict multi-tenant and multi-actor isolation:

```
Developer Account
       │
       ▼
    Project                  (Identified by Kairo API Key)
       │
       ▼
  MemoryScope                (Resolved automatically: Project + ActorId)
       │
       ├── Memory            (Active canonical memory items)
       └── MemoryVersions    (Audit history & superseded versions)
```

$$\text{MemoryScope} = \text{Project} + \text{ActorId}$$

- **Developer Account**: Represents the registered developer organization.
- **Project**: Represents a specific application environment. Identified and authenticated by a Project API key (`kairo_live_...`).
- **ActorId**: Supplied by your application (e.g. `user-123`, `tenant-abc`, `session-456`). Identifies the individual end-user or agent session.
- **MemoryScope**: Automatically resolved on the server from `(ProjectId, ActorId)`. Memories never mix across actors or projects.
- **Server Authority**: The client never supplies `UserId`, `ProjectId`, or `ScopeId`. All authority is established securely on the server from the verified API key.

---

## Core Capabilities (V1)

1. **Conversational Memory Ingestion (`POST /api/v1/memories/ingest`)**:
   - Send complete conversation dialogues between user and assistant.
   - The server extracts salient memories, generates embeddings, retrieves existing candidates, and applies AI consolidation.
   - Four distinct consolidation actions:
     - **`Add`**: New memory created.
     - **`Update`**: Existing memory superseded with updated facts.
     - **`Merge`**: Existing memory enriched with complementary context.
     - **`NoAction`**: Memory candidate skipped due to duplication or lack of durable salience.

2. **Semantic Vector Search (`POST /api/v1/memories/search`)**:
   - Natural language queries embedded via Mistral AI embeddings.
   - Scoped cosine similarity matching against stored vectors.
   - Mistral AI relevance evaluator verifies factual contextual alignment and filters out irrelevant memories.

3. **Memory CRUD & Versioning (`/api/v1/memories`)**:
   - Direct memory creation, retrieval, updates, and soft deletion (`forget`).
   - Every mutation or deletion archives an immutable version in `MemoryVersions`.

4. **Multi-Tenant Security & IDOR Resistance**:
   - Project and actor boundaries enforced in database queries.
   - Direct memory lookups verify ownership; cross-project access returns HTTP 404 Not Found.

5. **Model Context Protocol (MCP)**:
   - Built-in MCP server adapter for AI tools (`remember`, `recall`, `update`, `forget`, `kairo_ping`).

---

## Quickstart

### 1. Developer Setup
1. Register or log in at `http://localhost:3000` (or via `/api/auth/register`).
2. Create a Project in the Dashboard to receive your Project API Key (`kairo_live_...`).
3. Set your environment variable:
   ```bash
   export KAIRO_API_KEY="kairo_live_your_api_key_here"
   export KAIRO_BASE_URL="http://localhost:5171"
   ```

### 2. Python SDK

```bash
pip install ./sdks/python
```

```python
from kairo import Kairo

client = Kairo()  # reads KAIRO_API_KEY and KAIRO_BASE_URL

# 1. Ingest a conversation
response = client.memories.ingest(
    actor_id="user-123",
    messages=[
        {"role": "user", "content": "I prefer PostgreSQL and I usually work from Pune."},
        {"role": "assistant", "content": "Understood! I'll remember your preferences."},
    ],
)

for mem in response.memories:
    print(f"[{mem.action}] {mem.content}")

# 2. Semantic search
results = client.memories.search(
    actor_id="user-123",
    query="What database does this user prefer?",
    top_k=5,
)

for mem in results.memories:
    print(f"[{mem.similarity:.4f}] {mem.content}")
```

### 3. Node.js / TypeScript SDK

```bash
npm install ./sdks/node
```

```typescript
import { Kairo } from "@kairo/sdk";

const client = new Kairo(); // reads KAIRO_API_KEY and KAIRO_BASE_URL

// 1. Ingest a conversation
const response = await client.memories.ingest({
    actorId: "user-123",
    messages: [
        { role: "user", content: "I prefer PostgreSQL and I usually work from Pune." },
        { role: "assistant", content: "Understood! I'll remember your preferences." },
    ],
});

for (const mem of response.memories) {
    console.log(`[${mem.action}] ${mem.content}`);
}

// 2. Semantic search
const results = await client.memories.search({
    actorId: "user-123",
    query: "What database does this user prefer?",
    topK: 5,
});

for (const mem of results.memories) {
    console.log(`[${mem.similarity.toFixed(4)}] ${mem.content}`);
}
```

---

## Repository Structure

```
├── backend/                  # ASP.NET Core Web API & Application layers (.NET 10)
│   ├── Kairo.API/            # Public REST API, MCP endpoints, Auth pipeline
│   ├── Kairo.Application/    # Business logic, MemoryService, ScopeResolution
│   ├── Kairo.Domain/         # Domain entities & interfaces
│   ├── Kairo.Infrastructure/  # EF Core, SQL Server repos, Mistral AI services
│   ├── Kairo.MCP/            # Model Context Protocol tool adapters
│   └── Kairo.Tests/          # Comprehensive xUnit test suite (52 tests)
├── frontend/                 # Next.js 16 (Turbopack) Developer Dashboard & UI
├── sdks/
│   ├── python/               # Official Python client library (136 tests)
│   └── node/                 # Official Node.js/TypeScript client library (95 tests)
└── docs/                     # Architectural guides and documentation
```

---

## Current V1 Limitations

- **Provider**: Embeddings and relevance evaluation currently use Mistral AI (`mistral-embed` and `mistral-small-latest`).
- **Scope Model**: Scopes are strictly partitioned per `(ProjectId, ActorId)`. Cross-actor memory aggregation and cross-project continuity are out of scope for V1.
- **Vector Search**: Vector similarity search is executed server-side via cosine computation on normalized float vectors stored in SQL Server.
