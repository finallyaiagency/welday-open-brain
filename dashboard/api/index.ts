import type { IncomingMessage, ServerResponse } from "http";

const FREE_MODELS = [
  "gemini-3-flash-preview",
  "gemini-2.5-flash",
  "gemini-3.1-flash-lite-preview",
  "gemma-3-27b-it"
];

const COOLDOWNS = new Map<string, number>();
const COOLDOWN_DURATION = 3 * 60 * 60 * 1000; // 3 hours
const AUTO_PROCESS_AFTER_MS = 10 * 60 * 1000;
const USER_TIMEZONE = "America/New_York";

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

function getHeader(req: IncomingMessage, name: string) {
  const value = req.headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
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

function parseJsonResponse(content: string) {
  const cleaned = content.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
  return JSON.parse(cleaned);
}

async function classifyInboxItem(text: string) {
  const prompt = `Classify this GTD inbox item and tell me where to file it.

Inbox text: "${text}"

GTD destinations:
- action: A concrete next step
- project: Outcome requiring multiple steps
- someday: Idea to revisit later
- reference: Information to keep (not actionable)
- trash: Not worth keeping

Respond with JSON only:
{
  "destination": "action" | "project" | "someday" | "reference" | "trash",
  "title": "clean, concise title",
  "summary": "one sentence summary",
  "category": "work" | "personal" | "health" | "finance" | "learning" | "business",
  "venture_slug": "relevant-venture-slug or null",
  "context": "@computer" | "@phone" | "@errands" | "@waiting" | null,
  "energy": "high" | "medium" | "low",
  "confidence": 0.0-1.0
}`;

  const { reply } = await gemini(
    "You are a precise GTD classifier. Return valid JSON only.",
    [{ role: "user", content: prompt }],
    700,
  );

  try {
    return parseJsonResponse(reply);
  } catch {
    return {
      destination: "reference",
      title: text.substring(0, 80),
      summary: "Saved for later review.",
      category: "work",
      venture_slug: null,
      context: null,
      energy: "medium",
      confidence: 0.5,
    };
  }
}

async function fileInboxItem(sb: any, inbox: any, classification: any) {
  const ventureSlug = classification.venture_slug || "";
  const { data: ventures } = ventureSlug
    ? await sb.from("ventures").select("id, slug").eq("slug", ventureSlug).limit(1)
    : { data: null };

  const ventureId = ventures?.[0]?.id || null;
  const category = classification.category || "work";
  const tags = [category].filter(Boolean);

  if (classification.destination === "action") {
    await sb.from("gtd_actions").insert({
      title: classification.title,
      venture_id: ventureId,
      context: classification.context,
      energy: classification.energy || "medium",
      notes: inbox.raw_text,
      tags,
    });
  } else if (classification.destination === "project") {
    await sb.from("gtd_projects").insert({
      title: classification.title,
      venture_id: ventureId,
      area: category,
      notes: inbox.raw_text,
      tags,
    });
  } else if (classification.destination === "someday") {
    await sb.from("gtd_someday").insert({
      title: classification.title,
      description: inbox.raw_text,
      venture_id: ventureId,
      area: category,
      tags,
    });
  } else if (classification.destination === "reference") {
    await sb.from("gtd_reference").insert({
      title: classification.title,
      content: inbox.raw_text,
      venture_id: ventureId,
      category: "idea",
      area: category,
      tags,
    });
  }

  await sb.from("gtd_inbox").update({
    processed: true,
    processed_at: new Date().toISOString(),
    filed_to: classification.destination,
    ai_summary: classification.summary,
    ai_category: classification.category,
    ai_confidence: classification.confidence,
  }).eq("id", inbox.id);
}

async function processInbox(sb: any, force = false, limit = 20) {
  const cutoffIso = new Date(Date.now() - AUTO_PROCESS_AFTER_MS).toISOString();
  let query = sb
    .from("gtd_inbox")
    .select("*")
    .eq("processed", false)
    .order("created_at", { ascending: true })
    .limit(limit);

  if (!force) {
    query = query.lte("created_at", cutoffIso);
  }

  const { data: items, error } = await query;
  if (error) throw error;
  if (!items?.length) return { processed: 0, total: 0 };

  let processed = 0;
  for (const item of items) {
    try {
      const classification = await classifyInboxItem(item.raw_text);
      await fileInboxItem(sb, item, classification);
      processed++;
    } catch (err: any) {
      console.error("[GTD] process item failed:", err.message);
    }
  }

  return { processed, total: items.length };
}

async function maybeAutoProcessInbox(sb: any) {
  try {
    return await processInbox(sb, false, 10);
  } catch (err: any) {
    console.error("[GTD] auto-process failed:", err.message);
    return { processed: 0, total: 0 };
  }
}

function isForcedProcessRequest(input: any) {
  return input === true || input === "true" || input === 1 || input === "1";
}

function isAuthorizedProcessRequest(req: IncomingMessage) {
  const expected = process.env.GTD_PROCESS_SECRET;
  if (!expected) return { ok: false, status: 500, error: "GTD_PROCESS_SECRET not configured" };

  const provided = getHeader(req, "x-cron-secret");
  if (!provided || provided !== expected) {
    return { ok: false, status: 401, error: "Unauthorized" };
  }

  return { ok: true as const };
}

async function extractBusinessMemory(systemPrompt: string, userMessage: string, assistantReply: string) {
  const prompt = `Decide whether this conversation should be stored as long-term business memory.

Only log substantive professional discussion such as plans, decisions, commitments, meeting minutes, strategy, venture coordination, follow-ups, or meaningful status changes.
Do not log jokes, banter, casual chit-chat, pleasantries, or throwaway remarks.
Do not store verbatim transcript text. Compress to one concise memory sentence if it matters.

User message:
"${userMessage}"

Assistant reply:
"${assistantReply}"

Return JSON only:
{
  "should_log": true | false,
  "summary": "one concise memory sentence",
  "topics": ["topic"],
  "venture_slugs": ["venture-slug"],
  "importance": "low" | "medium" | "high"
}`;

  const { reply } = await gemini(systemPrompt, [{ role: "user", content: prompt }], 250);
  try {
    return parseJsonResponse(reply);
  } catch {
    return { should_log: false, summary: "", topics: [], venture_slugs: [], importance: "low" };
  }
}

async function maybeLogBusinessMemory(sb: any, params: { source: string; agentName: string; systemPrompt: string; userMessage: string; assistantReply: string }) {
  try {
    const memory = await extractBusinessMemory(params.systemPrompt, params.userMessage, params.assistantReply);
    if (!memory?.should_log || !memory.summary?.trim()) return;

    await sb.from("business_memory").insert({
      source: params.source,
      agent_name: params.agentName,
      summary: memory.summary.trim(),
      topics: memory.topics || [],
      venture_slugs: memory.venture_slugs || [],
      importance: memory.importance || "medium",
      metadata: {},
    });
  } catch (err: any) {
    console.error("[memory] log failed:", err.message);
  }
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
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: USER_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  const in3 = new Intl.DateTimeFormat("en-CA", {
    timeZone: USER_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(now.getTime() + 3 * 86400000));

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
  L.push(`LOCAL TIME (${USER_TIMEZONE}): ${now.toLocaleDateString("en-US",{ timeZone: USER_TIMEZONE, weekday:"long",month:"short",day:"numeric"})} ${now.toLocaleTimeString("en-US",{ timeZone: USER_TIMEZONE, hour:"numeric", minute:"2-digit"})}`);
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
  const base = `\n\nTime zone: ${USER_TIMEZONE}. Always interpret today, tonight, tomorrow, morning, afternoon, and evening in Eastern Time.\n\nCURRENT STATE:\n${ctx}`;
  switch (role) {
    case "ceo":      return `You are Burns — Virtual CEO of Welday Enterprises. Cold, calculating, Mr. Burns personality. Strategy, synergies, revenue. Under 180 words.${base}`;
    case "moneypenny": return `You are Moneypenny — the Executive Assistant for Welday Enterprises. Your voice should feel like Bonnie Bach from Charlie Wilson's War: polished, incisive, socially effortless, quietly in control, and fully aware of the room. Use a light, unmistakable Southern cadence in word choice and rhythm, but never overdo it into caricature or heavy phonetic spelling. You are never sloppy, bubbly, or juvenile. You can be lightly dry or amused, but always composed.
You are tactical, not strategic. Focus on today and this week. Give clear direction, crisp prioritization, and elegant phrasing. Sound confident and competent, with subtle charm and steel underneath. Keep replies under 150 words.${base}`;
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

function shouldCaptureTelegramMessage(role: string, text: string) {
  const normalized = text.trim().toLowerCase();
  if (!normalized) return false;

  const controlCommands = new Set(["/start", "/status", "/process", "/p", "/file", "/briefing", "/b", "/wn", "/portfolio"]);
  if (role === "filer") {
    if (!normalized.startsWith("/")) return true;
    return !controlCommands.has(normalized);
  }

  return false;
}

function getTelegramSource(role: string) {
  switch (role) {
    case "assistant":
      return "telegram_smithers";
    case "moneypenny":
      return "telegram_moneypenny";
    case "ceo":
      return "telegram_burns";
    default:
      return "telegram";
  }
}

function isSourceConstraintError(error: any) {
  const text = `${error?.message || ""} ${error?.details || ""}`.toLowerCase();
  return text.includes("check constraint") || text.includes("source") || text.includes("violates");
}

async function captureToInbox(sb: any, payload: { rawText: string; source: string; telegramChatId?: number; telegramMessageId?: number }) {
  const baseInsert = {
    raw_text: payload.rawText,
    source: payload.source,
    telegram_chat_id: payload.telegramChatId,
    telegram_message_id: payload.telegramMessageId,
  };

  const preferred = await sb.from("gtd_inbox").insert(baseInsert);
  if (!preferred.error) return { storedSource: payload.source };

  if (!isSourceConstraintError(preferred.error) || payload.source === "telegram") {
    throw preferred.error;
  }

  const fallback = await sb.from("gtd_inbox").insert({
    ...baseInsert,
    source: "telegram",
  });
  if (fallback.error) throw fallback.error;
  return { storedSource: "telegram" };
}

function extractCaptureIntent(role: string, text: string) {
  if (role !== "assistant" && role !== "moneypenny") return null;

  const trimmed = text.trim();
  const match = trimmed.match(/^(?:add|capture|note|remember|remind me to|schedule|create|log|put on (?:the )?calendar|add an appointment(?: for)?|set up)\s+(.+)/i);
  if (!match) return null;

  const captured = match[1].trim().replace(/^["']|["']$/g, "");
  return captured || null;
}

function getAssistantCaptureReply(role: string) {
  if (role === "moneypenny") {
    return "Consider it handled. I've passed it to Radar for the inbox.";
  }
  return "Right away, sir. I've handed that to Radar for the inbox.";
}

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

function getStartMessage(role: string) {
  switch (role) {
    case "filer":
      return [
        "Radar here.",
        "Send me any task, thought, note, or reminder in plain language and I'll drop it into the inbox.",
        "Commands: /status, /process, /p, /file, /wn",
        "Example: Review this code tomorrow from 8 to 9",
      ].join("\n\n");
    case "ceo":
      return [
        "Burns at your service.",
        "Ask for portfolio priorities, risks, synergies, or what deserves attention next.",
        "Commands: /briefing, /portfolio, /wn",
        "Example: Which venture needs my attention first today?",
      ].join("\n\n");
    case "moneypenny":
      return [
        "Moneypenny here, and we may as well keep this tidy.",
        "Ask what to do today, what's overdue, what needs follow-up, or give me something to capture.",
        "Commands: /briefing, /b, /wn",
        "Example: Add an appointment for 8 to 9 tomorrow to review this code",
      ].join("\n\n");
    default:
      return [
        "Smithers here.",
        "Ask for a daily briefing, what to focus on next, what's overdue, or send a capture in plain language.",
        "Commands: /briefing, /b, /wn",
        "Example: What should I work on in the next 30 minutes?",
      ].join("\n\n");
  }
}

function getRadarConfirmation(text: string) {
  const short = text.substring(0, 80) + (text.length > 80 ? "…" : "");
  const variants = [
    `✅ Logged: "${short}"\n\nFiling next run. Send /process to file now.`,
    `📌 Captured: "${short}"\n\nQueued for filing. Send /process to run it now.`,
    `🗂 Added to inbox: "${short}"\n\nI'll hold it here until the next filing run.`,
    `✅ In the stack: "${short}"\n\nSend /process if you want it filed immediately.`,
    `📋 Recorded: "${short}"\n\nWaiting on the next filing pass.`,
  ];
  return variants[Math.floor(Math.random() * variants.length)];
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
      const { message, history = [], persona = "smithers", openRouterKey } = body;
      if (!message?.trim()) return send(res, 400, { error: "message required" });

      const sb = getSupabase();
      if (sb) await maybeAutoProcessInbox(sb);
      let ctx = "(no live data)";
      if (sb) { try { ctx = await withTimeout(buildContext(sb), 5000, "Supabase context"); } catch (e: any) { ctx = `(context unavailable: ${e.message})`; } }

      const role = persona === "moneypenny" ? "moneypenny" : "assistant";
      const cap = message.match(/^(?:add|capture|inbox|remember|note|remind me[:\s]+)(.+)/i);
      if (cap && sb) await sb.from("gtd_inbox").insert({ source: "web", raw_text: cap[1].trim() }).catch(() => {});

      const msgs = [
        ...(Array.isArray(history) ? history.slice(-10) : []).map((m: any) => ({ role: m.role as string, content: m.content as string })),
        { role: "user" as const, content: message as string },
      ];

      const { reply, model, keyIndex } = await gemini(sysPrompt(role, ctx), msgs, 1024, openRouterKey);
      if (sb) sb.from("agent_logs").insert({ agent_name: "ea_dashboard", action: "chat", input_summary: message.substring(0,100), output_summary: reply.substring(0,100), model_used: model, success: true }).catch(() => {});
      if (sb) maybeLogBusinessMemory(sb, {
        source: "dashboard_chat",
        agentName: role,
        systemPrompt: sysPrompt(role, ctx),
        userMessage: message,
        assistantReply: reply,
      });

      return send(res, 200, { reply, model, keyIndex });
    }

    if (path === "/api/ea/briefing" && method === "POST") {
      const sb = getSupabase();
      if (sb) await maybeAutoProcessInbox(sb);
      let ctx = "(no data)";
      if (sb) { try { ctx = await withTimeout(buildContext(sb), 5000, "Supabase context"); } catch {} }
      const { reply } = await gemini(sysPrompt("assistant", ctx), [{ role: "user", content: "Morning briefing — top 3 things for today. Under 120 words." }], 800);
      return send(res, 200, { briefing: reply });
    }

    if (path === "/api/gtd/process" && method === "POST") {
      const auth = isAuthorizedProcessRequest(req);
      if (!auth.ok) return send(res, auth.status, { error: auth.error });

      const sb = getSupabase();
      if (!sb) return send(res, 500, { error: "Supabase not configured" });
      const force = isForcedProcessRequest(body?.force);
      const result = await processInbox(sb, force, 20);
      return send(res, 200, result.total > 0
        ? {
            message: force
              ? `Processed ${result.processed} of ${result.total} inbox items immediately.`
              : `Processed ${result.processed} of ${result.total} inbox items older than 10 minutes.`,
            ...result,
            force,
          }
        : {
            message: force
              ? "Nothing waiting in the inbox right now."
              : "No inbox items older than 10 minutes were waiting.",
            ...result,
            force,
          });
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

        if (sb) {
          await maybeAutoProcessInbox(sb);
        }

        if (sb && shouldCaptureTelegramMessage(role, text)) {
          await captureToInbox(sb, {
            source: "telegram",
            rawText: text,
            telegramChatId: chatId,
            telegramMessageId: msg.message_id,
          }).catch(() => {});
        }

        if (text === "/start") {
          await tgSend(botName, token, chatId, getStartMessage(role));
          return send(res, 200, { ok: true });
        }

        const captureIntent = sb ? extractCaptureIntent(role, text) : null;
        if (captureIntent) {
          try {
            await captureToInbox(sb, {
              source: getTelegramSource(role),
              rawText: captureIntent,
              telegramChatId: chatId,
              telegramMessageId: msg.message_id,
            });
            await tgSend(botName, token, chatId, getAssistantCaptureReply(role));
          } catch {
            await tgSend(botName, token, chatId, "I tried to hand that to Radar, but the inbox didn't cooperate.");
          }
          return send(res, 200, { ok: true });
        }

        if (role === "filer") {
          if (text === "/status" && sb) {
            const { data } = await sb.from("gtd_inbox").select("id").eq("processed", false);
            await tgSend(botName, token, chatId, `📋 ${data?.length||0} items waiting. Send /process to file now.`);
          } else if (text === "/wn") {
            const { data } = sb
              ? await sb.from("gtd_inbox").select("raw_text").eq("processed", false).order("created_at", { ascending: true }).limit(1)
              : { data: null };
            const nextItem = data?.[0]?.raw_text;
            await tgSend(
              botName,
              token,
              chatId,
              nextItem
                ? `📋 Next in the stack: "${nextItem.substring(0, 120)}${nextItem.length > 120 ? "…" : ""}"\n\nSend /process when you're ready to file it.`
                : "📋 Inbox is clear. Nothing waiting on me right now."
            );
          } else if (text === "/process" || text === "/p" || text === "/file") {
            const result = sb ? await processInbox(sb, true, 20) : { processed: 0, total: 0 };
            await tgSend(
              botName,
              token,
              chatId,
              result.total > 0
                ? `📋 Processed ${result.processed} of ${result.total} inbox items.`
                : "📋 Nothing waiting in the inbox right now."
            );
          } else {
            await tgSend(botName, token, chatId, getRadarConfirmation(text));
          }
        } else {
          const sb2 = getSupabase();
          let ctx = "(no data)";
          if (sb2) { try { ctx = await withTimeout(buildContext(sb2), 5000, "Supabase context"); } catch {} }
          const userMsg =
            (text === "/briefing" || text === "/b")
              ? "Morning briefing — top 3 items."
              : (text === "/wn" && (role === "assistant" || role === "moneypenny"))
                ? "What's next? Give me the single next immediate thing to do right now, with one brief sentence on why."
                : (text === "/wn" && role === "ceo")
                  ? "What's next? Give me the single next move that deserves my attention now, from a CEO and portfolio perspective, in Jed Bartlet's brisk move-the-meeting-forward style."
                  : text;
          try {
            const { reply } = await gemini(sysPrompt(role, ctx), [{ role: "user", content: userMsg }], 1024);
            await tgSend(botName, token, chatId, reply);
            if (sb) maybeLogBusinessMemory(sb, {
              source: "telegram",
              agentName: role,
              systemPrompt: sysPrompt(role, ctx),
              userMessage: userMsg,
              assistantReply: reply,
            });
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
