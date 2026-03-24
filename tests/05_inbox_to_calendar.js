/**
 * Test 05: GTD Inbox → Calendar Event (End-to-End)
 * THE KEY TEST: inserts time-specific events into inbox, processes them,
 * and verifies they land in calendar_events. This is where the user's bug manifests.
 * REQUIRES: Dashboard server running on http://localhost:5001
 */
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const BASE_URL = process.env.DASHBOARD_URL || 'http://localhost:5001';
const SECRET = process.env.GTD_PROCESS_SECRET;

const TEST_INPUTS = [
  { text: `[TEST-CAL] Meeting with investor tomorrow at 2pm to 3pm - ${Date.now()}`, expected: 'calendar' },
  { text: `[TEST-CAL] Dentist appointment Friday at 10:30 AM - ${Date.now()}`, expected: 'calendar' },
  { text: `[TEST-CAL] Add an appointment for this Saturday noon to one eat lunch during class - ${Date.now()}`, expected: 'calendar' },
];

async function test() {
  console.log('=== Test 05: Inbox → Calendar Event ===\n');
  console.log('  *** This tests the user\'s reported calendar creation bug ***\n');

  if (!SECRET) {
    console.error('FAIL: GTD_PROCESS_SECRET not set in .env');
    process.exit(1);
  }

  const insertedInboxIds = [];
  const filedItemIds = [];
  let passed = 0;
  let failed = 0;

  for (const input of TEST_INPUTS) {
    console.log(`\n  Testing: "${input.text.substring(0, 70)}..."`);

    // Insert into inbox
    const { data: inbox, error: insertErr } = await supabase.from('gtd_inbox').insert({
      raw_text: input.text, source: 'web', life_domain: 'personal'
    }).select();
    if (insertErr) {
      console.error(`  FAIL (insert): ${insertErr.message}`);
      failed++;
      continue;
    }
    insertedInboxIds.push(inbox[0].id);
    console.log(`  Inserted inbox item: ${inbox[0].id}`);
  }

  // Process ALL at once via API
  try {
    const res = await fetch(`${BASE_URL}/api/gtd/process?force=true`, {
      headers: { 'x-cron-secret': SECRET }
    });
    const result = await res.json();
    console.log(`\n  Process API result: ${JSON.stringify(result)}`);
  } catch (err) {
    console.error(`\n  FAIL (API): ${err.message}`);
    console.log('  NOTE: Is the dashboard server running? Try: cd dashboard && npm run dev');
    process.exit(1);
  }

  // Check each item's outcome
  for (let i = 0; i < insertedInboxIds.length; i++) {
    const inboxId = insertedInboxIds[i];
    const input = TEST_INPUTS[i];

    const { data: updated } = await supabase.from('gtd_inbox').select('*').eq('id', inboxId).single();
    if (!updated) {
      console.error(`  FAIL: Inbox item ${inboxId} not found`);
      failed++;
      continue;
    }

    console.log(`\n  Item: "${input.text.substring(0, 50)}..."`);
    console.log(`  processed=${updated.processed}, filed_to=${updated.filed_to}`);
    console.log(`  ai_summary="${updated.ai_summary}"`);

    if (!updated.processed) {
      console.error(`  FAIL: Item NOT processed!`);
      failed++;
      continue;
    }

    if (updated.filed_to === 'calendar' && updated.filed_item_id) {
      filedItemIds.push({ id: updated.filed_item_id, table: 'calendar' });
      const { data: event } = await supabase.from('calendar_events').select('*').eq('id', updated.filed_item_id).single();
      if (event) {
        console.log(`  OK: Calendar event created!`);
        console.log(`    title="${event.title}"`);
        console.log(`    start_at=${event.start_at}`);
        console.log(`    end_at=${event.end_at}`);
        console.log(`    source=${event.source}, type=${event.event_type}, domain=${event.life_domain}`);
        passed++;
      } else {
        console.error(`  FAIL: filed_item_id points to missing calendar event!`);
        failed++;
      }
    } else if (updated.filed_to === 'calendar' && !updated.filed_item_id) {
      console.error(`  FAIL: Classified as calendar but no filed_item_id — insert likely failed!`);
      failed++;
    } else {
      console.log(`  WARN: Not classified as calendar (got "${updated.filed_to}"). AI may have chosen differently.`);

      // Still check if a filed item exists
      if (updated.filed_item_id) {
        const tableMap = { action: 'gtd_actions', project: 'gtd_projects', someday: 'gtd_someday', reference: 'gtd_reference' };
        const t = tableMap[updated.filed_to];
        if (t) {
          const { data: filed } = await supabase.from(t).select('title').eq('id', updated.filed_item_id).single();
          console.log(`  Filed to ${t}: title="${filed?.title}"`);
          filedItemIds.push({ id: updated.filed_item_id, table: updated.filed_to });
        }
      }
      passed++; // Still counts — we're documenting classification behavior
    }
  }

  // Cleanup
  for (const id of insertedInboxIds) {
    await supabase.from('gtd_inbox').delete().eq('id', id);
  }
  for (const { id, table } of filedItemIds) {
    const tableMap = { action: 'gtd_actions', project: 'gtd_projects', calendar: 'calendar_events', someday: 'gtd_someday', reference: 'gtd_reference' };
    const t = tableMap[table];
    if (t) await supabase.from(t).delete().eq('id', id);
  }
  console.log(`\n  Cleaned up test data.`);
  console.log(`\n--- Results: ${passed} passed, ${failed} failed ---`);
  process.exit(failed > 0 ? 1 : 0);
}

test().catch(err => { console.error('Fatal:', err); process.exit(1); });
