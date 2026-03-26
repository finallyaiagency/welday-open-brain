
const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.join(__dirname, '.env') });

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;

if (!url || !key) {
  console.error("Supabase credentials not found");
  process.exit(1);
}

const supabase = createClient(url, key);

async function checkRange() {
  const { data: logs, error } = await supabase
    .from('agent_logs')
    .select('*')
    .gte('created_at', '2026-03-26T10:55:00Z')
    .lte('created_at', '2026-03-26T12:00:00Z')
    .order('created_at', { ascending: false });

  if (error) {
    console.error("Error fetching logs:", error);
    process.exit(1);
  }

  console.log(JSON.stringify(logs, null, 2));
}

checkRange();
