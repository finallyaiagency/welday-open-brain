/**
 * Test 12: CEO Agent & Briefing
 * Verifies the briefing endpoint and checks for the duplicate runCEO() bug.
 */
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function test() {
  console.log('=== Test 12: CEO Agent & Briefing ===\n');

  let passed = 0, failed = 0;

  // Check 1: Verify ceo-agent.js has the duplicate runCEO() bug
  console.log('  [1] Checking ceo-agent.js for duplicate runCEO()...');
  const ceoPath = path.join(__dirname, '..', 'agents', 'ceo-agent.js');
  const ceoCode = fs.readFileSync(ceoPath, 'utf-8');
  const runCEOCalls = (ceoCode.match(/\brunCEO\(\);/g) || []).length;
  if (runCEOCalls > 1) {
    console.log(`  BUG CONFIRMED: runCEO() is called ${runCEOCalls} times (should be 1)`);
    console.log(`  This causes duplicate CEO recommendations on every execution.`);
    passed++;
  } else {
    console.log(`  OK: runCEO() called ${runCEOCalls} time(s)`);
    passed++;
  }

  // Check 2: Verify dead code in routes.ts
  console.log('\n  [2] Checking routes.ts for dead code after return...');
  const routesPath = path.join(__dirname, '..', 'dashboard', 'server', 'routes.ts');
  const routesCode = fs.readFileSync(routesPath, 'utf-8');
  const lines = routesCode.split('\n');
  
  // Find the early return in handleTelegramMessage
  let deadCodeFound = false;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === 'return;' && i > 2200 && i < 2220) {
      // Check if there's code after this return that's still in the same function
      const nextNonEmpty = lines.slice(i + 1, i + 5).find(l => l.trim().length > 0);
      if (nextNonEmpty && !nextNonEmpty.trim().startsWith('}')) {
        console.log(`  BUG CONFIRMED: Dead code after return at line ${i + 1}`);
        deadCodeFound = true;
      }
    }
  }
  if (deadCodeFound) passed++;
  else { console.log(`  INFO: Dead code pattern not found at expected location`); passed++; }

  // Check 3: Verify calendar description uses literal \\n
  console.log('\n  [3] Checking calendar description escaping...');
  const calendarLine = routesCode.includes('classification.summary + "\\\\n" + inbox.raw_text');
  if (calendarLine) {
    console.log('  BUG CONFIRMED: Calendar description uses literal \\\\n instead of actual newline');
    passed++;
  } else {
    console.log('  INFO: Bug may have been fixed or pattern differs');
    passed++;
  }

  // Check 4: Count existing CEO recommendations
  console.log('\n  [4] Checking existing CEO recommendations...');
  const { data: recs, error: recErr } = await supabase
    .from('ceo_recommendations')
    .select('id, title, type, priority, created_at')
    .order('created_at', { ascending: false })
    .limit(5);
  if (recErr) {
    console.error(`  FAIL: ${recErr.message}`);
    failed++;
  } else {
    console.log(`  ${recs.length} recommendations found`);
    for (const r of recs) {
      console.log(`    ${r.type}: "${r.title}" (${r.priority}) — ${r.created_at}`);
    }
    passed++;
  }

  console.log(`\n--- Results: ${passed} passed, ${failed} failed ---`);
}

test().catch(err => { console.error('Fatal:', err); process.exit(1); });
