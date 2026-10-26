# VOIDZONE SDKs & Agent Integration

Client libraries and agent integrations for the [VOIDZONE AI Memory Platform](https://voidzone.ai).

VOIDZONE equips AI applications and autonomous agents with persistent, scoped, searchable memory powered by semantic vector embeddings.

---

## SDK Packages (Source In-Repo)

The SDK libraries in this repository are developed as local packages. They can be installed directly from source:

| Package Name | Language | Runtime | Source Directory | Documentation | Local Installation |
|---|---|---|---|---|---|
| **`kairo`** | Python | Python 3.10+ | [`sdks/python/`](python/) | [Python README](python/README.md) | `pip install -e sdks/python` |
| **`@kairo/sdk`** | TypeScript / JavaScript | Node.js 18+ | [`sdks/node/`](node/) | [Node README](node/README.md) | `npm install ./sdks/node` |

> [!NOTE]
> These packages are currently built and tested from local source in this repository. They are not yet published to public PyPI / npm registries under `voidzone` or `@voidzone/sdk`.

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

client = Kairo()  # reads KAIRO_API_KEY or VOIDZONE API key passed explicitly: Kairo(api_key="...")
agent = KairoAgentMemory(client, actor_id="user-123")

# Remember
agent.remember(content="User prefers Python", memory_type="Preference")

# Recall
context = agent.recall(query="What language does the user prefer?")
```

### TypeScript / Node.js
```typescript
import { Kairo, KairoAgentMemory } from "@kairo/sdk";

const client = new Kairo(); // reads KAIRO_API_KEY or pass apiKey explicitly: new Kairo({ apiKey: "..." })
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
  - `KAIRO_API_KEY`: Project API key (required when not passed in constructor)
  - `KAIRO_BASE_URL`: Override base URL (e.g. `http://localhost:5171`)
