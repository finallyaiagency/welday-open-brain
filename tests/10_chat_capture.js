/**
 * Test 10: Chat Capture — "Add X to inbox" via Chat
 * Verifies that chat capture intent creates inbox items.
 * REQUIRES: Dashboard server running on http://localhost:5001
 */
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const BASE_URL = process.env.DASHBOARD_URL || 'http://localhost:5001';

async function test() {
  console.log('=== Test 10: Chat Capture to Inbox ===\n');

  const captureText = `Pick up dry cleaning tomorrow - TEST-CAPTURE-${Date.now()}`;
  let passed = 0, failed = 0;

  // Send capture via chat
  console.log(`  Sending: "add ${captureText}"`);
  try {
    const res = await fetch(`${BASE_URL}/api/ea/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: `add ${captureText}`,
        persona: 'smithers',
        history: []
      })
    });

    if (!res.ok) {
      console.error(`  FAIL: HTTP ${res.status} — ${await res.text()}`);
      failed++;
    } else {
      const data = await res.json();
      console.log(`  Chat reply: "${data.reply?.substring(0, 150)}"`);
    }
  } catch (err) {
    console.error(`  FAIL (API): ${err.message}`);
    failed++;
  }

  // Wait a moment for async insert
  await new Promise(r => setTimeout(r, 2000));

  // Check inbox for the captured text
  const { data: inboxItems } = await supabase
    .from('gtd_inbox')
    .select('id, raw_text, source, processed')
    .ilike('raw_text', `%TEST-CAPTURE-${captureText.split('TEST-CAPTURE-')[1]}%`)
    .limit(5);

  if (inboxItems && inboxItems.length > 0) {
    console.log(`\n  OK: Found ${inboxItems.length} inbox item(s):`);
    for (const item of inboxItems) {
      console.log(`    id=${item.id}, source=${item.source}, processed=${item.processed}`);
      console.log(`    raw_text="${item.raw_text.substring(0, 80)}"`);
    }
    passed++;

    // Cleanup
    const ids = inboxItems.map(i => i.id);
    await supabase.from('gtd_inbox').delete().in('id', ids);
    console.log(`\n  Cleaned up ${ids.length} test inbox items.`);
  } else {
    console.error(`\n  FAIL: No inbox item found with capture text`);
    failed++;
  }

  console.log(`\n--- Results: ${passed} passed, ${failed} failed ---`);
  process.exit(failed > 0 ? 1 : 0);
}

test().catch(err => { console.error('Fatal:', err); process.exit(1); });
