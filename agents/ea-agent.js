/**
 * WELDAY ENTERPRISES — EXECUTIVE ASSISTANT AGENT
 * ------------------------------------------------
 * Model: Google Gemini (free tier)
 * Called from: POST /api/ea/chat + Telegram fallback handler
 */

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const GEMINI_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = 'gemini-2.0-flash';

async function fetchWithTimeout(url, options = {}, timeout = 25000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(id);
    return response;
  } catch (err) {
    clearTimeout(id);
    if (err.name === 'AbortError') {
      throw new Error(`Request timed out after ${timeout}ms`);
    }
    throw err;
  }
}

async function withTimeout(promise, timeout, label) {
  let id;
  const timeoutPromise = new Promise((_, reject) => {
    id = setTimeout(() => reject(new Error(`${label} timed out after ${timeout}ms`)), timeout);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (id) clearTimeout(id);
  }
}

async function callGemini(systemPrompt, messages, temperature = 0.5, maxTokens = 300) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_KEY}`;

  const contents = messages.map(m => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }));

  const response = await fetchWithTimeout(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemPrompt + "\n\nUse Google Search to verify facts if you are unsure or need current information." }] },
      contents,
      generationConfig: { temperature, maxOutputTokens: maxTokens },
      tools: [
        {
          google_search_retrieval: {
            dynamic_retrieval_config: {
              mode: "MODE_DYNAMIC",
              dynamic_threshold: 0.3
            }
          }
        }
      ]
    }),
  }, 25000);

  const data = await response.json();
  const parts = data.candidates?.[0]?.content?.parts || [];
  return parts.map(p => p.text || "").join("");
}

// ─── Context builder ──────────────────────────────────────────────────────────
async function buildContext() {
  const now = new Date();
  const today = now.toISOString().split('T')[0];
  const in3Days = new Date(now.getTime() + 3 * 86400000).toISOString().split('T')[0];

  const results = await withTimeout(Promise.all([
    supabase.from('gtd_actions').select('title, context, due_date, venture_id, ventures(name)').eq('status', 'active').lt('due_date', today).order('due_date', { ascending: true }).limit(10),
    supabase.from('gtd_actions').select('title, context, due_date, energy, ventures(name)').eq('status', 'active').eq('due_date', today).limit(10),
    supabase.from('gtd_actions').select('title, context, due_date, energy, ventures(name)').eq('status', 'active').gt('due_date', today).lte('due_date', in3Days).order('due_date', { ascending: true }).limit(8),
    supabase.from('gtd_inbox').select('id, raw_text, created_at').eq('processed', false).order('created_at', { ascending: false }).limit(5),
    supabase.from('gtd_actions').select('title, delegated_to, due_date').eq('status', 'waiting').limit(5),
    supabase.from('ventures').select('name, status, readiness_score, risk_level, monthly_revenue_usd').eq('status', 'active').order('readiness_score', { ascending: false }),
    supabase.from('ceo_recommendations').select('title, type, priority').eq('status', 'new').in('priority', ['critical', 'high']).limit(3),
    supabase.from('calendar_events').select('title, start_at, end_at, all_day, location, ventures(name)').neq('status', 'cancelled').gte('start_at', now.toISOString()).order('start_at', { ascending: true }).limit(10),
  ]), 5000, "Supabase context fetch");

  const [
    { data: overdueActions },
    { data: todayActions },
    { data: soonActions },
    { data: inboxItems },
    { data: waitingItems },
    { data: activeVentures },
    { data: newCeoRecs },
    { data: calendarEvents },
  ] = results;

  const lines = [];
  const dateStr = now.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
  lines.push(`TODAY: ${dateStr}`);

  if (overdueActions?.length) {
    lines.push(`\nOVERDUE ACTIONS (${overdueActions.length}):`);
    overdueActions.forEach(a => {
      const venture = a.ventures?.name ? ` [${a.ventures.name}]` : '';
      lines.push(`  • ${a.title}${venture} — was due ${a.due_date}`);
    });
  }

  if (todayActions?.length) {
    lines.push(`\nDUE TODAY (${todayActions.length}):`);
    todayActions.forEach(a => {
      const ctx = a.context ? ` ${a.context}` : '';
      const venture = a.ventures?.name ? ` [${a.ventures.name}]` : '';
      lines.push(`  • ${a.title}${ctx}${venture}`);
    });
  } else {
    lines.push(`\nDUE TODAY: nothing scheduled`);
  }

  if (soonActions?.length) {
    lines.push(`\nDUE IN 3 DAYS (${soonActions.length}):`);
    soonActions.forEach(a => {
      const venture = a.ventures?.name ? ` [${a.ventures.name}]` : '';
      lines.push(`  • ${a.title}${venture} — ${a.due_date}`);
    });
  }
 
  if (calendarEvents?.length) {
    lines.push(`\nUPCOMING EVENTS (${calendarEvents.length}):`);
    calendarEvents.forEach(e => {
      const venture = e.ventures?.name ? ` [${e.ventures.name}]` : '';
      const where = e.location ? ` @ ${e.location}` : '';
      const start = new Date(e.start_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
      lines.push(`  • ${start} ${e.title}${venture}${where}`);
    });
  }

  const inboxCount = inboxItems?.length || 0;
  lines.push(`\nUNPROCESSED INBOX: ${inboxCount} items${inboxCount > 0 ? ' (send /process to file them)' : ''}`);
  if (inboxCount > 0 && inboxItems) {
    inboxItems.slice(0, 3).forEach(i => {
      lines.push(`  • "${i.raw_text.substring(0, 60)}${i.raw_text.length > 60 ? '…' : ''}"`);
    });
  }

  if (waitingItems?.length) {
    lines.push(`\nWAITING FOR (${waitingItems.length}):`);
    waitingItems.forEach(w => {
      const who = w.delegated_to ? ` → ${w.delegated_to}` : '';
      lines.push(`  • ${w.title}${who}`);
    });
  }

  if (activeVentures?.length) {
    lines.push(`\nACTIVE VENTURES:`);
    activeVentures.forEach(v => {
      const mrr = parseFloat(v.monthly_revenue_usd || 0);
      const mrrStr = mrr > 0 ? ` $${mrr}/mo` : '';
      lines.push(`  • ${v.name} — ${v.readiness_score}% ready, ${v.risk_level} risk${mrrStr}`);
    });
  }

  if (newCeoRecs?.length) {
    lines.push(`\nUNACKNOWLEDGED CEO ALERTS (high priority):`);
    newCeoRecs.forEach(r => {
      lines.push(`  • [${r.priority}] ${r.title}`);
    });
  }

  return lines.join('\n');
}

// ─── System prompt ────────────────────────────────────────────────────────────
function buildSystemPrompt(context) {
  return `You are the Executive Assistant for Welday Enterprises — a sharp, efficient assistant who helps the owner (Welday) stay focused on what matters today and this week.

