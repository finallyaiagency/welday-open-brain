const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '../.env' });
const fs = require('fs');

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase URL or Key');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function check() {
  const result = {};

  const { data: logs, error: logsError } = await supabase
    .from('agent_logs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(20);

  result.logs = logsError ? { error: logsError } : logs;

  fs.writeFileSync('db_check_output_logs.json', JSON.stringify(result, null, 2));
  console.log('Done.');
}

check();
