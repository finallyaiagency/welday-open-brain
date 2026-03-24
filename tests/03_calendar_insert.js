/**
 * Test 03: Calendar Event Insertion — Direct DB
 * Tests all calendar_events insert patterns used in the codebase.
 * This is the primary test for the user's reported calendar creation bug.
 */
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function test() {
  console.log('=== Test 03: Calendar Event Insertion ===\n');

  const tomorrow = new Date(Date.now() + 86400000);
  const endTime = new Date(tomorrow.getTime() + 3600000);
  const insertedIds = [];
  let passed = 0;
  let failed = 0;

  // Test A: Pattern from gtd-filer.js agent
  console.log('  [A] Testing gtd-filer.js pattern...');
  const { data: dA, error: eA } = await supabase.from('calendar_events').insert({
    title: '[TEST] Calendar - gtd-filer pattern',
    description: 'Test summary\n\nOriginal inbox text here',
    start_at: tomorrow.toISOString(),
    end_at: endTime.toISOString(),
    source: 'system',
    event_type: 'personal',
    life_domain: 'unknown',
    status: 'confirmed',
    google_calendar_id: 'weldayenterprises@gmail.com'
  }).select('id');
  if (eA) {
    console.error(`  FAIL [A]: ${eA.message}`);
    if (eA.details) console.error(`        details: ${eA.details}`);
    if (eA.hint) console.error(`        hint: ${eA.hint}`);
    failed++;
  } else {
    console.log(`  OK   [A]: id=${dA[0].id}`);
    insertedIds.push(dA[0].id);
    passed++;
  }

  // Test B: Pattern from routes.ts fileInboxItem
  console.log('  [B] Testing routes.ts fileInboxItem pattern...');
  const { data: dB, error: eB } = await supabase.from('calendar_events').insert({
    title: '[TEST] Calendar - routes.ts pattern',
    description: 'Classification summary\\nOriginal inbox text',
    start_at: tomorrow.toISOString(),
    end_at: endTime.toISOString(),
    source: 'system',
    event_type: 'work',
    life_domain: 'business',
    status: 'confirmed',
    google_calendar_id: 'weldayenterprises@gmail.com'
  }).select('id');
  if (eB) {
    console.error(`  FAIL [B]: ${eB.message}`);
    if (eB.details) console.error(`        details: ${eB.details}`);
    failed++;
  } else {
    console.log(`  OK   [B]: id=${dB[0].id}`);
    insertedIds.push(dB[0].id);
    passed++;
  }

  // Test C: Manual source (dashboard / user-created)
  console.log('  [C] Testing manual source...');
  const { data: dC, error: eC } = await supabase.from('calendar_events').insert({
    title: '[TEST] Calendar - manual source',
    start_at: tomorrow.toISOString(),
    source: 'manual',
    event_type: 'personal',
    life_domain: 'personal',
    status: 'confirmed'
  }).select('id');
  if (eC) {
    console.error(`  FAIL [C]: ${eC.message}`);
    if (eC.details) console.error(`        details: ${eC.details}`);
    failed++;
  } else {
    console.log(`  OK   [C]: id=${dC[0].id}`);
    insertedIds.push(dC[0].id);
    passed++;
  }

  // Test D: Without life_domain (what old gtd-filer.js does if column has no default)
  console.log('  [D] Testing without life_domain...');
  const { data: dD, error: eD } = await supabase.from('calendar_events').insert({
    title: '[TEST] Calendar - no life_domain',
    start_at: tomorrow.toISOString(),
    end_at: endTime.toISOString(),
    source: 'system',
    event_type: 'personal',
    status: 'confirmed'
  }).select('id');
  if (eD) {
    console.error(`  FAIL [D]: ${eD.message}`);
    if (eD.details) console.error(`        details: ${eD.details}`);
    failed++;
  } else {
    console.log(`  OK   [D]: id=${dD[0].id}`);
    insertedIds.push(dD[0].id);
    passed++;
  }

  // Test E: All valid source values for calendar_events
  console.log('  [E] Testing all calendar source values...');
  const calendarSources = ['manual', 'google', 'telegram', 'telegram_smithers', 'telegram_moneypenny',
    'telegram_burns', 'dashboard_chat', 'web', 'api', 'ceo_agent', 'email', 'system'];
  for (const src of calendarSources) {
    const { data, error } = await supabase.from('calendar_events').insert({
      title: `[TEST] Calendar source=${src}`,
      start_at: tomorrow.toISOString(),
      source: src,
      event_type: 'personal',
      life_domain: 'unknown',
      status: 'confirmed'
    }).select('id');
    if (error) {
      console.error(`  FAIL [E] source="${src}": ${error.message}`);
      failed++;
    } else {
      console.log(`  OK   [E] source="${src}"`);
      insertedIds.push(data[0].id);
      passed++;
    }
  }

  // Cleanup
  if (insertedIds.length > 0) {
    await supabase.from('calendar_events').delete().in('id', insertedIds);
    console.log(`\n  Cleaned up ${insertedIds.length} test events.`);
  }

  console.log(`\n--- Results: ${passed} passed, ${failed} failed ---`);
  process.exit(failed > 0 ? 1 : 0);
}

test().catch(err => { console.error('Fatal:', err); process.exit(1); });
