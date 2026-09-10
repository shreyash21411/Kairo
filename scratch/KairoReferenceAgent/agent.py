"""
Kairo Reference Agent - Step 11B
=================================

Deterministic reference integration demonstrating how an external AI agent
uses Kairo as its persistent memory layer.

This is NOT a production agent.
This is NOT an LLM application.
This is NOT an agent framework.

It is a developer reference implementation showing the correct patterns.

Architecture
------------

    Reference Agent (this file)
          |
    KairoAgentMemory          (kairo.agent -- thin facade)
          |
    Kairo Python SDK          (kairo.memories / kairo.client)
          |
    Kairo REST API            (http://localhost:5171 by default)
          |
    Memory Engine / Embeddings / Database

Kairo owns: persistence, deduplication, embeddings, retrieval,
versioning, tenant isolation, authentication.

The agent owns: deciding what to store/recall, prompt construction,
candidate selection.

Usage
-----
    export KAIRO_API_KEY=kairo_live_...
    python agent.py

    # optional override
    export KAIRO_BASE_URL=http://localhost:5171
"""

from __future__ import annotations

import os
import sys
import textwrap
import traceback
from dataclasses import dataclass, field
from typing import Optional

_SDK_SRC = os.path.normpath(
    os.path.join(os.path.dirname(__file__), "..", "..", "sdks", "python", "src")
)
if _SDK_SRC not in sys.path:
    sys.path.insert(0, _SDK_SRC)

from kairo import Kairo, KairoNotFoundError  # noqa: E402
from kairo.agent import KairoAgentMemory      # noqa: E402

STEP11_PREFIX    = "Kairo Reference Agent Step11:"
SCENARIO_A_CONTENT = f"{STEP11_PREFIX} user prefers C# for backend development."
SCENARIO_C_UPDATED = f"{STEP11_PREFIX} user prefers Go for backend development (migrated from C#)."
SCENARIO_E_CONTENT = f"{STEP11_PREFIX} exact-dup test -- user likes monospace fonts."
SCENARIO_F_FIRST   = f"{STEP11_PREFIX} The user prefers dark UI themes."
SCENARIO_F_SECOND  = f"{STEP11_PREFIX} The user likes dark mode interfaces."
SCENARIO_I_LANG_A  = f"{STEP11_PREFIX} ambiguity test -- user writes Python daily."
SCENARIO_I_LANG_B  = f"{STEP11_PREFIX} ambiguity test -- user writes TypeScript daily."

PASS = "PASS"
FAIL = "FAIL"
INFO = "INFO"


@dataclass
class ScenarioResult:
    name: str
    status: str = PASS
    detail: str = ""
    exception: Optional[str] = None


@dataclass
class AgentRunSummary:
    results: list = field(default_factory=list)
    created_ids: list = field(default_factory=list)
    cleaned_ids: list = field(default_factory=list)
    failed_cleanup_ids: list = field(default_factory=list)

    def record(self, result: ScenarioResult) -> None:
        self.results.append(result)

    def track_created(self, memory_id: int) -> None:
        self.created_ids.append(memory_id)


def _banner(text: str, width: int = 60) -> str:
    return f"\n{'=' * width}\n{text}\n{'=' * width}"

def _ok(label: str)   -> None: print(f"    v  {label}")
def _info(label: str) -> None: print(f"    i  {label}")
def _fail(label: str) -> None: print(f"    X  {label}")


# ---------------------------------------------------------------------------
# Scenario A -- Remember
# ---------------------------------------------------------------------------

