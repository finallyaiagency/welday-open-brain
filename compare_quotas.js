import { readFileSync } from 'node:fs';

const keys = [
  process.env.GEMINI_API_KEY,
  process.env.GEMINI_API_KEY_2,
  process.env.GEMINI_API_KEY_3
].filter(Boolean);

const modelsToTest = [
  "gemini-3-flash-preview",
  "gemini-3.1-flash-lite-preview",
  "gemini-2.5-flash",
  "gemini-2.5-pro",
  "gemini-2.0-flash",
  "gemini-2.0-flash-lite",
  "gemma-3-1b-it",
  "gemma-3-4b-it",
  "gemma-3-12b-it",
  "gemma-3-27b-it",
  "gemini-2.5-flash-lite",
  "gemini-3.1-pro-preview",
  "gemini-robotics-er-1.5-preview",
  "gemini-2.5-computer-use-preview-10-2025",
  "deep-research-pro-preview-12-2025"
];

async function testModelKey(model, key, keyIdx) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: 'hi' }] }],
        generationConfig: { maxOutputTokens: 5 }
      })
    });
    
    if (res.ok) return "OK (200)";
    if (res.status === 429) return "LIMIT (429)";
    if (res.status === 404) return "NOT FOUND (404)";
    return `ERR (${res.status})`;
  } catch (e) {
    return `FETCH FAIL: ${e.message}`;
  }
}

async function run() {
  console.log(`Testing ${modelsToTest.length} models across ${keys.length} keys...\n`);
  
  const results = [];
  for (const model of modelsToTest) {
    const row = { model };
    for (let i = 0; i < keys.length; i++) {
      row[`key${i+1}`] = await testModelKey(model, keys[i], i+1);
    }
    results.push(row);
    console.log(`${model.padEnd(40)} | ${row.key1?.padEnd(15)} | ${row.key2?.padEnd(15)} | ${row.key3?.padEnd(15)}`);
  }
}

run();
