import { createClient } from "@supabase/supabase-js";
import 'dotenv/config';

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function resetAndInject() {
  const items = [
    "create appointment today 6-7 pm eat dinner",
    "Create appointment to go car shopping tomorrow 1:30-5"
  ];
  
  for (const text of items) {
    console.log("Resetting/Injecting:", text);
    // Delete existing to be sure
    await supabase.from("gtd_inbox").delete().eq("raw_text", text);
    
    // Insert fresh
    const { data, error } = await supabase.from("gtd_inbox").insert({
      raw_text: text,
      source: "telegram",
      processed: false,
      filed_to: null,
      tags: ["#appointment"]
    }).select("id").single();
    
    if (error) console.error("Error:", error);
    else console.log("Inserted:", data.id);
  }
}

resetAndInject().catch(console.error);