def scenario_a_remember(memory: KairoAgentMemory, run: AgentRunSummary) -> Optional[int]:
    """
    Simulated user input    : 'I prefer C# for backend work.'
    Simulated agent decision: durable preference -> store it.
    Kairo operation         : remember(content, memory_type)
    Returns the created memoryId, or None on failure.
    """
    print(_banner("Scenario A -- Remember"))
    result = ScenarioResult(name="Scenario A -- Remember")
    memory_id: Optional[int] = None
    try:
        _info("Simulated user message: 'I prefer C# for backend work.'")
        _info("Agent decides: durable preference -> call remember().")
        res = memory.remember(content=SCENARIO_A_CONTENT, memory_type="Preference")
        if res.is_duplicate:
            result.status = FAIL
            result.detail = ("Unexpected duplicate detected. Re-run after cleaning up "
                             "previous Step11 test data.")
            _fail(result.detail)
            run.record(result)
            return None
        assert res.memory is not None,                      "memory must not be None when is_duplicate=False"
        assert isinstance(res.memory.memory_id, int),       "memory_id must be an integer"
        assert res.memory.content == SCENARIO_A_CONTENT
        assert res.memory.memory_type == "Preference"
        assert res.memory.is_active is True
        memory_id = res.memory.memory_id
        run.track_created(memory_id)
        _ok(f"remember() succeeded  ->  memory_id={memory_id}")
        _ok("is_duplicate == False")
        _ok(f"content: {SCENARIO_A_CONTENT[:60]}...")
        _ok("memory_type: Preference")
        _ok("is_active: True")
        result.detail = f"memory_id={memory_id}"
    except Exception as exc:
        result.status = FAIL
        result.exception = traceback.format_exc()
        result.detail = str(exc)
        _fail(f"Exception: {exc}")
    run.record(result)
    return memory_id


# ---------------------------------------------------------------------------
# Scenario B -- Recall
# ---------------------------------------------------------------------------

def scenario_b_recall(memory: KairoAgentMemory, run: AgentRunSummary,
                       created_id: Optional[int]) -> None:
    """
    Simulated user input    : 'What language do I prefer for backend?'
    Simulated agent decision: recall context before responding.
    Kairo operation         : recall(query, top_k)
    Does NOT assume a fixed similarity score.
    """
    print(_banner("Scenario B -- Recall"))
    result = ScenarioResult(name="Scenario B -- Recall")
    try:
        _info("Simulated user message: 'What language do I prefer for backend?'")
        _info("Agent decides: recall before responding.")
        res = memory.recall(query="backend programming language preference", top_k=10)
        assert isinstance(res.count, int)
        assert isinstance(res.memories, list)
        assert res.count == len(res.memories)
        _ok(f"recall() succeeded  ->  {res.count} memories returned")
        if created_id is not None:
            matching = [m for m in res.memories if m.memory_id == created_id]
            assert len(matching) == 1, \
                f"Expected Step11 memory_id={created_id} in recall results, not found."
            m = matching[0]
            assert isinstance(m.similarity, float)
            assert 0.0 <= m.similarity <= 1.0
            assert m.memory_id is not None
            _ok(f"Step11 memory found  ->  memory_id={m.memory_id}, similarity={m.similarity:.4f}")
            _ok("memoryId present in result -- agent can use it for update/forget")
        else:
            _info("Scenario A failed; skipping memory_id presence assertion.")
        result.detail = f"count={res.count}"
    except Exception as exc:
        result.status = FAIL
        result.exception = traceback.format_exc()
        result.detail = str(exc)
        _fail(f"Exception: {exc}")
    run.record(result)


# ---------------------------------------------------------------------------
# Scenario C -- Update
# ---------------------------------------------------------------------------

def scenario_c_update(memory: KairoAgentMemory, run: AgentRunSummary,
                       created_id: Optional[int]) -> Optional[int]:
    """
    Simulated user input    : 'I moved to Go. Update my backend preference.'
    Simulated agent decision:
        1. Recall current backend preference.
        2. Identify correct memory by content + memoryType.
        3. Call update() -- never hardcode the memoryId.
    Kairo operation: recall() -> update(memoryId, ...)
    Returns the same memoryId after update, or None on failure.
    """
    print(_banner("Scenario C -- Update"))
    result = ScenarioResult(name="Scenario C -- Update")
    updated_id: Optional[int] = None
    try:
        _info("Simulated user message: 'I moved to Go. Update my backend preference.'")
        _info("Agent: recall first to find existing memory -- never hardcode ID.")
        recall_res = memory.recall(query="backend programming language preference", top_k=10)
        _ok(f"Recall returned {recall_res.count} memories")
        candidates = [m for m in recall_res.memories
                      if m.memory_type == "Preference" and STEP11_PREFIX in m.content]
        if not candidates:
            result.status = FAIL
            result.detail = "No Step11 Preference memory found in recall; cannot update."
            _fail(result.detail)
            run.record(result)
            return None
        if created_id is not None:
            exact = [c for c in candidates if c.memory_id == created_id]
            target = exact[0] if exact else max(candidates, key=lambda m: m.similarity)
        else:
            target = max(candidates, key=lambda m: m.similarity)
        _ok(f"Target identified  ->  memory_id={target.memory_id}, similarity={target.similarity:.4f}")
        updated = memory.update(memory_id=target.memory_id,
                                content=SCENARIO_C_UPDATED,
                                memory_type="Preference")
        assert updated.memory_id == target.memory_id, \
            f"memory_id must be preserved: expected {target.memory_id}, got {updated.memory_id}"
        assert "Go" in updated.content
        assert updated.memory_type == "Preference"
        assert updated.is_active is True
        updated_id = updated.memory_id
        _ok(f"update() succeeded  ->  memory_id={updated_id} preserved")
        _ok(f"New content: {SCENARIO_C_UPDATED[:70]}...")
        _ok("memory_type: Preference (unchanged)")
        result.detail = f"memory_id={updated_id}"
    except Exception as exc:
        result.status = FAIL
        result.exception = traceback.format_exc()
        result.detail = str(exc)
        _fail(f"Exception: {exc}")
    run.record(result)
    return updated_id


