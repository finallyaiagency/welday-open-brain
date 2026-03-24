import { createClient } from "@supabase/supabase-js";
import 'dotenv/config';

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || 'https://xxx.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error("Missing Supabase URL or Key");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

const tables = ["calendar_events", "gtd_actions", "gtd_projects", "gtd_someday", "gtd_reference"];

async function scrub() {
  for (const table of tables) {
    console.log(`Checking ${table} for 'dinner'...`);
    const { data, error } = await supabase
      .from(table)
      .select("id, title")
      .ilike("title", "%dinner%");
    
    if (error) {
      console.error(`Error checking ${table}:`, error.message);
      continue;
    }

    if (data && data.length > 0) {
      console.log(`Found ${data.length} items in ${table}:`);
      data.forEach(item => console.log(`- [${table}:${item.id}] ${item.title}`));
      
      const ids = data.map(item => item.id);
      const { error: deleteError } = await supabase
        .from(table)
        .delete()
        .in("id", ids);
      
      if (deleteError) {
        console.error(`Error deleting from ${table}:`, deleteError.message);
      } else {
        console.log(`Successfully deleted from ${table}.`);
      }
    } else {
      console.log(`No items found in ${table}.`);
    }
  }
}

scrub().catch(console.error);
