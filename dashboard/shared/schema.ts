import { pgTable, uuid, text, boolean, integer, numeric, timestamp, date, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// ─── Ventures ───────────────────────────────────────────────
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

// ─── GTD Inbox ──────────────────────────────────────────────
export const gtdInbox = pgTable("gtd_inbox", {
  id: uuid("id").primaryKey().defaultRandom(),
  source: text("source").notNull().default("telegram"),
  rawText: text("raw_text").notNull(),
  processed: boolean("processed").default(false),
  processedAt: timestamp("processed_at"),
  filedTo: text("filed_to"),
  aiSummary: text("ai_summary"),
  aiCategory: text("ai_category"),
  aiConfidence: numeric("ai_confidence"),
  createdAt: timestamp("created_at").defaultNow(),
});

// ─── GTD Projects ───────────────────────────────────────────
export const gtdProjects = pgTable("gtd_projects", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: text("title").notNull(),
  outcome: text("outcome"),
  why: text("why"),
  status: text("status").notNull().default("active"),
  ventureId: uuid("venture_id").references(() => ventures.id),
  area: text("area"),
  energy: text("energy").default("medium"),
  dueDate: date("due_date"),
  completedAt: timestamp("completed_at"),
  notes: text("notes"),
  tags: text("tags").array(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// ─── GTD Actions ────────────────────────────────────────────
export const gtdActions = pgTable("gtd_actions", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: text("title").notNull(),
  projectId: uuid("project_id").references(() => gtdProjects.id),
  ventureId: uuid("venture_id").references(() => ventures.id),
  context: text("context"),
  status: text("status").notNull().default("active"),
  delegatedTo: text("delegated_to"),
  energy: text("energy").default("medium"),
  timeEstimateMin: integer("time_estimate_min"),
  dueDate: date("due_date"),
  completedAt: timestamp("completed_at"),
  googleTaskId: text("google_task_id"),
  notes: text("notes"),
  tags: text("tags").array(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// ─── CEO Recommendations ────────────────────────────────────
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

// ─── Saved Dashboards ───────────────────────────────────────
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

// ─── Agent Logs ─────────────────────────────────────────────
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
  ventureSlugs: text("venture_slugs").array(),
  topics: text("topics").array(),
  importance: text("importance").default("medium"),
  metadata: jsonb("metadata").default({}),
  createdAt: timestamp("created_at").defaultNow(),
});

// ─── Insert Schemas ─────────────────────────────────────────
export const insertGtdInboxSchema = createInsertSchema(gtdInbox).omit({ id: true, createdAt: true });
export const insertGtdActionSchema = createInsertSchema(gtdActions).omit({ id: true, createdAt: true, updatedAt: true });
export const insertGtdProjectSchema = createInsertSchema(gtdProjects).omit({ id: true, createdAt: true, updatedAt: true });
export const insertSavedDashboardSchema = createInsertSchema(savedDashboards).omit({ id: true, createdAt: true, updatedAt: true });

// ─── Types ──────────────────────────────────────────────────
export type Venture = typeof ventures.$inferSelect;
export type GtdInbox = typeof gtdInbox.$inferSelect;
export type GtdProject = typeof gtdProjects.$inferSelect;
export type GtdAction = typeof gtdActions.$inferSelect;
export type CeoRecommendation = typeof ceoRecommendations.$inferSelect;
export type SavedDashboard = typeof savedDashboards.$inferSelect;
export type AgentLog = typeof agentLogs.$inferSelect;
export type BusinessMemory = typeof businessMemory.$inferSelect;

export type InsertGtdInbox = z.infer<typeof insertGtdInboxSchema>;
export type InsertGtdAction = z.infer<typeof insertGtdActionSchema>;
export type InsertGtdProject = z.infer<typeof insertGtdProjectSchema>;
export type InsertSavedDashboard = z.infer<typeof insertSavedDashboardSchema>;
