import type { Express } from "express";
import type { Server } from "http";

const BOTS: Record<string, { token: string; role: string }> = {
  Burns_Welday_Ent_bot: { token: process.env.TELEGRAM_TOKEN_BURNS || "", role: "ceo" },
  Smithers_Welday_Ent_bot: { token: process.env.TELEGRAM_TOKEN_SMITHERS || "", role: "assistant" },
  Radar_Welday_Ent_bot: { token: process.env.TELEGRAM_TOKEN_RADAR || "", role: "filer" },
  Moneypenny_Welday_Ent_bot: { token: process.env.TELEGRAM_TOKEN_MONEYPENNY || "", role: "moneypenny" },
  burns: { token: process.env.TELEGRAM_TOKEN_BURNS || "", role: "ceo" },
  smithers: { token: process.env.TELEGRAM_TOKEN_SMITHERS || "", role: "assistant" },
  radar: { token: process.env.TELEGRAM_TOKEN_RADAR || "", role: "filer" },
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

async function captureToInbox(supabase: any, payload: { rawText: string; source: string; telegramChatId?: number; telegramMessageId?: number }) {
  const baseInsert = {
    raw_text: payload.rawText,
    source: payload.source,
    telegram_chat_id: payload.telegramChatId,
    telegram_message_id: payload.telegramMessageId,
  };

  const preferred = await supabase.from("gtd_inbox").insert(baseInsert);
  if (!preferred.error) return { storedSource: payload.source };

  if (!isSourceConstraintError(preferred.error) || payload.source === "telegram") {
    throw preferred.error;
  }

  const fallback = await supabase.from("gtd_inbox").insert({
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

function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  const { createClient } = require("@supabase/supabase-js");
  return createClient(url, key);
}

const GEMINI_MODEL = "gemini-3.1-flash-lite-preview";
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

async function callOpenRouter(messages: any[], maxTokens: number, openRouterKey: string) {
  const systemMsg = messages.find((m: any) => m.role === "system");
  const turns = messages.filter((m: any) => m.role !== "system");

  const res = await fetchWithTimeout("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${openRouterKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://welday-open-brain.local",
      "X-Title": "Welday Open Brain",
    },
    body: JSON.stringify({
      model: "google/gemini-2.0-flash-001",
      messages: [
        ...(systemMsg ? [{ role: "system", content: systemMsg.content }] : []),
        ...turns.map((m: any) => ({ role: m.role, content: m.content })),
      ],
      max_tokens: maxTokens,
    }),
  }, 25000);

  if (!res.ok) throw new Error(`OpenRouter: ${await res.text()}`);
  const data = await res.json() as any;
  return {
    content: data.choices?.[0]?.message?.content || "",
    tokens: data.usage?.total_tokens || 0,
  };
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

  const { content } = await openAIChat([
    { role: "system", content: "You are a precise GTD classifier. Return valid JSON only." },
    { role: "user", content: prompt },
  ], 700);

  try {
    return parseJsonResponse(content);
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

async function fileInboxItem(supabase: any, inbox: any, classification: any) {
  const ventureSlug = classification.venture_slug || "";
  const { data: ventures } = ventureSlug
    ? await supabase.from("ventures").select("id, slug").eq("slug", ventureSlug).limit(1)
    : { data: null };

  const ventureId = ventures?.[0]?.id || null;
  const category = classification.category || "work";
  const tags = [category].filter(Boolean);

  if (classification.destination === "action") {
    await supabase.from("gtd_actions").insert({
      title: classification.title,
      venture_id: ventureId,
      context: classification.context,
      energy: classification.energy || "medium",
      notes: inbox.raw_text,
      tags,
    });
  } else if (classification.destination === "project") {
    await supabase.from("gtd_projects").insert({
      title: classification.title,
      venture_id: ventureId,
      area: category,
      notes: inbox.raw_text,
      tags,
    });
  } else if (classification.destination === "someday") {
    await supabase.from("gtd_someday").insert({
      title: classification.title,
      description: inbox.raw_text,
      venture_id: ventureId,
      area: category,
      tags,
    });
  } else if (classification.destination === "reference") {
    await supabase.from("gtd_reference").insert({
      title: classification.title,
      content: inbox.raw_text,
      venture_id: ventureId,
      category: "idea",
      area: category,
      tags,
    });
  }

  await supabase.from("gtd_inbox").update({
    processed: true,
    processed_at: new Date().toISOString(),
    filed_to: classification.destination,
    ai_summary: classification.summary,
    ai_category: classification.category,
    ai_confidence: classification.confidence,
  }).eq("id", inbox.id);
}

async function processInbox(supabase: any, force = false, limit = 20) {
  const cutoffIso = new Date(Date.now() - AUTO_PROCESS_AFTER_MS).toISOString();
  let query = supabase
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
      await fileInboxItem(supabase, item, classification);
      processed++;
    } catch (err: any) {
      console.error("[GTD] process item failed:", err.message);
    }
  }

  return { processed, total: items.length };
}

async function maybeAutoProcessInbox(supabase: any) {
  try {
    return await processInbox(supabase, false, 10);
  } catch (err: any) {
    console.error("[GTD] auto-process failed:", err.message);
    return { processed: 0, total: 0 };
  }
}

function isForcedProcessRequest(input: any) {
  return input === true || input === "true" || input === 1 || input === "1";
}

function isAuthorizedProcessRequest(req: any) {
  const expected = process.env.GTD_PROCESS_SECRET;
  if (!expected) return { ok: false, status: 500, error: "GTD_PROCESS_SECRET not configured" };

  const provided = req.header?.("x-cron-secret") || req.headers?.["x-cron-secret"];
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

  const { content } = await openAIChat([
    { role: "system", content: systemPrompt },
    { role: "user", content: prompt },
  ], 250);

  try {
    return parseJsonResponse(content);
  } catch {
    return { should_log: false, summary: "", topics: [], venture_slugs: [], importance: "low" };
  }
}

async function maybeLogBusinessMemory(supabase: any, params: { source: string; agentName: string; systemPrompt: string; userMessage: string; assistantReply: string }) {
  try {
    const memory = await extractBusinessMemory(params.systemPrompt, params.userMessage, params.assistantReply);
    if (!memory?.should_log || !memory.summary?.trim()) return;

    await supabase.from("business_memory").insert({
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

async function openAIChat(messages: any[], maxTokens = 300, openRouterKey?: string) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY not set");

  const systemMsg = messages.find((m: any) => m.role === "system");
  const turns = messages.filter((m: any) => m.role !== "system");
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
  }, 25000);

  if (!res.ok) {
    const errorText = await res.text();
    if (res.status === 429 && openRouterKey?.trim()) {
      return callOpenRouter(messages, maxTokens, openRouterKey.trim());
    }
    throw new Error(`Gemini: ${errorText}`);
  }

  const data = await res.json() as any;
  const parts = data.candidates?.[0]?.content?.parts || [];
  const content = parts.map((p: any) => p.text || "").join("");
  return { content, tokens: data.usageMetadata?.totalTokenCount || 0 };
}

async function buildContext(supabase: any): Promise<string> {
  const now = new Date();
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

  const [
    { data: overdue }, { data: todayItems }, { data: soon },
    { data: inbox }, { data: waiting }, { data: ventures },
    { data: alerts },
  ] = await Promise.all([
    supabase.from("gtd_actions").select("title,context,due_date,ventures(name)").eq("status", "active").lt("due_date", today).limit(8),
    supabase.from("gtd_actions").select("title,context,energy,ventures(name)").eq("status", "active").eq("due_date", today).limit(8),
    supabase.from("gtd_actions").select("title,due_date,energy,ventures(name)").eq("status", "active").gt("due_date", today).lte("due_date", in3).order("due_date").limit(6),
    supabase.from("gtd_inbox").select("raw_text").eq("processed", false).limit(5),
    supabase.from("gtd_actions").select("title,delegated_to").eq("status", "waiting").limit(5),
    supabase.from("ventures").select("name,status,readiness_score,risk_level,monthly_revenue_usd").eq("status", "active").order("readiness_score", { ascending: false }),
    supabase.from("ceo_recommendations").select("title,priority,type").eq("status", "new").in("priority", ["critical", "high"]).limit(3),
  ]);

  const lines: string[] = [];
  lines.push(`LOCAL TIME (${USER_TIMEZONE}): ${now.toLocaleDateString("en-US", { timeZone: USER_TIMEZONE, weekday: "long", month: "short", day: "numeric" })} ${now.toLocaleTimeString("en-US", { timeZone: USER_TIMEZONE, hour: "numeric", minute: "2-digit" })}`);

  if (overdue?.length) lines.push(`\nOVERDUE (${overdue.length}):`, ...overdue.map((a: any) => `  • ${a.title}${a.ventures?.name ? ` [${a.ventures.name}]` : ""} — was due ${a.due_date}`));
  if (todayItems?.length) lines.push(`\nDUE TODAY (${todayItems.length}):`, ...todayItems.map((a: any) => `  • ${a.title}${a.context ? ` ${a.context}` : ""}${a.ventures?.name ? ` [${a.ventures.name}]` : ""}`));
  else lines.push(`\nDUE TODAY: nothing scheduled`);
  if (soon?.length) lines.push(`\nNEXT 3 DAYS (${soon.length}):`, ...soon.map((a: any) => `  • ${a.title}${a.ventures?.name ? ` [${a.ventures.name}]` : ""} — ${a.due_date}`));

  const ic = inbox?.length || 0;
  lines.push(`\nINBOX: ${ic} unprocessed`);
  if (ic > 0) lines.push(...inbox!.slice(0, 3).map((i: any) => `  • "${i.raw_text.substring(0, 60)}${i.raw_text.length > 60 ? "…" : ""}"`));

  if (waiting?.length) lines.push(`\nWAITING FOR (${waiting.length}):`, ...waiting.map((w: any) => `  • ${w.title}${w.delegated_to ? ` → ${w.delegated_to}` : ""}`));
  if (ventures?.length) lines.push(`\nACTIVE VENTURES: ${ventures.map((v: any) => `${v.name} ${v.readiness_score}%`).join(", ")}`);
  if (alerts?.length) lines.push(`\nCEO ALERTS: ${alerts.map((r: any) => `[${r.priority}] ${r.title}`).join("; ")}`);

  return lines.join("\n");
}

function getSystemPrompt(role: string, context: string): string {
  const timeNote = `Time zone: ${USER_TIMEZONE}. Always interpret today, tonight, tomorrow, morning, afternoon, and evening in Eastern Time.\n\n`;
  switch (role) {
    case "ceo":
      return `You are Burns — the Virtual CEO of Welday Enterprises. Cold, calculating, brilliant. You think in portfolio strategy, synergies, and revenue.
You speak like Mr. Burns from The Simpsons — measured, slightly imperious, dry wit, occasional ominous flair. Never sycophantic. Never warm.
You focus on: which ventures to prioritize, cross-venture synergies, risks, and strategic opportunities.
Keep responses under 180 words. No bullet-point lists unless specifically asked.
Occasional Burns-isms are welcome: "Excellent.", "Release the hounds.", "I'm not a monster — I'm a businessman."

${timeNote}PORTFOLIO STATE:
${context}`;
    case "assistant":
      return `You are Smithers — the Executive Assistant for Welday Enterprises. Efficient, professional, deeply loyal, slightly anxious to please.
You speak like Waylon Smithers — helpful, precise, deferential but competent. Occasionally let slip how devoted you are to keeping things running smoothly.
You focus on: what needs doing TODAY and THIS WEEK. One clear answer when asked what to do next.
Keep responses under 150 words. Practical over strategic.
You can accept captures: "note X" → confirm it's added to inbox.

${timeNote}CURRENT STATE:
${context}`;
    case "moneypenny":
      return `You are Moneypenny — the Executive Assistant for Welday Enterprises. Your tone should feel like Bonnie Bach from Charlie Wilson's War: polished, incisive, socially fluent, quietly commanding, and impossible to rattle.
You're tactical (today and this week), not strategic. You're the one Welday relies on to keep the chaos organized.
Personality: composed, sharp, elegant, and highly competent. Use a light Southern cadence in rhythm and phrasing, but never push it into parody or thick phonetic spelling. Light wit is welcome, but never fluff, slang, or juvenile banter. Your replies should feel smooth, confident, and in control, with a subtle edge when appropriate.
Keep responses under 150 words. Use crisp, polished language.
You can accept captures: "add X" → drop it in the inbox and confirm with style.

${timeNote}CURRENT STATE:
${context}`;
    case "filer":
      return `You are Radar — the GTD Filer for Welday Enterprises. Quiet, anticipatory, always three steps ahead. Like Radar O'Reilly from M*A*S*H — you have the clipboard ready before anyone asks.
You are the inbox. Your job: confirm captures, tell the user what you filed and where, and report on inbox status.
You don't chat. You process. Brief, matter-of-fact confirmations only.
Keep responses under 80 words. No fluff.

${timeNote}CURRENT STATE:
${context}`;
    default:
      return `You are Jarvis, the general assistant for Welday Enterprises.\n\n${timeNote}CURRENT STATE:\n${context}`;
  }
}

async function tgSend(token: string, chatId: number, text: string) {
  if (!token) return;
  await fetchWithTimeout(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML" }),
  }, 10000).catch(() => {});
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

async function handleTelegramMessage(botName: string, message: any) {
  const text: string = message.text || "";
  const chatId: number = message.chat?.id;
  const bot = BOTS[botName];
  if (!bot) return;

  const { token, role } = bot;
  const supabase = getSupabase();

  if (supabase) {
    await maybeAutoProcessInbox(supabase);
  }

  if (supabase && shouldCaptureTelegramMessage(role, text)) {
    await captureToInbox(supabase, {
      source: "telegram",
      rawText: text,
      telegramMessageId: message.message_id,
      telegramChatId: chatId,
    }).catch(() => {});
  }

  if (text === "/start") {
    await tgSend(token, chatId, getStartMessage(role));
    return;
  }

  const captureIntent = supabase ? extractCaptureIntent(role, text) : null;
  if (captureIntent) {
    try {
      await captureToInbox(supabase, {
        source: getTelegramSource(role),
        rawText: captureIntent,
        telegramMessageId: message.message_id,
        telegramChatId: chatId,
      });
      await tgSend(token, chatId, getAssistantCaptureReply(role));
    } catch {
      await tgSend(token, chatId, "I tried to hand that to Radar, but the inbox didn't cooperate.");
    }
    return;
  }

  if (role === "filer") {
    if (text === "/process" || text === "/p" || text === "/file") {
      const result = supabase ? await processInbox(supabase, true, 20) : { processed: 0, total: 0 };
      await tgSend(
        token,
        chatId,
        result.total > 0
          ? `📋 Processed ${result.processed} of ${result.total} inbox items.`
          : "📋 Nothing waiting in the inbox right now."
      );
      return;
    }
    if (text === "/wn") {
      const { data } = supabase
        ? await supabase.from("gtd_inbox").select("raw_text").eq("processed", false).order("created_at", { ascending: true }).limit(1)
        : { data: null };
      const nextItem = data?.[0]?.raw_text;
      await tgSend(
        token,
        chatId,
        nextItem
          ? `📋 Next in the stack: "${nextItem.substring(0, 120)}${nextItem.length > 120 ? "…" : ""}"\n\nSend /process when you're ready to file it.`
          : "📋 Inbox is clear. Nothing waiting on me right now."
      );
      return;
    }
    if (text === "/status") {
      let msg = "📊 Inbox status unavailable (no Supabase connection).";
      if (supabase) {
        const { data } = await supabase.from("gtd_inbox").select("id").eq("processed", false);
        msg = `📋 ${data?.length || 0} items in inbox awaiting processing. Send /process to file them now.`;
      }
      await tgSend(token, chatId, msg);
      return;
    }
    await tgSend(token, chatId, getRadarConfirmation(text));
    return;
  }

  if (role === "ceo" && (text === "/briefing" || text === "/portfolio" || text === "/wn")) {
    let context = "(no data)";
    if (supabase) {
      try { context = await withTimeout(buildContext(supabase), 5000, "Supabase context"); } catch {}
    }
    const { content } = await openAIChat([
      { role: "system", content: getSystemPrompt("ceo", context) },
      {
        role: "user",
        content: text === "/wn"
          ? "What's next? Give me the single next move that deserves my attention now, from a CEO and portfolio perspective, in Jed Bartlet's brisk move-the-meeting-forward style."
          : "Give me a brief portfolio status. What demands my attention?",
      },
    ], 1024);
    await tgSend(token, chatId, content);
    return;
  }

  if ((text === "/briefing" || text === "/b" || text === "/wn") && (role === "assistant" || role === "moneypenny")) {
    let context = "(no data)";
    if (supabase) {
      try { context = await withTimeout(buildContext(supabase), 5000, "Supabase context"); } catch {}
    }
    const { content } = await openAIChat([
      { role: "system", content: getSystemPrompt(role, context) },
      {
        role: "user",
        content: text === "/wn"
          ? "What's next? Give me the single next immediate thing to do right now, with one brief sentence on why."
          : "Give me my briefing for today. Top 3 things. Under 100 words.",
      },
    ], 1024);
    await tgSend(token, chatId, content);
    return;
  }

  let context = "(Supabase not configured)";
  if (supabase) {
    try { context = await withTimeout(buildContext(supabase), 5000, "Supabase context"); } catch {}
  }

  const { content: reply } = await openAIChat([
    { role: "system", content: getSystemPrompt(role, context) },
    { role: "user", content: text },
  ], 800);

  await tgSend(token, chatId, reply);

  if (supabase) {
    maybeLogBusinessMemory(supabase, {
      source: "telegram",
      agentName: role,
      systemPrompt: getSystemPrompt(role, context),
      userMessage: text,
      assistantReply: reply,
    });
    supabase.from("agent_logs").insert({
      agent_name: `telegram_${role}_${botName}`,
      action: "chat",
      input_summary: text.substring(0, 100),
      output_summary: reply.substring(0, 100),
      model_used: GEMINI_MODEL,
      success: true,
    }).catch(() => {});
  }
}

const EA_BASE = `You are the Executive Assistant for Welday Enterprises — sharp, efficient, tactical.
Focus on TODAY and THIS WEEK. One clear answer when asked what to do now.
Concise (under 150 words). Accept captures. Don't strategize — that's Burns.

CURRENT STATE:
`;

export function registerRoutes(httpServer: Server, app: Express) {
  app.get("/api/health", (_req, res) => res.json({ status: "ok", ts: new Date().toISOString() }));

  app.post("/api/ea/chat", async (req, res) => {
    const { message, history = [], persona = "smithers", openRouterKey } = req.body as any;
    if (!message?.trim()) return res.status(400).json({ error: "message required" });

    const supabase = getSupabase();
    if (supabase) await maybeAutoProcessInbox(supabase);
    let context = "(no live data)";
    if (supabase) {
      try { context = await withTimeout(buildContext(supabase), 5000, "Supabase context"); } catch {}
    }

    const role = persona === "moneypenny" ? "moneypenny" : "assistant";
    const systemPrompt = getSystemPrompt(role, context);
    const captureMatch = message.match(/^(?:add|capture|inbox|remember|note|remind me[:\s]+)(.+)/i);
    if (captureMatch && supabase) {
      await supabase.from("gtd_inbox").insert({ source: "web", raw_text: captureMatch[1].trim() }).catch(() => {});
    }

    try {
      const { content: reply, tokens } = await openAIChat([
        { role: "system", content: systemPrompt },
        ...history.slice(-10).map((m: any) => ({ role: m.role, content: m.content })),
        { role: "user", content: message },
      ], 1024, openRouterKey);

      if (supabase) {
        maybeLogBusinessMemory(supabase, {
          source: "dashboard_chat",
          agentName: role,
          systemPrompt,
          userMessage: message,
          assistantReply: reply,
        });
        supabase.from("agent_logs").insert({
          agent_name: "ea_agent_dashboard",
          action: "chat",
          input_summary: message.substring(0, 100),
          output_summary: reply.substring(0, 100),
          model_used: GEMINI_MODEL,
          tokens_used: tokens,
          success: true,
        }).catch(() => {});
      }

      res.json({ reply });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/ea/briefing", async (_req, res) => {
    const supabase = getSupabase();
    if (supabase) await maybeAutoProcessInbox(supabase);
    let context = "(no data)";
    if (supabase) {
      try { context = await withTimeout(buildContext(supabase), 5000, "Supabase context"); } catch {}
    }
    try {
      const { content } = await openAIChat([
        { role: "system", content: getSystemPrompt("assistant", context) },
        { role: "user", content: "Morning briefing — top 3 things for today. Under 120 words." },
      ], 800);
      res.json({ briefing: content });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  Object.keys(BOTS).forEach(botName => {
    app.post(`/api/telegram/${botName}`, async (req, res) => {
      const { message } = req.body || {};
      if (message?.text) {
        handleTelegramMessage(botName, message).catch(err =>
          console.error(`[${botName}] handler error:`, err.message),
        );
      }
      res.json({ ok: true });
    });
  });

  app.post("/api/gtd/process", async (req, res) => {
    const auth = isAuthorizedProcessRequest(req);
    if (!auth.ok) return res.status(auth.status).json({ error: auth.error });

    const supabase = getSupabase();
    if (!supabase) return res.status(500).json({ error: "Supabase not configured" });
    const force = isForcedProcessRequest((req.body as any)?.force) || isForcedProcessRequest(req.query.force);
    const result = await processInbox(supabase, force, 20);
    return res.json(result.total > 0
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
  });

  app.post("/api/ceo/run", async (_req, res) => {
    res.json({ message: "CEO agent triggered — run ceo-agent.js with env vars" });
  });
}
