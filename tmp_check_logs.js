
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkLogs() {
  console.log("Fetching last 5 agent logs...");
  const { data, error } = await supabase
    .from('agent_logs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(5);

  if (error) {
    console.error("Error fetching logs:", error);
    return;
  }

  data.forEach((log, i) => {
    console.log(`--- Log ${i} (${log.agent_name}, ${log.action}) ---`);
    console.log(`Created: ${log.created_at}`);
    console.log(`Input: ${log.input_summary}`);
    console.log(`Output: ${log.output_summary}`);
    console.log(`Model: ${log.model_used}`);
    console.log(`Success: ${log.success}`);
    console.log("-------------------------\n");
  });
}

checkLogs().catch(console.error);
