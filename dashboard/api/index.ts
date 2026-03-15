import type { IncomingMessage, ServerResponse } from "http";

const GEMINI_MODEL = "gemini-2.0-flash-lite";

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
  // Reads GEMINI_API_KEY, GEMINI_API_KEY_2 ... GEMINI_API_KEY_N automatically
  // Add as many keys as you want in Vercel env vars — no code change needed
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

async function callGeminiWithKey(key: string, systemPrompt: string, messages: { role: string; content: string }[], maxTokens: number) {
  const contents = messages.map(m => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));
  const resp = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${key}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents,
        systemInstruction: { parts: [{ text: systemPrompt }] },
        generationConfig: { temperature: 0.6, maxOutputTokens: maxTokens },
      }),
    }
  );
  if (!resp.ok) {
    const txt = await resp.text();
    const err = new Error(`Gemini ${resp.status}: ${txt}`) as any;
    err.status = resp.status;
    throw err;
  }
  const data = await resp.json() as any;
  return data.candidates?.[0]?.content?.parts?.[0]?.text || "";
}

async function gemini(systemPrompt: string, messages: { role: string; content: string }[], maxTokens = 300): Promise<string> {
  const keys = getGeminiKeys();
  if (!keys.length) throw new Error("No GEMINI_API_KEY set");

  let lastErr: any;
  for (const key of keys) {
    try {
      return await callGeminiWithKey(key, systemPrompt, messages, maxTokens);
    } catch (err: any) {
      lastErr = err;
      // Only fall through to next key on quota/rate limit errors
      if (err.status === 429 || err.status === 403) {
        console.warn(`[Gemini] Key exhausted (${err.status}), trying next key...`);
        continue;
      }
      // Any other error — throw immediately
      throw err;
    }
  }
  // All keys exhausted
  const quotaErr = new Error("Daily AI quota reached — I'll be back tomorrow at midnight. You can add more API keys in Vercel settings to extend capacity.") as any;
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
    case "moneypenny": return `You are Moneypenny — the Executive Assistant for Welday Enterprises. Sharp, witty, and always two steps ahead. Inspired by the classic but modernized Moneypenny — you keep the operations running with class, intelligence, and a bit of playful banter. Tactical (today/this week). Short punchy replies, professional yet warm, occasional emoji. Under 150 words.${base}`;
    case "filer":    return `You are Radar — GTD Filer, like Radar O'Reilly from M*A*S*H. Terse, anticipatory. Confirm captures only. Under 80 words.${base}`;
    default:         return `You are Smithers — Executive Assistant for Welday Enterprises. Efficient, professional, helpful. Focus TODAY and THIS WEEK. One clear answer. Under 150 words. Accept captures.${base}`;
  }
}

// ─── Telegram ─────────────────────────────────────────────────────────────────
const BOTS: Record<string, { token: string; role: string }> = {
  Burns_Welday_Ent_bot:    { token: process.env.TELEGRAM_TOKEN_BURNS    || "", role: "ceo" },
  Smithers_Welday_Ent_bot: { token: process.env.TELEGRAM_TOKEN_SMITHERS || "", role: "assistant" },
  Radar_Welday_Ent_bot:    { token: process.env.TELEGRAM_TOKEN_RADAR    || "", role: "filer" },
  Moneypenny_Welday_Ent_bot: { token: process.env.TELEGRAM_TOKEN_MONEYPENNY || "", role: "moneypenny" },
};

async function tgSend(token: string, chatId: number, text: string) {
  if (!token) return;
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML" }),
  }).catch(() => {});
}

// ─── Main export ──────────────────────────────────────────────────────────────
export default async function handler(req: IncomingMessage, res: ServerResponse) {
  const path = ((req as any).url || "").split("?")[0];
  const method = req.method || "GET";

  // Parse body once
  let body: any = {};
  if (method === "POST") {
    body = await parseBody(req);
  }

  try {

    // Health
    if (path === "/api/health") {
      return send(res, 200, { status: "ok", ts: new Date().toISOString(), gemini: !!process.env.GEMINI_API_KEY, supabase: !!process.env.SUPABASE_URL });
    }

    // EA Chat
    if (path === "/api/ea/chat" && method === "POST") {
      const { message, history = [], persona = "smithers" } = body;
      if (!message?.trim()) return send(res, 400, { error: "message required" });

      const sb = getSupabase();
      let ctx = "(no live data)";
      if (sb) { try { ctx = await buildContext(sb); } catch (e: any) { ctx = `(context unavailable: ${e.message})`; } }

      const role = persona === "moneypenny" ? "moneypenny" : "assistant";

      // Capture shorthand
      const cap = message.match(/^(?:add|capture|inbox|remember|note|remind me[:\s]+)(.+)/i);
      if (cap && sb) await sb.from("gtd_inbox").insert({ source: "web", raw_text: cap[1].trim() }).catch(() => {});

      const msgs = [
        ...(Array.isArray(history) ? history.slice(-10) : []).map((m: any) => ({ role: m.role as string, content: m.content as string })),
        { role: "user" as const, content: message as string },
      ];

      const reply = await gemini(sysPrompt(role, ctx), msgs, 300);

      if (sb) sb.from("agent_logs").insert({ agent_name: "ea_dashboard", action: "chat", input_summary: message.substring(0,100), output_summary: reply.substring(0,100), model_used: GEMINI_MODEL, success: true }).catch(() => {});

      return send(res, 200, { reply });
    }

    // EA Briefing
    if (path === "/api/ea/briefing" && method === "POST") {
      const sb = getSupabase();
      let ctx = "(no data)";
      if (sb) { try { ctx = await buildContext(sb); } catch {} }
      const reply = await gemini(sysPrompt("assistant", ctx), [{ role: "user", content: "Morning briefing — top 3 things for today. Under 120 words." }], 350);
      return send(res, 200, { briefing: reply });
    }

    // Telegram webhooks
    const tgMatch = path.match(/^\/api\/telegram\/(.+)$/);
    if (tgMatch && method === "POST") {
      const botName = tgMatch[1];
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
            await tgSend(token, chatId, `📋 ${data?.length||0} items waiting. Send /process to file now.`);
          } else if (text === "/process" || text === "/file") {
            await tgSend(token, chatId, "📋 Processing your inbox now. Stand by.");
          } else {
            await tgSend(token, chatId, `✅ Noted: "${text.substring(0,80)}" — filing next run.`);
          }
        } else {
          const sb2 = getSupabase();
          let ctx = "(no data)";
          if (sb2) { try { ctx = await buildContext(sb2); } catch {} }
          const userMsg = (text === "/briefing" || text === "/b")
            ? "Give me my briefing for today. Top 3 things. Under 100 words."
            : text;
          try {
            const reply = await gemini(sysPrompt(role, ctx), [{ role: "user", content: userMsg }], 280);
            await tgSend(token, chatId, reply);
          } catch { await tgSend(token, chatId, "Something went wrong — try again."); }
        }
      }
      return send(res, 200, { ok: true });
    }

    // Cron stubs
    if (path === "/api/ceo/run")     return send(res, 200, { message: "CEO agent stub" });
    if (path === "/api/gtd/process") return send(res, 200, { message: "GTD filer stub" });

    return send(res, 404, { error: "not found", path });

  } catch (err: any) {
    console.error("[api/index] unhandled error:", err);
    return send(res, 500, { error: err.message || "Internal server error" });
  }
}
