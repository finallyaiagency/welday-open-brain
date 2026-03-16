
const models = [
    "gemini-2.0-flash-lite",
    "gemini-2.0-flash",
    "gemini-1.5-flash",
    "gemini-3.1-flash-lite-preview"
];

const keys = [
    process.env.GEMINI_API_KEY,
    process.env.GEMINI_API_KEY_2,
    process.env.GEMINI_API_KEY_3
].filter(Boolean);

async function fetchWithTimeout(url, options = {}, timeout = 10000) {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeout);
    id.unref?.();
    try {
        const response = await fetch(url, { ...options, signal: controller.signal });
        clearTimeout(id);
        return response;
    } catch (err) {
        clearTimeout(id);
        if (err.name === 'AbortError') {
            throw new Error(`Request timed out after ${timeout}ms`);
        }
        throw err;
    }
}

async function testModel(model, key, keyName) {
    console.log(`[${keyName}] Testing ${model}...`);
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
    try {
        const resp = await fetchWithTimeout(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                contents: [{ role: "user", parts: [{ text: "hi" }] }]
            })
        }, 10000); // 10s timeout per test
        const status = resp.status;
        console.log(`[${keyName}] ${model}: Status ${status}`);
    } catch (e) {
        const cause = e?.cause?.message ? ` | cause: ${e.cause.message}` : "";
        console.log(`[${keyName}] ${model}: Error: ${e.message}${cause}`);
    }
}

async function runTests() {
    console.log("Starting runTests...");
    if (keys.length === 0) {
        console.error("No API keys found. Make sure you've populated the .env file and are running with --env-file=.env");
        return;
    }

    console.log(`Testing ${models.length} models with ${keys.length} keys...\n`);

    for (let i = 0; i < keys.length; i++) {
        const keyName = `KEY_${i + 1}`;
        for (const model of models) {
            await testModel(model, keys[i], keyName);
        }
    }
}

async function main() {
    try {
        await runTests();
        process.exitCode = 0;
    } catch (err) {
        console.error("Fatal error:", err?.stack || err?.message || err);
        process.exitCode = 1;
    } finally {
        // Force the script to terminate even if the runtime keeps network handles open.
        process.exit(process.exitCode ?? 0);
    }
}

await main();
