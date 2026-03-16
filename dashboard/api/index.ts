import type { IncomingMessage, ServerResponse } from "http";
import { createClient } from "@supabase/supabase-js";

const FREE_MODELS = [
  "gemini-3-flash-preview",
  "gemini-2.5-flash",
  "gemini-3.1-flash-lite-preview",
  "gemma-3-27b-it"
];
const GEMINI_MODEL = FREE_MODELS[0];

const COOLDOWNS = new Map<string, number>();
const COOLDOWN_DURATION = 3 * 60 * 60 * 1000; // 3 hours
const AUTO_PROCESS_AFTER_MS = 10 * 60 * 1000;
const USER_TIMEZONE = "America/New_York";
const GEMINI_EMBEDDING_MODEL = "text-embedding-004";
const GEMINI_EMBEDDING_DIMENSIONS = 768;
const BOT_FILE_ORDER = ["soul", "agents", "user", "tools", "memory"] as const;
const TELEGRAM_SESSION_HISTORY_LIMIT = 10;
const TELEGRAM_MEMORY_MATCH_LIMIT = 6;
const TELEGRAM_SESSION_IDLE_MS = 4 * 60 * 60 * 1000;
const SCHEMA_OPERATION_TYPES = new Set(["add_column", "add_table", "add_index"]);
const ALLOWED_SCHEMA_TYPES = new Set([
  "text",
  "text[]",
  "boolean",
  "integer",
  "bigint",
  "numeric",
  "date",
  "timestamptz",
  "uuid",
  "uuid[]",
  "jsonb",
]);
const RESERVED_SCHEMA_TABLES = new Set(["schema_migrations", "pg_stat_statements", "pg_stat_activity"]);

let adminPool: any = null;

function getSchemaReviewAdminEmails() {
  return (process.env.SCHEMA_REVIEW_ADMIN_EMAILS || process.env.ADMIN_EMAILS || "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
}

function formatLogTimestamp(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: USER_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZoneName: "short",
  }).formatToParts(date);

  const get = (type: string) => parts.find((part) => part.type === type)?.value || "";
  return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")} ${get("timeZoneName")}`.trim();
}

async function logAgentEvent(sb: any, params: {
  agentName: string;
  action: string;
  inputSummary?: string;
  outputSummary?: string;
  success?: boolean;
  errorMessage?: string;
  modelUsed?: string;
}) {
  await sb.from("agent_logs").insert({
    agent_name: params.agentName,
    action: params.action,
    input_summary: params.inputSummary,
    output_summary: params.outputSummary,
    success: params.success ?? true,
    error_message: params.errorMessage,
    model_used: params.modelUsed,
  });
}

function getAdminPool() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) return null;
  if (!adminPool) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { Pool } = require("pg");
    adminPool = new Pool({
      connectionString: databaseUrl,
      ssl: databaseUrl.includes("supabase.co") ? { rejectUnauthorized: false } : undefined,
    });
  }
  return adminPool;
}

function isSafeIdentifier(value: unknown) {
  return typeof value === "string" && /^[a-z][a-z0-9_]{0,62}$/.test(value);
}

function quoteIdentifier(value: string) {
  if (!isSafeIdentifier(value)) throw new Error(`Invalid identifier: ${String(value)}`);
  return `"${value}"`;
}

function normalizeSchemaType(value: unknown) {
  if (typeof value !== "string") throw new Error("dataType must be a string");
  const normalized = value.trim().toLowerCase();
  if (!ALLOWED_SCHEMA_TYPES.has(normalized)) {
    throw new Error(`Unsupported data type: ${value}`);
  }
  return normalized;
}

function toSqlLiteral(value: any, dataType: string) {
  if (value === null) return "null";
  if (dataType === "jsonb") return `'${JSON.stringify(value).replace(/'/g, "''")}'::jsonb`;
  if (dataType === "boolean") {
    if (value === true || value === false) return value ? "true" : "false";
    throw new Error("boolean defaultValue must be true or false");
  }
  if (dataType === "integer" || dataType === "bigint" || dataType === "numeric") {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new Error(`${dataType} defaultValue must be a finite number`);
    }
    return String(value);
  }
  if (dataType === "text[]" || dataType === "uuid[]") {
    if (!Array.isArray(value)) throw new Error(`${dataType} defaultValue must be an array`);
    const items = value.map((item) => {
      if (typeof item !== "string") throw new Error(`${dataType} array items must be strings`);
      return `'${item.replace(/'/g, "''")}'`;
    });
    return `ARRAY[${items.join(",")}]::${dataType}`;
  }
  if (dataType === "date" || dataType === "timestamptz" || dataType === "text" || dataType === "uuid") {
    if (typeof value !== "string") throw new Error(`${dataType} defaultValue must be a string`);
    const escaped = value.replace(/'/g, "''");
    if (dataType === "date") return `'${escaped}'::date`;
    if (dataType === "timestamptz") return `'${escaped}'::timestamptz`;
    return `'${escaped}'`;
  }
  throw new Error(`Unsupported defaultValue for data type: ${dataType}`);
}

function buildColumnDefinition(column: any) {
  if (!column || typeof column !== "object") throw new Error("Each column must be an object");
  const name = typeof column.name === "string" ? column.name.trim().toLowerCase() : "";
  if (!isSafeIdentifier(name)) throw new Error(`Invalid column name: ${column?.name}`);

  const dataType = normalizeSchemaType(column.dataType);
  const nullable = column.nullable !== false;
  const parts = [`${quoteIdentifier(name)} ${dataType}`];

  if (column.primaryKey) {
    if (dataType !== "uuid" && dataType !== "text") {
      throw new Error(`Primary key columns must use uuid or text: ${name}`);
    }
    parts.push("primary key");
  }

  if (Object.prototype.hasOwnProperty.call(column, "defaultValue")) {
    parts.push(`default ${toSqlLiteral(column.defaultValue, dataType)}`);
  }

  if (!nullable || column.primaryKey) parts.push("not null");
  return { name, sql: parts.join(" "), dataType };
}

function buildSchemaOperation(input: any) {
  const operation = typeof input?.operation === "string" ? input.operation.trim().toLowerCase() : "";
  if (!SCHEMA_OPERATION_TYPES.has(operation)) {
    throw new Error("operation must be one of add_column, add_table, add_index");
  }

  const actor = typeof input?.actor === "string" && input.actor.trim() ? input.actor.trim().slice(0, 80) : "schema_api";
  const rationale = typeof input?.rationale === "string" ? input.rationale.trim().slice(0, 1000) : null;
  const description = typeof input?.description === "string" && input.description.trim()
    ? input.description.trim().slice(0, 1000)
    : null;

  if (operation === "add_column") {
    const tableName = typeof input?.tableName === "string" ? input.tableName.trim().toLowerCase() : "";
    const columnName = typeof input?.columnName === "string" ? input.columnName.trim().toLowerCase() : "";
    if (!isSafeIdentifier(tableName) || RESERVED_SCHEMA_TABLES.has(tableName)) throw new Error("Invalid tableName");
    if (!isSafeIdentifier(columnName)) throw new Error("Invalid columnName");

    const dataType = normalizeSchemaType(input?.dataType);
    const nullable = input?.nullable !== false;
    const sqlParts = [
      `alter table public.${quoteIdentifier(tableName)}`,
      `add column if not exists ${quoteIdentifier(columnName)} ${dataType}`,
    ];
    if (Object.prototype.hasOwnProperty.call(input, "defaultValue")) {
      sqlParts.push(`default ${toSqlLiteral(input.defaultValue, dataType)}`);
    }
    if (!nullable) sqlParts.push("not null");

    return {
      operation,
      actor,
      rationale,
      description: description || `Add ${columnName} to ${tableName}`,
      tableName,
      columnName,
      sql: `${sqlParts.join(" ")};`,
      verifySql: `
        select column_name, data_type, is_nullable
        from information_schema.columns
        where table_schema = 'public' and table_name = $1 and column_name = $2
      `,
      verifyParams: [tableName, columnName],
    };
  }

  if (operation === "add_table") {
    const tableName = typeof input?.tableName === "string" ? input.tableName.trim().toLowerCase() : "";
    if (!isSafeIdentifier(tableName) || RESERVED_SCHEMA_TABLES.has(tableName)) throw new Error("Invalid tableName");
    if (!Array.isArray(input?.columns) || !input.columns.length) {
      throw new Error("columns must be a non-empty array");
    }

    const definitions = input.columns.map(buildColumnDefinition);
    const primaryKeys = definitions.filter((column: any, index: number) => input.columns[index]?.primaryKey);
    if (primaryKeys.length > 1) {
      throw new Error("Only one primary key column is supported");
    }

    return {
      operation,
      actor,
      rationale,
      description: description || `Create ${tableName}`,
      tableName,
      columnName: null,
      sql: `create table if not exists public.${quoteIdentifier(tableName)} (\n  ${definitions.map((column: any) => column.sql).join(",\n  ")}\n);`,
      verifySql: `
        select table_name
        from information_schema.tables
        where table_schema = 'public' and table_name = $1
      `,
      verifyParams: [tableName],
    };
  }

  const tableName = typeof input?.tableName === "string" ? input.tableName.trim().toLowerCase() : "";
  const columns: string[] = Array.isArray(input?.columns)
    ? input.columns.map((column: any) => typeof column === "string" ? column.trim().toLowerCase() : "").filter(Boolean)
    : [];
  if (!isSafeIdentifier(tableName) || RESERVED_SCHEMA_TABLES.has(tableName)) throw new Error("Invalid tableName");
  if (!columns.length || columns.some((column) => !isSafeIdentifier(column))) {
    throw new Error("columns must contain one or more valid column names");
  }

  const unique = input?.unique === true;
  const indexName = typeof input?.indexName === "string" && input.indexName.trim()
    ? input.indexName.trim().toLowerCase()
    : `${tableName}_${columns.join("_")}_${unique ? "uniq" : "idx"}`;
  if (!isSafeIdentifier(indexName)) throw new Error("Invalid indexName");

  return {
    operation,
    actor,
    rationale,
    description: description || `Add ${unique ? "unique " : ""}index ${indexName} on ${tableName}`,
    tableName,
    columnName: indexName,
    sql: `create ${unique ? "unique " : ""}index if not exists ${quoteIdentifier(indexName)} on public.${quoteIdentifier(tableName)} (${columns.map(quoteIdentifier).join(", ")});`,
    verifySql: `
      select indexname
      from pg_indexes
      where schemaname = 'public' and indexname = $1
    `,
    verifyParams: [indexName],
  };
}

