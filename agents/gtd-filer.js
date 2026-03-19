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
const GEMINI_MODEL = 'gemini-3.1-flash-lite-preview';

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
  const now = new Date().toISOString();
  const prompt = `Classify this GTD inbox item and tell me where to file it. Current time is ${now}.

Inbox text: "${text}"

GTD destinations:
- action: A concrete next step (do in <2min, or schedule)
- project: Outcome requiring multiple steps
- someday: Idea to revisit later
- reference: Information to keep (not actionable)
- calendar: A scheduled appointment or event with a specific time
- trash: Not worth keeping

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
  try {
    return JSON.parse(content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim());
  } catch {
    return { destination: 'reference', title: text.substring(0, 80), confidence: 0.5 };
  }
}

async function fileItem(inbox, classification) {
  const { data: ventures } = await withTimeout(supabase
    .from('ventures')
    .select('id, slug')
    .eq('slug', classification.venture_slug || ''), 5000, "Fetch Ventures");

  const ventureId = ventures?.[0]?.id || null;
  let filedItemId = null;

  if (classification.destination === 'action') {
    const { data } = await withTimeout(supabase.from('gtd_actions').insert({
      title: classification.title,
      venture_id: ventureId,
      context: classification.context,
      energy: classification.energy || 'medium',
      notes: inbox.raw_text,
      tags: [classification.category].filter(Boolean),
    }).select('id').single(), 5000, "Insert Action");
    filedItemId = data?.id || null;
  } else if (classification.destination === 'project') {
    const { data } = await withTimeout(supabase.from('gtd_projects').insert({
      title: classification.title,
      venture_id: ventureId,
      area: classification.category,
      notes: inbox.raw_text,
      tags: [classification.category].filter(Boolean),
    }).select('id').single(), 5000, "Insert Project");
    filedItemId = data?.id || null;
  } else if (classification.destination === 'someday') {
    const { data } = await withTimeout(supabase.from('gtd_someday').insert({
      title: classification.title,
      description: inbox.raw_text,
      venture_id: ventureId,
      area: classification.category,
      tags: [classification.category].filter(Boolean),
    }).select('id').single(), 5000, "Insert Someday");
    filedItemId = data?.id || null;
  } else if (classification.destination === 'reference') {
    const { data } = await withTimeout(supabase.from('gtd_reference').insert({
      title: classification.title,
      content: inbox.raw_text,
      venture_id: ventureId,
      category: 'idea',
      area: classification.category,
      tags: [classification.category].filter(Boolean),
    }).select('id').single(), 5000, "Insert Reference");
    filedItemId = data?.id || null;
  } else if (classification.destination === 'calendar') {
    const { data } = await withTimeout(supabase.from('calendar_events').insert({
      title: classification.title,
      description: classification.summary + "\\n" + inbox.raw_text,
      start_at: classification.start_at || new Date().toISOString(),
      end_at: classification.end_at || new Date(Date.now() + 3600000).toISOString(),
      source: 'system',
      event_type: ['work', 'business'].includes(classification.category) ? 'work' : 'personal',
      life_domain: 'unknown',
      status: 'confirmed',
      google_calendar_id: 'weldayenterprises@gmail.com'
    }).select('id').single(), 5000, "Insert Calendar Event");
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
  }), 3000, "Agent Log Insert").catch(() => {});

  console.log(`[GTD Filer] Done. ${processed}/${items.length} items filed.`);
}

runFiler();
