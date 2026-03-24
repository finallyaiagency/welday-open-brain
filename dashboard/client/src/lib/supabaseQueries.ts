import { getSession, supabase } from "./supabase";
import type { Venture, GtdInbox, GtdAction, GtdProject, GtdReference, CeoRecommendation, AgentLog, BusinessMemory, SchemaChangelog, GtdSomeday } from "@shared/schema";
import { contextToHashtag, extractHashtags, mergeHashtags, normalizeHashtag } from "@shared/hashtags";

type RawVenture = {
  id: string;
  slug: string;
  name: string;
  domain: string | null;
  tagline: string | null;
  description: string | null;
  status: string;
  risk_level: string | null;
  readiness_score: number | null;
  revenue_model: string | null;
  target_market: string | null;
  lovable_url: string | null;
  monthly_revenue_usd: string | number | null;
  monthly_expenses_usd: string | number | null;
  monthly_visitors: number | null;
  ceo_notes: string | null;
  synergy_tags: string[] | null;
  metadata: Record<string, unknown> | null;
  created_at: string | null;
  updated_at: string | null;
};

type RawInbox = {
  id: string;
  source: string;
  raw_text: string;
  project_id?: string | null;
  life_domain?: string | null;
  processed: boolean | null;
  processed_at: string | null;
  filed_to: string | null;
  filed_item_id?: string | null;
  ai_summary: string | null;
  ai_category: string | null;
  ai_confidence: string | number | null;
  tags?: string[] | null;
  created_at: string | null;
  gtd_projects?: { id: string; title: string } | null;
};

type RawAction = {
  id: string;
  title: string;
  project_id: string | null;
  venture_id: string | null;
  context: string | null;
  life_domain?: string | null;
  source?: string | null;
  status: string;
  delegated_to: string | null;
  energy: string | null;
  time_estimate_min: number | null;
  due_date: string | null;
  completed_at: string | null;
  google_task_id: string | null;
  google_task_list_id?: string | null;
  notes: string | null;
  last_synced_at?: string | null;
  tags: string[] | null;
  created_at: string | null;
  updated_at: string | null;
  gtd_projects?: { title: string } | null;
  ventures?: { name: string; slug: string } | null;
};

type RawProject = {
  id: string;
  title: string;
  outcome: string | null;
  why: string | null;
  status: string;
  venture_id: string | null;
  area: string | null;
  life_domain?: string | null;
  energy: string | null;
  due_date: string | null;
  completed_at: string | null;
  notes: string | null;
  tags: string[] | null;
  created_at: string | null;
  updated_at: string | null;
  ventures?: { name: string; slug: string } | null;
};

type RawCeoRecommendation = {
  id: string;
  type: string;
  title: string;
  body: string;
  ventures_involved: string[] | null;
  priority: string | null;
  status: string | null;
  effort_level: string | null;
  estimated_revenue_impact: string | null;
  action_items: string[] | null;
  ai_model_used: string | null;
  generated_at: string | null;
  acknowledged_at: string | null;
  completed_at: string | null;
  notes: string | null;
};

type RawAgentLog = {
  id: string;
  agent_name: string;
  action: string;
  input_summary: string | null;
  output_summary: string | null;
  success: boolean | null;
  error_message: string | null;
  model_used: string | null;
  created_at: string | null;
};

type RawBusinessMemory = {
  id: string;
  source: string;
  agent_name: string;
  summary: string;
  life_domain?: string | null;
  venture_slugs: string[] | null;
  topics: string[] | null;
  importance: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string | null;
};

type RawSchemaReview = {
  id: string;
  proposed_by: string;
  change_type: string;
  table_name: string;
  column_name: string | null;
  description: string;
  sql_statement: string | null;
  status: string | null;
  rationale: string | null;
  approved_by: string | null;
  applied_at: string | null;
  created_at: string | null;
};