async function logSchemaChange(sb: any, details: {
  actor: string;
  operation: string;
  tableName: string;
  columnName: string | null;
  description: string;
  sql: string;
  rationale: string | null;
  status: "applied" | "rejected";
  approvedBy?: string;
}) {
  if (!sb) return;
  try {
    await sb.from("schema_changelog").insert({
      proposed_by: details.actor,
      change_type: details.operation,
      table_name: details.tableName,
      column_name: details.columnName,
      description: details.description,
      sql_statement: details.sql,
      rationale: details.rationale,
      status: details.status,
      approved_by: details.approvedBy || "schema_api",
      applied_at: details.status === "applied" ? new Date().toISOString() : null,
    });
  } catch {}
}

async function runSchemaOperation(sb: any, operation: ReturnType<typeof buildSchemaOperation>, options?: { logChange?: boolean }) {
  const pool = getAdminPool();
  if (!pool) throw new Error("DATABASE_URL not configured");
  const shouldLogChange = options?.logChange !== false;

  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query(operation.sql);
    const verification = await client.query(operation.verifySql, operation.verifyParams);
    if (!verification.rowCount) {
      throw new Error("Schema change verification failed");
    }
    await client.query("commit");

    if (shouldLogChange) {
      await logSchemaChange(sb, {
        actor: operation.actor,
        operation: operation.operation,
        tableName: operation.tableName,
        columnName: operation.columnName,
        description: operation.description,
        sql: operation.sql,
        rationale: operation.rationale,
        status: "applied",
      });
    }

    await logAgentEvent(sb, {
      agentName: "schema_api",
      action: operation.operation,
      inputSummary: operation.description,
      outputSummary: operation.sql,
      success: true,
    }).catch(() => {});

    return verification.rows;
  } catch (err: any) {
    try { await client.query("rollback"); } catch {}

    if (shouldLogChange) {
      await logSchemaChange(sb, {
        actor: operation.actor,
        operation: operation.operation,
        tableName: operation.tableName,
        columnName: operation.columnName,
        description: operation.description,
        sql: operation.sql,
        rationale: operation.rationale,
        status: "rejected",
      });
    }

    await logAgentEvent(sb, {
      agentName: "schema_api",
      action: `${operation.operation}_failed`,
      inputSummary: operation.description,
      outputSummary: operation.sql,
      success: false,
      errorMessage: err.message,
    }).catch(() => {});

    throw err;
  } finally {
    client.release();
  }
}

async function getSchemaReviewContext() {
  const pool = getAdminPool();
  if (!pool) return "Database admin connection unavailable.";

  const result = await pool.query(`
    select table_name, column_name, data_type, is_nullable
    from information_schema.columns
    where table_schema = 'public'
      and table_name in ('gtd_inbox', 'gtd_actions', 'gtd_projects', 'gtd_someday', 'gtd_reference', 'ventures', 'schema_changelog')
    order by table_name, ordinal_position
  `);

  const grouped = new Map<string, string[]>();
  for (const row of result.rows) {
    const columns = grouped.get(row.table_name) || [];
    columns.push(`${row.column_name}:${row.data_type}${row.is_nullable === "NO" ? " not null" : ""}`);
    grouped.set(row.table_name, columns);
  }

  return Array.from(grouped.entries())
    .map(([tableName, columns]) => `${tableName} -> ${columns.join(", ")}`)
    .join("\n");
}

async function fetchPendingSchemaReviews(sb: any, limit = 10) {
  const { data, error } = await sb
    .from("schema_changelog")
    .select("id, description, rationale, created_at, table_name, column_name")
    .eq("status", "proposed")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw error;
  return data || [];
}

async function getPendingSchemaReviewSummary(sb: any, limit = 3) {
  const reviews = await fetchPendingSchemaReviews(sb, limit);
  return { count: reviews.length, items: reviews };
}

function formatSchemaReviewRationale(params: {
  review: any;
  inbox: any;
  classification: any;
}) {
  const parts = [
    `Justification: ${params.review.rationale || params.review.justification || "Schema gap identified during inbox processing."}`,
  ];
  if (params.review.suspectedIntent) parts.push(`Suspected intent: ${params.review.suspectedIntent}`);
  if (params.review.clarificationQuestion) parts.push(`Clarification to confirm before approval: ${params.review.clarificationQuestion}`);
  parts.push(`Inbox item: ${params.inbox.raw_text}`);
  parts.push(`Filed as: ${params.classification.destination}`);
  return parts.join("\n\n");
}

async function reviewInboxSchemaNeed(sb: any, inbox: any, classification: any) {
  const pool = getAdminPool();
  if (!pool) return null;

  const schemaContext = await getSchemaReviewContext();
  const prompt = `You review whether a GTD inbox filing reveals a real database schema gap.

Principles:
- Prefer no schema change.
- Prefer existing text, notes, tags, and metadata patterns when they are sufficient.
- Only propose a schema change if the current schema clearly cannot represent an important recurring field in a structured way.
- Only allowed operations: add_column, add_table, add_index.
- Do not suggest destructive changes, renames, drops, or arbitrary SQL.
- If unsure, return no_change.

Inbox item:
${JSON.stringify({
    raw_text: inbox.raw_text,
    source: inbox.source,
    life_domain: inbox.life_domain,
  }, null, 2)}

Current filing decision:
${JSON.stringify(classification, null, 2)}

Current schema summary:
${schemaContext}

Return JSON only:
{
  "decision": "no_change" | "apply_change",
  "justification": "short explanation",
  "suspectedIntent": "best guess at what the user meant",
  "clarificationQuestion": "question Kevin should answer before approval",
  "operation": "add_column" | "add_table" | "add_index" | null,
  "tableName": "target table or null",
  "columnName": "target column or null",
  "dataType": "text | text[] | boolean | integer | bigint | numeric | date | timestamptz | uuid | uuid[] | jsonb | null",
  "nullable": true,
  "defaultValue": null,
  "indexName": "index name or null",
  "columns": ["column_name"],
  "tableColumns": [{"name":"id","dataType":"uuid","primaryKey":true,"nullable":false}],
  "description": "human description",
  "rationale": "why the change is necessary and why metadata is insufficient"
}`;

  const { reply } = await gemini(
    "You are a conservative database architect. Return valid JSON only. Favor no_change unless a structured schema gap is obvious and recurring.",
    [{ role: "user", content: prompt }],
    700,
  );

  let review: any;
  try {
    review = parseJsonResponse(reply);
  } catch {
    return null;
  }

  if (review?.decision !== "apply_change" || !review?.operation) return null;

  try {
    const operation = buildSchemaOperation({
      operation: review.operation,
      actor: "radar_inbox_processor",
      rationale: review.rationale || review.justification || "Schema gap identified during inbox processing",
      description: review.description || review.justification || "Inbox-driven schema change",
      tableName: review.tableName,
      columnName: review.columnName,
      dataType: review.dataType,
      nullable: review.nullable,
      defaultValue: review.defaultValue,
      indexName: review.indexName,
      columns: review.operation === "add_table" ? review.tableColumns : review.columns,
      unique: review.unique === true,
    });
    return { operation, review };
  } catch (err: any) {
    await logAgentEvent(sb, {
      agentName: "radar_schema_review",
      action: "schema_review_invalid",
      inputSummary: inbox.raw_text.substring(0, 120),
      outputSummary: typeof reply === "string" ? reply.substring(0, 200) : "invalid schema review",
      success: false,
      errorMessage: err.message,
    }).catch(() => {});
    return null;
  }
}

