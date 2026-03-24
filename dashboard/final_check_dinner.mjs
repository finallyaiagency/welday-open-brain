import { createClient } from "@supabase/supabase-js";
import 'dotenv/config';

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || 'https://xxx.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

async function finalCheck() {
  const tables = ["calendar_events", "gtd_actions"];
  for (const table of tables) {
    console.log(`Deep searching ${table} for 'dinner'...`);
    const { data: byTitle } = await supabase.from(table).select("*").ilike("title", "%dinner%");
    const { data: byDesc } = await supabase.from(table).select("*").ilike(table === "calendar_events" ? "description" : "notes", "%dinner%");
    
    const all = [...(byTitle || []), ...(byDesc || [])];
    const unique = Array.from(new Map(all.map(item => [item.id, item])).values());

    if (unique.length > 0) {
      console.log(`Found ${unique.length} remaining items in ${table}:`);
      unique.forEach(item => console.log(`- [${item.id}] Title: ${item.title}`));
    } else {
      console.log(`No more items found in ${table}.`);
    }
  }
}

finalCheck().catch(console.error);
