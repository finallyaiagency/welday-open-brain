/**
 * Test 01: DB Connectivity & Table Structure
 * Verifies all required Supabase tables are accessible.
 */
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function test() {
  console.log('=== Test 01: DB Connectivity ===\n');

  const tables = [
    'gtd_inbox', 'gtd_actions', 'gtd_projects', 'gtd_someday',
    'gtd_reference', 'calendar_events', 'ventures', 'agent_logs',
    'bots', 'bot_sessions', 'bot_messages', 'bot_memory',
    'ceo_recommendations', 'business_memory', 'contacts',
    'financial_entries', 'saved_dashboards', 'schema_changelog'
  ];

  let passed = 0;
  let failed = 0;

  for (const table of tables) {
    const { data, error } = await supabase.from(table).select('id').limit(1);
    if (error) {
      console.error(`  FAIL: ${table} — ${error.message}`);
      failed++;
    } else {
      console.log(`  OK:   ${table} (${data.length} sample rows)`);
      passed++;
    }
  }

  console.log(`\n--- Results: ${passed} passed, ${failed} failed out of ${tables.length} tables ---`);
  process.exit(failed > 0 ? 1 : 0);
}

test().catch(err => { console.error('Fatal:', err); process.exit(1); });
