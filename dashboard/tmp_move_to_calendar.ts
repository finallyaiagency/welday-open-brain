
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function main() {
  // Find the last inbox item
  const { data: inbox } = await supabase
    .from('gtd_inbox')
    .select('*')
    .ilike('raw_text', '%sell fishing kayak%')
    .order('created_at', { ascending: false })
    .limit(1);

  if (!inbox || inbox.length === 0) {
    console.error('Inbox item not found');
    return;
  }

  const item = inbox[0];
  console.log('Found inbox item:', item.id);

  if (item.filed_to === 'action') {
    console.log('Removing misfiled action task:', item.filed_item_id);
    await supabase.from('gtd_actions').delete().eq('id', item.filed_item_id);
  }

  console.log('Scheduling in Calendar as requested...');
  // Tomorrow 9 AM to 12 PM in Eastern Time (-04:00)
  const startAt = "2026-03-20T13:00:00Z"; // 9 AM EST
  const endAt = "2026-03-20T16:00:00Z";   // 12 PM EST

  const { data: event, error: eventError } = await supabase.from('calendar_events').insert({
    title: "Sell fishing kayak",
    description: "Meeting to sell fishing kayak. \nOriginal text: " + item.raw_text,
    start_at: startAt,
    end_at: endAt,
    event_type: "personal",
    life_domain: "personal",
    source: "dashboard_chat",
    status: "confirmed",
    google_calendar_id: "weldayenterprises@gmail.com"
  }).select().single();

  if (eventError) {
    console.error('Error creating calendar event:', eventError);
    return;
  }

  console.log('Updating inbox status with new calendar event ID:', event.id);
  await supabase.from('gtd_inbox').update({
    processed: true,
    processed_at: new Date().toISOString(),
    filed_to: 'calendar',
    filed_item_id: event.id,
    ai_summary: "Sell fishing kayak tomorrow 9AM-12PM"
  }).eq('id', item.id);

  console.log('Success.');
}

main();
