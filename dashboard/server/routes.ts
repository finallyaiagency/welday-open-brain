import type { Express } from "express";
import type { Server } from "http";
import { contextToHashtag, extractHashtags, mergeHashtags } from "../shared/hashtags";
import { createClient } from "@supabase/supabase-js";
import pg from "pg";
const { Pool } = pg;


const BOTS: Record<string, { token: string; role: string; slug: string }> = {
  Burns_Welday_Ent_bot: { token: process.env.TELEGRAM_TOKEN_BURNS || "", role: "ceo", slug: "burns" },
  Smithers_Welday_Ent_bot: { token: process.env.TELEGRAM_TOKEN_SMITHERS || "", role: "assistant", slug: "smithers" },
  Radar_Welday_Ent_bot: { token: process.env.TELEGRAM_TOKEN_RADAR || "", role: "filer", slug: "radar" },
  Moneypenny_Welday_Ent_bot: { token: process.env.TELEGRAM_TOKEN_MONEYPENNY || "", role: "moneypenny", slug: "moneypenny" },
  burns: { token: process.env.TELEGRAM_TOKEN_BURNS || "", role: "ceo", slug: "burns" },
  smithers: { token: process.env.TELEGRAM_TOKEN_SMITHERS || "", role: "assistant", slug: "smithers" },
  radar: { token: process.env.TELEGRAM_TOKEN_RADAR || "", role: "filer", slug: "radar" },
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

function isMissingColumnError(error: any, column: string) {
  const text = `${error?.message || ""} ${error?.details || ""}`.toLowerCase();
  return text.includes(`column "${column.toLowerCase()}"`) || text.includes(`column ${column.toLowerCase()}`);
}

async function captureToInbox(supabase: any, payload: { rawText: string; source: string; telegramChatId?: number; telegramMessageId?: number }) {
  const baseInsert: Record<string, any> = {
    raw_text: payload.rawText,
    source: payload.source,
    tags: extractHashtags(payload.rawText),
    telegram_chat_id: payload.telegramChatId,
    telegram_message_id: payload.telegramMessageId,
  };

  let insertPayload = { ...baseInsert };
  let preferred = await supabase.from("gtd_inbox").insert(insertPayload);
  if (preferred.error && isMissingColumnError(preferred.error, "tags")) {
    const { tags: _tags, ...withoutTags } = insertPayload;
    insertPayload = withoutTags;
    preferred = await supabase.from("gtd_inbox").insert(insertPayload);
  }
  if (!preferred.error) return { storedSource: payload.source };

  if (!isSourceConstraintError(preferred.error) || payload.source === "telegram") {
    throw preferred.error;
  }

  const fallback = await supabase.from("gtd_inbox").insert({
    ...insertPayload,
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

function getSupabase() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key) {
    console.log("[express] getSupabase: missing URL or KEY", { url: !!url, key: !!key });
    return null;
  }
  if (process.env.NODE_ENV !== "production") {
    console.log(`[express] getSupabase: URL=${url} KEY_LEN=${key.length}`);
  }
  return createClient(url, key);
}

async function getAuthenticatedAdminEmail(req: any) {
  const supabase = getSupabase();
  if (!supabase) throw new Error("Supabase not configured");

  const admins = getSchemaReviewAdminEmails();
  if (!admins.length) throw new Error("SCHEMA_REVIEW_ADMIN_EMAILS not configured");

  const authHeader = req.header?.("authorization") || req.headers?.authorization;
  const token = typeof authHeader === "string" && authHeader.toLowerCase().startsWith("bearer ")
    ? authHeader.slice(7).trim()
    : "";
  if (!token) return null;

  const { data, error } = await supabase.auth.getUser(token);
  if (error) return null;

  const email = data.user?.email?.toLowerCase() || "";
  return admins.includes(email) ? email : null;
}

const GEMINI_MODEL = "gemini-3.1-flash-lite-preview";
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

async function logAgentEvent(supabase: any, params: {
  agentName: string;
  action: string;
  inputSummary?: string;
  outputSummary?: string;
  success?: boolean;
  errorMessage?: string;
  modelUsed?: string;
}) {
  await supabase.from("agent_logs").insert({
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
  if (!isSafeIdentifier(value)) {
    throw new Error(`Invalid identifier: ${String(value)}`);
  }
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

async function logSchemaChange(supabase: any, details: {
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
  if (!supabase) return;
  try {
    await supabase.from("schema_changelog").insert({
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

async function runSchemaOperation(supabase: any, operation: ReturnType<typeof buildSchemaOperation>, options?: { logChange?: boolean }) {
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
      await logSchemaChange(supabase, {
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

    await logAgentEvent(supabase, {
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
      await logSchemaChange(supabase, {
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

    await logAgentEvent(supabase, {
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

async function fetchPendingSchemaReviews(supabase: any, limit = 10) {
  const { data, error } = await supabase
    .from("schema_changelog")
    .select("id, description, rationale, created_at, table_name, column_name")
    .eq("status", "proposed")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw error;
  return data || [];
}

async function getPendingSchemaReviewSummary(supabase: any, limit = 3) {
  const reviews = await fetchPendingSchemaReviews(supabase, limit);
  return {
    count: reviews.length,
    items: reviews,
  };
}

function formatSchemaReviewRationale(params: {
  review: any;
  inbox: any;
  classification: any;
}) {
  const parts = [
    `Justification: ${params.review.rationale || params.review.justification || "Schema gap identified during inbox processing."}`,
  ];
  if (params.review.suspectedIntent) {
    parts.push(`Suspected intent: ${params.review.suspectedIntent}`);
  }
  if (params.review.clarificationQuestion) {
    parts.push(`Clarification to confirm before approval: ${params.review.clarificationQuestion}`);
  }
  parts.push(`Inbox item: ${params.inbox.raw_text}`);
  parts.push(`Filed as: ${params.classification.destination}`);
  return parts.join("\n\n");
}

async function reviewInboxSchemaNeed(supabase: any, inbox: any, classification: any) {
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

  const { content } = await openAIChat([
    {
      role: "system",
      content: "You are a conservative database architect. Return valid JSON only. Favor no_change unless a structured schema gap is obvious and recurring.",
    },
    { role: "user", content: prompt },
  ], 700);

  let review: any;
  try {
    review = parseJsonResponse(content);
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
    await logAgentEvent(supabase, {
      agentName: "radar_schema_review",
      action: "schema_review_invalid",
      inputSummary: inbox.raw_text.substring(0, 120),
      outputSummary: typeof content === "string" ? content.substring(0, 200) : "invalid schema review",
      success: false,
      errorMessage: err.message,
    }).catch(() => {});
    return null;
  }
}

async function createSchemaProposal(supabase: any, params: {
  operation: ReturnType<typeof buildSchemaOperation>;
  review: any;
  inbox: any;
  classification: any;
}) {
  const { data: existing, error: lookupError } = await supabase
    .from("schema_changelog")
    .select("id")
    .eq("status", "proposed")
    .eq("sql_statement", params.operation.sql)
    .limit(1);

  if (lookupError) throw lookupError;
  if (existing?.length) return { created: false, id: existing[0].id };

  const proposal = await supabase
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

  await logAgentEvent(supabase, {
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

async function fetchWithTimeout(url: string, options: any = {}, timeout = 60000) {
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
  }, 60000);

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

function normalizeLifeDomain(value: unknown, fallbackCategory?: unknown) {
  if (value === "business" || value === "personal" || value === "unknown") return value;
  if (fallbackCategory === "business") return "business";
  if (fallbackCategory === "personal") return "personal";
  return "unknown";
}

async function fetchProjectCatalog(supabase: any) {
  const { data, error } = await supabase
    .from("gtd_projects")
    .select("id, title, life_domain, area, status")
    .eq("status", "active")
    .order("updated_at", { ascending: false })
    .limit(40);

  if (error) throw error;
  return data || [];
}

function buildProjectCatalogPrompt(projects: any[]) {
  if (!projects.length) return "No active projects yet.";
  return projects
    .map((project) => `- ${project.title} [${project.life_domain || "unknown"}${project.area ? `, ${project.area}` : ""}]`)
    .join("\n");
}

async function resolveProjectId(supabase: any, projectTitle: string | null | undefined) {
  const title = projectTitle?.trim();
  if (!title) return null;

  const exact = await supabase
    .from("gtd_projects")
    .select("id, title")
    .eq("status", "active")
    .ilike("title", title)
    .limit(1);

  if (exact.error) throw exact.error;
  if (exact.data?.[0]?.id) return exact.data[0].id;

  const fuzzy = await supabase
    .from("gtd_projects")
    .select("id, title")
    .eq("status", "active")
    .ilike("title", `%${title}%`)
    .limit(1);

  if (fuzzy.error) throw fuzzy.error;
  return fuzzy.data?.[0]?.id || null;
}

function truncateText(text: string, max = 400) {
  if (text.length <= max) return text;
  return `${text.substring(0, max)}...`;
}

function getTelegramSessionSlug(botSlug: string, chatId: number, date = new Date()) {
  return `${getLocalDateKey(date)}-${botSlug}-telegram-${Math.abs(chatId)}`;
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
  }, 60000);

  if (!res.ok) throw new Error(`Gemini embeddings: ${await res.text()}`);

  const data = await res.json() as any;
  const values = data.embedding?.values;
  return Array.isArray(values) ? values.map((value: any) => Number(value)) : null;
}

async function getBotRecord(supabase: any, slug: string) {
  const { data, error } = await supabase
    .from("bots")
    .select("id, slug, name, default_model")
    .eq("slug", slug)
    .limit(1);

  if (error) throw error;
  return data?.[0] || null;
}

async function getBotIdentityFiles(supabase: any, botId: string) {
  const { data, error } = await supabase
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

async function getOrCreateTelegramSession(supabase: any, botId: string, botSlug: string, chatId: number) {
  const baseSlug = `telegram-${botSlug}-${Math.abs(chatId)}`;
  const { data, error } = await supabase
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

  const inserted = await supabase
    .from("bot_sessions")
    .insert({
      bot_id: botId,
      slug,
      summary: `Telegram chat ${chatId}`,
    })
    .select("id, bot_id, slug, summary")
    .limit(1);

  if (inserted.error) {
    const duplicate = `${inserted.error.message || ""} ${inserted.error.details || ""}`.toLowerCase();
    if (duplicate.includes("duplicate") || duplicate.includes("unique")) {
      const retry = await supabase
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

async function loadRecentBotMessages(supabase: any, sessionId: string, limit = TELEGRAM_SESSION_HISTORY_LIMIT) {
  const { data, error } = await supabase
    .from("bot_messages")
    .select("role, content, created_at")
    .eq("session_id", sessionId)
    .in("role", ["user", "assistant"])
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw error;
  return [...(data || [])].reverse();
}

async function searchBotMemoryContext(supabase: any, botId: string, queryText: string) {
  const trimmed = queryText.trim();
  if (!trimmed) return [];

  let queryEmbedding: string | null = null;
  try {
    const values = await embedText(trimmed, "RETRIEVAL_QUERY");
    if (values?.length) queryEmbedding = toVectorLiteral(values);
  } catch (err: any) {
    console.error("[memory] query embedding failed:", err.message);
  }

  const { data, error } = await supabase.rpc("search_bot_memory", {
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

async function loadTelegramConversationState(supabase: any, params: { botSlug: string; role: string; chatId: number; queryText: string }) {
  const botRecord = await getBotRecord(supabase, params.botSlug);
  if (!botRecord) return null;

  const session = await getOrCreateTelegramSession(supabase, botRecord.id, params.botSlug, params.chatId);
  if (!session) return null;

  const [identityFiles, recentMessages, memoryResults] = await Promise.all([
    getBotIdentityFiles(supabase, botRecord.id),
    loadRecentBotMessages(supabase, session.id),
    searchBotMemoryContext(supabase, botRecord.id, params.queryText),
  ]);

  return {
    botRecord,
    session,
    recentMessages,
    systemPrompt: buildTelegramBotSystemPrompt(
      buildBotIdentityPrompt(identityFiles, getSystemPrompt(params.role, "(no stored identity files available)")),
      memoryResults,
      recentMessages,
    ),
  };
}

async function persistBotInteraction(supabase: any, params: {
  botSlug: string;
  role: string;
  chatId: number;
  source: string;
  agentName: string;
  userMessage: string;
  assistantReply: string;
  systemPrompt: string;
  modelUsed?: string;
  tokensUsed?: number;
  session?: any;
  botRecord?: any;
}) {
  const botRecord = params.botRecord || await getBotRecord(supabase, params.botSlug);
  if (!botRecord) return null;

  const session = params.session || await getOrCreateTelegramSession(supabase, botRecord.id, params.botSlug, params.chatId);
  if (!session) return null;

  const userInsert = await supabase.from("bot_messages").insert({
    session_id: session.id,
    role: "user",
    content: params.userMessage,
  });
  if (userInsert.error) throw userInsert.error;

  const assistantInsert = await supabase.from("bot_messages").insert({
    session_id: session.id,
    role: "assistant",
    content: params.assistantReply,
    tokens_used: params.tokensUsed,
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
  const memoryInsert = await supabase
    .from("bot_memory")
    .insert({
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
        model_used: params.modelUsed || botRecord.default_model || GEMINI_MODEL,
        topics: extractedMemory.topics || [],
        venture_slugs: extractedMemory.venture_slugs || [],
        importance: extractedMemory.importance || "medium",
        user_message: truncateText(params.userMessage, 500),
        assistant_reply: truncateText(params.assistantReply, 500),
        embedding_status: "pending",
      },
    })
    .select("id, content")
    .limit(1);

  if (memoryInsert.error) throw memoryInsert.error;

  if (summary) {
    await supabase.from("business_memory").insert({
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

async function classifyInboxBatch(supabase: any, items: any[], projectCatalog: any[] = []) {
  if (!items?.length) return [];
  const now = new Date();
  const easternTime = now.toLocaleString("en-US", { timeZone: "America/New_York" });
  const itemsList = items.map((item, i) => `ITEM_${i}:\nID: ${item.id}\nText: "${item.raw_text}"`).join("\n\n---\n\n");

  const prompt = `Classify these ${items.length} GTD inbox items and tell me where to file each. User's local time (Eastern Time) is ${easternTime}.

Active projects:
${buildProjectCatalogPrompt(projectCatalog)}

GTD destinations:
- action: A concrete next step
- project: Outcome requiring multiple steps
- someday: Idea to revisit later
- reference: Information to keep (not actionable)
- calendar: A scheduled appointment, meeting, or event with a specific time and date. MUST use this for any appointment.
- trash: Not worth keeping

Respond with a JSON array of objects, one for each and every ITEM_X provided.
Format:
[
  {
    "id": "match-the-item-id",
    "destination": "action" | "project" | "someday" | "reference" | "calendar" | "trash",
    "title": "clean, concise title",
    "summary": "one sentence summary",
    "life_domain": "business" | "personal" | "unknown",
    "category": "work" | "personal" | "health" | "finance" | "learning" | "business",
    "venture_slug": "relevant-venture-slug or null",
    "project_title": "matching active project title or null",
    "context": "@home" | "@work" | "@computer" | "@phone" | "@errands" | "@agenda" | "@email" | "@anywhere" | "@waiting" | null,
    "start_at": "ISO-8601 date with -04:00 offset or null",
    "end_at": "ISO-8601 date with -04:00 offset or null",
    "energy": "high" | "medium" | "low",
    "confidence": 0.0-1.0
  },
  ...
]

Items:
${itemsList}`;

  try {
    const { content } = await openAIChat([
      { role: "system", content: "You are a precise GTD classifier. Return a valid JSON array only." },
      { role: "user", content: prompt },
    ], 3000);
    const results = parseJsonResponse(content);
    if (!Array.isArray(results)) throw new Error("Batch classification did not return an array");
    return results;
  } catch (err) {
    console.error(`[GTD] batch classification failed for ${items.length} items:`, err);
    throw err;
  }
}

async function classifyInboxItem(supabase: any, text: string, projectCatalog: any[] = []) {
  const now = new Date();
  const easternTime = now.toLocaleString("en-US", { timeZone: "America/New_York" });
  const prompt = `Classify this GTD inbox item and tell me where to file it. User's local time (Eastern Time) is ${easternTime}.

Inbox text: "${text}"

Active projects you may assign when relevant:
${buildProjectCatalogPrompt(projectCatalog)}

GTD destinations:
- action: A concrete next step
- project: Outcome requiring multiple steps
- someday: Idea to revisit later
- reference: Information to keep (not actionable)
- calendar: A scheduled appointment, meeting, or event with a specific time and date. MUST use this for any appointment.
- trash: Not worth keeping

Respond with JSON only:
{
  "destination": "action" | "project" | "someday" | "reference" | "calendar" | "trash",
  "title": "clean, concise title",
  "summary": "one sentence summary",
  "life_domain": "business" | "personal" | "unknown",
  "category": "work" | "personal" | "health" | "finance" | "learning" | "business",
  "venture_slug": "relevant-venture-slug or null",
  "project_title": "matching active project title or null",
  "context": "@home" | "@work" | "@computer" | "@phone" | "@errands" | "@agenda" | "@email" | "@anywhere" | "@waiting" | null,
  "start_at": "ISO-8601 date with -04:00 offset or null if not calendar",
  "end_at": "ISO-8601 date with -04:00 offset or null if not calendar",
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
      life_domain: "unknown",
      category: "work",
      venture_slug: null,
      project_title: null,
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
  const lifeDomain = normalizeLifeDomain(classification.life_domain, category);
  let projectId = inbox.project_id || null;
  if (!projectId && classification.project_title) {
    projectId = await resolveProjectId(supabase, classification.project_title);
  }

  const contextTag = contextToHashtag(classification.context);
  const tags = mergeHashtags(inbox.tags, extractHashtags(inbox.raw_text), [category, lifeDomain, contextTag]);
  let filedItemId: string | null = null;

  if (classification.destination === "action") {
    const inserted = await supabase.from("gtd_actions").insert({
      title: classification.title,
      project_id: projectId,
      venture_id: ventureId,
      context: classification.context,
      life_domain: lifeDomain,
      source: inbox.source || "manual",
      energy: classification.energy || "medium",
      notes: inbox.raw_text,
      tags,
    }).select("id").single();
    if (inserted.error) throw inserted.error;
    filedItemId = inserted.data?.id || null;
  } else if (classification.destination === "project") {
    const inserted = await supabase.from("gtd_projects").insert({
      title: classification.title,
      venture_id: ventureId,
      area: category,
      life_domain: lifeDomain,
      notes: inbox.raw_text,
      tags,
    }).select("id").single();
    if (inserted.error) throw inserted.error;
    projectId = inserted.data?.id || null;
    filedItemId = projectId;
  } else if (classification.destination === "someday") {
    const inserted = await supabase.from("gtd_someday").insert({
      title: classification.title,
      description: inbox.raw_text,
      venture_id: ventureId,
      area: category,
      tags,
    }).select("id").single();
    if (inserted.error) throw inserted.error;
    filedItemId = inserted.data?.id || null;
  } else if (classification.destination === "reference") {
    const urlMatch = inbox.raw_text.match(/https?:\/\/[^\s]+/i);
    const extractedUrl = urlMatch ? urlMatch[0].replace(/[.,!?;:)]+$/, "") : null;

    const inserted = await supabase.from("gtd_reference").insert({
      title: classification.title,
      content: inbox.raw_text,
      url: extractedUrl,
      venture_id: ventureId,
      category: "idea",
      area: category,
      tags,
    }).select("id").single();
    if (inserted.error) throw inserted.error;
    filedItemId = inserted.data?.id || null;
  } else if (classification.destination === "calendar") {
    const payload = {
      title: classification.title,
      description: (classification.summary + "\n" + inbox.raw_text).replace(/\\n/g, "\n"),
      start_at: classification.start_at || new Date().toISOString(),
      end_at: classification.end_at || new Date(Date.now() + 3600000).toISOString(),
      source: "system",
      event_type: category === "work" || category === "business" ? "work" : "personal",
      life_domain: lifeDomain,
      status: "confirmed",
      google_calendar_id: "weldayenterprises@gmail.com"
    };
    console.log("[GTD] filing to calendar:", JSON.stringify(payload, null, 2));
    const inserted = await supabase.from("calendar_events").insert(payload).select("id").single();
    if (inserted.error) {
      console.error("[GTD] calendar insert error:", inserted.error);
      throw inserted.error;
    }
    console.log("[GTD] calendar insert success, ID:", inserted.data?.id);
    filedItemId = inserted.data?.id || null;
  }

  await supabase.from("gtd_inbox").update({
    processed: true,
    processed_at: new Date().toISOString(),
    filed_to: classification.destination,
    filed_item_id: filedItemId,
    project_id: projectId,
    ai_summary: classification.summary,
    ai_category: classification.category,
    life_domain: lifeDomain,
    ai_confidence: classification.confidence,
    tags,
  }).eq("id", inbox.id);
}

async function processInbox(supabase: any, force = false, limit = 20) {
  const startTime = Date.now();
  const maxDurationMs = 50000; // Stop if exceeding 50s total

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

  const projectCatalog = await fetchProjectCatalog(supabase);
  let processed = 0;
  let schemaReviewsProposed = 0;

  const processItemWithClassification = async (item: any, classification: any) => {
    try {
      const schemaReview = await reviewInboxSchemaNeed(supabase, item, classification).catch((err: any) => {
        console.error("[GTD] schema review failed:", err.message);
        return null;
      });
      if (schemaReview) {
        try {
          const proposal = await createSchemaProposal(supabase, {
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
      await fileInboxItem(supabase, item, classification);
      processed++;
    } catch (err: any) {
      console.error("[GTD] process item failed:", err.message);
    }
  };

  const remainingItems = [...items];
  while (remainingItems.length > 0) {
    if (Date.now() - startTime > maxDurationMs) {
      console.warn(`[GTD] processInbox: reaching timeout (${Date.now() - startTime}ms), stopping early.`);
      break;
    }

    const batch = remainingItems.splice(0, 5); // Use smaller batches of 5 for safety
    try {
      const classifications = await classifyInboxBatch(supabase, batch, projectCatalog);
      for (const item of batch) {
        const cls = classifications.find((c: any) => c.id === item.id);
        if (cls) {
          await processItemWithClassification(item, cls);
        } else {
          // Fallback for missing item in batch results
          const singleCls = await classifyInboxItem(supabase, item.raw_text, projectCatalog);
          await processItemWithClassification(item, singleCls);
        }
      }
    } catch (err: any) {
      console.error("[GTD] batch processing failed, falling back to sequential:", err.message);
      for (const item of batch) {
        try {
          const singleCls = await classifyInboxItem(supabase, item.raw_text, projectCatalog);
          await processItemWithClassification(item, singleCls);
        } catch (singleErr: any) {
          console.error(`[GTD] sequential fallback failed for item ${item.id}:`, singleErr.message);
        }
      }
    }
  }

  return { processed, total: items.length, schemaReviewsProposed };
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
  const githubSecret = process.env.GTD_PROCESS_SECRET;
  const cronSecret = process.env.CRON_SECRET;
  if (!githubSecret && !cronSecret) {
    return { ok: false, status: 500, error: "GTD_PROCESS_SECRET or CRON_SECRET not configured" };
  }

  const providedHeader = req.header?.("x-cron-secret") || req.headers?.["x-cron-secret"];
  if (githubSecret && providedHeader === githubSecret) {
    return { ok: true as const };
  }

  const authorization = req.header?.("authorization") || req.headers?.authorization;
  if (cronSecret && authorization === `Bearer ${cronSecret}`) {
    return { ok: true as const };
  }

  return { ok: false, status: 401, error: "Unauthorized" };
}

function isAuthorizedSchemaApplyRequest(req: any) {
  const expected = process.env.SCHEMA_APPLY_SECRET;
  if (!expected) return { ok: false, status: 500, error: "SCHEMA_APPLY_SECRET not configured" };

  const provided = req.header?.("x-schema-secret") || req.headers?.["x-schema-secret"];
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

  const { content } = await openAIChat([
    { role: "system", content: systemPrompt },
    { role: "user", content: prompt },
  ], 250);

  try {
    return parseJsonResponse(content);
  } catch {
    return { should_log: false, summary: "", life_domain: "unknown", topics: [], venture_slugs: [], importance: "low" };
  }
}

async function maybeLogBusinessMemory(supabase: any, params: { source: string; agentName: string; systemPrompt: string; userMessage: string; assistantReply: string }) {
  try {
    const memory = await extractBusinessMemory(params.systemPrompt, params.userMessage, params.assistantReply);
    if (!memory?.should_log || !memory.summary?.trim()) return;
    const timestamp = formatLogTimestamp();

    await supabase.from("business_memory").insert({
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

async function openAIChat(messages: any[], maxTokens = 300, openRouterKey?: string, model = GEMINI_MODEL) {
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

  const selectedModel = model?.trim() || GEMINI_MODEL;
  if (messages.some(m => m.content.includes("TRIGGER_429"))) {
     const err: any = new Error("Rate limit exceeded");
     err.status = 429;
     throw err;
  }
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${selectedModel}:generateContent?key=${key}`;
  const res = await fetchWithTimeout(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }, 60000);

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
    { data: alerts }, schemaReviews,
  ] = await Promise.all([
    supabase.from("gtd_actions").select("title,context,due_date,life_domain,ventures(name)").eq("status", "active").lt("due_date", today).limit(8),
    supabase.from("gtd_actions").select("title,context,energy,life_domain,ventures(name)").eq("status", "active").eq("due_date", today).limit(8),
    supabase.from("gtd_actions").select("title,due_date,energy,life_domain,ventures(name)").eq("status", "active").gt("due_date", today).lte("due_date", in3).order("due_date").limit(6),
    supabase.from("gtd_inbox").select("raw_text,life_domain").eq("processed", false).limit(5),
    supabase.from("gtd_actions").select("title,delegated_to,life_domain").eq("status", "waiting").limit(5),
    supabase.from("ventures").select("name,status,readiness_score,risk_level,monthly_revenue_usd").eq("status", "active").order("readiness_score", { ascending: false }),
    supabase.from("ceo_recommendations").select("title,priority,type").eq("status", "new").in("priority", ["critical", "high"]).order("generated_at", { ascending: false }).limit(3),
    getPendingSchemaReviewSummary(supabase, 3),
  ]);

  const lines: string[] = [];
  lines.push(`LOCAL TIME (${USER_TIMEZONE}): ${now.toLocaleDateString("en-US", { timeZone: USER_TIMEZONE, weekday: "long", month: "short", day: "numeric" })} ${now.toLocaleTimeString("en-US", { timeZone: USER_TIMEZONE, hour: "numeric", minute: "2-digit" })}`);

  if (overdue?.length) lines.push(`\nOVERDUE (${overdue.length}):`, ...overdue.map((a: any) => `  • [${normalizeLifeDomain(a.life_domain).toUpperCase()}] ${a.title}${a.ventures?.name ? ` [${a.ventures.name}]` : ""} — was due ${a.due_date}`));
  if (todayItems?.length) lines.push(`\nDUE TODAY (${todayItems.length}):`, ...todayItems.map((a: any) => `  • [${normalizeLifeDomain(a.life_domain).toUpperCase()}] ${a.title}${a.context ? ` ${a.context}` : ""}${a.ventures?.name ? ` [${a.ventures.name}]` : ""}`));
  else lines.push(`\nDUE TODAY: nothing scheduled`);
  if (soon?.length) lines.push(`\nNEXT 3 DAYS (${soon.length}):`, ...soon.map((a: any) => `  • [${normalizeLifeDomain(a.life_domain).toUpperCase()}] ${a.title}${a.ventures?.name ? ` [${a.ventures.name}]` : ""} — ${a.due_date}`));

  const ic = inbox?.length || 0;
  lines.push(`\nINBOX: ${ic} unprocessed`);
  if (ic > 0) lines.push(...inbox!.slice(0, 3).map((i: any) => `  • [${normalizeLifeDomain(i.life_domain).toUpperCase()}] "${i.raw_text.substring(0, 60)}${i.raw_text.length > 60 ? "…" : ""}"`));

  if (waiting?.length) lines.push(`\nWAITING FOR (${waiting.length}):`, ...waiting.map((w: any) => `  • [${normalizeLifeDomain(w.life_domain).toUpperCase()}] ${w.title}${w.delegated_to ? ` → ${w.delegated_to}` : ""}`));
  if (schemaReviews.count > 0) {
    lines.push(`\nADMIN REVIEW: ${schemaReviews.count} schema proposal${schemaReviews.count === 1 ? "" : "s"} need Kevin's review before any database changes.`);
    lines.push(...schemaReviews.items.map((item: any) => `  - ${item.description}`));
  }
  if (ventures?.length) lines.push(`\nACTIVE VENTURES: ${ventures.map((v: any) => `${v.name} ${v.readiness_score}%`).join(", ")}`);
  if (alerts?.length) lines.push(`\nCEO ALERTS: ${alerts.map((r: any) => `[${r.priority}] ${r.title}`).join("; ")}`);

  return lines.join("\n");
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

async function buildMoneypennyReviewPayload(supabase: any, window: "morning" | "evening") {
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
    supabase.from("gtd_actions").select("title,due_date,life_domain,ventures(name)").eq("status", "active").lt("due_date", today).order("due_date", { ascending: true }).limit(5),
    supabase.from("gtd_actions").select("title,context,due_date,life_domain,ventures(name)").eq("status", "active").eq("due_date", today).order("created_at", { ascending: true }).limit(6),
    supabase.from("gtd_actions").select("title,due_date,context,life_domain,ventures(name)").eq("status", "active").gte("due_date", today).order("due_date", { ascending: true }).limit(8),
    supabase.from("gtd_actions").select("title,delegated_to,due_date,life_domain").eq("status", "waiting").order("due_date", { ascending: true }).limit(5),
    supabase.from("gtd_inbox").select("raw_text,created_at,life_domain").eq("processed", false).order("created_at", { ascending: true }).limit(4),
    supabase.from("calendar_events").select("title,start_at,end_at,all_day,location,status,life_domain,ventures(name)").neq("status", "cancelled").lte("start_at", horizon.toISOString()).order("start_at", { ascending: true }).limit(20),
    supabase.from("ceo_recommendations").select("title,priority").eq("status", "new").in("priority", ["critical", "high"]).order("generated_at", { ascending: false }).limit(3),
    getPendingSchemaReviewSummary(supabase, 3),
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

async function generateMoneypennyReview(supabase: any, window: "morning" | "evening") {
  const payload = await buildMoneypennyReviewPayload(supabase, window);
  const instruction = window === "morning"
    ? "Write the scheduled 7:00 AM Telegram review."
    : "Write the scheduled 5:00 PM Telegram review.";

  try {
    const { content } = await openAIChat([
      { role: "system", content: getSystemPrompt("moneypenny", payload.context) },
      {
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
      },
    ], 700);

    return content?.trim() || payload.fallback;
  } catch {
    return payload.fallback;
  }
}

function getSystemPrompt(role: string, context: string): string {
  const timeNote = `Time zone: ${USER_TIMEZONE}. Always interpret today, tonight, tomorrow, morning, afternoon, and evening in Eastern Time.\n\n`;
  const dbChangeNote = `DATABASE CHANGES:
- This environment has live Supabase/Postgres credentials configured via SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and DATABASE_URL.
- Do not assume database changes are impossible just because the request requires SQL.
- If tool or command execution is available in the current runtime, you may apply remote SQL changes, including schema updates, backfills, one-off fixes, functions, indexes, and bulk updates.
- Prefer normal table writes for ordinary record changes; use SQL when the job truly needs SQL.
- After making a database change, verify it with a follow-up query and report the result.
- Only say you cannot run the change when the current interface truly lacks execution tools; if that happens, explain that the limitation is the interface, not the project, and provide the exact SQL plus a verification query.\n\n`;
  switch (role) {
    case "ceo":
      return `You are Burns — the Virtual CEO of Welday Enterprises. Cold, calculating, brilliant. You think in portfolio strategy, synergies, and revenue.
You speak like Mr. Burns from The Simpsons — measured, slightly imperious, dry wit, occasional ominous flair. Never sycophantic. Never warm.
You focus on: which ventures to prioritize, cross-venture synergies, risks, and strategic opportunities.
Keep responses under 180 words. No bullet-point lists unless specifically asked.
Occasional Burns-isms are welcome: "Excellent.", "Release the hounds.", "I'm not a monster — I'm a businessman."

${timeNote}${dbChangeNote}PORTFOLIO STATE:
${context}`;
    case "assistant":
      return `You are Smithers — the Executive Assistant for Welday Enterprises. Efficient, professional, deeply loyal, slightly anxious to please.
You speak like Waylon Smithers — helpful, precise, deferential but competent. Occasionally let slip how devoted you are to keeping things running smoothly.
You focus on: what needs doing TODAY and THIS WEEK. One clear answer when asked what to do next.
Keep responses under 150 words. Practical over strategic.
You can accept captures: "note X" → confirm it's added to inbox.
If CURRENT STATE shows ADMIN REVIEW items, explicitly remind the user that Kevin needs to review them in the Review tab.

${timeNote}${dbChangeNote}CURRENT STATE:
${context}`;
    case "moneypenny":
      return `You are Moneypenny — the Executive Assistant for Welday Enterprises. Your tone should feel like Bonnie Bach from Charlie Wilson's War: polished, incisive, socially fluent, quietly commanding, and impossible to rattle.
You're tactical (today and this week), not strategic. You're the one Welday relies on to keep the chaos organized.
Personality: composed, sharp, elegant, and highly competent. Use a light Southern cadence in rhythm and phrasing, but never push it into parody or thick phonetic spelling. Light wit is welcome, but never fluff, slang, or juvenile banter. Your replies should feel smooth, confident, and in control, with a subtle edge when appropriate.
Keep responses under 150 words. Use crisp, polished language.
You can accept captures: "add X" → drop it in the inbox and confirm with style.
If CURRENT STATE shows ADMIN REVIEW items, explicitly remind the user that Kevin needs to review them in the Review tab.

${timeNote}${dbChangeNote}CURRENT STATE:
${context}`;
    case "filer":
      return `You are Radar — the GTD Filer for Welday Enterprises. Quiet, anticipatory, always three steps ahead. Like Radar O'Reilly from M*A*S*H — you have the clipboard ready before anyone asks.
You are the inbox. Your job: confirm captures, tell the user what you filed and where, and report on inbox status.
You don't chat. You process. Brief, matter-of-fact confirmations only.
Keep responses under 80 words. No fluff.
If CURRENT STATE shows ADMIN REVIEW items, explicitly remind the user that Kevin needs to review them in the Review tab.

${timeNote}${dbChangeNote}CURRENT STATE:
${context}`;
    default:
      return `You are Jarvis, the general assistant for Welday Enterprises.\n\n${timeNote}${dbChangeNote}CURRENT STATE:\n${context}`;
  }
}

async function tgSend(token: string, chatId: number, text: string) {
  if (!token) return false;
  const response = await fetchWithTimeout(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML" }),
  }, 10000).catch(() => null);
  return !!response && response.ok;
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

  const { token, role, slug } = bot;
  const supabase = getSupabase();
  const agentName = `telegram_${role}_${botName}`;

  const persistTelegramReply = async (assistantReply: string, options: {
    userMessage?: string;
    systemPrompt?: string;
    modelUsed?: string;
    tokensUsed?: number;
    botRecord?: any;
    session?: any;
  } = {}) => {
    if (!supabase) return;

    try {
      await persistBotInteraction(supabase, {
        botSlug: slug,
        role,
        chatId,
        source: "telegram",
        agentName,
        userMessage: options.userMessage || text,
        assistantReply,
        systemPrompt: options.systemPrompt || getSystemPrompt(role, "(no persistent identity loaded)"),
        modelUsed: options.modelUsed,
        tokensUsed: options.tokensUsed,
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
    tokensUsed?: number;
    botRecord?: any;
    session?: any;
  } = {}) => {
    const sent = await tgSend(token, chatId, assistantReply);
    if (sent) {
      await persistTelegramReply(assistantReply, options);
    }
    return sent;
  };

  if (supabase) {
    void maybeAutoProcessInbox(supabase);
  }

  if (supabase && shouldCaptureTelegramMessage(role, text)) {
    try {
      await captureToInbox(supabase, {
        source: "telegram",
        rawText: text,
        telegramMessageId: message.message_id,
        telegramChatId: chatId,
      });
      await logAgentEvent(supabase, {
        agentName,
        action: "capture_inbox",
        inputSummary: text.substring(0, 100),
        outputSummary: "Stored in inbox from Telegram message.",
      }).catch(() => {});
    } catch (err: any) {
      await logAgentEvent(supabase, {
        agentName,
        action: "capture_inbox_failed",
        inputSummary: text.substring(0, 100),
        outputSummary: "Inbox insert failed.",
        success: false,
        errorMessage: err?.message || "Inbox insert failed",
      }).catch(() => {});
      if (role === "filer") {
        const failureReply = "I couldn't add that to the inbox. The write failed, so nothing was recorded.";
        await tgSend(token, chatId, failureReply);
        return;
      }
    }
  }

  if (text === "/start") {
    const startReply = getStartMessage(role);
    await sendAndPersistTelegramReply(startReply);
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
      await logAgentEvent(supabase, {
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
      await logAgentEvent(supabase, {
        agentName,
        action: "delegate_to_inbox_failed",
        inputSummary: captureIntent.substring(0, 100),
        outputSummary: "Inbox handoff failed.",
        success: false,
        errorMessage: err?.message || "Inbox handoff failed",
      }).catch(() => {});
      const failureReply = "I tried to hand that to Radar, but the inbox didn't cooperate.";
      await tgSend(token, chatId, failureReply);
    }
    return;
  }

  if (role === "filer") {
    if (text === "/process" || text === "/p" || text === "/file") {
      const result = supabase ? await processInbox(supabase, true, 20) : { processed: 0, total: 0 };
      const processReply = result.total > 0
        ? `Processed ${result.processed} of ${result.total} inbox items.`
        : "Nothing waiting in the inbox right now.";
      await sendAndPersistTelegramReply(processReply);
      return;
    }

    if (text === "/wn") {
      const { data } = supabase
        ? await supabase.from("gtd_inbox").select("raw_text").eq("processed", false).order("created_at", { ascending: true }).limit(1)
        : { data: null };
      const nextItem = data?.[0]?.raw_text;
      const nextReply = nextItem
        ? `Next in the stack: "${nextItem.substring(0, 120)}${nextItem.length > 120 ? "..." : ""}"\n\nSend /process when you're ready to file it.`
        : "Inbox is clear. Nothing waiting on me right now.";
      await sendAndPersistTelegramReply(nextReply);
      return;
    }

    if (text === "/status") {
      let statusReply = "Inbox status unavailable (no Supabase connection).";
      if (supabase) {
        const { data } = await supabase.from("gtd_inbox").select("id").eq("processed", false);
        statusReply = `${data?.length || 0} items in inbox awaiting processing. Send /process to file them now.`;
      }
      await sendAndPersistTelegramReply(statusReply);
      return;
    }

    const radarReply = getRadarConfirmation(text);
    await sendAndPersistTelegramReply(radarReply);
    return;
  }

  const resolvedPrompt = resolveTelegramUserPrompt(role, text);
  const storedUserMessage = buildStoredUserMessage(text, resolvedPrompt);
  const conversationState = supabase
    ? await loadTelegramConversationState(supabase, {
        botSlug: slug,
        role,
        chatId,
        queryText: resolvedPrompt,
      }).catch((err: any) => {
        console.error("[memory] conversation state failed:", err.message);
        return null;
      })
    : null;

  const persistentSystemPrompt = conversationState?.systemPrompt || getSystemPrompt(role, "(persistent memory unavailable)");
  const recentMessages = conversationState?.recentMessages || [];
  const persistentModelUsed = conversationState?.botRecord?.default_model || GEMINI_MODEL;
  const { content: persistentReply, tokens: persistentTokens } = await openAIChat([
    { role: "system", content: persistentSystemPrompt },
    ...recentMessages.map((item: any) => ({ role: item.role, content: item.content })),
    { role: "user", content: resolvedPrompt },
  ], 1024, undefined, persistentModelUsed);

  const sent = await tgSend(token, chatId, persistentReply);

  if (supabase) {
    if (sent) {
      await persistTelegramReply(persistentReply, {
        userMessage: storedUserMessage,
        systemPrompt: persistentSystemPrompt,
        modelUsed: persistentModelUsed,
        tokensUsed: persistentTokens,
        botRecord: conversationState?.botRecord,
        session: conversationState?.session,
      });
    }
    logAgentEvent(supabase, {
      agentName,
      action: "chat",
      inputSummary: text.substring(0, 100),
      outputSummary: persistentReply.substring(0, 100),
      modelUsed: persistentModelUsed,
      success: sent,
      errorMessage: sent ? undefined : "Telegram send failed",
    }).catch(() => {});
  }
  return;

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
    if (supabase) void maybeAutoProcessInbox(supabase);
    let context = "(no live data)";
    if (supabase) {
      try { context = await withTimeout(buildContext(supabase), 5000, "Supabase context"); } catch {}
    }

    const role = persona === "moneypenny" ? "moneypenny" : "assistant";
    const systemPrompt = getSystemPrompt(role, context);
    const captureMatch = message.match(/^(?:add|capture|inbox|remember|note|remind me[:\s]+)(.+)/i);
    if (captureMatch && supabase) {
      const rawText = captureMatch[1].trim();
      try {
        await supabase.from("gtd_inbox").insert({ source: "web", raw_text: rawText, tags: extractHashtags(rawText) });
      } catch (e) {}
    }

    try {
      const { content: reply } = await openAIChat([
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
        logAgentEvent(supabase, {
          agentName: "ea_agent_dashboard",
          action: "chat",
          inputSummary: message.substring(0, 100),
          outputSummary: reply.substring(0, 100),
          modelUsed: GEMINI_MODEL,
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
    if (supabase) void maybeAutoProcessInbox(supabase);
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

  app.post("/api/moneypenny/review", async (req, res) => {
    const auth = isAuthorizedProcessRequest(req);
    if (!auth.ok) return res.status(auth.status).json({ error: auth.error });

    const supabase = getSupabase();
    if (!supabase) return res.status(500).json({ error: "Supabase not configured" });

    const requestedWindow = (req.body as any)?.window || (req.query.window as string | undefined) || "auto";
    const window = resolveScheduledReviewWindow(requestedWindow);
    if (!window) {
      return res.json({
        sent: false,
        skipped: true,
        reason: `Current hour in ${USER_TIMEZONE} is ${getLocalHour()}, so this run is outside the 7:00 AM and 5:00 PM review windows.`,
      });
    }

    const token = process.env.TELEGRAM_TOKEN_MONEYPENNY || "";
    const chatId = getMoneypennyReviewChatId();
    if (!token) return res.status(500).json({ error: "TELEGRAM_TOKEN_MONEYPENNY not configured" });
    if (!chatId) return res.status(500).json({ error: "MONEYPENNY_REVIEW_CHAT_ID not configured" });

    await maybeAutoProcessInbox(supabase);
    const review = await generateMoneypennyReview(supabase, window);
    const sent = await tgSend(token, chatId, escapeHtml(review));

    await logAgentEvent(supabase, {
      agentName: "moneypenny_scheduler",
      action: sent ? `scheduled_${window}_review_sent` : `scheduled_${window}_review_failed`,
      inputSummary: `window=${window}`,
      outputSummary: review.substring(0, 120),
      modelUsed: GEMINI_MODEL,
      success: sent,
      errorMessage: sent ? undefined : "Telegram send failed",
    }).catch(() => {});

    if (!sent) {
      return res.status(502).json({ error: "Telegram send failed", sent: false, window });
    }

    return res.json({ sent: true, window, chatId, preview: review });
  });

  app.post("/api/bot-memory/embed", async (req, res) => {
    const auth = isAuthorizedProcessRequest(req);
    if (!auth.ok) return res.status(auth.status).json({ error: auth.error });

    const supabase = getSupabase();
    if (!supabase) return res.status(500).json({ error: "Supabase not configured" });

    const memoryId = (req.body as any)?.memoryId as string | undefined;
    const limit = Math.max(1, Math.min(Number((req.body as any)?.limit || 5), 20));
    const botSlug = (req.body as any)?.botSlug as string | undefined;

    let botId: string | null = null;
    if (botSlug) {
      const botRecord = await getBotRecord(supabase, botSlug).catch(() => null);
      botId = botRecord?.id || null;
      if (!botId) return res.status(404).json({ error: `Unknown bot slug: ${botSlug}` });
    }

    let query = supabase
      .from("bot_memory")
      .select("id, bot_id, content, created_at")
      .order("created_at", { ascending: false })
      .limit(limit);

    if (memoryId) query = query.eq("id", memoryId);
    if (botId) query = query.eq("bot_id", botId);

    const { data: memories, error } = await query;
    if (error) return res.status(500).json({ error: error.message });
    if (!memories?.length) return res.json({ embedded: 0, chunkCount: 0 });

    let embedded = 0;
    let chunkCount = 0;
    for (const memory of memories) {
      const result = await upsertBotMemoryEmbeddings(supabase, {
        memoryId: memory.id,
        botId: memory.bot_id,
        content: memory.content,
      });
      embedded++;
      chunkCount += result.chunkCount;
    }

    return res.json({
      embedded,
      chunkCount,
      model: GEMINI_EMBEDDING_MODEL,
      dimensions: GEMINI_EMBEDDING_DIMENSIONS,
    });
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

  app.get("/api/gtd/process", async (req, res) => {
    const auth = isAuthorizedProcessRequest(req);
    if (!auth.ok) return res.status(auth.status).json({ error: auth.error });

    const supabase = getSupabase();
    if (!supabase) return res.status(500).json({ error: "Supabase not configured" });
    const force = isForcedProcessRequest(req.query.force);
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

  app.get("/api/reference", async (_req, res) => {
    const supabase = getSupabase();
    if (!supabase) return res.status(500).json({ error: "Supabase not configured" });
    const { data, error } = await supabase
      .from("gtd_reference")
      .select("*, ventures(name, slug), gtd_projects(title)")
      .order("created_at", { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    return res.json(data || []);
  });

  app.get("/api/calendar/events", async (_req, res) => {
    const supabase = getSupabase();
    if (!supabase) return res.status(500).json({ error: "Supabase not configured" });
    const { data, error } = await supabase
      .from("calendar_events")
      .select("*, ventures(name, slug)")
      .order("start_at", { ascending: true });
    if (error) return res.status(500).json({ error: error.message });
    return res.json(data || []);
  });

  app.get("/api/actions", async (req, res) => {
    const supabase = getSupabase();
    if (!supabase) return res.status(500).json({ error: "Supabase not configured" });
    const status = req.query.status as string || "active";
    const { data, error } = await supabase
      .from("gtd_actions")
      .select("*, gtd_projects(title), ventures(name, slug)")
      .eq("status", status)
      .order("due_date", { ascending: true, nullsFirst: false });
    if (error) return res.status(500).json({ error: error.message });
    return res.json(data || []);
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

  app.post("/api/schema/apply", async (req, res) => {
    const auth = isAuthorizedSchemaApplyRequest(req);
    if (!auth.ok) return res.status(auth.status).json({ error: auth.error });

    const supabase = getSupabase();
    const pool = getAdminPool();
    if (!pool) return res.status(500).json({ error: "DATABASE_URL not configured" });

    let operation: ReturnType<typeof buildSchemaOperation>;
    try {
      operation = buildSchemaOperation(req.body || {});
    } catch (err: any) {
      return res.status(400).json({ error: err.message });
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

      await logSchemaChange(supabase, {
        actor: operation.actor,
        operation: operation.operation,
        tableName: operation.tableName,
        columnName: operation.columnName,
        description: operation.description,
        sql: operation.sql,
        rationale: operation.rationale,
        status: "applied",
      });

      await logAgentEvent(supabase, {
        agentName: "schema_api",
        action: operation.operation,
        inputSummary: operation.description,
        outputSummary: operation.sql,
        success: true,
      }).catch(() => {});

      return res.json({
        ok: true,
        operation: operation.operation,
        tableName: operation.tableName,
        columnName: operation.columnName,
        sql: operation.sql,
        verification: verification.rows,
      });
    } catch (err: any) {
      try { await client.query("rollback"); } catch {}

      await logSchemaChange(supabase, {
        actor: operation.actor,
        operation: operation.operation,
        tableName: operation.tableName,
        columnName: operation.columnName,
        description: operation.description,
        sql: operation.sql,
        rationale: operation.rationale,
        status: "rejected",
      });

      await logAgentEvent(supabase, {
        agentName: "schema_api",
        action: `${operation.operation}_failed`,
        inputSummary: operation.description,
        outputSummary: operation.sql,
        success: false,
        errorMessage: err.message,
      }).catch(() => {});

      return res.status(500).json({ error: err.message, sql: operation.sql });
    } finally {
      client.release();
    }
  });

  app.post("/api/schema/review-action", async (req, res) => {
    let adminEmail: string | null = null;
    try {
      adminEmail = await getAuthenticatedAdminEmail(req);
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
    if (!adminEmail) return res.status(403).json({ error: "Admin review required" });

    const supabase = getSupabase();
    if (!supabase) return res.status(500).json({ error: "Supabase not configured" });

    const proposalId = typeof req.body?.id === "string" ? req.body.id : "";
    const decision = typeof req.body?.decision === "string" ? req.body.decision.toLowerCase() : "";
    if (!proposalId) return res.status(400).json({ error: "id required" });
    if (decision !== "approve" && decision !== "reject") {
      return res.status(400).json({ error: "decision must be approve or reject" });
    }

    const { data: proposal, error } = await supabase
      .from("schema_changelog")
      .select("*")
      .eq("id", proposalId)
      .eq("status", "proposed")
      .single();
    if (error || !proposal) return res.status(404).json({ error: "Pending proposal not found" });

    if (decision === "reject") {
      const rejected = await supabase
        .from("schema_changelog")
        .update({ status: "rejected", approved_by: adminEmail })
        .eq("id", proposalId)
        .eq("status", "proposed")
        .select("id")
        .maybeSingle();
      if (rejected.error) return res.status(500).json({ error: rejected.error.message });
      if (!rejected.data) return res.status(409).json({ error: "Proposal is no longer pending" });
      return res.json({ ok: true, id: proposalId, status: "rejected" });
    }

    try {
      const claimed = await supabase
        .from("schema_changelog")
        .update({ status: "applying", approved_by: adminEmail, applied_at: null })
        .eq("id", proposalId)
        .eq("status", "proposed")
        .select("*")
        .maybeSingle();
      if (claimed.error) return res.status(500).json({ error: claimed.error.message });
      if (!claimed.data) return res.status(409).json({ error: "Proposal is no longer pending" });

      const operation = schemaProposalRowToOperation(claimed.data);
      await runSchemaOperation(supabase, operation, { logChange: false });
      const applied = await supabase
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
      if (applied.error) return res.status(500).json({ error: applied.error.message });
      if (!applied.data) return res.status(409).json({ error: "Proposal approval state changed during apply" });
      return res.json({ ok: true, id: proposalId, status: "applied" });
    } catch (err: any) {
      await supabase
        .from("schema_changelog")
        .update({ status: "proposed", approved_by: null, applied_at: null })
        .eq("id", proposalId)
        .eq("status", "applying");
      return res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/ceo/run", async (_req, res) => {
    res.json({ message: "CEO agent triggered — run ceo-agent.js with env vars" });
  });

  app.all("/api/*", (_req, res) => {
    res.status(404).json({ error: "API endpoint not found" });
  });
}