# ---------------------------------------------------------------------------
# Scenario D -- Forget
# ---------------------------------------------------------------------------

def scenario_d_forget(memory: KairoAgentMemory, run: AgentRunSummary,
                       target_id: Optional[int]) -> None:
    """
    Simulated user input    : 'Remove my backend language preference.'
    Kairo operation         : forget(memoryId) -> recall() to verify absence.

    Important: the post-forget recall may still return OTHER memories.
    Only the target memoryId is asserted absent -- not the entire result set.
    """
    print(_banner("Scenario D -- Forget"))
    result = ScenarioResult(name="Scenario D -- Forget")
    try:
        _info("Simulated user message: 'Remove my backend language preference.'")
        if target_id is None:
            recall_res = memory.recall(query="Go backend development preference", top_k=10)
            candidates = [m for m in recall_res.memories
                          if m.memory_type == "Preference" and STEP11_PREFIX in m.content]
            if not candidates:
                result.status = FAIL
                result.detail = "Cannot find Step11 memory to forget."
                _fail(result.detail)
                run.record(result)
                return
            target_id = max(candidates, key=lambda m: m.similarity).memory_id
            _info(f"Located target via recall fallback  ->  memory_id={target_id}")
        else:
            _ok(f"Using memory_id={target_id} from Scenario C")
        forget_res = memory.forget(memory_id=target_id)
        assert forget_res.memory_id == target_id, \
            f"forget result mismatch: expected {target_id}, got {forget_res.memory_id}"
        _ok(f"forget() succeeded  ->  memory_id={forget_res.memory_id}")
        _ok(f"Message: {forget_res.message}")
        _info("Recalling again to verify memory is absent...")
        recheck = memory.recall(query="backend programming language preference", top_k=20)
        still_present = [m for m in recheck.memories if m.memory_id == target_id]
        assert len(still_present) == 0, \
            f"Forgotten memory_id={target_id} still appears in recall results."
        _ok(f"memory_id={target_id} is absent from recall results (soft-deleted)")
        _ok(f"Total recall results: {recheck.count} (other memories may exist -- expected)")
        result.detail = f"forgotten memory_id={target_id}"
    except Exception as exc:
        result.status = FAIL
        result.exception = traceback.format_exc()
        result.detail = str(exc)
        _fail(f"Exception: {exc}")
    run.record(result)


# ---------------------------------------------------------------------------
# Scenario E -- Exact Duplicate
# ---------------------------------------------------------------------------