type RawCalendarEvent = {
  id: string;
  title: string;
  description: string | null;
  start_at: string;
  end_at: string | null;
  all_day: boolean | null;
  event_type: string | null;
  life_domain?: string | null;
  status: string | null;
  location: string | null;
  source?: string | null;
};

type RawReference = {
  id: string;
  title: string;
  content: string| null;
  url: string | null;
  project_id: string | null;
  venture_id: string | null;
  area: string | null;
  category: string | null;
  tags: string[] | null;
  created_at: string | null;
  updated_at: string | null;
  ventures?: { name: string; slug: string } | null;
  gtd_projects?: { title: string } | null;
};

type RawSomeday = {
  id: string;
  title: string;
  description: string | null;
  venture_id: string | null;
  area: string | null;
  review_date: string | null;
  promoted_to: string | null;
  promoted_item_id: string | null;
  is_archived: boolean | null;
  tags: string[] | null;
  created_at: string | null;
  ventures?: { name: string; slug: string } | null;
};

function normalizeLifeDomain(value: string | null | undefined, fallback?: { ventureId?: string | null; area?: string | null; eventType?: string | null; ventureSlugs?: string[] | null }) {
  if (value === "business" || value === "personal" || value === "unknown") return value;
  if (fallback?.ventureId) return "business";
  if (fallback?.area === "personal") return "personal";
  if (fallback?.eventType === "personal") return "personal";
  if (fallback?.eventType === "work") return "business";
  if ((fallback?.ventureSlugs?.length || 0) > 0) return "business";
  return "unknown";
}

function mapVenture(row: RawVenture): Venture {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    domain: row.domain,
    tagline: row.tagline,
    description: row.description,
    status: row.status,
    riskLevel: row.risk_level,
    readinessScore: row.readiness_score,
    revenueModel: row.revenue_model,
    targetMarket: row.target_market,
    lovableUrl: row.lovable_url,
    monthlyRevenueUsd: row.monthly_revenue_usd as any,
    monthlyExpensesUsd: row.monthly_expenses_usd as any,
    monthlyVisitors: row.monthly_visitors,
    ceoNotes: row.ceo_notes,
    synergyTags: row.synergy_tags,
    metadata: row.metadata as any,
    createdAt: row.created_at as any,
    updatedAt: row.updated_at as any,
  };
}

function mapInbox(row: RawInbox): GtdInbox {
  return {
    id: row.id,
    source: row.source,
    rawText: row.raw_text,
    projectId: row.project_id || null,
    lifeDomain: normalizeLifeDomain(row.life_domain),
    processed: row.processed,
    processedAt: row.processed_at as any,
    filedTo: row.filed_to,
    filedItemId: row.filed_item_id || null,
    aiSummary: row.ai_summary,
    aiCategory: row.ai_category,
    aiConfidence: row.ai_confidence as any,
    tags: mergeHashtags(row.tags, extractHashtags(row.raw_text)),
    gtd_projects: row.gtd_projects ?? null,
    createdAt: row.created_at as any,
  } as GtdInbox;
}

function mapAction(row: RawAction): GtdAction & { gtd_projects?: { title: string } | null; ventures?: { name: string; slug: string } | null } {
  return {
    id: row.id,
    title: row.title,
    projectId: row.project_id,
    ventureId: row.venture_id,
    context: row.context,
    lifeDomain: normalizeLifeDomain(row.life_domain, { ventureId: row.venture_id }),
    source: row.source || "manual",
    status: row.status,
    delegatedTo: row.delegated_to,
    energy: row.energy,
    timeEstimateMin: row.time_estimate_min,
    dueDate: row.due_date,
    completedAt: row.completed_at as any,
    googleTaskId: row.google_task_id,
    googleTaskListId: row.google_task_list_id || null,
    notes: row.notes,
    lastSyncedAt: row.last_synced_at as any,
    tags: mergeHashtags(row.tags, [contextToHashtag(row.context)]),
    createdAt: row.created_at as any,
    updatedAt: row.updated_at as any,
    gtd_projects: row.gtd_projects ?? null,
    ventures: row.ventures ?? null,
  };
}

