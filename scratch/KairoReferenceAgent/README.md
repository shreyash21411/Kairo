# Kairo Reference Agent — Step 11B

A deterministic, framework-neutral reference implementation demonstrating
how an external AI agent integrates with **Kairo** as its persistent memory
layer.

---

## What this demonstrates

This reference agent shows the **correct integration pattern** for an
agent that uses Kairo for persistent memory. It is not a production agent,
not an LLM application, and not an agent framework.

The agent executes nine deterministic scenarios covering the complete
memory lifecycle:

| Scenario | What it demonstrates |
|---|---|
| A — Remember | Storing a durable preference; verifying the memory was created. |
| B — Recall | Retrieving context before generating a response; confirming memoryId is returned. |
| C — Update | Recall → identify by content/type → update with captured memoryId. |
| D — Forget | Forget by memoryId; verify memory is absent from subsequent recall. |
| E — Exact Duplicate | Kairo blocks identical content; `is_duplicate=True`, `memory=None`. |
| F — Semantic Duplicate | Kairo may block semantically equivalent content; result depends on model threshold. |
| G — Zero Recall | Zero results is normal behavior, not an error. |
| H — Error Contract | `update`/`forget` on a nonexistent ID raises `KairoNotFoundError`. |
| I — Ambiguous Recall | Multiple candidates returned; agent applies content signals before deciding. |

---

## Architecture

```
Reference Agent  (agent.py)
      |
KairoAgentMemory  (kairo.agent — thin facade)
      |
Kairo Python SDK  (kairo.memories / kairo.client)
      |
Kairo REST API    (http://localhost:5171 by default)
      |
Memory Engine / Mistral Embeddings / SQL Database
```

### Responsibility boundary

| Kairo owns | Agent owns |
|---|---|
| Persistence | Deciding what to remember |
| Duplicate detection (exact + semantic) | Deciding when to recall |
| Embedding generation | Constructing LLM prompts |
| Semantic retrieval | Selecting the correct candidate from recall results |
| Memory versioning | Driving agent reasoning |
| Tenant isolation | |
| Authentication | |

Kairo does not run the agent loop. Kairo does not call the LLM.

---

## Prerequisites

- Python 3.10 or later
- The Kairo API must be running (default: `http://localhost:5171`)
- The `kairo` Python SDK (included at `sdks/python/src/`)

The reference agent resolves the SDK automatically from the relative path
`../../sdks/python/src`. No `pip install` is required if you run
`agent.py` from within `scratch/KairoReferenceAgent/`.

If you prefer, install the SDK in editable mode:

```bash
pip install -e ../../sdks/python
```

---

## Configuration

### Required

```bash
export KAIRO_API_KEY=kairo_live_...
```

The API key is never printed. It is passed to Kairo as a Bearer token.

### Optional

```bash
export KAIRO_BASE_URL=http://localhost:5171   # default
```

Override this to point at a staging or production Kairo instance.

---

## How to run

```bash
cd scratch/KairoReferenceAgent
export KAIRO_API_KEY=kairo_live_...
python agent.py
```

Expected output format:

```
============================================================
KAIRO REFERENCE AGENT -- STEP 11B
============================================================
  v  Scenario A -- Remember               PASS
       memory_id=42
  v  Scenario B -- Recall                 PASS
       count=3
  v  Scenario C -- Update                 PASS
       memory_id=42
  v  Scenario D -- Forget                 PASS
       forgotten memory_id=42
  v  Scenario E -- Exact Duplicate        PASS
       original memory_id=43; duplicate correctly blocked
  i  Scenario F -- Semantic Dup           INFO
       Semantic duplicate not triggered; second memory created (memory_id=44)
  v  Scenario G -- Zero Recall            PASS
       count=0; handled as normal empty result
  v  Scenario H -- Error Contract         PASS
       KairoNotFoundError raised for both update and forget on phantom ID
  v  Scenario I -- Ambiguity              PASS
       Case 3 demonstrated: 2 candidates; disambiguation logic applied

------------------------------------------------------------
Summary
------------------------------------------------------------
  Passed : 8
  Failed : 0
  Info   : 1
```

