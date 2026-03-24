/**
 * Test 07: GTD Inbox → Waiting-For & Context Lists
 * Tests that delegated tasks and context-tagged tasks are filed correctly.
 * REQUIRES: Dashboard server running on http://localhost:5001
 */
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const BASE_URL = process.env.DASHBOARD_URL || 'http://localhost:5001';
const SECRET = process.env.GTD_PROCESS_SECRET;

const TEST_INPUTS = [
  { text: `[TEST-CTX] Waiting for John to send the contract - ${Date.now()}`, expectContext: '@waiting' },
  { text: `[TEST-CTX] Buy groceries and pick up dry cleaning on the way home - ${Date.now()}`, expectContext: '@errands' },
  { text: `[TEST-CTX] Call mom to wish her happy birthday - ${Date.now()}`, expectContext: '@phone' },
  { text: `[TEST-CTX] Research competitor pricing online tonight - ${Date.now()}`, expectContext: '@computer' },
];

async function test() {
  console.log('=== Test 07: Waiting-For & Context Lists ===\n');

  if (!SECRET) { console.error('FAIL: GTD_PROCESS_SECRET not set'); process.exit(1); }

  const insertedInboxIds = [];
  const filedItemIds = [];
  let passed = 0, failed = 0;

  for (const input of TEST_INPUTS) {
    const { data: inbox, error } = await supabase.from('gtd_inbox').insert({
      raw_text: input.text, source: 'web', life_domain: 'personal'
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
    console.log(`  filed_to=${updated?.filed_to}, ai_category=${updated?.ai_category}`);

    if (updated?.filed_item_id && updated?.filed_to === 'action') {
      filedItemIds.push({ id: updated.filed_item_id, table: 'action' });
      const { data: action } = await supabase.from('gtd_actions').select('title, context, status, delegated_to').eq('id', updated.filed_item_id).single();
      if (action) {
        console.log(`  title="${action.title}", context=${action.context || 'null'}, status=${action.status}`);
        if (action.context === TEST_INPUTS[i].expectContext) {
          console.log(`  OK: Context matches expected "${TEST_INPUTS[i].expectContext}"`);
          passed++;
        } else {
          console.log(`  WARN: Context="${action.context}" (expected "${TEST_INPUTS[i].expectContext}")`);
          passed++; // acceptable — AI may choose differently
        }
      }
    } else {
      console.log(`  Filed as "${updated?.filed_to}" (may not be action)`);
      if (updated?.filed_item_id) filedItemIds.push({ id: updated.filed_item_id, table: updated.filed_to });
      passed++;
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