function mapBusinessMemory(row: RawBusinessMemory): BusinessMemory {
  return {
    id: row.id,
    source: row.source,
    agentName: row.agent_name,
    summary: row.summary,
    lifeDomain: normalizeLifeDomain(row.life_domain, { ventureSlugs: row.venture_slugs }),
    ventureSlugs: row.venture_slugs,
    topics: row.topics,
    importance: row.importance,
    metadata: row.metadata as any,
    createdAt: row.created_at as any,
  };
}

function mapProject(row: RawProject): GtdProject & { ventures?: { name: string; slug: string } | null } {
  return {
    id: row.id,
    title: row.title,
    outcome: row.outcome,
    why: row.why,
    status: row.status,
    ventureId: row.venture_id,
    area: row.area,
    lifeDomain: normalizeLifeDomain(row.life_domain, { ventureId: row.venture_id, area: row.area }),
    energy: row.energy,
    dueDate: row.due_date,
    completedAt: row.completed_at as any,
    notes: row.notes,
    tags: row.tags,
    createdAt: row.created_at as any,
    updatedAt: row.updated_at as any,
    ventures: row.ventures ?? null,
  };
}

function mapSchemaReview(row: RawSchemaReview): SchemaChangelog {
  return {
    id: row.id,
    proposedBy: row.proposed_by,
    changeType: row.change_type,
    tableName: row.table_name,
    columnName: row.column_name,
    description: row.description,
    sqlStatement: row.sql_statement,
    status: row.status,
    rationale: row.rationale,
    approvedBy: row.approved_by,
    appliedAt: row.applied_at as any,
    createdAt: row.created_at as any,
  };
}

function mapCeoRecommendation(row: RawCeoRecommendation): CeoRecommendation {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    body: row.body,
    venturesInvolved: row.ventures_involved as any,
    priority: row.priority,
    status: row.status,
    effortLevel: row.effort_level,
    estimatedRevenueImpact: row.estimated_revenue_impact,
    actionItems: row.action_items,
    aiModelUsed: row.ai_model_used,
    generatedAt: row.generated_at as any,
    acknowledgedAt: row.acknowledged_at as any,
    completedAt: row.completed_at as any,
    notes: row.notes,
  };
}

function mapReference(row: RawReference): GtdReference & { ventures?: { name: string; slug: string } | null; gtd_projects?: { title: string } | null } {
  return {
    id: row.id,
    title: row.title,
    content: row.content,
    url: row.url,
    projectId: row.project_id,
    ventureId: row.venture_id,
    area: row.area,
    category: row.category || "general",
    tags: row.tags,
    createdAt: row.created_at as any,
    updatedAt: row.updated_at as any,
    ventures: row.ventures || null,
    gtd_projects: row.gtd_projects || null,
  };
}

function mapSomeday(row: RawSomeday): GtdSomeday {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    ventureId: row.venture_id,
    area: row.area,
    reviewDate: row.review_date,
    promotedTo: row.promoted_to,
    promotedItemId: row.promoted_item_id,
    isArchived: row.is_archived,
    tags: row.tags,
    createdAt: row.created_at as any,
  };
}

function mapAgentLog(row: RawAgentLog): AgentLog {
  return {
    id: row.id,
    agentName: row.agent_name,
    action: row.action,
    inputSummary: row.input_summary,
    outputSummary: row.output_summary,
    success: row.success,
    errorMessage: row.error_message,
    modelUsed: row.model_used,
    createdAt: row.created_at as any,
  };
}

