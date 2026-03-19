
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

  if (item.filed_to === 'calendar') {
    console.log('Cleaning up misfiled calendar event:', item.filed_item_id);
    await supabase.from('calendar_events').delete().eq('id', item.filed_item_id);
  }

  console.log('Creating as GTD Action instead...');
  const { data: action, error: actionError } = await supabase.from('gtd_actions').insert({
    title: "Sell fishing kayak",
    notes: item.raw_text + "\n(Requested for tomorrow 9 AM to 12 PM)",
    due_date: "2026-03-20",
    life_domain: "personal",
    energy: "medium",
    status: "active",
    source: "dashboard_chat"
  }).select().single();

  if (actionError) {
    console.error('Error creating action:', actionError);
    return;
  }

  console.log('Updating inbox status with new action ID:', action.id);
  await supabase.from('gtd_inbox').update({
    processed: true,
    processed_at: new Date().toISOString(),
    filed_to: 'action',
    filed_item_id: action.id,
    ai_summary: "Sell fishing kayak tomorrow morning"
  }).eq('id', item.id);

  console.log('Success.');
}

main();
