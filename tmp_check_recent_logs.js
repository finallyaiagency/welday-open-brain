
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

async function checkRecentLogs() {
  const { data: logs, error } = await supabase
    .from('agent_logs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(10);

  if (error) {
    console.error("Error fetching logs:", error);
    process.exit(1);
  }

  console.log(JSON.stringify(logs, null, 2));
}

checkRecentLogs();
