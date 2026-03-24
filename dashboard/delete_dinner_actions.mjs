import { createClient } from "@supabase/supabase-js";
import 'dotenv/config';

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || 'https://xxx.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error("Missing Supabase URL or Key");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkActions() {
  console.log("Searching for gtd_actions with 'dinner' in title...");
  
  const { data: actions, error: fetchError } = await supabase
    .from("gtd_actions")
    .select("id, title")
    .ilike("title", "%dinner%");

  if (fetchError) {
    console.error("Error fetching actions:", fetchError);
    return;
  }

  if (!actions || actions.length === 0) {
    console.log("No actions found with 'dinner' in title.");
    return;
  }

  console.log(`Found ${actions.length} actions:`);
  actions.forEach(e => console.log(`- [${e.id}] ${e.title}`));

  const ids = actions.map(e => e.id);
  
  const { error: deleteError } = await supabase
    .from("gtd_actions")
    .delete()
    .in("id", ids);

  if (deleteError) {
    console.error("Error deleting actions:", deleteError);
  } else {
    console.log(`Successfully deleted ${actions.length} actions.`);
  }
}

checkActions().catch(console.error);
