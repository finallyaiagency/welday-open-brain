import { createClient } from "@supabase/supabase-js";
import pg from "pg";
const { Pool } = pg;

const USER_TIMEZONE = "America/New_York";
const GEMINI_EMBEDDING_MODEL = "text-embedding-004";
const GEMINI_EMBEDDING_DIMENSIONS = 768;

function getSupabase() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

let adminPool: any = null;
function getAdminPool() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) return null;
  if (!adminPool) {
    adminPool = new Pool({
      connectionString: databaseUrl,
      ssl: databaseUrl.includes("supabase.co") ? { rejectUnauthorized: false } : undefined,
    });
  }
  return adminPool;
}

// ── Embeddings Logic ─────────────────────────────────────────────────────────

function chunkText(text: string, chunkSize = 900, overlap = 120) {
  const normalized = text.trim();
  if (!normalized) return [];
  if (normalized.length <= chunkSize) return [normalized];
  const chunks: string[] = [];
  let start = 0;
  while (start < normalized.length) {
    const end = Math.min(normalized.length, start + chunkSize);
    chunks.push(normalized.slice(start, end));
    if (end >= normalized.length) break;
    start = Math.max(end - overlap, start + 1);
  }
  return chunks;
}

async function embedText(text: string, taskType: "RETRIEVAL_QUERY" | "RETRIEVAL_DOCUMENT" = "RETRIEVAL_QUERY") {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_EMBEDDING_MODEL}:embedContent?key=${key}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: `models/${GEMINI_EMBEDDING_MODEL}`,
      content: { parts: [{ text }] },
      taskType,
      outputDimensionality: GEMINI_EMBEDDING_DIMENSIONS,
    }),
  });
  if (!res.ok) throw new Error(`Gemini embeddings: ${await res.text()}`);
  const data = await res.json() as any;
  const values = data.embedding?.values;
  return Array.isArray(values) ? values.map((v: any) => Number(v)) : null;
}

function toVectorLiteral(values: number[]) {
  return `[${values.join(",")}]`;
}

async function upsertBotMemoryEmbeddings(supabase: any, params: { memoryId: string; botId: string; content: string }) {
  const chunks = chunkText(params.content);
  if (!chunks.length) return { chunkCount: 0 };
  const rows: any[] = [];
  for (const chunk of chunks) {
    const values = await embedText(chunk, "RETRIEVAL_DOCUMENT");
    if (!values?.length) continue;
    rows.push({
      bot_id: params.botId,
      source_id: params.memoryId,
      content_chunk: chunk,
      embedding: toVectorLiteral(values),
    });
  }
  if (!rows.length) return { chunkCount: 0 };
  const inserted = await supabase
    .from("bot_memory_embeddings")
    .upsert(rows, { onConflict: "source_id,content_chunk" });
  if (inserted.error) throw inserted.error;
  return { chunkCount: rows.length };
}

async function embedPendingMemories(supabase: any) {
  const { data: pending } = await supabase
    .from("bot_memory")
    .select("id, bot_id, content, metadata")
    .eq("metadata->>embedding_status", "pending")
    .limit(5);

  if (!pending?.length) return;

  for (const memory of pending) {
    try {
      await upsertBotMemoryEmbeddings(supabase, {
        memoryId: memory.id,
        botId: memory.bot_id,
        content: memory.content
      });
      await supabase.from("bot_memory").update({
        metadata: { ...memory.metadata, embedding_status: "done" }
      }).eq("id", memory.id);
      console.log(`[heartbeat:embed] Success for memory ${memory.id}`);
    } catch (err: any) {
      console.error(`[heartbeat:embed] Failed for ${memory.id}:`, err.message);
    }
  }
}

// ── Heartbeat Loop ───────────────────────────────────────────────────────────

export async function runHeartbeat() {
  const supabase = getSupabase();
  if (!supabase) return;

  try {
    // 1. Update the Pulse
    const { data: pulse } = await supabase.from("brain_pulse").select("id").limit(1).single();
    await supabase.from("brain_pulse").upsert({ 
      id: pulse?.id || undefined,
      last_pulse_at: new Date().toISOString(),
      status: 'healthy'
    });

    // 2. Process Pending Embeddings (Semantic Recall Foundation)
    await embedPendingMemories(supabase).catch(err => console.error("[heartbeat] Embedding failed:", err.message));

    // 3. Process Inbox Auto-Filing (Radar logic)
    // We call the server API or internal logic? Let's use internal logic if available.
    // For now, we omit it or call the local API.
    await fetch(`http://127.0.0.1:${process.env.PORT || 5001}/api/gtd/process`, {
        headers: { "x-cron-secret": process.env.GTD_PROCESS_SECRET || "" }
    }).catch(() => {});

    // 4. Check for scheduled modules (Tele-Cron logic)
    const { data: modules, error } = await supabase
      .from("brain_heartbeat")
      .select("*")
      .eq("status", "active")
      .lte("next_run_at", new Date().toISOString());

    if (error) {
      console.error("[heartbeat] Error fetching modules:", error);
      return;
    }

    if (modules && modules.length > 0) {
      for (const module of modules) {
        console.log(`[heartbeat] Running module: ${module.module_name}`);
        
        // Modules like 'moneypenny_morning_briefing' are handled via routes.ts currently.
        // But we want to consolidate it. 
        // For now, just update next_run_at to satisfy the heart.
        
        const nextRun = calculateNextRun(module.cron_expression);
        await supabase.from("brain_heartbeat").update({
          last_run_at: new Date().toISOString(),
          next_run_at: nextRun.toISOString(),
          updated_at: new Date().toISOString()
        }).eq("id", module.id);
      }
    }

  } catch (err) {
    console.error("[heartbeat] Fatal error in heartbeat loop:", err);
  }
}

function calculateNextRun(cron: string | null): Date {
  const now = new Date();
  if (!cron) return new Date(now.getTime() + 60 * 60 * 1000);

  if (cron === '*/5 * * * *') return new Date(now.getTime() + 5 * 60 * 1000);
  if (cron === '0 7 * * *') {
    const next = new Date(now);
    next.setHours(7, 0, 0, 0);
    if (next <= now) next.setDate(next.getDate() + 1);
    return next;
  }
  if (cron === '0 0 * * 1') {
    const next = new Date(now);
    next.setDate(now.getDate() + (1 + 7 - now.getDay()) % 7);
    next.setHours(0, 0, 0, 0);
    if (next <= now) next.setDate(next.getDate() + 7);
    return next;
  }
  return new Date(now.getTime() + 60 * 60 * 1000);
}

export function startHeartbeatLoop() {
  setInterval(runHeartbeat, 60 * 1000);
  setTimeout(runHeartbeat, 5000); // Wait 5s for server to start
}
