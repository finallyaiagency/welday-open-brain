import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

dotenv.config({ path: "dashboard/.env" });

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function findChatIds() {
  const { data, error } = await supabase
    .from("bot_sessions")
    .select("slug")
    .limit(10);

  if (error) {
    console.error(error);
    return;
  }

  console.log("Session slugs:", data.map(s => s.slug));
}

findChatIds();
