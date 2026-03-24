import { createClient } from "@supabase/supabase-js";
import 'dotenv/config';

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || 'https://xxx.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error("Missing Supabase URL or Key");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function finalCleanup() {
  console.log("Deep cleaning database for 'dinner' events/actions...");
  
  // Clean calendar_events
  const { data: events, error: eventErr } = await supabase
    .from("calendar_events")
    .select("id, title, google_event_id")
    .ilike("title", "%dinner%");
  
  if (events && events.length > 0) {
    console.log(`Found ${events.length} events containing 'dinner' in title.`);
    for (const event of events) {
      if (event.google_event_id) {
        console.log(`- Marking Google Event as cancelled: [${event.id}] ${event.title}`);
        await supabase.from("calendar_events").update({ status: 'cancelled', updated_at: new Date().toISOString() }).eq("id", event.id);
      } else {
        console.log(`- Deleting local Event: [${event.id}] ${event.title}`);
        await supabase.from("calendar_events").delete().eq("id", event.id);
      }
    }
  } else {
    console.log("No matching events found in calendar_events.");
  }

  // Clean gtd_actions
  const { data: actions, error: actionErr } = await supabase
    .from("gtd_actions")
    .select("id, title, google_task_id")
    .ilike("title", "%dinner%");
  
  if (actions && actions.length > 0) {
    console.log(`Found ${actions.length} actions containing 'dinner' in title.`);
    for (const action of actions) {
      if (action.google_task_id) {
        console.log(`- Marking Google Task as cancelled: [${action.id}] ${action.title}`);
        await supabase.from("gtd_actions").update({ status: 'cancelled', updated_at: new Date().toISOString() }).eq("id", action.id);
      } else {
        console.log(`- Deleting local Action: [${action.id}] ${action.title}`);
        await supabase.from("gtd_actions").delete().eq("id", action.id);
      }
    }
  } else {
    console.log("No matching actions found in gtd_actions.");
  }

  // Final verification of gtd_inbox
  const { data: inbox, error: inboxErr } = await supabase
    .from("gtd_inbox")
    .select("id, raw_text")
    .ilike("raw_text", "%dinner%");
  
  if (inbox && inbox.length > 0) {
    console.log(`Found ${inbox.length} inbox items containing 'dinner'. Deleting...`);
    await supabase.from("gtd_inbox").delete().in("id", inbox.map(i => i.id));
  } else {
    console.log("No matching inbox items found.");
  }

  console.log("Cleanup complete!");
}

finalCleanup().catch(console.error);
