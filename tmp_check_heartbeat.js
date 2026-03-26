
const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.join(__dirname, '.env') });

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;

if (!url || !key) {
  process.exit(1);
}

const supabase = createClient(url, key);

async function checkHeartbeat() {
  const { data, error } = await supabase
    .from('brain_heartbeat')
    .select('*');

  if (error) {
    process.exit(1);
  }

  console.log(JSON.stringify(data, null, 2));
}

checkHeartbeat();
