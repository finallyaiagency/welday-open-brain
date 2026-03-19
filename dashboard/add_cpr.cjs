const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '../.env' });

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

async function addEvent() {
  const { data, error } = await supabase.from('calendar_events').insert({
    title: 'CPR class at the yacht club',
    start_at: '2026-03-21T09:00:00-04:00',
    end_at: '2026-03-21T17:00:00-04:00',
    source: 'system',
    event_type: 'personal',
    life_domain: 'unknown',
    status: 'confirmed',
    google_calendar_id: 'weldayenterprises@gmail.com'
  });
  console.log(error ? error : 'Success');
}
addEvent();