function mapVenturePatch(patch: Partial<Venture>) {
  const next: Record<string, unknown> = {};
  if ("slug" in patch) next.slug = patch.slug;
  if ("name" in patch) next.name = patch.name;
  if ("domain" in patch) next.domain = patch.domain;
  if ("tagline" in patch) next.tagline = patch.tagline;
  if ("description" in patch) next.description = patch.description;
  if ("status" in patch) next.status = patch.status;
  if ("riskLevel" in patch) next.risk_level = patch.riskLevel;
  if ("readinessScore" in patch) next.readiness_score = patch.readinessScore;
  if ("revenueModel" in patch) next.revenue_model = patch.revenueModel;
  if ("targetMarket" in patch) next.target_market = patch.targetMarket;
  if ("lovableUrl" in patch) next.lovable_url = patch.lovableUrl;
  if ("monthlyRevenueUsd" in patch) next.monthly_revenue_usd = patch.monthlyRevenueUsd;
  if ("monthlyExpensesUsd" in patch) next.monthly_expenses_usd = patch.monthlyExpensesUsd;
  if ("monthlyVisitors" in patch) next.monthly_visitors = patch.monthlyVisitors;
  if ("ceoNotes" in patch) next.ceo_notes = patch.ceoNotes;
  if ("synergyTags" in patch) next.synergy_tags = patch.synergyTags;
  if ("metadata" in patch) next.metadata = patch.metadata;
  return next;
}

function mergeUniqueById<T extends { id: string }>(...groups: T[][]): T[] {
  const seen = new Map<string, T>();
  for (const group of groups) {
    for (const item of group) {
      if (!seen.has(item.id)) seen.set(item.id, item);
    }
  }
  return Array.from(seen.values());
}

export async function fetchVentures(): Promise<Venture[]> {
  const { data, error } = await supabase
    .from("ventures")
    .select("*")
    .order("readiness_score", { ascending: false });
  if (error) throw error;
  return ((data as RawVenture[] | null) || []).map(mapVenture);
}

export async function updateVenture(id: string, patch: Partial<Venture>) {
  const { error } = await supabase.from("ventures").update(mapVenturePatch(patch)).eq("id", id);
  if (error) throw error;
}

export async function fetchInbox(limit = 50): Promise<GtdInbox[]> {
  const { data, error } = await supabase
    .from("gtd_inbox")
    .select("*, gtd_projects(id, title)")
    .eq("processed", false)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return ((data as RawInbox[] | null) || []).map(mapInbox);
}

export async function fetchInboxHistory(limit = 100): Promise<GtdInbox[]> {
  const { data, error } = await supabase
    .from("gtd_inbox")
    .select("*, gtd_projects(id, title)")
    .eq("processed", true)
    .order("processed_at", { ascending: false, nullsFirst: false })
    .limit(limit);
  if (error) throw error;
  return ((data as RawInbox[] | null) || []).map(mapInbox);
}

export async function addToInbox(rawText: string, source = "web") {
  const { error } = await supabase
    .from("gtd_inbox")
    .insert({ raw_text: rawText, source, life_domain: "unknown", tags: extractHashtags(rawText) });
  if (error) throw error;
}

export async function processInboxItem(id: string, filedTo = "manual") {
  const { error } = await supabase
    .from("gtd_inbox")
    .update({
      processed: true,
      processed_at: new Date().toISOString(),
      filed_to: filedTo,
    })
    .eq("id", id);
  if (error) throw error;
}

export async function processInboxItems(ids: string[], filedTo = "manual-bulk") {
  if (!ids.length) return;
  const { error } = await supabase
    .from("gtd_inbox")
    .update({
      processed: true,
      processed_at: new Date().toISOString(),
      filed_to: filedTo,
    })
    .in("id", ids);
  if (error) throw error;
}

export async function undoInboxProcessing(id: string) {
  const { error } = await supabase
    .from("gtd_inbox")
    .update({
      processed: false,
      processed_at: null,
      filed_to: null,
    })
    .eq("id", id);
  if (error) throw error;
}

