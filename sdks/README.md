# Kairo SDKs & Agent Integration

Official client libraries and agent integrations for the [Kairo AI Memory Platform](https://kairo.ai).

Kairo equips AI applications and autonomous agents with persistent, scoped, searchable memory powered by semantic vector embeddings.

---

## SDK Packages

| Package | Language | Runtime | Directory | Documentation |
|---|---|---|---|---|
| **`kairo`** | Python | Python 3.10+ | [`sdks/python/`](python/) | [Python README](python/README.md) |
| **`@kairo/sdk`** | TypeScript / JavaScript | Node.js 18+ | [`sdks/node/`](node/) | [Node README](node/README.md) |

For the complete technical guide covering both languages, architectural deep dives, and troubleshooting, see the [Master Developer Guide](../docs/SDK_GUIDE.md).

---

## Core Capabilities

- **Actor-Based Memory Scoping**: Scope memories by application-level actor IDs (`actor_id` / `actorId`) for multi-user and multi-tenant isolation.
- **Semantic Vector Search**: Natural-language similarity queries backed by Mistral AI embeddings and vector search.
- **Duplicate Detection**: Transparent server-side exact and semantic deduplication.
- **Agent Integration V1**: Native `KairoAgentMemory` adapter with `remember()`, `recall()`, `update()`, and `forget()` verbs.
- **Structured Error Hierarchy**: Predictable HTTP-to-exception mapping with `Retry-After` extraction on rate limits.

---

## Quick Comparison

### Python
```python
from kairo import Kairo, KairoAgentMemory

client = Kairo()  # reads KAIRO_API_KEY
agent = KairoAgentMemory(client, actor_id="user-123")

# Remember
agent.remember(content="User prefers Python", memory_type="Preference")

# Recall
context = agent.recall(query="What language does the user prefer?")
```

### TypeScript / Node.js
```typescript
import { Kairo, KairoAgentMemory } from "@kairo/sdk";

const client = new Kairo(); // reads KAIRO_API_KEY
const agent = new KairoAgentMemory(client, { actorId: "user-123" });

// Remember
await agent.remember({ content: "User prefers TypeScript", memoryType: "Preference" });

// Recall
const context = await agent.recall({ query: "What language does the user prefer?" });
```

---

## Default Endpoints & Configuration

- **API Base URL**: `http://localhost:5171` (default for local development)
- **Environment Variables**:
  - `KAIRO_API_KEY`: Project API key (required)
  - `KAIRO_BASE_URL`: Override base URL (e.g. `http://localhost:5171`)
