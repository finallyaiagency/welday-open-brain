/**
 * Test 02: Inbox Insertion — All Source Types
 * Verifies that inbox items can be inserted with all valid source values.
 */
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function test() {
  console.log('=== Test 02: Inbox Source Constraint ===\n');

  const sources = [
    'telegram', 'telegram_smithers', 'telegram_moneypenny',
    'telegram_burns', 'web', 'api', 'ceo_agent', 'email'
  ];
  const insertedIds = [];
  let passed = 0;
  let failed = 0;

  for (const source of sources) {
    const { data, error } = await supabase.from('gtd_inbox').insert({
      raw_text: `[TEST] Source constraint test: ${source} at ${new Date().toISOString()}`,
      source,
      life_domain: 'unknown'
    }).select('id');

    if (error) {
      console.error(`  FAIL source="${source}": ${error.message}`);
      if (error.details) console.error(`        details: ${error.details}`);
      failed++;
    } else {
      console.log(`  OK   source="${source}": id=${data[0].id}`);
      insertedIds.push(data[0].id);
      passed++;
    }
  }

  // Cleanup
  if (insertedIds.length > 0) {
    await supabase.from('gtd_inbox').delete().in('id', insertedIds);
    console.log(`\n  Cleaned up ${insertedIds.length} test rows.`);
  }

  console.log(`\n--- Results: ${passed} passed, ${failed} failed out of ${sources.length} sources ---`);
  process.exit(failed > 0 ? 1 : 0);
}

test().catch(err => { console.error('Fatal:', err); process.exit(1); });
