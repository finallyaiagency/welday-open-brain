import { createClient } from "@supabase/supabase-js";
import 'dotenv/config';

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || 'https://xxx.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error("Missing Supabase URL or Key");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function deleteInboxDinner() {
  console.log("Searching for gtd_inbox with 'dinner' in raw_text...");
  
  const { data: inboxItems, error: fetchError } = await supabase
    .from("gtd_inbox")
    .select("id, raw_text")
    .ilike("raw_text", "%dinner%");

  if (fetchError) {
    console.error("Error fetching inbox:", fetchError);
    return;
  }

  if (!inboxItems || inboxItems.length === 0) {
    console.log("No inbox items found with 'dinner' in raw_text.");
    return;
  }

  const ids = inboxItems.map(i => i.id);
  const { error: deleteError } = await supabase
    .from("gtd_inbox")
    .delete()
    .in("id", ids);

  if (deleteError) {
    console.error("Error deleting from inbox:", deleteError.message);
  } else {
    console.log(`Successfully deleted ${inboxItems.length} inbox items.`);
  }
}

deleteInboxDinner().catch(console.error);
