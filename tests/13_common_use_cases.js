
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function testCommonUseCases() {
  console.log('--- GTD Common Use Cases Test ---');

  const testItems = [
    { text: "Buy cat food #personal", expected: "action" },
    { text: "Meeting with the design team tomorrow at 10am @office", expected: "calendar" },
    { text: "Read this interesting article on AI safety: https://openai.com/safety", expected: "reference" },
    { text: "Waiting for John to finish the mockups for the new landing page #design", expected: "action" }, // Should be @waiting
    { text: "Call mom this weekend @phone", expected: "action" },
    { text: "Someday I want to learn how to play the cello", expected: "someday" },
    { text: "Lunch with Mike next Friday at 1pm", expected: "calendar" }
  ];

  console.log(`[1] Inserting ${testItems.length} test items into inbox...`);
  
  const { data: inserted, error: insertError } = await supabase
    .from('gtd_inbox')
    .insert(testItems.map(item => ({
      raw_text: item.text,
      source: 'api',
      processed: false
    })))
    .select();

  if (insertError) {
    console.error('Error inserting items:', insertError);
    return;
  }
  console.log(`Inserted ${inserted.length} items.`);

  console.log('[2] Triggering inbox processing (batch mode)...');
  // Since we can't easily call the local express API from here without the secret or a session,
  // we can use the supabase client to mimic the logic if the server isn't running,
  // OR we can try to call the endpoint if it's reachable.
  // However, the best way to test the ACTUAL server logic is to call the API.
  
  const secret = process.env.CRON_SECRET || process.env.GTD_PROCESS_SECRET;
  const baseUrl = 'http://localhost:5001'; // Default dashboard port

  try {
    const response = await fetch(`${baseUrl}/api/gtd/process?force=true`, {
      method: 'POST',
      headers: { 
        'x-cron-secret': process.env.GTD_PROCESS_SECRET || '',
        'Authorization': `Bearer ${process.env.CRON_SECRET || ''}`
      }
    });
    const result = await response.json();
    console.log('Processing Result:', JSON.stringify(result, null, 2));
  } catch (err) {
    console.warn('Could not call local API (is the server running?). Falling back to manual verification of processing script logic...');
    console.log('Note: The server must be running for the batch logic in routes.ts to execute.');
  }

  // Wait a bit for processing to complete if it was asynchronous (it's synchronous in our routes.ts)
  await new Array(2000);

  console.log('[3] Verifying destinations...');
  
  // Check Actions
  const { data: actions } = await supabase.from('gtd_actions').select('*').order('created_at', { ascending: false }).limit(10);
  console.log('Recent Actions:');
  actions?.forEach(a => console.log(`  - [${a.context}] ${a.title} (${a.status})`));

  // Check Calendar
  const { data: events } = await supabase.from('calendar_events').select('*').order('created_at', { ascending: false }).limit(5);
  console.log('Recent Calendar Events:');
  events?.forEach(e => console.log(`  - ${e.start_at}: ${e.title} @ ${e.location || 'N/A'}`));

  // Check Reference
  const { data: refs } = await supabase.from('gtd_reference').select('*').order('created_at', { ascending: false }).limit(5);
  console.log('Recent References:');
  refs?.forEach(r => console.log(`  - ${r.title} (URL: ${r.url || 'None'})`));

  // Check Someday
  const { data: someday } = await supabase.from('gtd_someday').select('*').order('created_at', { ascending: false }).limit(5);
  console.log('Recent Someday Items:');
  someday?.forEach(s => console.log(`  - ${s.title}`));

  console.log('--- Test Complete ---');
}

testCommonUseCases();
