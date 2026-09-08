const { Kairo } = require("./dist/index.js");
const { KairoAgentMemory } = require("./dist/agent.js");

const kairo = new Kairo({
    apiKey: process.env.KAIRO_API_KEY,
    baseUrl: "http://localhost:5171"
});

const memory = new KairoAgentMemory(kairo);

async function test() {

    console.log("\n========== TEST 17 RETRY: NODE → PYTHON INTEROPERABILITY ==========");

    const result = await memory.remember({
        content: "Node interoperability unique test 2026: user prefers backend systems to have clear modular architecture.",
        memoryType: "Context"
    });

    console.log("Full result:");
    console.dir(result, { depth: null });

    console.log("\nIs Duplicate:", result.isDuplicate);
    console.log("Duplicate Reason:", result.duplicateReason);
    console.log("Memory:", result.memory);

    if (result.isDuplicate) {
        console.log("\n⚠️ RESULT WAS TREATED AS DUPLICATE.");
        console.log("This explains why memory may be null.");
        return;
    }

    if (result.memory === null) {
        console.log("\nFAIL - Node agent returned null memory for a non-duplicate.");
        return;
    }

    console.log("\nMemory ID:", result.memory.memoryId);
    console.log("Content:", result.memory.content);
    console.log("Type:", result.memory.memoryType);
    console.log("Active:", result.memory.isActive);

    assert(result.memory.content ===
        "Node interoperability unique test 2026: user prefers backend systems to have clear modular architecture."
    );

    assert(result.memory.memoryType === "Context");
    assert(result.memory.isActive === true);

    console.log("\nPASS - Node agent created shared backend memory.");
    console.log("SAVE THIS MEMORY ID:", result.memory.memoryId);
}

test().catch(error => {
    console.error("\nTEST FAILED");
    console.error("Error Type:", error.constructor.name);
    console.error("Message:", error.message);
});