async function createSchemaProposal(sb: any, params: {
  operation: ReturnType<typeof buildSchemaOperation>;
  review: any;
  inbox: any;
  classification: any;
}) {
  const { data: existing, error: lookupError } = await sb
    .from("schema_changelog")
    .select("id")
    .eq("status", "proposed")
    .eq("sql_statement", params.operation.sql)
    .limit(1);

  if (lookupError) throw lookupError;
  if (existing?.length) return { created: false, id: existing[0].id };

  const proposal = await sb
    .from("schema_changelog")
    .insert({
      proposed_by: params.operation.actor,
      change_type: params.operation.operation,
      table_name: params.operation.tableName,
      column_name: params.operation.columnName,
      description: params.operation.description,
      sql_statement: params.operation.sql,
      rationale: formatSchemaReviewRationale(params),
      status: "proposed",
    })
    .select("id")
    .single();

  if (proposal.error) throw proposal.error;

  await logAgentEvent(sb, {
    agentName: "radar_schema_review",
    action: "schema_change_proposed_from_inbox",
    inputSummary: params.inbox.raw_text.substring(0, 120),
    outputSummary: params.operation.description,
    success: true,
  }).catch(() => {});

  return { created: true, id: proposal.data?.id || null };
}

function getSchemaProposalVerification(changeType: string, tableName: string, columnName: string | null) {
  if (changeType === "add_column") {
    return {
      verifySql: `
        select column_name
        from information_schema.columns
        where table_schema = 'public' and table_name = $1 and column_name = $2
      `,
      verifyParams: [tableName, columnName],
    };
  }

  if (changeType === "add_table") {
    return {
      verifySql: `
        select table_name
        from information_schema.tables
        where table_schema = 'public' and table_name = $1
      `,
      verifyParams: [tableName],
    };
  }

  return {
    verifySql: `
      select indexname
      from pg_indexes
      where schemaname = 'public' and indexname = $1
    `,
    verifyParams: [columnName],
  };
}

function schemaProposalRowToOperation(row: any) {
  const verification = getSchemaProposalVerification(row.change_type, row.table_name, row.column_name);
  return {
    operation: row.change_type,
    actor: row.proposed_by || "schema_api",
    rationale: row.rationale || null,
    description: row.description,
    tableName: row.table_name,
    columnName: row.column_name,
    sql: row.sql_statement,
    verifySql: verification.verifySql,
    verifyParams: verification.verifyParams,
  };
}

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
  return createClient(url, key);
}

// ─── Gemini (with key fallback) ──────────────────────────────────────────────
async function getAuthenticatedAdminEmail(req: IncomingMessage) {
  const supabase = getSupabase();
  if (!supabase) throw new Error("Supabase not configured");

  const admins = getSchemaReviewAdminEmails();
  if (!admins.length) throw new Error("SCHEMA_REVIEW_ADMIN_EMAILS not configured");

  const authHeader = getHeader(req, "authorization");
  const token = typeof authHeader === "string" && authHeader.toLowerCase().startsWith("bearer ")
    ? authHeader.slice(7).trim()
    : "";
  if (!token) return null;

  const { data, error } = await supabase.auth.getUser(token);
  if (error) return null;

  const email = data.user?.email?.toLowerCase() || "";
  return admins.includes(email) ? email : null;
}

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