export async function updateInboxText(
  id: string,
  rawText: string,
  reopen = false,
  filedTo?: string | null,
  projectId?: string | null,
  existingTags?: string[] | null,
) {
  const patch: Record<string, unknown> = {
    raw_text: rawText,
    tags: mergeHashtags(existingTags, extractHashtags(rawText)),
  };

  if (filedTo !== undefined) {
    patch.filed_to = filedTo;
    patch.processed = filedTo !== null;
    patch.processed_at = filedTo !== null ? new Date().toISOString() : null;
  }

  if (reopen) {
    patch.processed = false;
    patch.processed_at = null;
    patch.filed_to = null;
    patch.ai_summary = null;
    patch.ai_category = null;
    patch.life_domain = "unknown";
    patch.ai_confidence = null;
  }

  if (projectId !== undefined) {
    patch.project_id = projectId;
  }

  const { error } = await supabase
    .from("gtd_inbox")
    .update(patch)
    .eq("id", id);
  if (error) throw error;
}

export async function fetchBusinessMemory(limit = 50): Promise<BusinessMemory[]> {
  const { data, error } = await supabase
    .from("business_memory")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return ((data as RawBusinessMemory[] | null) || []).map(mapBusinessMemory);
}

export async function fetchActions(status = "active"): Promise<GtdAction[]> {
  const { data, error } = await supabase
    .from("gtd_actions")
    .select("*, gtd_projects(title), ventures(name, slug)")
    .eq("status", status)
    .order("due_date", { ascending: true, nullsFirst: false });
  if (error) throw error;
  return ((data as RawAction[] | null) || []).map(mapAction);
}

export async function fetchWaitingActions(): Promise<GtdAction[]> {
  const { data, error } = await supabase
    .from("gtd_actions")
    .select("*, gtd_projects(title), ventures(name, slug)")
    .neq("status", "completed")
    .neq("status", "cancelled")
    .or("status.eq.waiting,status.eq.delegated,context.eq.@waiting")
    .order("due_date", { ascending: true, nullsFirst: false });
  if (error) throw error;
  return ((data as RawAction[] | null) || []).map(mapAction);
}

export async function fetchReferences(): Promise<GtdReference[]> {
  const { data, error } = await supabase
    .from("gtd_reference")
    .select("*, ventures(name, slug), gtd_projects(title)")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return ((data as RawReference[] | null) || []).map(mapReference);
}

export async function fetchSomeday(): Promise<GtdSomeday[]> {
  const { data, error } = await supabase
    .from("gtd_someday")
    .select("*, ventures(name, slug)")
    .eq("is_archived", false)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return ((data as RawSomeday[] | null) || []).map(mapSomeday);
}


