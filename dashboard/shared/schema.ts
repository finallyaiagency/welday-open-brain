import { pgTable, uuid, text, boolean, integer, numeric, timestamp, date, jsonb, vector } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Ventures
export const ventures = pgTable("ventures", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  domain: text("domain"),
  tagline: text("tagline"),
  description: text("description"),
  status: text("status").notNull().default("queued"),
  riskLevel: text("risk_level").default("medium"),
  readinessScore: integer("readiness_score").default(0),
  revenueModel: text("revenue_model"),
  targetMarket: text("target_market"),
  lovableUrl: text("lovable_url"),
  monthlyRevenueUsd: numeric("monthly_revenue_usd").default("0"),
  monthlyExpensesUsd: numeric("monthly_expenses_usd").default("0"),
  monthlyVisitors: integer("monthly_visitors").default(0),
  ceoNotes: text("ceo_notes"),
  synergyTags: text("synergy_tags").array(),
  metadata: jsonb("metadata").default({}),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// GTD Projects
export const gtdProjects = pgTable("gtd_projects", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: text("title").notNull(),
  outcome: text("outcome"),
  why: text("why"),
  status: text("status").notNull().default("active"),
  ventureId: uuid("venture_id").references(() => ventures.id),
  area: text("area"),
  lifeDomain: text("life_domain").notNull().default("unknown"),
  energy: text("energy").default("medium"),
  dueDate: date("due_date"),
  completedAt: timestamp("completed_at"),
  notes: text("notes"),
  tags: text("tags").array(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// GTD Inbox
export const gtdInbox = pgTable("gtd_inbox", {
  id: uuid("id").primaryKey().defaultRandom(),
  source: text("source").notNull().default("telegram"),
  rawText: text("raw_text").notNull(),
  projectId: uuid("project_id").references(() => gtdProjects.id),
  lifeDomain: text("life_domain").notNull().default("unknown"),
  processed: boolean("processed").default(false),
  processedAt: timestamp("processed_at"),
  filedTo: text("filed_to"),
  filedItemId: uuid("filed_item_id"),
  aiSummary: text("ai_summary"),
  aiCategory: text("ai_category"),
  aiConfidence: numeric("ai_confidence"),
  tags: text("tags").array(),
  createdAt: timestamp("created_at").defaultNow(),
});

// GTD Actions
export const gtdActions = pgTable("gtd_actions", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: text("title").notNull(),
  projectId: uuid("project_id").references(() => gtdProjects.id),
  ventureId: uuid("venture_id").references(() => ventures.id),
  context: text("context"),
  lifeDomain: text("life_domain").notNull().default("unknown"),
  source: text("source").notNull().default("manual"),
  status: text("status").notNull().default("active"),
  delegatedTo: text("delegated_to"),
  energy: text("energy").default("medium"),
  timeEstimateMin: integer("time_estimate_min"),
  dueDate: date("due_date"),
  completedAt: timestamp("completed_at"),
  googleTaskId: text("google_task_id"),
  googleTaskListId: text("google_task_list_id"),
  notes: text("notes"),
  lastSyncedAt: timestamp("last_synced_at"),
  tags: text("tags").array(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// CEO Recommendations
export const ceoRecommendations = pgTable("ceo_recommendations", {
  id: uuid("id").primaryKey().defaultRandom(),
  type: text("type").notNull(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  venturesInvolved: uuid("ventures_involved").array(),
  priority: text("priority").default("medium"),
  status: text("status").default("new"),
  effortLevel: text("effort_level").default("medium"),
  estimatedRevenueImpact: text("estimated_revenue_impact"),
  actionItems: text("action_items").array(),
  aiModelUsed: text("ai_model_used"),
  generatedAt: timestamp("generated_at").defaultNow(),
  acknowledgedAt: timestamp("acknowledged_at"),
  completedAt: timestamp("completed_at"),
  notes: text("notes"),
});

// Saved Dashboards
export const savedDashboards = pgTable("saved_dashboards", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  description: text("description"),
  queryPrompt: text("query_prompt"),
  config: jsonb("config").notNull().default({}),
  isPinned: boolean("is_pinned").default(false),
  lastUsedAt: timestamp("last_used_at"),
  useCount: integer("use_count").default(0),
  tags: text("tags").array(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Agent Logs
export const agentLogs = pgTable("agent_logs", {
  id: uuid("id").primaryKey().defaultRandom(),
  agentName: text("agent_name").notNull(),
  action: text("action").notNull(),
  inputSummary: text("input_summary"),
  outputSummary: text("output_summary"),
  success: boolean("success").default(true),
  errorMessage: text("error_message"),
  modelUsed: text("model_used"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const businessMemory = pgTable("business_memory", {
  id: uuid("id").primaryKey().defaultRandom(),
  source: text("source").notNull(),
  agentName: text("agent_name").notNull(),
  summary: text("summary").notNull(),
  lifeDomain: text("life_domain").notNull().default("unknown"),
  ventureSlugs: text("venture_slugs").array(),
  topics: text("topics").array(),
  importance: text("importance").default("medium"),
  metadata: jsonb("metadata").default({}),
  createdAt: timestamp("created_at").defaultNow(),
});

export const schemaChangelog = pgTable("schema_changelog", {
  id: uuid("id").primaryKey().defaultRandom(),
  proposedBy: text("proposed_by").notNull(),
  changeType: text("change_type").notNull(),
  tableName: text("table_name").notNull(),
  columnName: text("column_name"),
  description: text("description").notNull(),
  sqlStatement: text("sql_statement"),
  status: text("status").default("proposed"),
  rationale: text("rationale"),
  approvedBy: text("approved_by"),
  appliedAt: timestamp("applied_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const bots = pgTable("bots", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  description: text("description"),
  defaultModel: text("default_model").default("gemini-3.1-flash-lite-preview"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const botIdentityFiles = pgTable("bot_identity_files", {
  id: uuid("id").primaryKey().defaultRandom(),
  botId: uuid("bot_id").notNull().references(() => bots.id, { onDelete: "cascade" }),
  fileType: text("file_type").notNull(),
  content: text("content").notNull(),
  version: integer("version").default(1),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const botSessions = pgTable("bot_sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  botId: uuid("bot_id").notNull().references(() => bots.id, { onDelete: "cascade" }),
  slug: text("slug"),
  summary: text("summary"),
  startedAt: timestamp("started_at").defaultNow(),
  endedAt: timestamp("ended_at"),
});

export const botMessages = pgTable("bot_messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  sessionId: uuid("session_id").notNull().references(() => botSessions.id, { onDelete: "cascade" }),
  role: text("role").notNull(),
  content: text("content").notNull(),
  toolCallId: text("tool_call_id"),
  tokensUsed: integer("tokens_used"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const botMemory = pgTable("bot_memory", {
  id: uuid("id").primaryKey().defaultRandom(),
  botId: uuid("bot_id").notNull().references(() => bots.id, { onDelete: "cascade" }),
  sessionId: uuid("session_id").references(() => botSessions.id, { onDelete: "set null" }),
  logDate: date("log_date").notNull().defaultNow(),
  entryType: text("entry_type").default("note"),
  content: text("content").notNull(),
  lifeDomain: text("life_domain").notNull().default("unknown"),
  metadata: jsonb("metadata").default({}),
  createdAt: timestamp("created_at").defaultNow(),
});

export const botMemoryEmbeddings = pgTable("bot_memory_embeddings", {
  id: uuid("id").primaryKey().defaultRandom(),
  botId: uuid("bot_id").notNull().references(() => bots.id, { onDelete: "cascade" }),
  sourceId: uuid("source_id").notNull().references(() => botMemory.id, { onDelete: "cascade" }),
  contentChunk: text("content_chunk").notNull(),
  embedding: vector("embedding", { dimensions: 768 }),
  createdAt: timestamp("created_at").defaultNow(),
});

// Insert Schemas
export const insertGtdInboxSchema = createInsertSchema(gtdInbox);
export const insertGtdActionSchema = createInsertSchema(gtdActions);
export const insertGtdProjectSchema = createInsertSchema(gtdProjects);
export const insertSavedDashboardSchema = createInsertSchema(savedDashboards);

// Types
export type Venture = typeof ventures.$inferSelect;
export type GtdInbox = typeof gtdInbox.$inferSelect;
export type GtdProject = typeof gtdProjects.$inferSelect;
export type GtdAction = typeof gtdActions.$inferSelect;
export type CeoRecommendation = typeof ceoRecommendations.$inferSelect;
export type SavedDashboard = typeof savedDashboards.$inferSelect;
export type AgentLog = typeof agentLogs.$inferSelect;
export type BusinessMemory = typeof businessMemory.$inferSelect;
export type SchemaChangelog = typeof schemaChangelog.$inferSelect;
export type Bot = typeof bots.$inferSelect;
export type BotIdentityFile = typeof botIdentityFiles.$inferSelect;
export type BotSession = typeof botSessions.$inferSelect;
export type BotMessage = typeof botMessages.$inferSelect;
export type BotMemory = typeof botMemory.$inferSelect;
export type BotMemoryEmbedding = typeof botMemoryEmbeddings.$inferSelect;

export type InsertGtdInbox = z.infer<typeof insertGtdInboxSchema>;
export type InsertGtdAction = z.infer<typeof insertGtdActionSchema>;
export type InsertGtdProject = z.infer<typeof insertGtdProjectSchema>;
export type InsertSavedDashboard = z.infer<typeof insertSavedDashboardSchema>;
