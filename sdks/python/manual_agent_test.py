import os

from kairo import Kairo
from kairo.agent import KairoAgentMemory

kairo = Kairo(
    api_key=os.environ["KAIRO_API_KEY"],
    base_url="http://localhost:5171"
)

memory = KairoAgentMemory(kairo)

print("Agent Memory:", repr(memory))
print("remember:", callable(memory.remember))
print("recall:", callable(memory.recall))
print("update:", callable(memory.update))
print("forget:", callable(memory.forget))

assert callable(memory.remember)
assert callable(memory.recall)
assert callable(memory.update)
assert callable(memory.forget)

print("PASS - Python agent memory initialized correctly.")

print("\n========== TEST 2: PYTHON REMEMBER ==========")

result = memory.remember(
    content="User prefers concise technical explanations from AI agents.",
    memory_type="Preference"
)

print("Is duplicate:", result.is_duplicate)
print("Duplicate reason:", result.duplicate_reason)
print("Memory:", result.memory)

if result.is_duplicate:
    print("NOTE - Memory already exists.")
else:
    print("PASS - Python agent remember() stored memory.")

if result.memory:
    memory_id = result.memory.memory_id
    print("Memory ID:", memory_id)
else:
    memory_id = None

print("\n========== TEST 3: PYTHON RECALL ==========")

result = memory.recall(
    query="What does the user prefer about AI responses?",
    top_k=5
)

print("Query:", result.query)
print("Count:", result.count)

for item in result.memories:
    print(
        f"ID: {item.memory_id} | "
        f"Similarity: {item.similarity:.4f} | "
        f"Type: {item.memory_type}"
    )
    print("Content:", item.content)

if result.count == len(result.memories):
    print("PASS - Python agent recall() returned valid response.")
else:
    print("FAIL - Recall count does not match result collection.")
print("\n========== TEST 4: PYTHON UPDATE ==========")

if memory_id is None:
    print("SKIPPED - Test 2 did not create a new memory.")
else:

    updated = memory.update(
        memory_id=memory_id,
        content="User strongly prefers concise and structured technical explanations from AI agents.",
        memory_type="Preference"
    )

    print("Memory ID:", updated.memory_id)
    print("Content:", updated.content)
    print("Type:", updated.memory_type)
    print("Active:", updated.is_active)

    if (
        updated.memory_id == memory_id
        and updated.content ==
            "User strongly prefers concise and structured technical explanations from AI agents."
        and updated.memory_type == "Preference"
        and updated.is_active is True
    ):
        print("PASS - Python agent update() worked correctly.")
    else:
        print("FAIL - Python agent update() returned unexpected data.")