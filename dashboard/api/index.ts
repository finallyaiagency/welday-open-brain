import type { IncomingMessage, ServerResponse } from "http";

const FREE_MODELS = [
  "gemini-3-flash-preview",
  "gemini-2.5-flash",
  "gemini-3.1-flash-lite-preview",
  "gemma-3-27b-it"
];

const COOLDOWNS = new Map<string, number>();
const COOLDOWN_DURATION = 3 * 60 * 60 * 1000; // 3 hours

async function fetchWithTimeout(url: string, options: any = {}, timeout = 25000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(id);
    return response;
  } catch (err: any) {
    clearTimeout(id);
    if (err.name === "AbortError") {
      throw new Error(`Request timed out after ${timeout}ms`);
    }
    throw err;
  }
}

async function withTimeout<T>(promise: Promise<T>, timeout: number, label: string): Promise<T> {
  let id: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    id = setTimeout(() => reject(new Error(`${label} timed out after ${timeout}ms`)), timeout);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (id) clearTimeout(id);
  }
}

// ─── Response helper ──────────────────────────────────────────────────────────
function send(res: ServerResponse, code: number, data: any) {
  const body = JSON.stringify(data);
  res.writeHead(code, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) });
  res.end(body);
}

// ─── Body parser ──────────────────────────────────────────────────────────────
async function parseBody(req: IncomingMessage): Promise<any> {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (chunk: any) => { data += chunk.toString(); });
    req.on("end", () => { try { resolve(JSON.parse(data)); } catch { resolve({}); } });
    req.on("error", () => resolve({}));
  });
}

// ─── Supabase ─────────────────────────────────────────────────────────────────
function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { createClient } = require("@supabase/supabase-js");
    return createClient(url, key);
  } catch { return null; }
}

// ─── Gemini (with key fallback) ──────────────────────────────────────────────
function getGeminiKeys(): string[] {
  const keys: string[] = [];
  if (process.env.GEMINI_API_KEY) keys.push(process.env.GEMINI_API_KEY);
  let i = 2;
  while (true) {
    const k = process.env[`GEMINI_API_KEY_${i}`];
    if (!k) break;
    keys.push(k);
    i++;
  }
  return keys;
}

async function callGeminiWithKey(key: string, model: string, systemPrompt: string, messages: { role: string; content: string }[], maxTokens: number) {
  const contents = messages.map(m => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));
  const resp = await fetchWithTimeout(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents,
        systemInstruction: { parts: [{ text: systemPrompt }] },
        generationConfig: { temperature: 0.6, maxOutputTokens: maxTokens },
      }),
    },
    20000 
  );
  if (!resp.ok) {
    const txt = await resp.text();
    const err = new Error(`Gemini ${resp.status}: ${txt}`) as any;
    err.status = resp.status;
    throw err;
  }
  const data = await resp.json() as any;
  const parts = data.candidates?.[0]?.content?.parts || [];
  return parts.map((p: any) => p.text || "").join("");
}

