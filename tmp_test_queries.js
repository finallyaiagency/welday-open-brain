import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

dotenv.config({ path: "dashboard/.env" });

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

// Mocking some functions present in api/index.ts
function getLocalDateKey(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

async function fetchPendingSchemaReviews(sb, limit = 10) {
  const { data, error } = await sb
    .from("schema_changelog")
    .select("id, description, rationale, created_at, table_name, column_name")
    .eq("status", "proposed")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw error;
  return data || [];
}

async function getPendingSchemaReviewSummary(sb, limit = 3) {
  const reviews = await fetchPendingSchemaReviews(sb, limit);
  return { count: reviews.length, items: reviews };
}

function normalizeLifeDomain(value, fallbackCategory) {
  if (value === "business" || value === "personal" || value === "unknown") return value;
  if (fallbackCategory === "business") return "business";
  if (fallbackCategory === "personal") return "personal";
  return "unknown";
}

async function buildMoneypennyReviewPayload(sb, window) {
  const now = new Date();
  const today = getLocalDateKey(now);
  const horizon = new Date(now.getTime() + (window === "morning" ? 36 : 18) * 60 * 60 * 1000);

  const [
    { data: overdue, error: err1 },
    { data: todayItems, error: err2 },
    { data: soonItems, error: err3 },
    { data: waitingItems, error: err4 },
    { data: inboxItems, error: err5 },
    { data: calendarRows, error: err6 },
    { data: alerts, error: err7 },
    schemaReviews,
  ] = await Promise.all([
    sb.from("gtd_actions").select("title,due_date,life_domain,ventures(name)").eq("status", "active").lt("due_date", today).order("due_date", { ascending: true }).limit(5),
    sb.from("gtd_actions").select("title,context,due_date,life_domain,ventures(name)").eq("status", "active").eq("due_date", today).order("created_at", { ascending: true }).limit(6),
    sb.from("gtd_actions").select("title,due_date,context,life_domain,ventures(name)").eq("status", "active").gte("due_date", today).order("due_date", { ascending: true }).limit(8),
    sb.from("gtd_actions").select("title,delegated_to,due_date,life_domain").eq("status", "waiting").order("due_date", { ascending: true }).limit(5),
    sb.from("gtd_inbox").select("raw_text,created_at,life_domain").eq("processed", false).order("created_at", { ascending: true }).limit(4),
    sb.from("calendar_events").select("title,start_at,end_at,all_day,location,status,life_domain,ventures(name)").neq("status", "cancelled").lte("start_at", horizon.toISOString()).order("start_at", { ascending: true }).limit(20),
    sb.from("ceo_recommendations").select("title,priority").eq("status", "new").in("priority", ["critical", "high"]).order("generated_at", { ascending: false }).limit(3),
    getPendingSchemaReviewSummary(sb, 3),
  ]);

  if (err1) console.error("err1:", err1);
  if (err2) console.error("err2:", err2);
  if (err3) console.error("err3:", err3);
  if (err4) console.error("err4:", err4);
  if (err5) console.error("err5:", err5);
  if (err6) console.error("err6:", err6);
  if (err7) console.error("err7:", err7);

  console.log("Everything fetched successfully!");
}

buildMoneypennyReviewPayload(supabase, "morning");