def scenario_e_exact_duplicate(memory: KairoAgentMemory,
                                 run: AgentRunSummary) -> Optional[int]:
    """
    Demonstrates that Kairo blocks exact-duplicate storage.
    The agent checks is_duplicate and does NOT parse duplicate_reason.
    Returns the original memoryId for cleanup.
    """
    print(_banner("Scenario E -- Exact Duplicate"))
    result = ScenarioResult(name="Scenario E -- Exact Duplicate")
    original_id: Optional[int] = None
    try:
        _info(f"Content: '{SCENARIO_E_CONTENT}'")
        _info("Step 1: Storing original memory...")
        r1 = memory.remember(content=SCENARIO_E_CONTENT, memory_type="Preference")
        if r1.is_duplicate:
            result.status = FAIL
            result.detail = ("First remember() returned is_duplicate=True unexpectedly. "
                             "Re-run after cleaning up prior Step11 test data.")
            _fail(result.detail)
            run.record(result)
            return None
        assert r1.memory is not None
        original_id = r1.memory.memory_id
        run.track_created(original_id)
        _ok(f"First remember() succeeded  ->  memory_id={original_id}")
        _info("Step 2: Sending identical content again...")
        r2 = memory.remember(content=SCENARIO_E_CONTENT, memory_type="Preference")
        assert r2.is_duplicate is True, \
            (f"Expected is_duplicate=True for exact duplicate, got False. "
             f"New memory_id={r2.memory.memory_id if r2.memory else 'N/A'}")
        assert r2.memory is None,              "memory must be None when is_duplicate=True"
        assert r2.duplicate_reason is not None, "duplicate_reason must be present"
        _ok("Second remember() blocked  ->  is_duplicate=True")
        _ok("memory is None  (no new record created)")
        _ok(f"duplicate_reason: {r2.duplicate_reason}")
        # IMPORTANT: do NOT parse duplicate_reason to extract a memoryId.
        # Use recall() to locate the existing memory when the ID is needed.
        _info("Correct pattern: use recall() -- not duplicate_reason -- to find existing memory_id.")
        result.detail = f"original memory_id={original_id}; duplicate correctly blocked"
    except Exception as exc:
        result.status = FAIL
        result.exception = traceback.format_exc()
        result.detail = str(exc)
        _fail(f"Exception: {exc}")
    run.record(result)
    return original_id


# ---------------------------------------------------------------------------
# Scenario F -- Semantic Duplicate
# ---------------------------------------------------------------------------

def scenario_f_semantic_duplicate(memory: KairoAgentMemory,
                                    run: AgentRunSummary) -> list:
    """
    Demonstrates Kairo's semantic duplicate detection.
    Whether the second phrase triggers deduplication depends on the
    embedding model and the configured threshold.
    - Detected   -> PASS
    - Not detected -> INFO (not a Kairo defect; not all phrasings exceed threshold)
    Returns a list of memoryIds created for cleanup.
    """
    print(_banner("Scenario F -- Semantic Duplicate"))
    result = ScenarioResult(name="Scenario F -- Semantic Dup")
    created = []
    try:
        _info(f"First phrase : '{SCENARIO_F_FIRST}'")
        _info(f"Second phrase: '{SCENARIO_F_SECOND}'")
        r1 = memory.remember(content=SCENARIO_F_FIRST, memory_type="Preference")
        if r1.is_duplicate:
            result.status = INFO
            result.detail = "First phrase already exists from a prior run. Re-run after cleanup."
            _info(result.detail)
            run.record(result)
            return created
        assert r1.memory is not None
        created.append(r1.memory.memory_id)
        run.track_created(r1.memory.memory_id)
        _ok(f"First remember() succeeded  ->  memory_id={r1.memory.memory_id}")
        r2 = memory.remember(content=SCENARIO_F_SECOND, memory_type="Preference")
        if r2.is_duplicate:
            assert r2.memory is None
            assert r2.duplicate_reason is not None
            _ok("Semantic duplicate detected  ->  is_duplicate=True")
            _ok("memory is None  (no new record created)")
            _ok(f"duplicate_reason: {r2.duplicate_reason}")
            _info("Correct pattern: use recall() -- not duplicate_reason -- to find existing memory.")
            # Demonstrate the recommended recall pattern.
            context = memory.recall(query="dark mode UI preference", top_k=5)
            dark_memories = [m for m in context.memories
                             if STEP11_PREFIX in m.content and "dark" in m.content.lower()]
            assert len(dark_memories) >= 1, \
                "At least one dark-mode preference memory should appear after storing the first."
            _ok(f"Recall pattern confirmed: {len(dark_memories)} dark-mode preference(s) "
                "found via recall() after duplicate response.")
            result.status = PASS
            result.detail = "Semantic duplicate detected and recalled correctly"
        else:
            assert r2.memory is not None
            created.append(r2.memory.memory_id)
            run.track_created(r2.memory.memory_id)
            _info(f"Semantic duplicate NOT triggered for this phrase pair. "
                  f"Second memory stored  ->  memory_id={r2.memory.memory_id}")
            _info("This is expected: different phrasings may not exceed the "
                  "configured semantic similarity threshold.")
            _info("Kairo's deduplication logic is unchanged. This is not a failure.")
            result.status = INFO
            result.detail = (f"Semantic duplicate not triggered; "
                             f"second memory created (memory_id={r2.memory.memory_id})")
    except Exception as exc:
        result.status = FAIL
        result.exception = traceback.format_exc()
        result.detail = str(exc)
        _fail(f"Exception: {exc}")
    run.record(result)
    return created


