/**
 * Test 09: Dashboard Chat — Bot Interaction
 * Verifies /api/ea/chat works for both smithers and moneypenny.
 * REQUIRES: Dashboard server running on http://localhost:5001
 */
require('dotenv').config();

const BASE_URL = process.env.DASHBOARD_URL || 'http://localhost:5001';

async function test() {
  console.log('=== Test 09: Chat Bot Interaction ===\n');

  const personas = ['smithers', 'moneypenny'];
  let passed = 0, failed = 0;

  for (const persona of personas) {
    console.log(`  Testing persona: ${persona}`);
    try {
      const res = await fetch(`${BASE_URL}/api/ea/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: 'What should I focus on right now?',
          persona,
          history: []
        })
      });

      if (!res.ok) {
        const text = await res.text();
        console.error(`  FAIL ${persona}: HTTP ${res.status} — ${text.substring(0, 200)}`);
        failed++;
        continue;
      }

      const data = await res.json();
      if (data.reply && data.reply.trim().length > 0) {
        console.log(`  OK ${persona}: "${data.reply.substring(0, 150)}..."`);
        console.log(`  Reply length: ${data.reply.length} chars`);
        passed++;
      } else {
        console.error(`  FAIL ${persona}: Empty reply`);
        failed++;
      }
    } catch (err) {
      console.error(`  FAIL ${persona}: ${err.message}`);
      console.log('  NOTE: Is the dashboard server running? Try: cd dashboard && npm run dev');
      failed++;
    }
  }

  // Test briefing endpoint
  console.log(`\n  Testing briefing endpoint...`);
  try {
    const res = await fetch(`${BASE_URL}/api/ea/briefing`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    if (!res.ok) {
      console.error(`  FAIL briefing: HTTP ${res.status}`);
      failed++;
    } else {
      const data = await res.json();
      console.log(`  OK briefing: "${(data.briefing || '').substring(0, 150)}..."`);
      passed++;
    }
  } catch (err) {
    console.error(`  FAIL briefing: ${err.message}`);
    failed++;
  }

  console.log(`\n--- Results: ${passed} passed, ${failed} failed ---`);
  process.exit(failed > 0 ? 1 : 0);
}

test().catch(err => { console.error('Fatal:', err); process.exit(1); });
