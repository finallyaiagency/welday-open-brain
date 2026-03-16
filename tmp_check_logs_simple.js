
const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

async function check() {
  const target = `${URL}/rest/v1/agent_logs?select=agent_name,action,input_summary,output_summary,created_at&order=created_at.desc&limit=5`;
  console.log("Fetching logs from:", target);
  
  const resp = await fetch(target, {
    headers: {
      'apikey': KEY,
      'Authorization': `Bearer ${KEY}`
    }
  });
  
  if (!resp.ok) {
    console.error("Error:", resp.status, await resp.text());
    return;
  }
  
  const data = await resp.json();
  console.log(JSON.stringify(data, null, 2));
}

check().catch(console.error);