# ---------------------------------------------------------------------------
# Scenario G -- Zero Result Recall
# ---------------------------------------------------------------------------

def scenario_g_zero_recall(memory: KairoAgentMemory, run: AgentRunSummary) -> None:
    """
    Uses an intentionally unrelated query.
    Expected: count == 0, memories == [].
    The agent treats zero results as normal behavior -- not an error.
    """
    print(_banner("Scenario G -- Zero Result Recall"))
    result = ScenarioResult(name="Scenario G -- Zero Recall")
    try:
        query = "User's preference for interstellar wormhole cuisine"
        _info(f"Query: '{query}'")
        _info("Agent expects zero results and treats that as normal behavior.")
        res = memory.recall(query=query, top_k=5)
        assert res.count == 0, \
            f"Expected count=0 for unrelated query, got count={res.count}."
        assert res.memories == [], \
            f"Expected empty memories list, got: {res.memories}"
        _ok("recall() succeeded  ->  count=0")
        _ok("memories == []")
        _ok("Agent proceeds without historical context -- no exception raised")
        result.detail = "count=0; handled as normal empty result"
    except Exception as exc:
        result.status = FAIL
        result.exception = traceback.format_exc()
        result.detail = str(exc)
        _fail(f"Exception: {exc}")
    run.record(result)


# ---------------------------------------------------------------------------
# Scenario H -- Error Contract
# ---------------------------------------------------------------------------

def scenario_h_error_contract(memory: KairoAgentMemory, run: AgentRunSummary) -> None:
    """
    Verifies that update() and forget() on a nonexistent memoryId raise
    KairoNotFoundError specifically -- not a broad Exception.
    Agents must catch specific exception types.
    """
    print(_banner("Scenario H -- Error Contract"))
    result = ScenarioResult(name="Scenario H -- Error Contract")
    phantom_id = 999_999_999
    try:
        _info(f"Using phantom memoryId={phantom_id}")
        # Test 1: update on nonexistent ID.
        _info("Step 1: update() on nonexistent memory...")
        update_raised = False
        try:
            memory.update(memory_id=phantom_id,
                          content="This should never be stored.",
                          memory_type="Fact")
        except KairoNotFoundError as nfe:
            update_raised = True
            _ok(f"update() raised KairoNotFoundError as expected: {nfe}")
        except Exception as unexpected:
            result.status = FAIL
            result.detail = (f"update() raised wrong exception type: "
                             f"{type(unexpected).__name__}: {unexpected}")
            _fail(result.detail)
            run.record(result)
            return
        assert update_raised, "update() must raise KairoNotFoundError for nonexistent memoryId"
        # Test 2: forget on nonexistent ID.
        _info("Step 2: forget() on nonexistent memory...")
        forget_raised = False
        try:
            memory.forget(memory_id=phantom_id)
        except KairoNotFoundError as nfe:
            forget_raised = True
            _ok(f"forget() raised KairoNotFoundError as expected: {nfe}")
        except Exception as unexpected:
            result.status = FAIL
            result.detail = (f"forget() raised wrong exception type: "
                             f"{type(unexpected).__name__}: {unexpected}")
            _fail(result.detail)
            run.record(result)
            return
        assert forget_raised, "forget() must raise KairoNotFoundError for nonexistent memoryId"
        _ok("Both update() and forget() correctly raise KairoNotFoundError")
        _ok("Agent must catch specific exception types -- not bare Exception")
        result.detail = "KairoNotFoundError raised for both update and forget on phantom ID"
    except Exception as exc:
        result.status = FAIL
        result.exception = traceback.format_exc()
        result.detail = str(exc)
        _fail(f"Exception: {exc}")
    run.record(result)


# ---------------------------------------------------------------------------
# Scenario I -- Ambiguous Recall
# ---------------------------------------------------------------------------

