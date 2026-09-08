# Kairo Python SDK

Official Python client library for the [Kairo AI Memory Platform](https://kairo.ai).

Kairo gives AI applications, agents, and assistants persistent, searchable memory. Store facts, preferences, goals, and context. Retrieve the most relevant memories for any query using semantic search.

> **Version**: 0.1.0 (Developer Preview)

---

## Installation

The Kairo SDK is not yet published to PyPI. Install directly from the repository for now:

```bash
pip install -e path/to/sdks/python
```

Once published:

```bash
pip install kairo
```

**Requires Python 3.10 or later.**

---

## Authentication

Kairo authenticates every API request with your API key.

**Option 1 — Environment variable (recommended for servers):**

```bash
export KAIRO_API_KEY="kairo_live_xxx"
```

```python
from kairo import Kairo

client = Kairo()
```

**Option 2 — Constructor argument:**

```python
from kairo import Kairo

client = Kairo(api_key="kairo_live_xxx")
```

> ⚠️ Never hard-code your API key in source code or commit it to version control.

---

## Quick Start

```python
from kairo import Kairo

client = Kairo()  # reads KAIRO_API_KEY from environment

# Store a memory
result = client.memories.create(
    content="User prefers dark mode and a minimal UI",
    memory_type="Preference",
)

if result.is_duplicate:
    print(f"Duplicate detected: {result.duplicate_reason}")
else:
    print(f"Memory created: {result.memory.memory_id}")

# Search memories
results = client.memories.search(
    query="What UI theme does the user prefer?",
    top_k=3,
)

for m in results.memories:
    print(f"[{m.similarity:.4f}] {m.content}")
```

---

## Initialization

```python
from kairo import Kairo

# Basic — reads KAIRO_API_KEY from environment
client = Kairo()

# Explicit API key
client = Kairo(api_key="kairo_live_xxx")

# Custom base URL (staging, self-hosted)
client = Kairo(
    api_key="kairo_live_xxx",
    base_url="https://api.kairo.ai",
)

# Custom timeout (seconds)
client = Kairo(
    api_key="kairo_live_xxx",
    timeout=60,
)
```

Use as a context manager to automatically close the connection pool:

```python
with Kairo() as client:
    memories = client.memories.list()
```

---

## Memory Operations

### Create a memory

```python
result = client.memories.create(
    content="User works primarily in Python and prefers type hints",
    memory_type="Fact",
)

if result.is_duplicate:
    print(f"Already stored: {result.duplicate_reason}")
else:
    memory = result.memory
    print(f"Created memory {memory.memory_id} at {memory.created_at}")
```

**Supported memory types:**

| Value | Description |
|---|---|
| `Preference` | User preferences and settings |
| `Fact` | Factual information about the user |
| `Goal` | User goals and objectives |
| `Context` | Session or project context |
| `Skill` | User skills and expertise |
| `Relationship` | Relationship and social context |
| `Other` | Miscellaneous |

### Get a memory

```python
memory = client.memories.get(memory_id=16)
print(memory.content)
print(memory.memory_type)
print(memory.created_at)
```

### List memories

```python
memories = client.memories.list()

print(f"{len(memories)} active memories")
for memory in memories:
    print(f"[{memory.memory_id}] {memory.memory_type}: {memory.content}")
```

### Update a memory

```python
updated = client.memories.update(
    memory_id=16,
    content="User strongly prefers dark mode across all applications",
    memory_type="Preference",
)
print(f"Updated at {updated.updated_at}")
```

### Search memories (semantic)

```python
results = client.memories.search(
    query="What programming languages does the user know?",
    top_k=5,
)

print(f"Found {results.count} relevant memories")
for m in results.memories:
    print(f"  [{m.similarity:.4f}] {m.content}")
```

`top_k` must be between 1 and 100. Defaults to 5.

### Delete (deactivate) a memory

```python
result = client.memories.delete(memory_id=16)
print(result.message)
```

> Kairo performs **soft deletion**. The memory record is preserved in the database
> and marked inactive. It will no longer appear in list or search results.

---

## Exception Handling

```python
from kairo import (
    Kairo,
    KairoError,
    KairoAuthenticationError,
    KairoNotFoundError,
    KairoValidationError,
    KairoServerError,
    KairoConnectionError,
)

client = Kairo()

try:
    memory = client.memories.get(memory_id=999)
except KairoNotFoundError:
    print("Memory not found.")
except KairoAuthenticationError:
    print("Invalid or expired API key.")
except KairoValidationError as e:
    print(f"Bad request: {e}")
except KairoConnectionError as e:
    print(f"Could not reach Kairo API: {e}")
except KairoError as e:
    print(f"Kairo error: {e}")
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

## Models

| Model | Description |
|---|---|
| `Memory` | A stored memory (`memory_id`, `content`, `memory_type`, `is_active`, `created_at`, `updated_at`) |
| `CreateMemoryResult` | Result of `create()` — includes `memory` and `is_duplicate` |
| `RetrievedMemory` | A search result (`memory_id`, `content`, `memory_type`, `similarity`) |
| `MemorySearchResponse` | Search response (`query`, `count`, `memories`) |
| `DeleteMemoryResult` | Deletion result (`memory_id`, `message`) |

---

## Requirements

- Python 3.10+
- [httpx](https://www.python-httpx.org/) ≥ 0.27

---

## License

MIT