async function gemini(systemPrompt: string, messages: { role: string; content: string }[], maxTokens = 300, openRouterKey?: string): Promise<{ reply: string; model: string; keyIndex: number | string }> {
  const keys = getGeminiKeys();
  const now = Date.now();
  const summary: string[] = [];

  // --- Pass 1: Try respecting Cooldowns ---
  if (keys.length > 0) {
    for (const model of FREE_MODELS) {
      let attempt = 1;
      for (const key of keys) {
        const cacheKey = `${model}:${key}`;
        const cooldownUntil = COOLDOWNS.get(cacheKey) || 0;

        if (now < cooldownUntil) {
          summary.push(`${model}@K${attempt}: Cooldown`);
          attempt++;
          continue;
        }

        try {
          const reply = await callGeminiWithKey(key, model, systemPrompt, messages, maxTokens);
          COOLDOWNS.delete(cacheKey);
          return { reply, model, keyIndex: attempt };
        } catch (err: any) {
          summary.push(`${model}@K${attempt}: ${err.status || "Err"}`);
          if (err.status === 429) {
            COOLDOWNS.set(cacheKey, now + COOLDOWN_DURATION);
          }
          attempt++;
        }
      }
    }

    // --- Pass 2: Last Resort (Ignore Cooldowns) ---
    console.log("[Gemini] First pass exhausted. Attempting last resort (ignoring cooldowns)...");
    for (const model of FREE_MODELS) {
      let attempt = 1;
      for (const key of keys) {
        try {
          const reply = await callGeminiWithKey(key, model, systemPrompt, messages, maxTokens);
          COOLDOWNS.delete(`${model}:${key}`); 
          return { reply, model, keyIndex: attempt };
        } catch (err: any) {
          summary.push(`${model}@K${attempt}: ForceFail(${err.status || "Err"})`);
          attempt++;
        }
      }
    }
  }

  // --- Pass 3: OpenRouter Emergency Fallback ---
  if (openRouterKey?.trim()) {
    console.log("[Gemini] All Gemini keys exhausted. Trying OpenRouter...");
    try {
      const orResp = await fetchWithTimeout("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${openRouterKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://welday-open-brain.local",
          "X-Title": "Welday Open Brain"
        },
        body: JSON.stringify({
          model: "google/gemini-2.0-flash-001",
          messages: [
            { role: "system", content: systemPrompt },
            ...messages.map(m => ({ role: m.role, content: m.content }))
          ],
          max_tokens: maxTokens
        })
      });

      if (orResp.ok) {
        const data = await orResp.json() as any;
        const reply = data.choices?.[0]?.message?.content || "";
        return { reply, model: "gemini-2.0-flash (via OpenRouter)", keyIndex: "OpenRouter" };
      } else {
        const txt = await orResp.text();
        summary.push(`OpenRouter: ${orResp.status} (${txt.substring(0,50)})`);
      }
    } catch (e: any) {
      summary.push(`OpenRouter: Error (${e.message})`);
    }
  }

  const quotaErr = new Error(`All Free models exhausted.\nDebug: ${summary.join(" | ")}`) as any;
  quotaErr.status = 429;
  throw quotaErr;
}

// ─── Context builder ──────────────────────────────────────────────────────────
async function buildContext(sb: any): Promise<string> {
  const now   = new Date();
  const today = now.toISOString().split("T")[0];
  const in3   = new Date(now.getTime() + 3 * 86400000).toISOString().split("T")[0];

  const [od, td, sn, ib, wt, vt, al] = await Promise.all([
    sb.from("gtd_actions").select("title,due_date").eq("status","active").lt("due_date",today).limit(6),
    sb.from("gtd_actions").select("title,context").eq("status","active").eq("due_date",today).limit(6),
    sb.from("gtd_actions").select("title,due_date").eq("status","active").gt("due_date",today).lte("due_date",in3).limit(5),
    sb.from("gtd_inbox").select("raw_text").eq("processed",false).limit(4),
    sb.from("gtd_actions").select("title,delegated_to").eq("status","waiting").limit(4),
    sb.from("ventures").select("name,readiness_score").eq("status","active").order("readiness_score",{ascending:false}),
    sb.from("ceo_recommendations").select("title,priority").eq("status","new").in("priority",["critical","high"]).limit(3),
  ]);

  const L: string[] = [];
  L.push(`TODAY: ${now.toLocaleDateString("en-US",{weekday:"long",month:"short",day:"numeric"})}`);
  if (od.data?.length)  { L.push(`\nOVERDUE (${od.data.length}):`);   od.data.forEach((a: any) => L.push(`  • ${a.title} — was due ${a.due_date}`)); }
  if (td.data?.length)  { L.push(`\nDUE TODAY (${td.data.length}):`); td.data.forEach((a: any) => L.push(`  • ${a.title}${a.context?" "+a.context:""}`)); }
  else L.push("\nDUE TODAY: nothing scheduled");
  if (sn.data?.length)  { L.push(`\nNEXT 3 DAYS:`); sn.data.forEach((a: any) => L.push(`  • ${a.title} — ${a.due_date}`)); }
  L.push(`\nINBOX: ${ib.data?.length||0} unprocessed`);
  if (wt.data?.length)  { L.push(`\nWAITING:`); wt.data.forEach((w: any) => L.push(`  • ${w.title}${w.delegated_to?" → "+w.delegated_to:""}`)); }
  if (vt.data?.length)  { L.push(`\nACTIVE VENTURES:`); vt.data.forEach((v: any) => L.push(`  • ${v.name} ${v.readiness_score}%`)); }
  if (al.data?.length)  { L.push(`\nCEO ALERTS:`); al.data.forEach((r: any) => L.push(`  • [${r.priority}] ${r.title}`)); }
  return L.join("\n");
}

