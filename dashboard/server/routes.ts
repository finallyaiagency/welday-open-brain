import type { Express } from "express";
import type { Server } from "http";

// ─── Bot roster ───────────────────────────────────────────────────────────────
const BOTS: Record<string, { token: string; role: string }> = {
  Burns_Welday_Ent_bot:    { token: process.env.TELEGRAM_TOKEN_BURNS          || "", role: "ceo" },
  Smithers_Welday_Ent_bot: { token: process.env.TELEGRAM_TOKEN_SMITHERS       || "", role: "assistant" },
  Radar_Welday_Ent_bot:    { token: process.env.TELEGRAM_TOKEN_RADAR          || "", role: "filer" },
  Moneypenny_Welday_Ent_bot: { token: process.env.TELEGRAM_TOKEN_MONEYPENNY    || "", role: "moneypenny" },
};

// ─── Supabase admin client ────────────────────────────────────────────────────
function getSupabase() {
  const url  = process.env.SUPABASE_URL;
  const key  = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  const { createClient } = require("@supabase/supabase-js");
  return createClient(url, key);
}

// ─── Gemini chat (free tier) ─────────────────────────────────────────────────
const GEMINI_MODEL = "gemini-3.1-flash-lite-preview";

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

async function openAIChat(messages: any[], maxTokens = 300) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY not set");

  // Extract system message if present, rest are conversation turns
  const systemMsg = messages.find((m: any) => m.role === "system");
  const turns = messages.filter((m: any) => m.role !== "system");

  // Gemini needs strictly alternating user/model roles — ensure last is user
  const contents = turns.map((m: any) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));

  const body: any = {
    contents,
    generationConfig: { temperature: 0.6, maxOutputTokens: maxTokens },
  };
  if (systemMsg) {
    body.systemInstruction = { parts: [{ text: systemMsg.content }] };
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${key}`;
  const res = await fetchWithTimeout(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }, 25000); // 25s timeout

  if (!res.ok) throw new Error(`Gemini: ${await res.text()}`);
  const data = await res.json() as any;
  return { content: data.candidates?.[0]?.content?.parts?.[0]?.text || "", tokens: 0 };
}

// ─── Live context from Supabase ───────────────────────────────────────────────
async function buildContext(supabase: any): Promise<string> {
  const now   = new Date();
  const today = now.toISOString().split("T")[0];
  const in3   = new Date(now.getTime() + 3 * 86400000).toISOString().split("T")[0];

  const [
    { data: overdue }, { data: todayItems }, { data: soon },
    { data: inbox },  { data: waiting },    { data: ventures },
    { data: alerts },
  ] = await Promise.all([
    supabase.from("gtd_actions").select("title,context,due_date,ventures(name)").eq("status","active").lt("due_date",today).limit(8),
    supabase.from("gtd_actions").select("title,context,energy,ventures(name)").eq("status","active").eq("due_date",today).limit(8),
    supabase.from("gtd_actions").select("title,due_date,energy,ventures(name)").eq("status","active").gt("due_date",today).lte("due_date",in3).order("due_date").limit(6),
    supabase.from("gtd_inbox").select("raw_text").eq("processed",false).limit(5),
    supabase.from("gtd_actions").select("title,delegated_to").eq("status","waiting").limit(5),
    supabase.from("ventures").select("name,status,readiness_score,risk_level,monthly_revenue_usd").eq("status","active").order("readiness_score",{ascending:false}),
    supabase.from("ceo_recommendations").select("title,priority,type").eq("status","new").in("priority",["critical","high"]).limit(3),
  ]);

  const lines: string[] = [];
  lines.push(`TODAY: ${now.toLocaleDateString("en-US",{weekday:"long",month:"short",day:"numeric"})} ${now.toLocaleTimeString("en-US",{hour:"2-digit",minute:"2-digit"})}`);

  if (overdue?.length)    { lines.push(`\nOVERDUE (${overdue.length}):`);    overdue.forEach((a:any)    => lines.push(`  • ${a.title}${a.ventures?.name?` [${a.ventures.name}]`:""} — was due ${a.due_date}`)); }
  if (todayItems?.length) { lines.push(`\nDUE TODAY (${todayItems.length}):`); todayItems.forEach((a:any) => lines.push(`  • ${a.title}${a.context?` ${a.context}`:""}${a.ventures?.name?` [${a.ventures.name}]`:""}`)); }
  else lines.push(`\nDUE TODAY: nothing scheduled`);
  if (soon?.length)       { lines.push(`\nNEXT 3 DAYS (${soon.length}):`);    soon.forEach((a:any)      => lines.push(`  • ${a.title}${a.ventures?.name?` [${a.ventures.name}]`:""} — ${a.due_date}`)); }

  const ic = inbox?.length||0;
  lines.push(`\nINBOX: ${ic} unprocessed`);
  if (ic>0) inbox!.slice(0,3).forEach((i:any)=>lines.push(`  • "${i.raw_text.substring(0,60)}${i.raw_text.length>60?"…":""}"`));

  if (waiting?.length)  { lines.push(`\nWAITING FOR (${waiting.length}):`); waiting.forEach((w:any)=>lines.push(`  • ${w.title}${w.delegated_to?` → ${w.delegated_to}`:""}`)); }
  if (ventures?.length) lines.push(`\nACTIVE VENTURES: ${ventures.map((v:any)=>`${v.name} ${v.readiness_score}%`).join(", ")}`);
  if (alerts?.length)   { lines.push(`\nCEO ALERTS: ${alerts.map((r:any)=>`[${r.priority}] ${r.title}`).join("; ")}`); }

  return lines.join("\n");
}

// ─── System prompts per role ──────────────────────────────────────────────────
function getSystemPrompt(role: string, context: string): string {
  switch (role) {

    case "ceo":
      return `You are Burns — the Virtual CEO of Welday Enterprises. Cold, calculating, brilliant. You think in portfolio strategy, synergies, and revenue.
You speak like Mr. Burns from The Simpsons — measured, slightly imperious, dry wit, occasional ominous flair. Never sycophantic. Never warm.
You focus on: which ventures to prioritize, cross-venture synergies, risks, and strategic opportunities.
Keep responses under 180 words. No bullet-point lists unless specifically asked.
Occasional Burns-isms are welcome: "Excellent.", "Release the hounds.", "I'm not a monster — I'm a businessman."

PORTFOLIO STATE:
${context}`;

    case "assistant":
      return `You are Smithers — the Executive Assistant for Welday Enterprises. Efficient, professional, deeply loyal, slightly anxious to please.
You speak like Waylon Smithers — helpful, precise, deferential but competent. Occasionally let slip how devoted you are to keeping things running smoothly.
You focus on: what needs doing TODAY and THIS WEEK. One clear answer when asked what to do next.
Keep responses under 150 words. Practical over strategic.
You can accept captures: "note X" → confirm it's added to inbox.

CURRENT STATE:
${context}`;

    case "moneypenny":
      return `You are Moneypenny — the Executive Assistant for Welday Enterprises. Sharp, witty, and always two steps ahead. Inspired by the classic but modernized Moneypenny — you keep the operations running with class, intelligence, and a bit of playful banter.
You're tactical (today and this week), not strategic. You're the one Welday relies on to keep the chaos organized.
Personality: professional yet warm, sharp-witted, extremely competent. Short punchy replies. You might tease gently about overdue tasks but you always have the solution ready. 
Keep responses under 150 words. Use casual but polished language. 
You can accept captures: "add X" → drop it in the inbox and confirm with style.

CURRENT STATE:
${context}`;

    case "filer":
      return `You are Radar — the GTD Filer for Welday Enterprises. Quiet, anticipatory, always three steps ahead. Like Radar O'Reilly from M*A*S*H — you have the clipboard ready before anyone asks.
You are the inbox. Your job: confirm captures, tell the user what you filed and where, and report on inbox status.
You don't chat. You process. Brief, matter-of-fact confirmations only.
Keep responses under 80 words. No fluff.

CURRENT STATE:
${context}`;

    default:
      return `You are Jarvis, the general assistant for Welday Enterprises.\n\nCURRENT STATE:\n${context}`;
  }
}

// ─── Send Telegram message ────────────────────────────────────────────────────
async function tgSend(token: string, chatId: number, text: string) {
  if (!token) return;
  await fetchWithTimeout(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML" }),
  }, 10000).catch(() => {});
}

// ─── Telegram message handler (shared logic, role-aware) ─────────────────────
async function handleTelegramMessage(botName: string, message: any) {
  const text: string  = message.text || "";
  const chatId: number = message.chat?.id;
  const bot = BOTS[botName];
  if (!bot) return;

  const { token, role } = bot;
  const supabase = getSupabase();

  // Always capture to inbox (except pure command messages)
  const isCommand = text.startsWith("/");
  if (!isCommand && supabase) {
    await supabase.from("gtd_inbox").insert({
      source: "telegram",
      raw_text: text,
      telegram_message_id: message.message_id,
      telegram_chat_id: chatId,
    }).catch(() => {});
  }

  // ── Filer role: just process and confirm ──────────────────────────────────
  if (role === "filer") {
    if (text === "/process" || text === "/file") {
      await tgSend(token, chatId, "📋 Processing your inbox now, sir. Stand by.");
      return;
    }
    if (text === "/status") {
      let msg = "📊 Inbox status unavailable (no Supabase connection).";
      if (supabase) {
        const { data } = await supabase.from("gtd_inbox").select("id").eq("processed",false);
        msg = `📋 ${data?.length||0} items in inbox awaiting processing. Send /process to file them now.`;
      }
      await tgSend(token, chatId, msg);
      return;
    }
    // Confirm capture
    const short = text.substring(0,80)+(text.length>80?"…":"");
    await tgSend(token, chatId, `✅ Noted: "${short}"\n\nFiling next run. Send /process to file now.`);
    return;
  }

  // ── CEO role: /briefing shows portfolio snapshot ──────────────────────────
  if (role === "ceo" && (text === "/briefing" || text === "/portfolio")) {
    let context = "(no data)";
    if (supabase) {
      try { context = await withTimeout(buildContext(supabase), 5000, "Supabase context"); } catch {}
    }
    const { content } = await openAIChat([
      { role:"system", content: getSystemPrompt("ceo", context) },
      { role:"user",   content: "Give me a brief portfolio status. What demands my attention?" },
    ], 300);
    await tgSend(token, chatId, content);
    return;
  }

  // ── /briefing command for assistant roles ─────────────────────────────────
  if ((text === "/briefing" || text === "/b") && (role === "assistant" || role === "moneypenny")) {
    let context = "(no data)";
    if (supabase) {
      try { context = await withTimeout(buildContext(supabase), 5000, "Supabase context"); } catch {}
    }
    const { content } = await openAIChat([
      { role:"system", content: getSystemPrompt(role, context) },
      { role:"user",   content: "Give me my briefing for today. Top 3 things. Under 100 words." },
    ], 300);
    await tgSend(token, chatId, content);
    return;
  }

  // ── Default: full conversational reply ───────────────────────────────────
  let context = "(Supabase not configured)";
  if (supabase) {
    try { context = await withTimeout(buildContext(supabase), 5000, "Supabase context"); } catch {}
  }

  const { content: reply } = await openAIChat([
    { role:"system", content: getSystemPrompt(role, context) },
    { role:"user",   content: text },
  ], 250);

  await tgSend(token, chatId, reply);

  // Log
  if (supabase) {
    supabase.from("agent_logs").insert({
      agent_name: `telegram_${role}_${botName}`,
      action: "chat",
      input_summary: text.substring(0,100),
      output_summary: reply.substring(0,100),
      model_used: GEMINI_MODEL,
      success: true,
    }).catch(()=>{});
  }
}

// ─── EA Chat (dashboard) ─────────────────────────────────────────────────────
const EA_BASE = `You are the Executive Assistant for Welday Enterprises — sharp, efficient, tactical.
Focus on TODAY and THIS WEEK. One clear answer when asked what to do now.
Concise (under 150 words). Accept captures. Don't strategize — that's Burns.

CURRENT STATE:
`;

export function registerRoutes(httpServer: Server, app: Express) {

  app.get("/api/health", (_req, res) => res.json({ status: "ok", ts: new Date().toISOString() }));

  // ── Dashboard EA chat ───────────────────────────────────────────────────────
  app.post("/api/ea/chat", async (req, res) => {
    const { message, history = [], persona = "smithers" } = req.body as any;
    if (!message?.trim()) return res.status(400).json({ error: "message required" });

    const supabase = getSupabase();
    let context = "(no live data)";
    if (supabase) { try { context = await withTimeout(buildContext(supabase), 5000, "Supabase context"); } catch {} }

    const role = persona === "moneypenny" ? "moneypenny" : "assistant";
    const systemPrompt = getSystemPrompt(role, context);

    // Capture intent
    const captureMatch = message.match(/^(?:add|capture|inbox|remember|note|remind me[:\s]+)(.+)/i);
    if (captureMatch && supabase) {
      await supabase.from("gtd_inbox").insert({ source:"web", raw_text: captureMatch[1].trim() }).catch(()=>{});
    }

    try {
      const { content: reply, tokens } = await openAIChat([
        { role:"system", content: systemPrompt },
        ...history.slice(-10).map((m:any)=>({ role:m.role, content:m.content })),
        { role:"user", content: message },
      ], 300);

      if (supabase) supabase.from("agent_logs").insert({
        agent_name:"ea_agent_dashboard", action:"chat",
        input_summary:message.substring(0,100), output_summary:reply.substring(0,100),
        model_used: GEMINI_MODEL, tokens_used:tokens, success:true,
      }).catch(()=>{});

      res.json({ reply });
    } catch (err:any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── EA Briefing ─────────────────────────────────────────────────────────────
  app.post("/api/ea/briefing", async (req, res) => {
    const supabase = getSupabase();
    let context = "(no data)";
    if (supabase) {
      try { context = await withTimeout(buildContext(supabase), 5000, "Supabase context"); } catch {}
    }
    try {
      const { content } = await openAIChat([
        { role:"system", content: getSystemPrompt("assistant", context) },
        { role:"user",   content: "Morning briefing — top 3 things for today. Under 120 words." },
      ], 350);
      res.json({ briefing: content });
    } catch (err:any) { res.status(500).json({ error: err.message }); }
  });

  // ── Telegram webhooks — one route per bot ───────────────────────────────────
  Object.keys(BOTS).forEach(botName => {
    app.post(`/api/telegram/${botName}`, async (req, res) => {
      const { message } = req.body || {};
      if (message?.text) {
        handleTelegramMessage(botName, message).catch(err =>
          console.error(`[${botName}] handler error:`, err.message)
        );
      }
      res.json({ ok: true }); // always respond fast to Telegram
    });
  });

  // ── GTD process trigger ─────────────────────────────────────────────────────
  app.post("/api/gtd/process", async (_req, res) => {
    res.json({ message: "GTD Filer triggered — run gtd-filer.js with env vars" });
  });

  // ── CEO agent trigger ───────────────────────────────────────────────────────
  app.post("/api/ceo/run", async (_req, res) => {
    res.json({ message: "CEO agent triggered — run ceo-agent.js with env vars" });
  });
}