---

## Scenario details

### A — Remember

The agent decides that a user statement represents durable information
and calls `memory.remember()`. The result is checked: `is_duplicate`
must be `False` and `memory.memory_id` must be present.

The `memory_id` returned here is stored and passed to Scenarios B, C, D.

### B — Recall

Before constructing a response, the agent calls `memory.recall()` with
a natural-language query. The SDK sends an embedding request to Kairo,
which returns the most semantically relevant memories.

**Key**: every result includes `memory_id`. The agent can immediately
use that ID for `update` or `forget` — no separate lookup is needed.

### C — Update (Correct pattern for mutation)

**Never hardcode a memoryId.**

The correct pattern is:
1. Call `recall()` with a query related to the concept to update.
2. Filter results by `memory_type` and content signals.
3. Capture the `memory_id` from the result.
4. Call `memory.update(memory_id=..., content=..., memory_type=...)`.

Kairo preserves the same `memory_id` after update and archives the
previous version internally.

### D — Forget

The correct pattern is:
1. Call `recall()` to locate the memory (do not hardcode the ID).
2. Call `memory.forget(memory_id=...)`.
3. Call `recall()` again and assert the `memory_id` is **absent**.

Do not assert that the entire recall result set is empty — other
memories may legitimately exist.

Calling `forget` on an already-deactivated memory returns a 404 error.
This is expected behavior and safe to catch and ignore.

### E — Exact Duplicate

When you call `remember()` with content that is byte-for-byte identical
to an existing memory:

```python
result = memory.remember(content="...", memory_type="Preference")
if result.is_duplicate:
    print("Blocked:", result.duplicate_reason)
    # result.memory is None -- no new record was created
```

**Do NOT parse `duplicate_reason` to extract a memory ID.**

The reason string is human-readable prose. Its format may change.
If you need the ID of the existing memory, use `recall()`:

```python
context = memory.recall(query="...", top_k=3)
existing_id = context.memories[0].memory_id
```

### F — Semantic Duplicate

Kairo generates an embedding for your content and compares it against
all existing memories. If the cosine similarity exceeds the configured
threshold, the content is classified as a semantic duplicate and blocked.

**Whether this triggers depends on the Mistral embedding model and
the threshold configured for your Kairo instance.** The reference agent
does not force either outcome:

- If detected → `PASS`
- If not detected → `INFO` (not a Kairo defect)

After a semantic duplicate response, use `recall()` to find the
existing memory — never parse `duplicate_reason`.

### G — Zero Result Recall

```python
res = memory.recall(query="...", top_k=5)
# res.count == 0
# res.memories == []
# This is NORMAL -- not an error
```

The agent proceeds without historical context. No exception is raised.
Zero results means no relevant memories exist yet for this user.

### H — Error Contract

`update()` and `forget()` both return `KairoNotFoundError` (HTTP 404)
when the `memoryId` does not exist or does not belong to the
authenticated user. These are intentionally indistinguishable:
Kairo does not confirm whether a memory exists for a different tenant.

```python
from kairo import KairoNotFoundError

try:
    memory.update(memory_id=999999999, content="...", memory_type="Fact")
except KairoNotFoundError:
    pass  # expected
```

**Always catch `KairoNotFoundError` specifically — not bare `Exception`.**

### I — Ambiguous Recall

When `recall()` returns multiple plausible memories, the agent must
apply additional signals before deciding to mutate any of them:

1. Filter by `memory_type` (e.g., only `Preference`).
2. Filter by content keywords matching the user's intent.
3. Rank by `similarity` only after narrowing by the above.

If ambiguity remains after all filters are applied, **do NOT mutate**.
Cosine similarity alone cannot resolve semantic ambiguity.

---

## The correct remember → recall → update → forget lifecycle

