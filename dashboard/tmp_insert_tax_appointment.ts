import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function main() {
  const text = "Set an appointment for today 3 to 5 help Colleen with taxes";
  
  // Create Inbox Item
  const { data: inbox, error: inboxError } = await supabase
    .from('gtd_inbox')
    .insert({
      raw_text: text,
      source: 'web',
      life_domain: 'personal',
      processed: true,
      processed_at: new Date().toISOString(),
      filed_to: 'calendar',
      ai_summary: "Help Colleen with taxes today 3-5 PM"
    })
    .select()
    .single();

  if (inboxError) {
    console.error('Error inserting inbox item:', inboxError);
    return;
  }
  
  console.log('Successfully inserted into inbox:', inbox.id);

  // Today 3 PM to 5 PM EDT (-04:00) -> 19:00 to 21:00 UTC
  const startAt = "2026-03-19T19:00:00Z";
  const endAt = "2026-03-19T21:00:00Z";

  const { data: event, error: eventError } = await supabase.from('calendar_events').insert({
    title: "Help Colleen with taxes",
    description: "Meeting to help Colleen with taxes. \nOriginal text: " + text,
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

  console.log('Successfully scheduled calendar event:', event.id);

  // Update inbox with calendar event id
  await supabase.from('gtd_inbox').update({
    filed_item_id: event.id
  }).eq('id', inbox.id);

  console.log('Updated inbox item with filed_item_id');
}

main();
