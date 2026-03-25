import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

dotenv.config({ path: "dashboard/.env" });

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

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

async function testQueries() {
  const now = new Date();
  const today = getLocalDateKey(now);
  const window = "morning";
  const horizon = new Date(now.getTime() + (window === "morning" ? 36 : 18) * 60 * 60 * 1000);

  console.log("Starting queries...");
  
  try {
    const results = await Promise.allSettled([
      supabase.from("gtd_actions").select("title,due_date,life_domain,ventures(name)").eq("status", "active").lt("due_date", today).order("due_date", { ascending: true }).limit(5),
      supabase.from("gtd_actions").select("title,context,due_date,life_domain,ventures(name)").eq("status", "active").eq("due_date", today).order("created_at", { ascending: true }).limit(6),
      supabase.from("gtd_actions").select("title,due_date,context,life_domain,ventures(name)").eq("status", "active").gte("due_date", today).order("due_date", { ascending: true }).limit(8),
      supabase.from("gtd_actions").select("title,delegated_to,due_date,life_domain").eq("status", "waiting").order("due_date", { ascending: true }).limit(5),
      supabase.from("gtd_inbox").select("raw_text,created_at,life_domain").eq("processed", false).order("created_at", { ascending: true }).limit(4),
      supabase.from("calendar_events").select("title,start_at,end_at,all_day,location,status,life_domain,ventures(name)").neq("status", "cancelled").lte("start_at", horizon.toISOString()).order("start_at", { ascending: true }).limit(20),
      supabase.from("ceo_recommendations").select("title,priority").eq("status", "new").in("priority", ["critical", "high"]).order("generated_at", { ascending: false }).limit(3),
      getPendingSchemaReviewSummary(supabase, 3),
    ]);

    results.forEach((res, i) => {
      if (res.status === "rejected") {
        console.error(`Query ${i} REJECTED:`, res.reason);
      } else {
        if (res.value.error) {
          console.error(`Query ${i} ERROR:`, res.value.error);
        } else {
          console.log(`Query ${i} SUCCESS`);
        }
      }
    });

  } catch (err) {
    console.error("Outer catch:", err);
  }
}

testQueries();