def scenario_i_ambiguous_recall(memory: KairoAgentMemory,
                                  run: AgentRunSummary) -> list:
    """
    Demonstrates safe agent behavior when multiple plausible memories are returned.

    Never blindly equates highest similarity with guaranteed correctness.
    Three cases handled explicitly:
      Case 1: No candidates       -> do NOT mutate.
      Case 2: One clear candidate -> may select it.
      Case 3: Multiple candidates -> apply content filters; if still ambiguous,
              do NOT mutate.

    Creates two distinct test memories through Kairo. No IDs hardcoded.
    Returns a list of memoryIds created for cleanup.
    """
    print(_banner("Scenario I -- Ambiguous Recall"))
    result = ScenarioResult(name="Scenario I -- Ambiguity")
    created = []
    try:
        _info("Creating two distinct Step11 Preference memories...")
        r1 = memory.remember(content=SCENARIO_I_LANG_A, memory_type="Preference")
        if not r1.is_duplicate:
            assert r1.memory is not None
            created.append(r1.memory.memory_id)
            run.track_created(r1.memory.memory_id)
            _ok(f"Memory A created  ->  memory_id={r1.memory.memory_id}")
        else:
            _info("Memory A already existed (prior run). Proceeding.")
        r2 = memory.remember(content=SCENARIO_I_LANG_B, memory_type="Preference")
        if not r2.is_duplicate:
            assert r2.memory is not None
            created.append(r2.memory.memory_id)
            run.track_created(r2.memory.memory_id)
            _ok(f"Memory B created  ->  memory_id={r2.memory.memory_id}")
        else:
            _info("Memory B already existed (prior run). Proceeding.")
        _info("Recalling: 'daily programming language'...")
        res = memory.recall(query="daily programming language", top_k=10)
        _ok(f"Recall returned {res.count} total memories")
        step11_candidates = [m for m in res.memories
                             if STEP11_PREFIX in m.content and m.memory_type == "Preference"]
        _info(f"Step11 Preference candidates: {len(step11_candidates)}")
        if len(step11_candidates) == 0:
            _ok("Case 1: No relevant candidates found.")
            _ok("Agent decision: do NOT attempt update -- no safe target.")
            result.detail = "Case 1 demonstrated: no candidates, no mutation"
        elif len(step11_candidates) == 1:
            target = step11_candidates[0]
            _ok(f"Case 2: One candidate  ->  memory_id={target.memory_id}, similarity={target.similarity:.4f}")
            _ok("Agent decision: single candidate -- may safely select.")
            _ok("(Demonstrating selection logic only -- no mutation performed.)")
            result.detail = f"Case 2 demonstrated: one candidate (memory_id={target.memory_id})"
        else:
            _info(f"Case 3: {len(step11_candidates)} candidates -- applying content-based disambiguation.")
            for m in step11_candidates:
                _info(f"  memory_id={m.memory_id}, similarity={m.similarity:.4f}, content=...{m.content[-40:]}")
            python_candidates = [m for m in step11_candidates if "Python"     in m.content]
            ts_candidates     = [m for m in step11_candidates if "TypeScript" in m.content]
            if len(python_candidates) == 1:
                _ok(f"Disambiguated to Python memory  ->  memory_id={python_candidates[0].memory_id}")
                _ok("Agent decision: content signal sufficient -- can safely select.")
            elif len(ts_candidates) == 1:
                _ok(f"Disambiguated to TypeScript memory  ->  memory_id={ts_candidates[0].memory_id}")
                _ok("Agent decision: content signal sufficient -- can safely select.")
            else:
                _ok("After filtering, candidates remain ambiguous.")
                _ok("Agent decision: do NOT mutate blindly.")
                _ok("Safe behavior: request clarification or skip mutation.")
            result.detail = (f"Case 3 demonstrated: {len(step11_candidates)} candidates; "
                             "disambiguation logic applied")
        _ok("Scenario I demonstrates safe agent behavior under ambiguous recall.")
    except Exception as exc:
        result.status = FAIL
        result.exception = traceback.format_exc()
        result.detail = str(exc)
        _fail(f"Exception: {exc}")
    run.record(result)
    return created


# ---------------------------------------------------------------------------
# Cleanup
# ---------------------------------------------------------------------------

