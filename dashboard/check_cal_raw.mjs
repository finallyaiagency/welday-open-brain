import { createClient } from "@supabase/supabase-js";
import 'dotenv/config';

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function check() {
  const { data: calItems, error } = await supabase
    .from("calendar_events")
    .select("*")
  
  if (error) {
    console.error("Query Error:", error);
  } else {
    console.log("ALL CALENDAR ITEMS:", JSON.stringify(calItems, null, 2));
  }
}

check().catch(console.error);
