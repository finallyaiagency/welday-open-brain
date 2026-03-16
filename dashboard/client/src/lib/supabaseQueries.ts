import { supabase } from "./supabase";
import type { Venture, GtdInbox, GtdAction, GtdProject, CeoRecommendation, AgentLog } from "@shared/schema";

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
  processed: boolean | null;
  processed_at: string | null;
  filed_to: string | null;
  ai_summary: string | null;
  ai_category: string | null;
  ai_confidence: string | number | null;
  created_at: string | null;
};

type RawAction = {
  id: string;
  title: string;
  project_id: string | null;
  venture_id: string | null;
  context: string | null;
  status: string;
  delegated_to: string | null;
  energy: string | null;
  time_estimate_min: number | null;
  due_date: string | null;
  completed_at: string | null;
  google_task_id: string | null;
  notes: string | null;
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
    processed: row.processed,
    processedAt: row.processed_at as any,
    filedTo: row.filed_to,
    aiSummary: row.ai_summary,
    aiCategory: row.ai_category,
    aiConfidence: row.ai_confidence as any,
    createdAt: row.created_at as any,
  };
}

function mapAction(row: RawAction): GtdAction & { gtd_projects?: { title: string } | null; ventures?: { name: string; slug: string } | null } {
  return {
    id: row.id,
    title: row.title,
    projectId: row.project_id,
    ventureId: row.venture_id,
    context: row.context,
    status: row.status,
    delegatedTo: row.delegated_to,
    energy: row.energy,
    timeEstimateMin: row.time_estimate_min,
    dueDate: row.due_date,
    completedAt: row.completed_at as any,
    googleTaskId: row.google_task_id,
    notes: row.notes,
    tags: row.tags,
    createdAt: row.created_at as any,
    updatedAt: row.updated_at as any,
    gtd_projects: row.gtd_projects ?? null,
    ventures: row.ventures ?? null,
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
  return [...seen.values()];
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
    .select("*")
    .eq("processed", false)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return ((data as RawInbox[] | null) || []).map(mapInbox);
}

export async function fetchInboxHistory(limit = 100): Promise<GtdInbox[]> {
  const { data, error } = await supabase
    .from("gtd_inbox")
    .select("*")
    .eq("processed", true)
    .order("processed_at", { ascending: false, nullsFirst: false })
    .limit(limit);
  if (error) throw error;
  return ((data as RawInbox[] | null) || []).map(mapInbox);
}

export async function addToInbox(rawText: string, source = "web") {
  const { error } = await supabase
    .from("gtd_inbox")
    .insert({ raw_text: rawText, source });
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

export async function updateInboxText(id: string, rawText: string, reopen = false) {
  const patch: Record<string, unknown> = {
    raw_text: rawText,
  };

  if (reopen) {
    patch.processed = false;
    patch.processed_at = null;
    patch.filed_to = null;
    patch.ai_summary = null;
    patch.ai_category = null;
    patch.ai_confidence = null;
  }

  const { error } = await supabase
    .from("gtd_inbox")
    .update(patch)
    .eq("id", id);
  if (error) throw error;
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

export async function searchAll(query: string) {
  const q = query.trim();
  if (!q) return { ventures: [], actions: [], projects: [], recommendations: [] };

  const like = `%${q}%`;

  const [ventureName, ventureDescription, ventureNotes, actions, projects, recTitle, recBody] = await Promise.all([
    supabase
      .from("ventures")
      .select("id, slug, name, status, readiness_score, ceo_notes, synergy_tags")
      .ilike("name", like)
      .limit(5),
    supabase
      .from("ventures")
      .select("id, slug, name, status, readiness_score, ceo_notes, synergy_tags")
      .ilike("description", like)
      .limit(5),
    supabase
      .from("ventures")
      .select("id, slug, name, status, readiness_score, ceo_notes, synergy_tags")
      .ilike("ceo_notes", like)
      .limit(5),
    supabase
      .from("gtd_actions")
      .select("id, title, status, context, due_date")
      .ilike("title", like)
      .eq("status", "active")
      .limit(5),
    supabase
      .from("gtd_projects")
      .select("id, title, status, area, due_date")
      .ilike("title", like)
      .limit(5),
    supabase
      .from("ceo_recommendations")
      .select("id, title, type, priority, status")
      .ilike("title", like)
      .limit(5),
    supabase
      .from("ceo_recommendations")
      .select("id, title, type, priority, status")
      .ilike("body", like)
      .limit(5),
  ]);

  return {
    ventures: mergeUniqueById(
      ventureName.data || [],
      ventureDescription.data || [],
      ventureNotes.data || [],
    ).slice(0, 5),
    actions: actions.data || [],
    projects: projects.data || [],
    recommendations: mergeUniqueById(recTitle.data || [], recBody.data || []).slice(0, 5),
  };
}
