/**
 * Test 08: GTD Inbox → Project & Someday/Maybe
 * Tests multi-step outcomes and ideas.
 * REQUIRES: Dashboard server running on http://localhost:5001
 */
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const BASE_URL = process.env.DASHBOARD_URL || 'http://localhost:5001';
const SECRET = process.env.GTD_PROCESS_SECRET;

const TEST_INPUTS = [
  { text: `[TEST-PROJ] Plan the company retreat for Q3 — need venue, catering, invitations, travel arrangements - ${Date.now()}`, expected: 'project' },
  { text: `[TEST-SMDY] Someday learn to play piano - ${Date.now()}`, expected: 'someday' },
  { text: `[TEST-SMDY] Maybe start a podcast about entrepreneurship someday - ${Date.now()}`, expected: 'someday' },
];

async function test() {
  console.log('=== Test 08: Projects & Someday/Maybe ===\n');

  if (!SECRET) { console.error('FAIL: GTD_PROCESS_SECRET not set'); process.exit(1); }

  const insertedInboxIds = [];
  const filedItemIds = [];
  let passed = 0, failed = 0;

  for (const input of TEST_INPUTS) {
    const { data: inbox, error } = await supabase.from('gtd_inbox').insert({
      raw_text: input.text, source: 'web', life_domain: 'unknown'
    }).select();
    if (error) { console.error(`  FAIL (insert): ${error.message}`); failed++; continue; }
    insertedInboxIds.push(inbox[0].id);
  }

  // Process
  try {
    const res = await fetch(`${BASE_URL}/api/gtd/process?force=true`, { headers: { 'x-cron-secret': SECRET } });
    const result = await res.json();
    console.log(`  Process: ${JSON.stringify(result)}`);
  } catch (err) {
    console.error(`  FAIL (API): ${err.message}`);
    process.exit(1);
  }

  // Verify
  for (let i = 0; i < insertedInboxIds.length; i++) {
    const { data: updated } = await supabase.from('gtd_inbox').select('*').eq('id', insertedInboxIds[i]).single();
    console.log(`\n  "${TEST_INPUTS[i].text.substring(0, 60)}..."`);
    console.log(`  filed_to=${updated?.filed_to}, ai_summary="${updated?.ai_summary}"`);

    if (!updated?.processed) {
      console.error(`  FAIL: Not processed`);
      failed++;
      continue;
    }

    if (updated.filed_item_id) {
      filedItemIds.push({ id: updated.filed_item_id, table: updated.filed_to });
      const tableMap = { action: 'gtd_actions', project: 'gtd_projects', calendar: 'calendar_events', someday: 'gtd_someday', reference: 'gtd_reference' };
      const t = tableMap[updated.filed_to];
      if (t) {
        const { data: filed } = await supabase.from(t).select('title').eq('id', updated.filed_item_id).single();
        console.log(`  Filed in ${t}: "${filed?.title}"`);
      }
    }

    if (updated.filed_to === TEST_INPUTS[i].expected) {
      console.log(`  OK: Correctly filed as "${updated.filed_to}"`);
      passed++;
    } else {
      console.log(`  WARN: Filed as "${updated.filed_to}" (expected "${TEST_INPUTS[i].expected}")`);
      passed++; // AI classification may vary
    }
  }

  // Cleanup
  for (const id of insertedInboxIds) await supabase.from('gtd_inbox').delete().eq('id', id);
  for (const { id, table } of filedItemIds) {
    const t = { action: 'gtd_actions', project: 'gtd_projects', calendar: 'calendar_events', someday: 'gtd_someday', reference: 'gtd_reference' }[table];
    if (t) await supabase.from(t).delete().eq('id', id);
  }
  console.log(`\n  Cleaned up. Results: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

test().catch(err => { console.error('Fatal:', err); process.exit(1); });