// ─── System prompts ───────────────────────────────────────────────────────────
function sysPrompt(role: string, ctx: string): string {
  const base = `\n\nCURRENT STATE:\n${ctx}`;
  switch (role) {
    case "ceo":      return `You are Burns — Virtual CEO of Welday Enterprises. Cold, calculating, Mr. Burns personality. Strategy, synergies, revenue. Under 180 words.${base}`;
    case "moneypenny": return `You are Moneypenny — the Executive Assistant for Welday Enterprises. Tactical (today/this week). Short punchy replies, professional yet warm, occasional emoji. Under 150 words.${base}`;
    case "filer":    return `You are Radar — GTD Filer. Terse, anticipatory. Confirm captures only. Under 80 words.${base}`;
    default:         return `You are Smithers — Executive Assistant. Efficient, professional. Focus TODAY and THIS WEEK. Under 150 words. Accept captures.${base}`;
  }
}

// ─── Telegram ─────────────────────────────────────────────────────────────────
const BOTS: Record<string, { token: string; role: string }> = {
  Burns_Welday_Ent_bot:    { token: process.env.TELEGRAM_TOKEN_BURNS    || "", role: "ceo" },
  Smithers_Welday_Ent_bot: { token: process.env.TELEGRAM_TOKEN_SMITHERS || "", role: "assistant" },
  Radar_Welday_Ent_bot:    { token: process.env.TELEGRAM_TOKEN_RADAR    || "", role: "filer" },
  Moneypenny_Welday_Ent_bot: { token: process.env.TELEGRAM_TOKEN_MONEYPENNY || "", role: "moneypenny" },
  // Short slugs for flexibility
  burns:      { token: process.env.TELEGRAM_TOKEN_BURNS    || "", role: "ceo" },
  smithers:   { token: process.env.TELEGRAM_TOKEN_SMITHERS || "", role: "assistant" },
  radar:      { token: process.env.TELEGRAM_TOKEN_RADAR    || "", role: "filer" },
  moneypenny: { token: process.env.TELEGRAM_TOKEN_MONEYPENNY || "", role: "moneypenny" },
};

async function tgSend(botName: string, token: string, chatId: number, text: string) {
  if (!token) {
    console.error(`[telegram:${botName}] send skipped: TELEGRAM token missing`);
    return false;
  }

  try {
    const resp = await fetchWithTimeout(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML" }),
    }, 10000);

    if (!resp.ok) {
      console.error(`[telegram:${botName}] send failed ${resp.status}: ${await resp.text()}`);
      return false;
    }

    return true;
  } catch (err: any) {
    console.error(`[telegram:${botName}] send failed: ${err.message}`);
    return false;
  }
}

