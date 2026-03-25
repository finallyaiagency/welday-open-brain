/**
 * WELDAY ENTERPRISES — GTD FILER AGENT
 * ----------------------------------------
 * Run: node gtd-filer.js
 * Schedule: Daily, or triggered by /process Telegram command
 * Model: Google Gemini (free tier)
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

async function callGemini(prompt) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_KEY}`;
  const response = await fetchWithTimeout(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.3, maxOutputTokens: 1024 },
    }),
  }, 25000);
  const data = await response.json();
  const parts = data.candidates?.[0]?.content?.parts || [];
  return parts.map(p => p.text || "").join("");
}

async function classifyItem(text) {
  const roster = `WELDAY ROSTER: Burns (CEO/Strategic), Moneypenny (EA/Tactical), Smithers (EA/Tactical), Radar (Filer/Operational - This is you).`;
  const now = new Date().toISOString();
  const prompt = `You are Radar, the GTD Filer for Welday Enterprises. ${roster}
  
Classify this GTD inbox item and tell me where to file it. Current time (UTC) is ${now}.
  
Inbox text: "${text}"

GTD destinations:
- calendar: MANDATORY for anything with a fixed time or specific appointment duration. (e.g., "meeting at 3", "dentist tomorrow", "noon to one Saturday", "Friday morning", "8-9pm"). If it has a time, it is NOT an action—it is a calendar event.
- action: A concrete next step. Use this for tasks that *could* be done at any time but might have a deadline (due date). If a specific time-of-day is mentioned for when it MUST happen, use 'calendar' instead.
- project: Outcome requiring multiple steps.
- someday: Idea to revisit later.
- reference: Information to keep (not actionable).
- trash: Not worth keeping.

EXAMPLES:
- "Add an appointment for this Saturday. Noon to one eat lunch during class." -> {"destination": "calendar", "title": "Lunch during class", "start_at": "[Saturday 12:00 UTC]", "end_at": "[Saturday 13:00 UTC]"}
- "Call mom tomorrow" -> {"destination": "action", "title": "Call mom"}
- "Dinner at 7pm tonight" -> {"destination": "calendar", "title": "Dinner"}

Respond with JSON only:
{
  "destination": "action" | "project" | "someday" | "reference" | "calendar" | "trash",
  "title": "clean, concise title",
  "summary": "one sentence summary",
  "category": "work" | "personal" | "health" | "finance" | "learning" | "business",
  "venture_slug": "relevant-venture-slug or null",
  "context": "@computer" | "@phone" | "@errands" | "@waiting" | null,
  "start_at": "ISO-8601 UTC date or null if not calendar",
  "end_at": "ISO-8601 UTC date or null if not calendar",
  "energy": "high" | "medium" | "low",
  "confidence": 0.0-1.0
}`;

  const content = await callGemini(prompt);
  let classification;
  try {
    classification = JSON.parse(content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim());
  } catch {
    classification = { destination: 'reference', title: text.substring(0, 80), confidence: 0.5 };
  }

  // ── Safety override: if the text has an explicit time-of-day pattern, force calendar ──
  // This catches cases where the AI still returns 'action' despite a clear appointment.
  const TIME_PATTERNS = [
    /\b\d{1,2}:\d{2}\s*(am|pm)\b/i,             // "2:00 PM", "10:30 am"
    /\b\d{1,2}\s*(am|pm)\s*to\s*\d{1,2}(:\d{2})?\s*(am|pm)\b/i,  // "2 pm to 3 pm"
    /\b\d{1,2}-\d{1,2}\s*(am|pm)\b/i,           // "8-9pm"
    /\bnoon\s+to\s+\w+/i,                        // "noon to one"
    /\b(appt|appointment|meeting|calendar)\b/i,  // explicit appointment keywords
  ];
  const hasTimePattern = TIME_PATTERNS.some(re => re.test(text));
  if (hasTimePattern && classification.destination !== 'calendar') {
    console.log(`  [override] "${text.substring(0, 60)}" reclassified: ${classification.destination} → calendar`);
    classification.destination = 'calendar';
  }

  return classification;
}

async function fileItem(inbox, classification) {
  const { data: ventures } = await withTimeout(supabase
    .from('ventures')
    .select('id, slug')
    .eq('slug', classification.venture_slug || ''), 5000, "Fetch Ventures");

  const ventureId = ventures?.[0]?.id || null;
  let filedItemId = null;

  if (classification.destination === 'action') {
    const { data, error } = await withTimeout(supabase.from('gtd_actions').insert({
      title: classification.title,
      venture_id: ventureId,
      context: classification.context,
      energy: classification.energy || 'medium',
      notes: inbox.raw_text,
      tags: [classification.category].filter(Boolean),
    }).select('id').single(), 5000, "Insert Action");
    if (error) throw new Error(`Action insert failed: ${error.message}`);
    filedItemId = data?.id || null;
  } else if (classification.destination === 'project') {
    const { data, error } = await withTimeout(supabase.from('gtd_projects').insert({
      title: classification.title,
      venture_id: ventureId,
      area: classification.category,
      notes: inbox.raw_text,
      tags: [classification.category].filter(Boolean),
    }).select('id').single(), 5000, "Insert Project");
    if (error) throw new Error(`Project insert failed: ${error.message}`);
    filedItemId = data?.id || null;
  } else if (classification.destination === 'someday') {
    const { data, error } = await withTimeout(supabase.from('gtd_someday').insert({
      title: classification.title,
      description: inbox.raw_text,
      venture_id: ventureId,
      area: classification.category,
      tags: [classification.category].filter(Boolean),
    }).select('id').single(), 5000, "Insert Someday");
    if (error) throw new Error(`Someday insert failed: ${error.message}`);
    filedItemId = data?.id || null;
  } else if (classification.destination === 'reference') {
    const { data, error } = await withTimeout(supabase.from('gtd_reference').insert({
      title: classification.title,
      content: inbox.raw_text,
      venture_id: ventureId,
      category: 'idea',
      area: classification.category,
      tags: [classification.category].filter(Boolean),
    }).select('id').single(), 5000, "Insert Reference");
    if (error) throw new Error(`Reference insert failed: ${error.message}`);
    filedItemId = data?.id || null;
  } else if (classification.destination === 'calendar') {
    const { data, error } = await withTimeout(supabase.from('calendar_events').insert({
      title: classification.title,
      description: classification.summary + (inbox.raw_text ? "\n\n" + inbox.raw_text : ""),
      start_at: classification.start_at || new Date().toISOString(),
      end_at: classification.end_at || new Date(Date.now() + 3600000).toISOString(),
      source: 'system',
      event_type: ['work', 'business'].includes(classification.category) ? 'work' : 'personal',
      life_domain: 'unknown',
      status: 'confirmed',
      google_calendar_id: 'weldayenterprises@gmail.com'
    }).select('id').single(), 5000, "Insert Calendar Event");
    if (error) throw new Error(`Calendar insert failed: ${error.message}`);
    filedItemId = data?.id || null;
  }

  await withTimeout(supabase.from('gtd_inbox').update({
    processed: true,
    processed_at: new Date().toISOString(),
    filed_to: classification.destination,
    filed_item_id: filedItemId,
    ai_summary: classification.summary,
    ai_category: classification.category,
    ai_confidence: classification.confidence,
  }).eq('id', inbox.id), 5000, "Update Inbox Status");
}

async function runFiler() {
  const startTime = Date.now();
  console.log('[GTD Filer] Starting…');

  const { data: items } = await withTimeout(supabase
    .from('gtd_inbox')
    .select('*')
    .eq('processed', false)
    .order('created_at', { ascending: true })
    .limit(20), 5000, "Fetch Inbox Items");

  if (!items?.length) {
    console.log('[GTD Filer] Inbox is empty.');
    return;
  }

  console.log(`[GTD Filer] Processing ${items.length} items…`);
  let processed = 0;

  for (const item of items) {
    try {
      const classification = await classifyItem(item.raw_text);
      await fileItem(item, classification);
      console.log(`  ✓ "${item.raw_text.substring(0, 50)}" → ${classification.destination}`);
      processed++;
    } catch (err) {
      console.error(`  ✗ Error processing item ${item.id}:`, err.message);
    }
  }

  await withTimeout(supabase.from('agent_logs').insert({
    agent_name: 'gtd_filer',
    action: 'process_inbox',
    input_summary: `${items.length} inbox items`,
    output_summary: `Processed ${processed} items`,
    tables_read: ['gtd_inbox', 'ventures'],
    tables_written: ['gtd_actions', 'gtd_projects', 'gtd_someday', 'gtd_reference', 'calendar_events', 'gtd_inbox'],
    duration_ms: Date.now() - startTime,
    model_used: GEMINI_MODEL,
    success: true,
  }), 10000, "Agent Log Insert").catch((e) => console.error(`[GTD Filer] Failed to insert agent log:`, e.message));

  console.log(`[GTD Filer] Done. ${processed}/${items.length} items filed.`);
}

runFiler();