export async function completeAction(id: string) {
  const { error } = await supabase
    .from("gtd_actions")
    .update({ status: "completed", completed_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}

export async function fetchProjects(status = "active"): Promise<GtdProject[]> {
  const { data, error } = await supabase
    .from("gtd_projects")
    .select("*, ventures(name, slug)")
    .eq("status", status)
    .order("due_date", { ascending: true, nullsFirst: false });
  if (error) throw error;
  return ((data as RawProject[] | null) || []).map(mapProject);
}

export async function createProject(input: {
  title: string;
  lifeDomain?: string | null;
  area?: string | null;
  ventureId?: string | null;
  tags?: string[] | null;
}) {
  const { data, error } = await supabase
    .from("gtd_projects")
    .insert({
      title: input.title.trim(),
      life_domain: normalizeLifeDomain(input.lifeDomain),
      area: input.area || null,
      venture_id: input.ventureId || null,
      tags: mergeHashtags(input.tags, extractHashtags(input.title)),
    })
    .select("id, title")
    .single();

  if (error) throw error;
  return data as { id: string; title: string };
}

export async function fetchCeoRecs(status = "new"): Promise<CeoRecommendation[]> {
  const { data, error } = await supabase
    .from("ceo_recommendations")
    .select("*")
    .eq("status", status)
    .order("generated_at", { ascending: false });
  if (error) throw error;
  return ((data as RawCeoRecommendation[] | null) || []).map(mapCeoRecommendation);
}

export async function acknowledgeCeoRec(id: string) {
  const { error } = await supabase
    .from("ceo_recommendations")
    .update({ status: "acknowledged", acknowledged_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}

export async function fetchRecentLogs(limit = 20): Promise<AgentLog[]> {
  const { data, error } = await supabase
    .from("agent_logs")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return ((data as RawAgentLog[] | null) || []).map(mapAgentLog);
}

export async function fetchSchemaReviewQueue(status = "proposed", limit = 100): Promise<SchemaChangelog[]> {
  const { data, error } = await supabase
    .from("schema_changelog")
    .select("*")
    .eq("status", status)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return ((data as RawSchemaReview[] | null) || []).map(mapSchemaReview);
}

export async function fetchSchemaReviewCount(status = "proposed"): Promise<number> {
  const { count, error } = await supabase
    .from("schema_changelog")
    .select("id", { count: "exact", head: true })
    .eq("status", status);
  if (error) throw error;
  return count || 0;
}

export async function reviewSchemaProposal(id: string, decision: "approve" | "reject") {
  const session = await getSession();
  const token = session?.access_token;
  if (!token) throw new Error("Not authenticated");

  const response = await fetch("/api/schema/review-action", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ id, decision }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || "Schema review request failed");
  }
  return payload as { ok: boolean; id: string; status: string };
}

export async function fetchPortfolioStats() {
  const { data: ventures, error } = await supabase
    .from("ventures")
    .select("status, readiness_score, monthly_revenue_usd, monthly_visitors, risk_level");
  if (error) throw error;

  const total = ventures?.length || 0;
  const active = ventures?.filter((v: any) => v.status === "active").length || 0;
  const totalRevenue = ventures?.reduce((sum: number, v: any) => sum + parseFloat(v.monthly_revenue_usd || 0), 0) || 0;
  const totalVisitors = ventures?.reduce((sum: number, v: any) => sum + (v.monthly_visitors || 0), 0) || 0;
  const avgReadiness = total > 0
    ? Math.round(ventures!.reduce((sum: number, v: any) => sum + (v.readiness_score || 0), 0) / total)
    : 0;

  return { total, active, totalRevenue, totalVisitors, avgReadiness };
}

export async function searchAll(query: string, scope = "all") {
  const q = query.trim();
  if (!q) return { ventures: [], actions: [], projects: [], recommendations: [], conversationLogs: [], inboxItems: [], calendarEvents: [], references: [] };

  const like = `%${q}%`;
  const tagQuery = q.startsWith("#") || !/\s/.test(q) ? normalizeHashtag(q) : null;
  const includeEverything = scope === "all";
  const includeConversation = includeEverything || scope === "conversation";
  const includeInbox = includeEverything || scope === "inbox";
  const includeCalendar = includeEverything || scope === "calendar";

  const [ventureName, ventureDescription, ventureNotes, actions, actionTags, projects, projectTags, recTitle, recBody, conversationSummary, conversationTopics, inboxText, inboxTags, calendarTitle, calendarDescription, refTitle, refContent, refTags] = await Promise.all([
    includeEverything
      ? supabase
          .from("ventures")
          .select("id, slug, name, status, readiness_score, ceo_notes, synergy_tags")
          .ilike("name", like)
          .limit(5)
      : Promise.resolve({ data: [], error: null }),
    includeEverything
      ? supabase
          .from("ventures")
          .select("id, slug, name, status, readiness_score, ceo_notes, synergy_tags")
          .ilike("description", like)
          .limit(5)
      : Promise.resolve({ data: [], error: null }),
    includeEverything
      ? supabase
          .from("ventures")
          .select("id, slug, name, status, readiness_score, ceo_notes, synergy_tags")
          .ilike("ceo_notes", like)
          .limit(5)
      : Promise.resolve({ data: [], error: null }),
    includeEverything
      ? supabase
          .from("gtd_actions")
          .select("id, title, status, context, due_date, life_domain, source, project_id, tags, gtd_projects(title)")
          .ilike("title", like)
          .eq("status", "active")
          .limit(5)
      : Promise.resolve({ data: [], error: null }),
    includeEverything && tagQuery
      ? supabase
          .from("gtd_actions")
          .select("id, title, status, context, due_date, life_domain, source, project_id, tags, gtd_projects(title)")
          .contains("tags", [tagQuery])
          .eq("status", "active")
          .limit(5)
      : Promise.resolve({ data: [], error: null }),
    includeEverything
      ? supabase
          .from("gtd_projects")
          .select("id, title, status, area, due_date, life_domain, tags")
          .ilike("title", like)
          .limit(5)
      : Promise.resolve({ data: [], error: null }),
    includeEverything && tagQuery
      ? supabase
          .from("gtd_projects")
          .select("id, title, status, area, due_date, life_domain, tags")
          .contains("tags", [tagQuery])
          .limit(5)
      : Promise.resolve({ data: [], error: null }),
    includeEverything
      ? supabase
          .from("ceo_recommendations")
          .select("id, title, type, priority, status, generated_at")
          .ilike("title", like)
          .limit(5)
      : Promise.resolve({ data: [], error: null }),
    includeEverything
      ? supabase
          .from("ceo_recommendations")
          .select("id, title, type, priority, status, generated_at")
          .ilike("body", like)
          .limit(5)
      : Promise.resolve({ data: [], error: null }),
    includeConversation
      ? supabase
          .from("business_memory")
          .select("id, source, agent_name, summary, importance, life_domain, created_at")
          .ilike("summary", like)
          .limit(20)
      : Promise.resolve({ data: [], error: null }),
    includeConversation
      ? supabase
          .from("business_memory")
          .select("id, source, agent_name, summary, importance, life_domain, created_at")
          .contains("topics", [q.toLowerCase()])
          .limit(20)
      : Promise.resolve({ data: [], error: null }),
    includeInbox
      ? supabase
          .from("gtd_inbox")
          .select("id, source, raw_text, life_domain, processed, filed_to, created_at, processed_at, project_id, tags, gtd_projects(title)")
          .ilike("raw_text", like)
          .limit(20)
      : Promise.resolve({ data: [], error: null }),
    includeInbox && tagQuery
      ? supabase
          .from("gtd_inbox")
          .select("id, source, raw_text, life_domain, processed, filed_to, created_at, processed_at, project_id, tags, gtd_projects(title)")
          .contains("tags", [tagQuery])
          .limit(20)
      : Promise.resolve({ data: [], error: null }),
    includeCalendar
      ? supabase
          .from("calendar_events")
          .select("id, title, description, start_at, end_at, all_day, event_type, life_domain, status, location, source")
          .ilike("title", like)
          .limit(20)
      : Promise.resolve({ data: [], error: null }),
    includeCalendar
      ? supabase
          .from("calendar_events")
          .select("id, title, description, start_at, end_at, all_day, event_type, life_domain, status, location, source")
          .ilike("description", like)
          .limit(20)
      : Promise.resolve({ data: [], error: null }),
    includeEverything
      ? supabase
          .from("gtd_reference")
          .select("*, ventures(name, slug), gtd_projects(title)")
          .ilike("title", like)
          .limit(10)
      : Promise.resolve({ data: [], error: null }),
    includeEverything
      ? supabase
          .from("gtd_reference")
          .select("*, ventures(name, slug), gtd_projects(title)")
          .ilike("content", like)
          .limit(10)
      : Promise.resolve({ data: [], error: null }),
    includeEverything && tagQuery
      ? supabase
          .from("gtd_reference")
          .select("*, ventures(name, slug), gtd_projects(title)")
          .contains("tags", [tagQuery])
          .limit(10)
      : Promise.resolve({ data: [], error: null }),
  ]);

  const queryErrors = [
    ventureName.error,
    ventureDescription.error,
    ventureNotes.error,
    actions.error,
    actionTags.error,
    projects.error,
    projectTags.error,
    recTitle.error,
    recBody.error,
    conversationSummary.error,
    conversationTopics.error,
    inboxText.error,
    inboxTags.error,
    calendarTitle.error,
    calendarDescription.error,
    refTitle.error,
    refContent.error,
    refTags.error,
  ].filter(Boolean);
  if (queryErrors.length > 0) {
    throw queryErrors[0];
  }

  return {
    ventures: mergeUniqueById(
      ventureName.data || [],
      ventureDescription.data || [],
      ventureNotes.data || [],
    ).slice(0, 5),
    actions: mergeUniqueById(actions.data || [], actionTags.data || []).slice(0, 5),
    projects: mergeUniqueById(projects.data || [], projectTags.data || []).slice(0, 5),
    recommendations: mergeUniqueById(recTitle.data || [], recBody.data || []).slice(0, 5),
    conversationLogs: mergeUniqueById(
      (conversationSummary.data as RawBusinessMemory[] | null) || [],
      (conversationTopics.data as RawBusinessMemory[] | null) || [],
    ).slice(0, 20),
    inboxItems: mergeUniqueById(
      (inboxText.data as RawInbox[] | null) || [],
      (inboxTags.data as RawInbox[] | null) || [],
    ).slice(0, 20),
    calendarEvents: mergeUniqueById(
      (calendarTitle.data as RawCalendarEvent[] | null) || [],
      (calendarDescription.data as RawCalendarEvent[] | null) || [],
    ).slice(0, 20),
    references: mergeUniqueById(
      (refTitle.data as RawReference[] | null) || [],
      (refContent.data as RawReference[] | null) || [],
      (refTags.data as RawReference[] | null) || [],
    ).slice(0, 20),
  };
}
export async function fetchCalendarEvents(): Promise<RawCalendarEvent[]> {
  const { data, error } = await supabase
    .from("calendar_events")
    .select("*")
    .neq("status", "cancelled")
    .order("start_at", { ascending: true });
  if (error) throw error;
  return (data as RawCalendarEvent[] | null) || [];
}

export async function deleteCalendarEvent(id: string) {
  // First check if it has a google_event_id
  const { data } = await supabase
    .from("calendar_events")
    .select("google_event_id")
    .eq("id", id)
    .single();

  if (data?.google_event_id) {
    // For Google events, we mark as cancelled so the sync agent pushes the deletion to Google
    const { error } = await supabase
      .from("calendar_events")
      .update({ 
        status: "cancelled",
        updated_at: new Date().toISOString() 
      })
      .eq("id", id);
    if (error) throw error;
  } else {
    // For local events, we can just delete
    const { error } = await supabase
      .from("calendar_events")
      .delete()
      .eq("id", id);
    if (error) throw error;
  }
}

export async function fetchAllHashtags(): Promise<string[]> {
  // Fetch tags from projects, actions, and inbox
  const [projects, actions, inbox, references] = await Promise.all([
    supabase.from("gtd_projects").select("tags"),
    supabase.from("gtd_actions").select("tags"),
    supabase.from("gtd_inbox").select("tags"),
    supabase.from("gtd_reference").select("tags")
  ]);

  if (projects.error) throw projects.error;
  if (actions.error) throw actions.error;
  if (inbox.error) throw inbox.error;
  if (references.error) throw references.error;

  const allTags = new Set<string>();
  [projects.data, actions.data, inbox.data, references.data].forEach(group => {
    group?.forEach((item: any) => {
      item.tags?.forEach((tag: string) => allTags.add(tag));
    });
  });

  return Array.from(allTags).sort();
}
