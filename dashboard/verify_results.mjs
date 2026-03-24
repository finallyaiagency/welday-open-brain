import { createClient } from "@supabase/supabase-js";
import 'dotenv/config';

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function check() {
  const { data: inbox } = await supabase
    .from("gtd_inbox")
    .select("raw_text, filed_to, processed, processed_at, filed_item_id")
    .order("created_at", { ascending: false })
    .limit(5);
  console.log("INBOX ITEMS:", JSON.stringify(inbox, null, 2));

  const { data: calItems } = await supabase
    .from("calendar_events")
    .select("id, title, description, start_at, end_at, event_type")
    .order("created_at", { ascending: false })
    .limit(5);
  console.log("CALENDAR ITEMS:", JSON.stringify(calItems, null, 2));
}

check().catch(console.error);
