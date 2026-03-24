import { createClient } from "@supabase/supabase-js";
import 'dotenv/config';

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || 'https://xxx.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error("Missing Supabase URL or Key");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function deleteDinnerEvents() {
  console.log("Searching for calendar events with 'dinner' in title...");
  
  const { data: events, error: fetchError } = await supabase
    .from("calendar_events")
    .select("id, title")
    .ilike("title", "%dinner%");

  if (fetchError) {
    console.error("Error fetching events:", fetchError);
    return;
  }

  if (!events || events.length === 0) {
    console.log("No events found with 'dinner' in title.");
    return;
  }

  console.log(`Found ${events.length} events:`);
  events.forEach(e => console.log(`- [${e.id}] ${e.title}`));

  const ids = events.map(e => e.id);
  
  const { error: deleteError } = await supabase
    .from("calendar_events")
    .delete()
    .in("id", ids);

  if (deleteError) {
    console.error("Error deleting events:", deleteError);
  } else {
    console.log(`Successfully deleted ${events.length} events.`);
  }
}

deleteDinnerEvents().catch(console.error);
