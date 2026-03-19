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

  const { data: inbox, error: inboxError } = await supabase
    .from('gtd_inbox')
    .select('*')
    .ilike('raw_text', '%appointment%')
    .order('created_at', { ascending: false })
    .limit(5);

  result.inbox = inboxError ? { error: inboxError } : inbox;

  const { data: logs, error: logsError } = await supabase
    .from('agent_logs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(10);

  result.logs = logsError ? { error: logsError } : logs;

  const { data: events, error: eventsError } = await supabase
    .from('calendar_events')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(5);

  result.events = eventsError ? { error: eventsError } : events;

  fs.writeFileSync('db_check_output.json', JSON.stringify(result, null, 2));
  console.log('Done.');
}

check();
