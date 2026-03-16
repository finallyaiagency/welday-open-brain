
const priorityModels = [
    "gemini-3.1-pro-preview",
    "gemini-2.5-pro",
    "gemini-3-flash-preview",
    "gemini-2.5-flash",
    "gemini-3.1-flash-lite-preview",
    "gemini-2.5-flash-lite"
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
    process.stdout.write(`[${keyName}] Trying ${model}... `);
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
    try {
        const resp = await fetchWithTimeout(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                contents: [{ role: "user", parts: [{ text: "hi" }] }]
            })
        }, 10000);
        
        const status = resp.status;
        if (status === 200) {
            console.log("SUCCESS");
            return { success: true, status };
        } else if (status === 429) {
            console.log("LIMIT EXHAUSTED (429)");
            return { success: false, status };
        } else {
            console.log(`ERROR (${status})`);
            return { success: false, status };
        }
    } catch (e) {
        console.log(`FAILED (${e.message})`);
        return { success: false, error: e.message };
    }
}

async function cascade() {
    console.log("Starting multi-key multi-model cascade...");
    console.log(`Models: ${priorityModels.length}, Keys: ${keys.length}\n`);

    if (keys.length === 0) {
        console.error("No API keys found in .env");
        process.exit(1);
    }

    for (const model of priorityModels) {
        console.log(`=== Tier: ${model} ===`);
        for (let i = 0; i < keys.length; i++) {
            const result = await testModel(model, keys[i], `KEY_${i + 1}`);
            if (result.success) {
                console.log("\n-------------------------------------------");
                console.log(`Winner: ${model} using KEY_${i + 1}`);
                console.log("-------------------------------------------");
                process.exit(0);
            }
        }
        console.log(`All keys exhausted for ${model}. Cascading down...\n`);
    }

    console.log("CRITICAL: All models and all keys exhausted.");
    process.exit(1);
}

cascade();