function normalizeLifeDomain(value: unknown, fallbackCategory?: unknown) {
  if (value === "business" || value === "personal" || value === "unknown") return value;
  if (fallbackCategory === "business") return "business";
  if (fallbackCategory === "personal") return "personal";
  return "unknown";
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
  "life_domain": "business" | "personal" | "unknown",
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
      life_domain: "unknown",
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
  const lifeDomain = normalizeLifeDomain(classification.life_domain, category);
  const tags = [category, lifeDomain].filter(Boolean);

  if (classification.destination === "action") {
    await sb.from("gtd_actions").insert({
      title: classification.title,
      venture_id: ventureId,
      context: classification.context,
      life_domain: lifeDomain,
      source: inbox.source || "manual",
      energy: classification.energy || "medium",
      notes: inbox.raw_text,
      tags,
    });
  } else if (classification.destination === "project") {
    await sb.from("gtd_projects").insert({
      title: classification.title,
      venture_id: ventureId,
      area: category,
      life_domain: lifeDomain,
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
    life_domain: lifeDomain,
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
  let schemaReviewsProposed = 0;
  for (const item of items) {
    try {
      const classification = await classifyInboxItem(item.raw_text);
      const schemaReview = await reviewInboxSchemaNeed(sb, item, classification).catch((err: any) => {
        console.error("[GTD] schema review failed:", err.message);
        return null;
      });
      if (schemaReview) {
        try {
          const proposal = await createSchemaProposal(sb, {
            operation: schemaReview.operation,
            review: schemaReview.review,
            inbox: item,
            classification,
          });
          if (proposal.created) schemaReviewsProposed++;
        } catch (err: any) {
          console.error("[GTD] schema proposal failed:", err.message);
        }
      }
      await fileInboxItem(sb, item, classification);
      processed++;
    } catch (err: any) {
      console.error("[GTD] process item failed:", err.message);
    }
  }

  return { processed, total: items.length, schemaReviewsProposed };
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

function isAuthorizedSchemaApplyRequest(req: IncomingMessage) {
  const expected = process.env.SCHEMA_APPLY_SECRET;
  if (!expected) return { ok: false, status: 500, error: "SCHEMA_APPLY_SECRET not configured" };

  const provided = getHeader(req, "x-schema-secret");
  if (!provided || provided !== expected) {
    return { ok: false, status: 401, error: "Unauthorized" };
  }

  return { ok: true as const };
}

async function extractBusinessMemory(systemPrompt: string, userMessage: string, assistantReply: string) {
  const prompt = `Decide whether this conversation should be stored as a long-term activity memory.

Log substantive business or personal discussion such as plans, decisions, commitments, project changes, appointments, reminders, or meaningful status changes.
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
  "life_domain": "business" | "personal" | "unknown",
  "topics": ["topic"],
  "venture_slugs": ["venture-slug"],
  "importance": "low" | "medium" | "high"
}`;

  const { reply } = await gemini(systemPrompt, [{ role: "user", content: prompt }], 250);
  try {
    return parseJsonResponse(reply);
  } catch {
    return { should_log: false, summary: "", life_domain: "unknown", topics: [], venture_slugs: [], importance: "low" };
  }
}

async function maybeLogBusinessMemory(sb: any, params: { source: string; agentName: string; systemPrompt: string; userMessage: string; assistantReply: string }) {
  try {
    const memory = await extractBusinessMemory(params.systemPrompt, params.userMessage, params.assistantReply);
    if (!memory?.should_log || !memory.summary?.trim()) return;
    const timestamp = formatLogTimestamp();

    await sb.from("business_memory").insert({
      source: params.source,
      agent_name: params.agentName,
      summary: `[${timestamp}] ${memory.summary.trim()}`,
      life_domain: normalizeLifeDomain(memory.life_domain),
      topics: memory.topics || [],
      venture_slugs: memory.venture_slugs || [],
      importance: memory.importance || "medium",
      metadata: {
        logged_at: new Date().toISOString(),
        timezone: USER_TIMEZONE,
      },
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

  const [od, td, sn, ib, wt, vt, al, schemaReviews] = await Promise.all([
    sb.from("gtd_actions").select("title,due_date,life_domain").eq("status","active").lt("due_date",today).limit(6),
    sb.from("gtd_actions").select("title,context,life_domain").eq("status","active").eq("due_date",today).limit(6),
    sb.from("gtd_actions").select("title,due_date,life_domain").eq("status","active").gt("due_date",today).lte("due_date",in3).limit(5),
    sb.from("gtd_inbox").select("raw_text,life_domain").eq("processed",false).limit(4),
    sb.from("gtd_actions").select("title,delegated_to,life_domain").eq("status","waiting").limit(4),
    sb.from("ventures").select("name,readiness_score").eq("status","active").order("readiness_score",{ascending:false}),
    sb.from("ceo_recommendations").select("title,priority").eq("status","new").in("priority",["critical","high"]).limit(3),
    getPendingSchemaReviewSummary(sb, 3),
  ]);

  const L: string[] = [];
  L.push(`LOCAL TIME (${USER_TIMEZONE}): ${now.toLocaleDateString("en-US",{ timeZone: USER_TIMEZONE, weekday:"long",month:"short",day:"numeric"})} ${now.toLocaleTimeString("en-US",{ timeZone: USER_TIMEZONE, hour:"numeric", minute:"2-digit"})}`);
  if (od.data?.length)  { L.push(`\nOVERDUE (${od.data.length}):`);   od.data.forEach((a: any) => L.push(`  • [${normalizeLifeDomain(a.life_domain).toUpperCase()}] ${a.title} — was due ${a.due_date}`)); }
  if (td.data?.length)  { L.push(`\nDUE TODAY (${td.data.length}):`); td.data.forEach((a: any) => L.push(`  • [${normalizeLifeDomain(a.life_domain).toUpperCase()}] ${a.title}${a.context?" "+a.context:""}`)); }
  else L.push("\nDUE TODAY: nothing scheduled");
  if (sn.data?.length)  { L.push(`\nNEXT 3 DAYS:`); sn.data.forEach((a: any) => L.push(`  • [${normalizeLifeDomain(a.life_domain).toUpperCase()}] ${a.title} — ${a.due_date}`)); }
  L.push(`\nINBOX: ${ib.data?.length||0} unprocessed`);
  if (ib.data?.length)  { ib.data.forEach((i: any) => L.push(`  • [${normalizeLifeDomain(i.life_domain).toUpperCase()}] "${i.raw_text.substring(0, 60)}${i.raw_text.length > 60 ? "…" : ""}"`)); }
  if (wt.data?.length)  { L.push(`\nWAITING:`); wt.data.forEach((w: any) => L.push(`  • [${normalizeLifeDomain(w.life_domain).toUpperCase()}] ${w.title}${w.delegated_to?" → "+w.delegated_to:""}`)); }
  if (vt.data?.length)  { L.push(`\nACTIVE VENTURES:`); vt.data.forEach((v: any) => L.push(`  • ${v.name} ${v.readiness_score}%`)); }
  if (al.data?.length)  { L.push(`\nCEO ALERTS:`); al.data.forEach((r: any) => L.push(`  • [${r.priority}] ${r.title}`)); }
  if (schemaReviews.count > 0) {
    L.push(`\nADMIN REVIEW: ${schemaReviews.count} schema proposal${schemaReviews.count === 1 ? "" : "s"} need Kevin's review before any database changes.`);
    schemaReviews.items.forEach((item: any) => L.push(`  - ${item.description}`));
  }
  return L.join("\n");
}

function getLocalDateKey(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: USER_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function getLocalHour(date = new Date()) {
  return Number(new Intl.DateTimeFormat("en-US", {
    timeZone: USER_TIMEZONE,
    hour: "numeric",
    hour12: false,
  }).format(date));
}

function resolveScheduledReviewWindow(requested?: string | null) {
  if (requested === "morning" || requested === "am") return "morning" as const;
  if (requested === "evening" || requested === "eod" || requested === "pm") return "evening" as const;

  const hour = getLocalHour();
  if (hour === 7) return "morning" as const;
  if (hour === 17) return "evening" as const;
  return null;
}

function getMoneypennyReviewChatId() {
  const raw =
    process.env.MONEYPENNY_REVIEW_CHAT_ID ||
    process.env.TELEGRAM_CHAT_ID_MONEYPENNY ||
    process.env.TELEGRAM_CHAT_ID ||
    "";
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed !== 0 ? parsed : null;
}

function escapeHtml(text: string) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function formatEventTime(startAt: string, endAt?: string | null, allDay?: boolean | null) {
  if (allDay) return "all day";

  const start = new Date(startAt);
  const startText = start.toLocaleTimeString("en-US", {
    timeZone: USER_TIMEZONE,
    hour: "numeric",
    minute: "2-digit",
  });

  if (!endAt) return startText;

  const end = new Date(endAt);
  const endText = end.toLocaleTimeString("en-US", {
    timeZone: USER_TIMEZONE,
    hour: "numeric",
    minute: "2-digit",
  });

  return `${startText}-${endText}`;
}

function truncateText(text: string, max = 400) {
  if (text.length <= max) return text;
  return `${text.substring(0, max)}...`;
}

function buildStoredUserMessage(originalText: string, resolvedText: string) {
  return originalText === resolvedText
    ? originalText
    : `${originalText}\n\nIntent: ${resolvedText}`;
}

function buildFallbackMemoryContent(userMessage: string, assistantReply: string) {
  return `User: ${truncateText(userMessage, 320)}\nAssistant: ${truncateText(assistantReply, 320)}`;
}

function inferBotMemoryEntryType(userMessage: string) {
  return userMessage.trim().startsWith("/") ? "tool_result" : "note";
}

function toVectorLiteral(values: number[]) {
  return `[${values.join(",")}]`;
}

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

  const res = await fetchWithTimeout(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_EMBEDDING_MODEL}:embedContent?key=${key}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: `models/${GEMINI_EMBEDDING_MODEL}`,
      content: { parts: [{ text }] },
      taskType,
      outputDimensionality: GEMINI_EMBEDDING_DIMENSIONS,
    }),
  }, 25000);

  if (!res.ok) throw new Error(`Gemini embeddings: ${await res.text()}`);

  const data = await res.json() as any;
  const values = data.embedding?.values;
  return Array.isArray(values) ? values.map((value: any) => Number(value)) : null;
}

async function getBotRecord(sb: any, slug: string) {
  const { data, error } = await sb
    .from("bots")
    .select("id, slug, name, default_model")
    .eq("slug", slug)
    .limit(1);

  if (error) throw error;
  return data?.[0] || null;
}

async function getBotIdentityFiles(sb: any, botId: string) {
  const { data, error } = await sb
    .from("bot_identity_files")
    .select("file_type, content, version, updated_at")
    .eq("bot_id", botId)
    .order("version", { ascending: false })
    .order("updated_at", { ascending: false });

  if (error) throw error;
  return data || [];
}

function buildBotIdentityPrompt(files: any[], fallbackPrompt: string) {
  const latestByType = new Map<string, string>();
  for (const file of files || []) {
    if (!latestByType.has(file.file_type) && typeof file.content === "string" && file.content.trim()) {
      latestByType.set(file.file_type, file.content.trim());
    }
  }

  const sections = BOT_FILE_ORDER
    .map((fileType) => {
      const content = latestByType.get(fileType);
      return content ? `[${fileType.toUpperCase()}]\n${content}` : null;
    })
    .filter(Boolean);

  return sections.length ? sections.join("\n\n") : fallbackPrompt;
}

async function getOrCreateTelegramSession(sb: any, botId: string, botSlug: string, chatId: number) {
  const baseSlug = `telegram-${botSlug}-${Math.abs(chatId)}`;
  const { data, error } = await sb
    .from("bot_sessions")
    .select("id, bot_id, slug, summary, started_at")
    .eq("bot_id", botId)
    .ilike("slug", `${baseSlug}%`)
    .order("started_at", { ascending: false })
    .limit(1);

  if (error) throw error;
  const latest = data?.[0];
  if (latest?.started_at) {
    const ageMs = Date.now() - new Date(latest.started_at).getTime();
    if (ageMs < TELEGRAM_SESSION_IDLE_MS) return latest;
  }

  const slug = `${baseSlug}-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  const inserted = await sb
    .from("bot_sessions")
    .insert({
      bot_id: botId,
      slug,
      summary: `Telegram chat ${chatId}`,
    })
    .select("id, bot_id, slug, summary, started_at")
    .limit(1);

  if (inserted.error) {
    const duplicate = `${inserted.error.message || ""} ${inserted.error.details || ""}`.toLowerCase();
    if (duplicate.includes("duplicate") || duplicate.includes("unique")) {
      const retry = await sb
        .from("bot_sessions")
        .select("id, bot_id, slug, summary, started_at")
        .eq("bot_id", botId)
        .eq("slug", slug)
        .limit(1);
      if (retry.error) throw retry.error;
      return retry.data?.[0] || null;
    }
    throw inserted.error;
  }

  return inserted.data?.[0] || null;
}

async function loadRecentBotMessages(sb: any, sessionId: string, limit = TELEGRAM_SESSION_HISTORY_LIMIT) {
  const { data, error } = await sb
    .from("bot_messages")
    .select("role, content, created_at")
    .eq("session_id", sessionId)
    .in("role", ["user", "assistant"])
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw error;
  return [...(data || [])].reverse();
}

async function searchBotMemoryContext(sb: any, botId: string, queryText: string) {
  const trimmed = queryText.trim();
  if (!trimmed) return [];

  let queryEmbedding: string | null = null;
  try {
    const values = await embedText(trimmed, "RETRIEVAL_QUERY");
    if (values?.length) queryEmbedding = toVectorLiteral(values);
  } catch (err: any) {
    console.error("[memory] query embedding failed:", err.message);
  }

  const { data, error } = await sb.rpc("search_bot_memory", {
    p_bot_id: botId,
    p_query: trimmed,
    p_query_embedding: queryEmbedding,
    p_match_count: TELEGRAM_MEMORY_MATCH_LIMIT,
  });

  if (error) {
    console.error("[memory] search failed:", error.message);
    return [];
  }

  return data || [];
}

function formatBotMemoryResults(memories: any[]) {
  if (!memories?.length) return "No relevant long-term memory matches.";

  return memories.map((memory: any) => {
    const stamp = memory.created_at
      ? new Date(memory.created_at).toLocaleDateString("en-US", {
          timeZone: USER_TIMEZONE,
          month: "short",
          day: "numeric",
        })
      : "Unknown date";

    return `- [${normalizeLifeDomain(memory.life_domain).toUpperCase()} | ${stamp}] ${memory.content}`;
  }).join("\n");
}

function formatRecentBotMessages(messages: any[]) {
  if (!messages?.length) return "No prior turns in this session.";
  return messages.map((message: any) => `${String(message.role || "").toUpperCase()}: ${message.content}`).join("\n");
}

function buildTelegramBotSystemPrompt(identityPrompt: string, memoryResults: any[], recentMessages: any[]) {
  return `${identityPrompt}

OPERATING CONTEXT:
- Channel: Telegram
- Time zone: ${USER_TIMEZONE}
- Use long-term memory as supporting context, not absolute truth.
- If recent session history conflicts with long-term memory, trust the recent session.
- If the available memory is thin or ambiguous, say so briefly instead of inventing details.

LONG-TERM MEMORY MATCHES:
${formatBotMemoryResults(memoryResults)}

RECENT SESSION HISTORY:
${formatRecentBotMessages(recentMessages)}`;
}

function resolveTelegramUserPrompt(role: string, text: string) {
  if (role === "ceo" && (text === "/briefing" || text === "/portfolio" || text === "/wn")) {
    return text === "/wn"
      ? "What's next? Give me the single next move that deserves my attention now, from a CEO and portfolio perspective, in Jed Bartlet's brisk move-the-meeting-forward style."
      : "Give me a brief portfolio status. What demands my attention?";
  }

  if ((role === "assistant" || role === "moneypenny") && (text === "/briefing" || text === "/b" || text === "/wn")) {
    return text === "/wn"
      ? "What's next? Give me the single next immediate thing to do right now, with one brief sentence on why."
      : "Give me my briefing for today. Top 3 things. Under 100 words.";
  }

  return text;
}

async function loadTelegramConversationState(sb: any, params: { botSlug: string; role: string; chatId: number; queryText: string }) {
  const botRecord = await getBotRecord(sb, params.botSlug);
  if (!botRecord) return null;

  const session = await getOrCreateTelegramSession(sb, botRecord.id, params.botSlug, params.chatId);
  if (!session) return null;

  const [identityFiles, recentMessages, memoryResults] = await Promise.all([
    getBotIdentityFiles(sb, botRecord.id),
    loadRecentBotMessages(sb, session.id),
    searchBotMemoryContext(sb, botRecord.id, params.queryText),
  ]);

  return {
    botRecord,
    session,
    recentMessages,
    systemPrompt: buildTelegramBotSystemPrompt(
      buildBotIdentityPrompt(identityFiles, sysPrompt(params.role, "(no stored identity files available)")),
      memoryResults,
      recentMessages,
    ),
  };
}

async function persistBotInteraction(sb: any, params: {
  botSlug: string;
  role: string;
  chatId: number;
  source: string;
  agentName: string;
  userMessage: string;
  assistantReply: string;
  systemPrompt: string;
  modelUsed?: string;
  session?: any;
  botRecord?: any;
}) {
  const botRecord = params.botRecord || await getBotRecord(sb, params.botSlug);
  if (!botRecord) return null;

  const session = params.session || await getOrCreateTelegramSession(sb, botRecord.id, params.botSlug, params.chatId);
  if (!session) return null;

  const userInsert = await sb.from("bot_messages").insert({
    session_id: session.id,
    role: "user",
    content: params.userMessage,
  });
  if (userInsert.error) throw userInsert.error;

  const assistantInsert = await sb.from("bot_messages").insert({
    session_id: session.id,
    role: "assistant",
    content: params.assistantReply,
  });
  if (assistantInsert.error) throw assistantInsert.error;

  let extractedMemory: any = { should_log: false, summary: "", life_domain: "unknown", topics: [], venture_slugs: [], importance: "low" };
  try {
    extractedMemory = await extractBusinessMemory(params.systemPrompt, params.userMessage, params.assistantReply);
  } catch (err: any) {
    console.error("[memory] summarize failed:", err.message);
  }

  const lifeDomain = normalizeLifeDomain(extractedMemory.life_domain);
  const summary = extractedMemory?.should_log && extractedMemory.summary?.trim()
    ? extractedMemory.summary.trim()
    : "";
  const memoryContent = summary || buildFallbackMemoryContent(params.userMessage, params.assistantReply);
  const memoryInsert = await sb.from("bot_memory").insert({
    bot_id: botRecord.id,
    session_id: session.id,
    log_date: getLocalDateKey(),
    entry_type: inferBotMemoryEntryType(params.userMessage),
    content: memoryContent,
    life_domain: lifeDomain,
    metadata: {
      source: params.source,
      agent_name: params.agentName,
      bot_slug: params.botSlug,
      model_used: params.modelUsed || botRecord.default_model || "gemini-3.1-flash-lite-preview",
      topics: extractedMemory.topics || [],
      venture_slugs: extractedMemory.venture_slugs || [],
      importance: extractedMemory.importance || "medium",
      user_message: truncateText(params.userMessage, 500),
      assistant_reply: truncateText(params.assistantReply, 500),
      embedding_status: "pending",
    },
  }).select("id, content").limit(1);

  if (memoryInsert.error) throw memoryInsert.error;

  if (summary) {
    await sb.from("business_memory").insert({
      source: params.source,
      agent_name: params.agentName,
      summary: `[${formatLogTimestamp()}] ${summary}`,
      life_domain: lifeDomain,
      topics: extractedMemory.topics || [],
      venture_slugs: extractedMemory.venture_slugs || [],
      importance: extractedMemory.importance || "medium",
      metadata: {
        bot_slug: params.botSlug,
        session_id: session.id,
        logged_at: new Date().toISOString(),
        timezone: USER_TIMEZONE,
      },
    }).catch(() => {});
  }

  return { botRecord, session, memory: memoryInsert.data?.[0] || null };
}

async function upsertBotMemoryEmbeddings(sb: any, params: { memoryId: string; botId: string; content: string }) {
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

  const inserted = await sb
    .from("bot_memory_embeddings")
    .upsert(rows, { onConflict: "source_id,content_chunk" });
  if (inserted.error) throw inserted.error;

  return { chunkCount: rows.length };
}

async function buildMoneypennyReviewPayload(sb: any, window: "morning" | "evening") {
  const now = new Date();
  const today = getLocalDateKey(now);
  const horizon = new Date(now.getTime() + (window === "morning" ? 36 : 18) * 60 * 60 * 1000);

  const [
    { data: overdue },
    { data: todayItems },
    { data: soonItems },
    { data: waitingItems },
    { data: inboxItems },
    { data: calendarRows },
    { data: alerts },
    schemaReviews,
  ] = await Promise.all([
    sb.from("gtd_actions").select("title,due_date,life_domain,ventures(name)").eq("status", "active").lt("due_date", today).order("due_date", { ascending: true }).limit(5),
    sb.from("gtd_actions").select("title,context,due_date,life_domain,ventures(name)").eq("status", "active").eq("due_date", today).order("created_at", { ascending: true }).limit(6),
    sb.from("gtd_actions").select("title,due_date,context,life_domain,ventures(name)").eq("status", "active").gte("due_date", today).order("due_date", { ascending: true }).limit(8),
    sb.from("gtd_actions").select("title,delegated_to,due_date,life_domain").eq("status", "waiting").order("due_date", { ascending: true }).limit(5),
    sb.from("gtd_inbox").select("raw_text,created_at,life_domain").eq("processed", false).order("created_at", { ascending: true }).limit(4),
    sb.from("calendar_events").select("title,start_at,end_at,all_day,location,status,life_domain,ventures(name)").neq("status", "cancelled").lte("start_at", horizon.toISOString()).order("start_at", { ascending: true }).limit(20),
    sb.from("ceo_recommendations").select("title,priority").eq("status", "new").in("priority", ["critical", "high"]).limit(3),
    getPendingSchemaReviewSummary(sb, 3),
  ]);

  const lines: string[] = [];
  const nowMs = now.getTime();
  const calendarEvents = (calendarRows || []).filter((event: any) => {
    const startMs = new Date(event.start_at).getTime();
    const endMs = new Date(event.end_at || event.start_at).getTime();
    return event.all_day ? endMs > nowMs : startMs >= nowMs;
  }).slice(0, 6);
  lines.push(`WINDOW: ${window.toUpperCase()}`);
  lines.push(`LOCAL TIME (${USER_TIMEZONE}): ${now.toLocaleString("en-US", { timeZone: USER_TIMEZONE, weekday: "long", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`);

  if (overdue?.length) {
    lines.push(`\nOVERDUE (${overdue.length}):`);
    overdue.forEach((item: any) => {
      const venture = item.ventures?.name ? ` [${item.ventures.name}]` : "";
      lines.push(`- [${normalizeLifeDomain(item.life_domain).toUpperCase()}] ${item.title}${venture} due ${item.due_date}`);
    });
  }

  if (todayItems?.length) {
    lines.push(`\nDUE TODAY (${todayItems.length}):`);
    todayItems.forEach((item: any) => {
      const venture = item.ventures?.name ? ` [${item.ventures.name}]` : "";
      lines.push(`- [${normalizeLifeDomain(item.life_domain).toUpperCase()}] ${item.title}${item.context ? ` ${item.context}` : ""}${venture}`);
    });
  } else {
    lines.push("\nDUE TODAY: none");
  }

  const upcomingTasks = (soonItems || []).filter((item: any) => item.due_date && item.due_date >= today).slice(0, 6);
  if (upcomingTasks.length) {
    lines.push(`\nUPCOMING TASKS (${upcomingTasks.length}):`);
    upcomingTasks.forEach((item: any) => {
      const venture = item.ventures?.name ? ` [${item.ventures.name}]` : "";
      lines.push(`- [${normalizeLifeDomain(item.life_domain).toUpperCase()}] ${item.title}${venture} due ${item.due_date}`);
    });
  }

  if (calendarEvents?.length) {
    lines.push(`\nUPCOMING EVENTS (${calendarEvents.length}):`);
    calendarEvents.forEach((event: any) => {
      const venture = event.ventures?.name ? ` [${event.ventures.name}]` : "";
      const where = event.location ? ` @ ${event.location}` : "";
      lines.push(`- [${normalizeLifeDomain(event.life_domain).toUpperCase()}] ${formatEventTime(event.start_at, event.end_at, event.all_day)} ${event.title}${venture}${where}`);
    });
  }

  if (waitingItems?.length) {
    lines.push(`\nWAITING FOR (${waitingItems.length}):`);
    waitingItems.forEach((item: any) => {
      lines.push(`- [${normalizeLifeDomain(item.life_domain).toUpperCase()}] ${item.title}${item.delegated_to ? ` -> ${item.delegated_to}` : ""}${item.due_date ? ` by ${item.due_date}` : ""}`);
    });
  }

  const inboxCount = inboxItems?.length || 0;
  lines.push(`\nUNPROCESSED INBOX: ${inboxCount}`);
  if (inboxCount > 0) {
    inboxItems!.slice(0, 3).forEach((item: any) => {
      lines.push(`- [${normalizeLifeDomain(item.life_domain).toUpperCase()}] "${item.raw_text.substring(0, 80)}${item.raw_text.length > 80 ? "..." : ""}"`);
    });
  }

  if (alerts?.length) {
    lines.push(`\nCEO ALERTS (${alerts.length}):`);
    alerts.forEach((alert: any) => {
      lines.push(`- [${alert.priority}] ${alert.title}`);
    });
  }

  if (schemaReviews.count > 0) {
    lines.push(`\nADMIN REVIEW (${schemaReviews.count}):`);
    schemaReviews.items.forEach((item: any) => {
      lines.push(`- ${item.description}`);
    });
  }

  const fallbackSections: string[] = [];
  fallbackSections.push(window === "morning" ? "Good morning. Here's the lay of the land." : "End of day check-in. Here's what's still pressing.");

  if (todayItems?.length) {
    fallbackSections.push(`Today: ${todayItems.slice(0, 3).map((item: any) => item.title).join("; ")}.`);
  }

  if (calendarEvents?.length) {
    fallbackSections.push(`Upcoming events: ${calendarEvents.slice(0, 3).map((event: any) => `${formatEventTime(event.start_at, event.end_at, event.all_day)} ${event.title}`).join("; ")}.`);
  }

  if (upcomingTasks.length) {
    fallbackSections.push(`Coming up soon: ${upcomingTasks.slice(0, 3).map((item: any) => `${item.title} (${item.due_date})`).join("; ")}.`);
  }

  if (waitingItems?.length) {
    fallbackSections.push(`Waiting for: ${waitingItems.slice(0, 3).map((item: any) => item.delegated_to ? `${item.title} -> ${item.delegated_to}` : item.title).join("; ")}.`);
  }

  if (overdue?.length) {
    fallbackSections.push(`Overdue: ${overdue.slice(0, 2).map((item: any) => item.title).join("; ")}.`);
  }

  if (inboxCount > 0) {
    fallbackSections.push(`Inbox still has ${inboxCount} unprocessed item${inboxCount === 1 ? "" : "s"}.`);
  }

  if (schemaReviews.count > 0) {
    fallbackSections.push(`${schemaReviews.count} schema proposal${schemaReviews.count === 1 ? "" : "s"} need Kevin's review in the Review tab before any database changes are made.`);
  }

  return {
    context: lines.join("\n"),
    fallback: fallbackSections.join("\n\n"),
  };
}

async function generateMoneypennyReview(sb: any, window: "morning" | "evening") {
  const payload = await buildMoneypennyReviewPayload(sb, window);
  const instruction = window === "morning"
    ? "Write the scheduled 7:00 AM Telegram review."
    : "Write the scheduled 5:00 PM Telegram review.";

  try {
    const { reply } = await gemini(
      sysPrompt("moneypenny", payload.context),
      [{
        role: "user",
        content: `${instruction}

Return plain text only for Telegram.
Keep it under 170 words.
Include:
- the most important tasks or events that need attention soon
- anything overdue that truly matters
- waiting-for items that deserve a follow-up
- one crisp recommendation for what to focus on next

Use short labeled lines if helpful, but do not use markdown or HTML.`,
      }],
      700,
    );

    return reply?.trim() || payload.fallback;
  } catch {
    return payload.fallback;
  }
}

// ─── System prompts ───────────────────────────────────────────────────────────
function sysPrompt(role: string, ctx: string): string {
  const base = `\n\nTime zone: ${USER_TIMEZONE}. Always interpret today, tonight, tomorrow, morning, afternoon, and evening in Eastern Time.\n\nDATABASE CHANGES:\n- This environment has live Supabase/Postgres credentials configured via SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and DATABASE_URL.\n- Do not assume database changes are impossible just because the request requires SQL.\n- If tool or command execution is available in the current runtime, you may apply remote SQL changes, including schema updates, backfills, one-off fixes, functions, indexes, and bulk updates.\n- Prefer normal table writes for ordinary record changes; use SQL when the job truly needs SQL.\n- After making a database change, verify it with a follow-up query and report the result.\n- Only say you cannot run the change when the current interface truly lacks execution tools; if that happens, explain that the limitation is the interface, not the project, and provide the exact SQL plus a verification query.\n\nCURRENT STATE:\n${ctx}`;
  switch (role) {
    case "ceo":      return `You are Burns — Virtual CEO of Welday Enterprises. Cold, calculating, Mr. Burns personality. Strategy, synergies, revenue. Under 180 words.${base}`;
    case "moneypenny": return `You are Moneypenny — the Executive Assistant for Welday Enterprises. Your voice should feel like Bonnie Bach from Charlie Wilson's War: polished, incisive, socially effortless, quietly in control, and fully aware of the room. Use a light, unmistakable Southern cadence in word choice and rhythm, but never overdo it into caricature or heavy phonetic spelling. You are never sloppy, bubbly, or juvenile. You can be lightly dry or amused, but always composed.
You are tactical, not strategic. Focus on today and this week. Give clear direction, crisp prioritization, and elegant phrasing. Sound confident and competent, with subtle charm and steel underneath. Keep replies under 150 words. If CURRENT STATE shows ADMIN REVIEW items, explicitly remind the user that Kevin needs to review them in the Review tab.${base}`;
    case "filer":    return `You are Radar — GTD Filer. Terse, anticipatory. Confirm captures only. Under 80 words.${base}`;
    default:         return `You are Smithers — Executive Assistant. Efficient, professional. Focus TODAY and THIS WEEK. Under 150 words. Accept captures.${base}`;
  }
}

// ─── Telegram ─────────────────────────────────────────────────────────────────
const BOTS: Record<string, { token: string; role: string; slug: string }> = {
  Burns_Welday_Ent_bot:    { token: process.env.TELEGRAM_TOKEN_BURNS    || "", role: "ceo", slug: "burns" },
  Smithers_Welday_Ent_bot: { token: process.env.TELEGRAM_TOKEN_SMITHERS || "", role: "assistant", slug: "smithers" },
  Radar_Welday_Ent_bot:    { token: process.env.TELEGRAM_TOKEN_RADAR    || "", role: "filer", slug: "radar" },
  Moneypenny_Welday_Ent_bot: { token: process.env.TELEGRAM_TOKEN_MONEYPENNY || "", role: "moneypenny", slug: "moneypenny" },
  // Short slugs for flexibility
  burns:      { token: process.env.TELEGRAM_TOKEN_BURNS    || "", role: "ceo", slug: "burns" },
  smithers:   { token: process.env.TELEGRAM_TOKEN_SMITHERS || "", role: "assistant", slug: "smithers" },
  radar:      { token: process.env.TELEGRAM_TOKEN_RADAR    || "", role: "filer", slug: "radar" },
  moneypenny: { token: process.env.TELEGRAM_TOKEN_MONEYPENNY || "", role: "moneypenny", slug: "moneypenny" },
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
  if (role === "filer") return null;

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
      if (sb) void maybeAutoProcessInbox(sb);
      let ctx = "(no live data)";
      if (sb) { try { ctx = await withTimeout(buildContext(sb), 5000, "Supabase context"); } catch (e: any) { ctx = `(context unavailable: ${e.message})`; } }

      const role = persona === "moneypenny" ? "moneypenny" : "assistant";
      const cap = message.match(/^(?:add|capture|inbox|remember|note|remind me[:\s]+)(.+)/i);
      if (cap && sb) {
        try {
          await sb.from("gtd_inbox").insert({ source: "web", raw_text: cap[1].trim() });
        } catch {}
      }

      const msgs = [
        ...(Array.isArray(history) ? history.slice(-10) : []).map((m: any) => ({ role: m.role as string, content: m.content as string })),
        { role: "user" as const, content: message as string },
      ];

      const { reply, model, keyIndex } = await gemini(sysPrompt(role, ctx), msgs, 1024, openRouterKey);
      if (sb) logAgentEvent(sb, { agentName: "ea_dashboard", action: "chat", inputSummary: message.substring(0,100), outputSummary: reply.substring(0,100), modelUsed: model, success: true }).catch(() => {});
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
      if (sb) void maybeAutoProcessInbox(sb);
      let ctx = "(no data)";
      if (sb) { try { ctx = await withTimeout(buildContext(sb), 5000, "Supabase context"); } catch {} }
      const { reply } = await gemini(sysPrompt("assistant", ctx), [{ role: "user", content: "Morning briefing — top 3 things for today. Under 120 words." }], 800);
      return send(res, 200, { briefing: reply });
    }

    if (path === "/api/moneypenny/review" && method === "POST") {
      const auth = isAuthorizedProcessRequest(req);
      if (!auth.ok) return send(res, auth.status, { error: auth.error });

      const sb = getSupabase();
      if (!sb) return send(res, 500, { error: "Supabase not configured" });

      const requestedWindow = body?.window || "auto";
      const window = resolveScheduledReviewWindow(requestedWindow);
      if (!window) {
        return send(res, 200, {
          sent: false,
          skipped: true,
          reason: `Current hour in ${USER_TIMEZONE} is ${getLocalHour()}, so this run is outside the 7:00 AM and 5:00 PM review windows.`,
        });
      }

      const token = process.env.TELEGRAM_TOKEN_MONEYPENNY || "";
      const chatId = getMoneypennyReviewChatId();
      if (!token) return send(res, 500, { error: "TELEGRAM_TOKEN_MONEYPENNY not configured" });
      if (!chatId) return send(res, 500, { error: "MONEYPENNY_REVIEW_CHAT_ID not configured" });

      await maybeAutoProcessInbox(sb);
      const review = await generateMoneypennyReview(sb, window);
      const sent = await tgSend("moneypenny", token, chatId, escapeHtml(review));

      await logAgentEvent(sb, {
        agentName: "moneypenny_scheduler",
        action: sent ? `scheduled_${window}_review_sent` : `scheduled_${window}_review_failed`,
        inputSummary: `window=${window}`,
        outputSummary: review.substring(0, 120),
        modelUsed: GEMINI_MODEL,
        success: sent,
        errorMessage: sent ? undefined : "Telegram send failed",
      }).catch(() => {});

      if (!sent) {
        return send(res, 502, { error: "Telegram send failed", sent: false, window });
      }

      return send(res, 200, { sent: true, window, chatId, preview: review });
    }

    if (path === "/api/bot-memory/embed" && method === "POST") {
      const auth = isAuthorizedProcessRequest(req);
      if (!auth.ok) return send(res, auth.status, { error: auth.error });

      const sb = getSupabase();
      if (!sb) return send(res, 500, { error: "Supabase not configured" });

      const memoryId = body?.memoryId as string | undefined;
      const limit = Math.max(1, Math.min(Number(body?.limit || 5), 20));
      const botSlug = body?.botSlug as string | undefined;

      let botId: string | null = null;
      if (botSlug) {
        const botRecord = await getBotRecord(sb, botSlug).catch(() => null);
        botId = botRecord?.id || null;
        if (!botId) return send(res, 404, { error: `Unknown bot slug: ${botSlug}` });
      }

      let query = sb
        .from("bot_memory")
        .select("id, bot_id, content, created_at")
        .order("created_at", { ascending: false })
        .limit(limit);

      if (memoryId) query = query.eq("id", memoryId);
      if (botId) query = query.eq("bot_id", botId);

      const { data: memories, error } = await query;
      if (error) return send(res, 500, { error: error.message });
      if (!memories?.length) return send(res, 200, { embedded: 0, chunkCount: 0 });

      let embedded = 0;
      let chunkCount = 0;
      for (const memory of memories) {
        const result = await upsertBotMemoryEmbeddings(sb, {
          memoryId: memory.id,
          botId: memory.bot_id,
          content: memory.content,
        });
        embedded++;
        chunkCount += result.chunkCount;
      }

      return send(res, 200, {
        embedded,
        chunkCount,
        model: GEMINI_EMBEDDING_MODEL,
        dimensions: GEMINI_EMBEDDING_DIMENSIONS,
      });
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

    if (path === "/api/schema/apply" && method === "POST") {
      const auth = isAuthorizedSchemaApplyRequest(req);
      if (!auth.ok) return send(res, auth.status, { error: auth.error });

      const sb = getSupabase();
      const pool = getAdminPool();
      if (!pool) return send(res, 500, { error: "DATABASE_URL not configured" });

      let operation: ReturnType<typeof buildSchemaOperation>;
      try {
        operation = buildSchemaOperation(body || {});
      } catch (err: any) {
        return send(res, 400, { error: err.message });
      }

      const client = await pool.connect();
      try {
        await client.query("begin");
        await client.query(operation.sql);
        const verification = await client.query(operation.verifySql, operation.verifyParams);
        if (!verification.rowCount) {
          throw new Error("Schema change verification failed");
        }
        await client.query("commit");

        await logSchemaChange(sb, {
          actor: operation.actor,
          operation: operation.operation,
          tableName: operation.tableName,
          columnName: operation.columnName,
          description: operation.description,
          sql: operation.sql,
          rationale: operation.rationale,
          status: "applied",
        });

        await logAgentEvent(sb, {
          agentName: "schema_api",
          action: operation.operation,
          inputSummary: operation.description,
          outputSummary: operation.sql,
          success: true,
        }).catch(() => {});

        return send(res, 200, {
          ok: true,
          operation: operation.operation,
          tableName: operation.tableName,
          columnName: operation.columnName,
          sql: operation.sql,
          verification: verification.rows,
        });
      } catch (err: any) {
        try { await client.query("rollback"); } catch {}

        await logSchemaChange(sb, {
          actor: operation.actor,
          operation: operation.operation,
          tableName: operation.tableName,
          columnName: operation.columnName,
          description: operation.description,
          sql: operation.sql,
          rationale: operation.rationale,
          status: "rejected",
        });

        await logAgentEvent(sb, {
          agentName: "schema_api",
          action: `${operation.operation}_failed`,
          inputSummary: operation.description,
          outputSummary: operation.sql,
          success: false,
          errorMessage: err.message,
        }).catch(() => {});

        return send(res, 500, { error: err.message, sql: operation.sql });
      } finally {
        client.release();
      }
    }

    if (path === "/api/schema/review-action" && method === "POST") {
      let adminEmail: string | null = null;
      try {
        adminEmail = await getAuthenticatedAdminEmail(req);
      } catch (err: any) {
        return send(res, 500, { error: err.message });
      }
      if (!adminEmail) return send(res, 403, { error: "Admin review required" });

      const sb = getSupabase();
      if (!sb) return send(res, 500, { error: "Supabase not configured" });

      const proposalId = typeof body?.id === "string" ? body.id : "";
      const decision = typeof body?.decision === "string" ? body.decision.toLowerCase() : "";
      if (!proposalId) return send(res, 400, { error: "id required" });
      if (decision !== "approve" && decision !== "reject") {
        return send(res, 400, { error: "decision must be approve or reject" });
      }

      const { data: proposal, error } = await sb
        .from("schema_changelog")
        .select("*")
        .eq("id", proposalId)
        .eq("status", "proposed")
        .single();
      if (error || !proposal) return send(res, 404, { error: "Pending proposal not found" });

      if (decision === "reject") {
        const rejected = await sb
          .from("schema_changelog")
          .update({ status: "rejected", approved_by: adminEmail })
          .eq("id", proposalId)
          .eq("status", "proposed")
          .select("id")
          .maybeSingle();
        if (rejected.error) return send(res, 500, { error: rejected.error.message });
        if (!rejected.data) return send(res, 409, { error: "Proposal is no longer pending" });
        return send(res, 200, { ok: true, id: proposalId, status: "rejected" });
      }

      try {
        const claimed = await sb
          .from("schema_changelog")
          .update({ status: "applying", approved_by: adminEmail, applied_at: null })
          .eq("id", proposalId)
          .eq("status", "proposed")
          .select("*")
          .maybeSingle();
        if (claimed.error) return send(res, 500, { error: claimed.error.message });
        if (!claimed.data) return send(res, 409, { error: "Proposal is no longer pending" });

        const operation = schemaProposalRowToOperation(claimed.data);
        await runSchemaOperation(sb, operation, { logChange: false });
        const applied = await sb
          .from("schema_changelog")
          .update({
            status: "applied",
            approved_by: adminEmail,
            applied_at: new Date().toISOString(),
          })
          .eq("id", proposalId)
          .eq("status", "applying")
          .select("id")
          .maybeSingle();
        if (applied.error) return send(res, 500, { error: applied.error.message });
        if (!applied.data) return send(res, 409, { error: "Proposal approval state changed during apply" });
        return send(res, 200, { ok: true, id: proposalId, status: "applied" });
      } catch (err: any) {
        await sb
          .from("schema_changelog")
          .update({ status: "proposed", approved_by: null, applied_at: null })
          .eq("id", proposalId)
          .eq("status", "applying");
        return send(res, 500, { error: err.message });
      }
    }

    if (path.match(/^\/api\/telegram\/(.+)$/) && method === "POST") {
      const botName = path.match(/^\/api\/telegram\/(.+)$/)![1];
      const bot = BOTS[botName];
      if (!bot) return send(res, 404, { error: "unknown bot" });

      const msg = body?.message;
      if (msg?.text) {
        const text: string = msg.text;
        const chatId: number = msg.chat?.id;
        const { token, role, slug } = bot;
        const sb = getSupabase();
        const agentName = `telegram_${role}_${botName}`;

        const persistTelegramReply = async (assistantReply: string, options: {
          userMessage?: string;
          systemPrompt?: string;
          modelUsed?: string;
          botRecord?: any;
          session?: any;
        } = {}) => {
          if (!sb) return;

          try {
            await persistBotInteraction(sb, {
              botSlug: slug,
              role,
              chatId,
              source: "telegram",
              agentName,
              userMessage: options.userMessage || text,
              assistantReply,
              systemPrompt: options.systemPrompt || sysPrompt(role, "(no persistent identity loaded)"),
              modelUsed: options.modelUsed,
              botRecord: options.botRecord,
              session: options.session,
            });
          } catch (err: any) {
            console.error("[memory] persist failed:", err.message);
          }
        };

        const sendAndPersistTelegramReply = async (assistantReply: string, options: {
          userMessage?: string;
          systemPrompt?: string;
          modelUsed?: string;
          botRecord?: any;
          session?: any;
        } = {}) => {
          const sent = await tgSend(botName, token, chatId, assistantReply);
          if (sent) {
            await persistTelegramReply(assistantReply, options);
          }
          return sent;
        };

        if (sb) {
          void maybeAutoProcessInbox(sb);
        }

        if (sb && shouldCaptureTelegramMessage(role, text)) {
          try {
            await captureToInbox(sb, {
              source: "telegram",
              rawText: text,
              telegramChatId: chatId,
              telegramMessageId: msg.message_id,
            });
            await logAgentEvent(sb, {
              agentName,
              action: "capture_inbox",
              inputSummary: text.substring(0, 100),
              outputSummary: "Stored in inbox from Telegram message.",
            }).catch(() => {});
          } catch (err: any) {
            await logAgentEvent(sb, {
              agentName,
              action: "capture_inbox_failed",
              inputSummary: text.substring(0, 100),
              outputSummary: "Inbox insert failed.",
              success: false,
              errorMessage: err?.message || "Inbox insert failed",
            }).catch(() => {});
            if (role === "filer") {
              await tgSend(botName, token, chatId, "I couldn't add that to the inbox. The write failed, so nothing was recorded.");
              return send(res, 200, { ok: true });
            }
          }
        }

        if (text === "/start") {
          await sendAndPersistTelegramReply(getStartMessage(role));
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
            await logAgentEvent(sb, {
              agentName,
              action: "delegate_to_inbox",
              inputSummary: captureIntent.substring(0, 100),
              outputSummary: "Forwarded to inbox.",
            }).catch(() => {});
            const captureReply = getAssistantCaptureReply(role);
            await sendAndPersistTelegramReply(captureReply, {
              userMessage: buildStoredUserMessage(text, captureIntent),
            });
          } catch (err: any) {
            await logAgentEvent(sb, {
              agentName,
              action: "delegate_to_inbox_failed",
              inputSummary: captureIntent.substring(0, 100),
              outputSummary: "Inbox handoff failed.",
              success: false,
              errorMessage: err?.message || "Inbox handoff failed",
            }).catch(() => {});
            await tgSend(botName, token, chatId, "I tried to hand that to Radar, but the inbox didn't cooperate.");
          }
          return send(res, 200, { ok: true });
        }

        if (role === "filer") {
          if (text === "/status") {
            let statusReply = "Inbox status unavailable (no Supabase connection).";
            if (sb) {
              const { data } = await sb.from("gtd_inbox").select("id").eq("processed", false);
              statusReply = `${data?.length || 0} items in inbox awaiting processing. Send /process to file them now.`;
            }
            await sendAndPersistTelegramReply(statusReply);
          } else if (text === "/wn") {
            const { data } = sb
              ? await sb.from("gtd_inbox").select("raw_text").eq("processed", false).order("created_at", { ascending: true }).limit(1)
              : { data: null };
            const nextItem = data?.[0]?.raw_text;
            const nextReply = nextItem
              ? `Next in the stack: "${nextItem.substring(0, 120)}${nextItem.length > 120 ? "..." : ""}"\n\nSend /process when you're ready to file it.`
              : "Inbox is clear. Nothing waiting on me right now.";
            await sendAndPersistTelegramReply(nextReply);
          } else if (text === "/process" || text === "/p" || text === "/file") {
            const result = sb ? await processInbox(sb, true, 20) : { processed: 0, total: 0 };
            const processReply = result.total > 0
              ? `Processed ${result.processed} of ${result.total} inbox items.`
              : "Nothing waiting in the inbox right now.";
            await sendAndPersistTelegramReply(processReply);
          } else {
            await sendAndPersistTelegramReply(getRadarConfirmation(text));
          }
        } else {
          const userMsg = resolveTelegramUserPrompt(role, text);
          const storedUserMessage = buildStoredUserMessage(text, userMsg);
          const conversationState = sb
            ? await loadTelegramConversationState(sb, {
                botSlug: slug,
                role,
                chatId,
                queryText: userMsg,
              }).catch((err: any) => {
                console.error("[memory] conversation state failed:", err.message);
                return null;
              })
            : null;

          const persistentSystemPrompt = conversationState?.systemPrompt || sysPrompt(role, "(persistent memory unavailable)");
          const recentMessages = conversationState?.recentMessages || [];
          try {
            const persistentModelUsed = conversationState?.botRecord?.default_model || GEMINI_MODEL;
            const { reply, model } = await gemini(
              persistentSystemPrompt,
              [
                ...recentMessages.map((item: any) => ({ role: item.role, content: item.content })),
                { role: "user", content: userMsg },
              ],
              1024,
            );
            const sent = await tgSend(botName, token, chatId, reply);

            if (sb) {
              if (sent) {
                await persistTelegramReply(reply, {
                  userMessage: storedUserMessage,
                  systemPrompt: persistentSystemPrompt,
                  modelUsed: model || persistentModelUsed,
                  botRecord: conversationState?.botRecord,
                  session: conversationState?.session,
                });
              }
              logAgentEvent(sb, {
                agentName,
                action: "chat",
                inputSummary: userMsg.substring(0, 100),
                outputSummary: reply.substring(0, 100),
                modelUsed: model || persistentModelUsed,
                success: sent,
                errorMessage: sent ? undefined : "Telegram send failed",
              }).catch(() => {});
            }
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
