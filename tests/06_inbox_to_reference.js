/**
 * Test 06: GTD Inbox → Reference (Save Links & Info)
 * Tests that URLs, video links, and reference info are classified and saved correctly.
 * REQUIRES: Dashboard server running on http://localhost:5001
 */
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const BASE_URL = process.env.DASHBOARD_URL || 'http://localhost:5001';
const SECRET = process.env.GTD_PROCESS_SECRET;

const TEST_INPUTS = [
  { text: `[TEST-REF] Save this video: https://youtube.com/watch?v=abc123 — great tutorial on React hooks - ${Date.now()}`, expected: 'reference' },
  { text: `[TEST-REF] Reference: https://docs.google.com/document/d/abc — Q1 marketing strategy - ${Date.now()}`, expected: 'reference' },
  { text: `[TEST-REF] Remember: The WiFi password at the office is WeldayNet2026 - ${Date.now()}`, expected: 'reference' },
];

async function test() {
  console.log('=== Test 06: Inbox → Reference ===\n');

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
    console.log(`  processed=${updated?.processed}, filed_to=${updated?.filed_to}, ai_summary="${updated?.ai_summary}"`);

    if (updated?.filed_item_id) {
      filedItemIds.push({ id: updated.filed_item_id, table: updated.filed_to });
      if (updated.filed_to === 'reference') {
        const { data: ref } = await supabase.from('gtd_reference').select('*').eq('id', updated.filed_item_id).single();
        console.log(`  OK: title="${ref?.title}", category=${ref?.category}, url=${ref?.url || 'null'}`);
        passed++;
      } else {
        console.log(`  WARN: Filed as "${updated.filed_to}" instead of "reference"`);
        passed++;
      }
    } else {
      console.error(`  FAIL: No filed_item_id`);
      failed++;
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
