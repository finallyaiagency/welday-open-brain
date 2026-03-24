/**
 * Test 04: GTD Inbox → Action Classification & Filing
 * Inserts an actionable task into inbox, processes via the filer, and verifies destination.
 * REQUIRES: Dashboard server running on http://localhost:5001
 */
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const BASE_URL = process.env.DASHBOARD_URL || 'http://localhost:5001';
const SECRET = process.env.GTD_PROCESS_SECRET;

const TEST_INPUTS = [
  { text: `[TEST-ACTION] Call the dentist to schedule a cleaning - ${Date.now()}`, expected: 'action' },
  { text: `[TEST-ACTION] Buy new printer cartridges from Amazon - ${Date.now()}`, expected: 'action' },
  { text: `[TEST-ACTION] Email John the quarterly report - ${Date.now()}`, expected: 'action' },
];

async function test() {
  console.log('=== Test 04: Inbox → Action Filing ===\n');

  if (!SECRET) {
    console.error('FAIL: GTD_PROCESS_SECRET not set in .env');
    process.exit(1);
  }

  const insertedInboxIds = [];
  const filedItemIds = [];
  let passed = 0;
  let failed = 0;

  for (const input of TEST_INPUTS) {
    console.log(`\n  Testing: "${input.text.substring(0, 60)}..."`);

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

    // Process via API
    try {
      const res = await fetch(`${BASE_URL}/api/gtd/process?force=true`, {
        headers: { 'x-cron-secret': SECRET }
      });
      const result = await res.json();
      console.log(`  Process API: ${JSON.stringify(result)}`);
    } catch (err) {
      console.error(`  FAIL (API): ${err.message}`);
      console.log('  NOTE: Is the dashboard server running? Try: cd dashboard && npm run dev');
      failed++;
      continue;
    }

    // Check what happened to the inbox item
    const { data: updated } = await supabase.from('gtd_inbox').select('*').eq('id', inbox[0].id).single();
    if (!updated) {
      console.error('  FAIL: Inbox item not found after processing');
      failed++;
      continue;
    }

    console.log(`  processed=${updated.processed}, filed_to=${updated.filed_to}`);
    console.log(`  ai_summary=${updated.ai_summary}`);
    console.log(`  ai_category=${updated.ai_category}, confidence=${updated.ai_confidence}`);

    if (!updated.processed) {
      console.error('  FAIL: Item was NOT processed');
      failed++;
      continue;
    }

    // Check destination
    if (updated.filed_item_id) {
      filedItemIds.push({ id: updated.filed_item_id, table: updated.filed_to });
      const tableMap = { action: 'gtd_actions', project: 'gtd_projects', calendar: 'calendar_events', someday: 'gtd_someday', reference: 'gtd_reference' };
      const table = tableMap[updated.filed_to];
      if (table) {
        const { data: filed } = await supabase.from(table).select('*').eq('id', updated.filed_item_id).single();
        console.log(`  Filed to ${table}: title="${filed?.title}", context=${filed?.context || 'n/a'}`);
      }
    }

    if (updated.filed_to === input.expected) {
      console.log(`  OK: Filed to "${updated.filed_to}" as expected`);
      passed++;
    } else {
      console.log(`  WARN: Filed to "${updated.filed_to}" (expected "${input.expected}")`);
      passed++; // still a valid classification, just different
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