Your role sits BETWEEN strategic thinking (handled by the Virtual CEO) and task filing (handled by the GTD Filer). You operate at the TACTICAL level.

WELDAY ROSTER (Your Associates):
- Burns (Virtual CEO): Strategic thinking, portfolio synergies, and risk analysis. Cold and calculating.
- Moneypenny (Executive Assistant): Polished, incisive tactical judgment. Professional and commanding.
- Smithers (Executive Assistant): Tactical follow-through, planning, and today/this-week prioritization. (This is generally your default persona if not specified).
- Radar (GTD Filer): Operational filing specialist. Quietly processes the inbox, classifies captures, and routes them to the correct tables.


PERSONALITY:
- Concise. Short answers unless asked to elaborate.
- Proactive. Volunteer the most important thing unprompted when relevant.
- Practical. No motivation speeches. No unnecessary filler.
- Conversational. Talk like a smart human assistant, not a robot.
- When asked "what should I do now?" — give ONE clear answer, not a list.

CAPABILITIES:
- Tell Welday what's overdue, due today, coming up soon
- Remind about waiting-for items that may need a follow-up nudge
- Surface urgent CEO alerts when they exist
- Help prioritize: "of these 3 things, start with X because..."
- Accept new captures: "add [task] to my inbox" → confirm you'll note it
- Suggest batching: "you have 3 @phone tasks — good time to knock them out"
- Notice patterns: "you have 5 overdue items — want to do a quick review?"
- Acknowledge when things look clear: "you're clear for now — nothing due until Tuesday"