// ─── Main export ──────────────────────────────────────────────────────────────
export default async function handler(req: IncomingMessage, res: ServerResponse) {
  const path = ((req as any).url || "").split("?")[0];
  const method = req.method || "GET";

  let body: any = {};
  if (method === "POST") body = await parseBody(req);

  try {
    if (path === "/api/health") {
      return send(res, 200, { status: "ok", ts: new Date().toISOString(), gemini: !!process.env.GEMINI_API_KEY, supabase: !!process.env.SUPABASE_URL });
    }

    if (path === "/api/ea/chat" && method === "POST") {
      const { message, history = [], persona = "smithers" } = body;
      if (!message?.trim()) return send(res, 400, { error: "message required" });

      const sb = getSupabase();
      let ctx = "(no live data)";
      if (sb) { try { ctx = await withTimeout(buildContext(sb), 5000, "Supabase context"); } catch (e: any) { ctx = `(context unavailable: ${e.message})`; } }

      const role = persona === "moneypenny" ? "moneypenny" : "assistant";
      const cap = message.match(/^(?:add|capture|inbox|remember|note|remind me[:\s]+)(.+)/i);
      if (cap && sb) await sb.from("gtd_inbox").insert({ source: "web", raw_text: cap[1].trim() }).catch(() => {});

      const msgs = [
        ...(Array.isArray(history) ? history.slice(-10) : []).map((m: any) => ({ role: m.role as string, content: m.content as string })),
        { role: "user" as const, content: message as string },
      ];

      const { reply, model, keyIndex } = await gemini(sysPrompt(role, ctx), msgs, 1024);
      if (sb) sb.from("agent_logs").insert({ agent_name: "ea_dashboard", action: "chat", input_summary: message.substring(0,100), output_summary: reply.substring(0,100), model_used: model, success: true }).catch(() => {});

      return send(res, 200, { reply, model, keyIndex });
    }

    if (path === "/api/ea/briefing" && method === "POST") {
      const sb = getSupabase();
      let ctx = "(no data)";
      if (sb) { try { ctx = await withTimeout(buildContext(sb), 5000, "Supabase context"); } catch {} }
      const { reply } = await gemini(sysPrompt("assistant", ctx), [{ role: "user", content: "Morning briefing — top 3 things for today. Under 120 words." }], 800);
      return send(res, 200, { briefing: reply });
    }

    if (path.match(/^\/api\/telegram\/(.+)$/) && method === "POST") {
      const botName = path.match(/^\/api\/telegram\/(.+)$/)![1];
      const bot = BOTS[botName];
      if (!bot) return send(res, 404, { error: "unknown bot" });

      const msg = body?.message;
      if (msg?.text) {
        const text: string = msg.text;
        const chatId: number = msg.chat?.id;
        const { token, role } = bot;
        const sb = getSupabase();

        if (!text.startsWith("/") && sb) {
          await sb.from("gtd_inbox").insert({ source: "telegram", raw_text: text, telegram_chat_id: chatId }).catch(() => {});
        }

        if (role === "filer") {
          if (text === "/status" && sb) {
            const { data } = await sb.from("gtd_inbox").select("id").eq("processed", false);
            await tgSend(botName, token, chatId, `📋 ${data?.length||0} items waiting. Send /process to file now.`);
          } else if (text === "/process" || text === "/file") {
            await tgSend(botName, token, chatId, "📋 Processing inbox now.");
          } else {
            await tgSend(botName, token, chatId, `✅ Noted: "${text.substring(0,80)}"`);
          }
        } else {
          const sb2 = getSupabase();
          let ctx = "(no data)";
          if (sb2) { try { ctx = await withTimeout(buildContext(sb2), 5000, "Supabase context"); } catch {} }
          const userMsg = (text === "/briefing" || text === "/b") ? "Morning briefing — top 3 items." : text;
          try {
            const { reply } = await gemini(sysPrompt(role, ctx), [{ role: "user", content: userMsg }], 1024);
            await tgSend(botName, token, chatId, reply);
          } catch {
            await tgSend(botName, token, chatId, "Gemini exhaustion. Try again later.");
          }
        }
      }
      return send(res, 200, { ok: true });
    }

    if (path === "/api/test-models") {
      const keys = getGeminiKeys();
      const results: any[] = [];
      const now = Date.now();

      for (const model of FREE_MODELS) {
        let modelResult = { model, statuses: [] as string[] };
        for (let i = 0; i < keys.length; i++) {
          const cacheKey = `${model}:${keys[i]}`;
          const cooldownUntil = COOLDOWNS.get(cacheKey) || 0;
          
          if (now < cooldownUntil) {
            const mins = Math.ceil((cooldownUntil - now) / 60000);
            modelResult.statuses.push(`Key ${i+1}: Cooldown (${mins}m)`);
            continue;
          }

          try {
            const response = await fetchWithTimeout(
              `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${keys[i]}`,
              { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ contents: [{ parts: [{ text: "hi" }] }] }) },
              10000
            );
            modelResult.statuses.push(`Key ${i+1}: ${response.status}`);
          } catch (e: any) {
            modelResult.statuses.push(`Key ${i+1}: Err`);
          }
        }
        results.push(modelResult);
      }
      return send(res, 200, { results });
    }

    return send(res, 404, { error: "not found" });
  } catch (err: any) {
    return send(res, 500, { error: err.message || "Internal server error" });
  }
}
