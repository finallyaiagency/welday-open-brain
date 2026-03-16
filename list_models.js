const fs = require('fs');

async function listModels() {
    const key = process.env.GEMINI_API_KEY;
    if (!key) {
        console.error("GEMINI_API_KEY not found in environment.");
        process.exit(1);
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${key}`;
    try {
        const resp = await fetch(url);
        if (!resp.ok) {
            throw new Error(`listModels failed with status ${resp.status}`);
        }
        const data = await resp.json();
        fs.writeFileSync('available_models.json', JSON.stringify(data, null, 2));
        console.log("Models list saved to available_models.json");
    } catch (e) {
        console.error("Error listing models:", e.message);
        process.exit(1);
    }
}

listModels();