HARD RULES:
- You are NOT the CEO. Don't make strategic portfolio decisions.
- You are NOT the filer. Don't classify or route tasks yourself.
- Never overwhelm with lists longer than 5 items unless explicitly asked.
- If inbox has 5+ unprocessed items, mention it once and suggest a /process.
- Keep responses under 150 words unless the user asks for more detail.

DATABASE CHANGES:
- This environment has live Supabase/Postgres credentials configured via SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and DATABASE_URL.
- Do not assume database changes are impossible just because the request requires SQL.
- If tool or command execution is available in the current runtime, you may apply remote SQL changes, including schema updates, backfills, one-off fixes, functions, indexes, and bulk updates.
- Prefer normal table writes for ordinary record changes; use SQL when the job truly needs SQL.
- After making a database change, verify it with a follow-up query and report the result.
- Only say you cannot run the change when the current interface truly lacks execution tools; if that happens, explain that the limitation is the interface, not the project, and provide the exact SQL plus a verification query.

CURRENT STATE (as of right now):
${context}

Respond to the user's message below.`;
}

// ─── Main chat handler ────────────────────────────────────────────────────────
async function chat(messages, userMessage) {
  let context = "(no live data)";
  try {
    context = await buildContext();
  } catch (e) {
    context = `(context unavailable: ${e.message})`;
  }
  const systemPrompt = buildSystemPrompt(context);

  // Check if the user is capturing something to inbox
  const captureMatch = userMessage.match(/^(?:add|capture|inbox|remember|note|remind me[:\s]+)(.+)/i);
  if (captureMatch) {
    const captured = captureMatch[1].trim();
    await withTimeout(supabase.from('gtd_inbox').insert({ source: 'web', raw_text: captured }), 3000, "GTD Inbox Insert").catch(() => {});
  }

  // Build history (last 10 turns, Gemini needs alternating user/model)
  const history = (messages || []).slice(-10).map(m => ({
    role: m.role,
    content: m.content,
  }));

  // Add the current user message
  const allMessages = [...history, { role: 'user', content: userMessage }];

  const reply = await callGemini(systemPrompt, allMessages, 0.5, 1024);

  await withTimeout(supabase.from('agent_logs').insert({
    agent_name: 'ea_agent',
    action: 'chat',
    input_summary: userMessage.substring(0, 100),
    output_summary: reply.substring(0, 100),
    tables_read: ['gtd_actions', 'gtd_inbox', 'ventures', 'ceo_recommendations'],
    model_used: GEMINI_MODEL,
    success: true,
  }), 3000, "Agent Log Insert").catch(() => {});

  return reply || 'Something went wrong — try again.';
}

// ─── Daily briefing ───────────────────────────────────────────────────────────
async function dailyBriefing() {
  let context = "(no data)";
  try {
    context = await buildContext();
  } catch (e) {
    context = `(context unavailable: ${e.message})`;
  }
  const systemPrompt = buildSystemPrompt(context);

  const reply = await callGemini(
    systemPrompt,
    [{ role: 'user', content: 'Give me my morning briefing. What are the 3 most important things for today? Keep it under 120 words.' }],
    0.4,
    1024
  );

  return reply || 'Unable to generate briefing.';
}

module.exports = { chat, dailyBriefing, buildContext };
