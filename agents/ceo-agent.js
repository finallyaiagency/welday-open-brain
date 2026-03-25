/**
 * WELDAY ENTERPRISES — VIRTUAL CEO AGENT
 * ----------------------------------------
 * Run: node ceo-agent.js
 * Schedule: Daily via Vercel Cron
 * Model: Google Gemini (free tier)
 */

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const GEMINI_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = 'gemini-2.0-flash'; // Switch to working model

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

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

async function callGemini(systemPrompt, userPrompt) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_KEY}`;
  const response = await fetchWithTimeout(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemPrompt + "\n\nUse Google Search to verify facts if you are unsure or need current information." }] },
      contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
      generationConfig: { temperature: 0.7, maxOutputTokens: 1024 },
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
  }, 30000);
  const data = await response.json();
  const parts = data.candidates?.[0]?.content?.parts || [];
  return parts.map(p => p.text || "").join("");
}

async function runCEO() {
  const startTime = Date.now();
  console.log('[CEO Agent] Starting analysis…');

  try {
    const { data: ventures } = await withTimeout(supabase
      .from('ventures')
      .select('*')
      .order('readiness_score', { ascending: false }), 5000, "Fetch Ventures");

    const yesterday = new Date(Date.now() - 86400000).toISOString();
    const { data: inbox } = await withTimeout(supabase
      .from('gtd_inbox')
      .select('raw_text, source, created_at')
      .gte('created_at', yesterday)
      .eq('processed', false)
      .limit(20), 5000, "Fetch Inbox");

    const venturesSummary = ventures.map(v =>
      `- ${v.name} (${v.status}): readiness=${v.readiness_score}%, risk=${v.risk_level}, tags=[${(v.synergy_tags||[]).join(',')}], MRR=$${v.monthly_revenue_usd || 0}`
    ).join('\n');

    const inboxSummary = inbox?.length
      ? inbox.map(i => `• ${i.raw_text}`).join('\n')
      : '(no recent inbox items)';

    const systemPrompt = `You are the Virtual CEO of Welday Enterprises, a portfolio of 11 AI-powered micro-businesses.
Your job is to analyze the portfolio and find synergies, risks, and opportunities.
You think strategically, focus on revenue and minimal-effort automation, and always look for ways 2+ businesses can work together.
Output JSON only — no markdown, no explanation outside the JSON.`;

    const userPrompt = `VENTURE PORTFOLIO:
${venturesSummary}

RECENT CAPTURES (24h):
${inboxSummary}

Analyze this portfolio and return a JSON array of 3-5 recommendations with this schema:
[{
  "type": "synergy" | "risk" | "opportunity" | "action",
  "title": "short title (max 10 words)",
  "body": "detailed explanation (2-3 sentences)",
  "ventures_involved": ["venture-slug-1", "venture-slug-2"],
  "priority": "critical" | "high" | "medium" | "low",
  "effort_level": "minimal" | "low" | "medium" | "high",
  "estimated_revenue_impact": "e.g. $500/mo or 20% traffic lift",
  "action_items": ["concrete step 1", "concrete step 2", "concrete step 3"]
}]

Focus on SYNERGIES first — how can 2+ ventures share content, users, or infrastructure?`;

    const content = await callGemini(systemPrompt, userPrompt);
    let recommendations = [];

    try {
      const cleaned = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      recommendations = JSON.parse(cleaned);
    } catch (e) {
      console.error('[CEO Agent] JSON parse error:', e.message);
      console.error('Raw response:', content);
    }

    if (recommendations.length > 0) {
      const slugToId = Object.fromEntries(ventures.map(v => [v.slug, v.id]));
      const rows = recommendations.map(r => ({
        type: r.type,
        title: r.title,
        body: r.body,
        ventures_involved: (r.ventures_involved || []).map(slug => slugToId[slug]).filter(Boolean),
        priority: r.priority || 'medium',
        effort_level: r.effort_level || 'medium',
        estimated_revenue_impact: r.estimated_revenue_impact,
        action_items: r.action_items || [],
        ai_model_used: GEMINI_MODEL,
        generated_at: new Date().toISOString(),
        status: 'new',
      }));

      const { error } = await withTimeout(supabase.from('ceo_recommendations').insert(rows), 5000, "Insert Recommendations");
      if (error) console.error('[CEO Agent] Insert error:', error);
      else console.log(`[CEO Agent] Inserted ${rows.length} recommendations`);
    }

    await withTimeout(supabase.from('agent_logs').insert({
      agent_name: 'ceo_agent',
      action: 'analyze_portfolio',
      input_summary: `${ventures.length} ventures, ${inbox?.length || 0} inbox items`,
      output_summary: `Generated ${recommendations.length} recommendations`,
      tables_read: ['ventures', 'gtd_inbox'],
      tables_written: ['ceo_recommendations', 'agent_logs'],
      duration_ms: Date.now() - startTime,
      model_used: GEMINI_MODEL,
      success: true,
    }), 3000, "Agent Log Insert");

  } catch (err) {
    console.error('[CEO Agent] Error:', err);
    await withTimeout(supabase.from('agent_logs').insert({
      agent_name: 'ceo_agent',
      action: 'analyze_portfolio',
      success: false,
      error_message: err.message,
      duration_ms: Date.now() - startTime,
    }), 3000, "Agent Error Log Insert").catch(() => {});
  }
}

runCEO();