```
User message
     |
     v
recall(query="...", top_k=N)
     |
     +-- memories=[...] -> inject into LLM prompt as context
     +-- memories=[]    -> proceed without historical context
     |
Agent generates response
     |
     +-- NEW durable fact?
     |      -> remember(content=..., memory_type=...)
     |         Check: is_duplicate? If True, already stored -- skip
     |
     +-- CORRECTION to existing fact?
     |      -> recall(query="...") to find memoryId
     |      -> update(memory_id=..., content=..., memory_type=...)
     |
     +-- FACT no longer valid?
            -> recall(query="...") to find memoryId
            -> forget(memory_id=...)
```

---

## Why the agent owns the decision of what is durable

Kairo stores what it is told to store. The agent (or the developer who
writes the agent) is responsible for:

- Recognising that a user statement expresses a preference, goal, or fact.
- Deciding whether that information should be persisted.
- Deciding when to recall context.
- Constructing the LLM prompt that incorporates recalled memories.

Kairo does not read the conversation. Kairo does not decide what is
worth remembering. Kairo does not call the LLM.

---

## Why Kairo owns persistence / retrieval / deduplication

The agent should never implement its own:

- Content hashing for duplicate detection
- Embedding vectors or cosine similarity
- Memory storage tables
- Tenant filtering
- Version archiving

All of these are owned by the Kairo backend. Agents that reimplement
these responsibilities will diverge from Kairo's authoritative state
and introduce bugs.

---

## Why developers must not parse `duplicate_reason`

The `duplicate_reason` field is a human-readable string intended for
developer diagnostics. It may embed the existing memory ID in prose
form (`"...existing memory 42 (similarity: 0.9972)."`), but this
format is an implementation detail that may change.

**Use `recall()` instead:**

```python
result = memory.remember(content="...", memory_type="Preference")
if result.is_duplicate:
    # locate the existing memory safely:
    context = memory.recall(query="...", top_k=3)
    target = context.memories[0]  # or filter by type/content
```

---

## Why zero-result recall is not an error

A new user has no memories. An existing user may simply have no relevant
memories for a given query. Both are valid states.

```python
res = memory.recall(query="...", top_k=5)
if res.count == 0:
    # no historical context available -- that's fine
    prompt = base_system_prompt
else:
    context_block = "\n".join(m.content for m in res.memories)
    prompt = f"{base_system_prompt}\n\nKnown context:\n{context_block}"
```

---

## Why `update` requires an explicit `memoryId`

Kairo has no "update by query" endpoint. This is intentional: it forces
the agent to identify precisely which memory it is correcting before
issuing a mutation. This prevents accidental updates to the wrong record.

The correct pattern is always: `recall` → identify → `update`.

---

## Why ambiguous retrieval must not cause blind mutation

Cosine similarity measures semantic proximity, not semantic correctness
for a specific update intent. When two memories have similar similarity
scores, picking the highest does not guarantee it is the one the user
intended to correct.

Safe patterns:
- Filter by `memory_type` first.
- Filter by content keywords second.
- Only mutate when a single, clearly matching candidate remains.
- If ambiguity persists, ask the user for clarification.

---

## Why framework-specific dependencies are absent

Kairo is framework-neutral. This reference agent uses only:

- The Kairo Python SDK (`kairo.agent`, `kairo.client`)
- Python standard library

No LangChain, Semantic Kernel, AutoGen, CrewAI, OpenAI SDK, or Anthropic
SDK is required. Any agent runtime that can make HTTP requests can
integrate with Kairo. Framework choice remains entirely with the developer.

---

## Scenario isolation

All test memories use the content prefix:

    Kairo Reference Agent Step11: ...

The reference agent never modifies or deletes memories that do not carry
this prefix. At the end of each run, all Step11 memories that were
successfully created are soft-deleted via `forget()`. If cleanup fails
for any memory, the `memory_id` is reported so you can deactivate it
manually.

---

## Running in CI

```bash
export KAIRO_API_KEY=$KAIRO_API_KEY_CI
export KAIRO_BASE_URL=https://kairo.staging.example.com
cd scratch/KairoReferenceAgent
python agent.py
echo "Exit code: $?"
```

Exit code 0 = all mandatory scenarios passed (INFO results do not count
as failures). Exit code 1 = one or more FAIL. Exit code 2 = missing
`KAIRO_API_KEY`.
