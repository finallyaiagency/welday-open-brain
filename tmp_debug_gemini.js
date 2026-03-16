
const GEMINI_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = 'gemini-3.1-flash-lite-preview';

async function debugGemini() {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_KEY}`;
  
  const payload = {
    contents: [{ role: 'user', parts: [{ text: "Introduce yourself as Mr. Burns from Welday Enterprises in a long, dramatic paragraph." }] }],
    generationConfig: { temperature: 0.7, maxOutputTokens: 1024 },
  };

  console.log("Calling Gemini...");
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  const data = await resp.json();
  console.log("--- FULL RESPONSE ---");
  console.log(JSON.stringify(data, null, 2));
  console.log("--- END RESPONSE ---");

  if (data.candidates && data.candidates[0] && data.candidates[0].content) {
    const parts = data.candidates[0].content.parts;
    console.log(`Number of parts: ${parts.length}`);
    parts.forEach((p, i) => {
      console.log(`Part ${i} text length: ${p.text?.length || 0}`);
      console.log(`Part ${i} text: "${p.text}"`);
    });
  }
}

debugGemini().catch(console.error);