def cleanup(memory: KairoAgentMemory, run: AgentRunSummary) -> None:
    """
    Soft-delete all Step11 memories created during this run.
    Partial cleanup is acceptable -- leaked IDs are reported.
    """
    print(_banner("Cleanup -- deactivating Step11 test memories"))
    if not run.created_ids:
        _info("No Step11 memories to clean up.")
        return
    _info(f"Memories to deactivate: {run.created_ids}")
    for mid in run.created_ids:
        try:
            memory.forget(memory_id=mid)
            run.cleaned_ids.append(mid)
            _ok(f"Deactivated memory_id={mid}")
        except KairoNotFoundError:
            # Already deactivated by a test scenario (e.g., Scenario D).
            run.cleaned_ids.append(mid)
            _ok(f"memory_id={mid} already inactive (cleaned by test scenario)")
        except Exception as exc:
            run.failed_cleanup_ids.append(mid)
            _fail(f"Failed to deactivate memory_id={mid}: {exc}")


# ---------------------------------------------------------------------------
# Final report
# ---------------------------------------------------------------------------

def print_report(run: AgentRunSummary) -> int:
    """Print the structured final report. Returns exit code 0=pass, 1=any fail."""
    W = 60
    print("\n" + "=" * W)
    print("KAIRO REFERENCE AGENT -- STEP 11B")
    print("=" * W)
    passed = failed = info_count = 0
    for r in run.results:
        icon  = "v" if r.status == PASS else ("i" if r.status == INFO else "X")
        label = f"{r.name:<34} {r.status}"
        print(f"  {icon}  {label}")
        if r.detail:
            print(f"       {r.detail}")
        if r.status == PASS:
            passed += 1
        elif r.status == FAIL:
            failed += 1
            if r.exception:
                print(textwrap.indent(r.exception, "       "))
        else:
            info_count += 1
    print()
    print("-" * W)
    print("Summary")
    print("-" * W)
    print(f"  Passed : {passed}")
    print(f"  Failed : {failed}")
    print(f"  Info   : {info_count}")
    print()
    print("-" * W)
    print("Step11 memory lifecycle")
    print("-" * W)
    print(f"  Created  : {run.created_ids}")
    print(f"  Cleaned  : {run.cleaned_ids}")
    if run.failed_cleanup_ids:
        print(f"  Leaked   : {run.failed_cleanup_ids}  <- still active; deactivate manually")
    print()
    print("-" * W)
    print("Notes")
    print("-" * W)
    print("  * No API keys were printed.")
    print("  * Only Step11-prefixed memories were touched.")
    print("  * Kairo owns: persistence, deduplication, embeddings,")
    print("    retrieval, versioning, tenant isolation, authentication.")
    print("  * The agent owns: what to store, when to recall,")
    print("    which candidate to select, prompt construction.")
    print("=" * W)
    return 0 if failed == 0 else 1


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main() -> int:
    api_key = os.environ.get("KAIRO_API_KEY", "")
    if not api_key:
        print(
            "ERROR: KAIRO_API_KEY environment variable is not set.\n"
            "Export your Kairo API key before running:\n\n"
            "    export KAIRO_API_KEY=kairo_live_...\n",
            file=sys.stderr,
        )
        return 2

    base_url = os.environ.get("KAIRO_BASE_URL", "http://localhost:5171")

    print(_banner("KAIRO REFERENCE AGENT -- STEP 11B", width=60))
    print(f"  Kairo API : {base_url}")
    print(f"  API key   : {'*' * 8}  (hidden)")
    print()

    kairo_client = Kairo(api_key=api_key, base_url=base_url)
    memory = KairoAgentMemory(kairo_client)
    run    = AgentRunSummary()

    scenario_a_id = scenario_a_remember(memory, run)
    scenario_b_recall(memory, run, created_id=scenario_a_id)
    scenario_c_id = scenario_c_update(memory, run, created_id=scenario_a_id)
    scenario_d_forget(memory, run, target_id=scenario_c_id)
    scenario_e_exact_duplicate(memory, run)
    scenario_f_semantic_duplicate(memory, run)
    scenario_g_zero_recall(memory, run)
    scenario_h_error_contract(memory, run)
    scenario_i_ambiguous_recall(memory, run)
    cleanup(memory, run)
    return print_report(run)


if __name__ == "__main__":
    sys.exit(main())
