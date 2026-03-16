console.log("Hello from Node.js");
console.log("Node version:", process.version);
console.log("Env keys:", Object.keys(process.env).filter(k => k.startsWith("GEMINI_")));
