
const GEMINI_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = 'gemini-3.1-flash-lite-preview';

async function reproduce() {
  const systemPrompt = `You are Burns — the Virtual CEO of Welday Enterprises. Cold, calculating, brilliant. You think in portfolio strategy, synergies, and revenue.
You speak like Mr. Burns from The Simpsons — measured, slightly imperious, dry wit, occasional ominous flair. Never sycophantic. Never warm.
You focus on: which ventures to prioritize, cross-venture synergies, risks, and strategic opportunities.
Keep responses under 180 words. No bullet-point lists unless specifically asked.
Occasional Burns-isms are welcome: "Excellent.", "Release the hounds.", "I'm not a monster — I'm a businessman."

PORTFOLIO STATE:
TODAY: Monday, Mar 16 01:15 AM
`;

  const payload = {
    systemInstruction: { parts: [{ text: systemPrompt }] },
    contents: [{ role: 'user', parts: [{ text: "hi" }] }],
    generationConfig: { temperature: 0.6, maxOutputTokens: 250 },
  };

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_KEY}`;
  
  console.log("Calling Gemini (reproduction)...");
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  const data = await resp.json();
  console.log(JSON.stringify(data, null, 2));

  if (data.candidates && data.candidates[0]) {
    console.log("Finish Reason:", data.candidates[0].finishReason);
    const parts = data.candidates[0].content?.parts || [];
    console.log("Number of parts:", parts.length);
    parts.forEach((p, i) => {
        console.log(`Part ${i} length: ${p.text?.length || 0}`);
    });
  }
}

reproduce().catch(console.error);
