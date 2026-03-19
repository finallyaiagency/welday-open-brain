
const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');
dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function main() {
  const text = "Set appointment sell fishing kayak tomorrow morning 9 AM to 12 PM. not put in calendar after processing";
  const { data, error } = await supabase
    .from('gtd_inbox')
    .insert({
      raw_text: text,
      source: 'assistant',
      life_domain: 'personal'
    })
    .select();

  if (error) {
    console.error('Error inserting item:', error);
    process.exit(1);
  }

  console.log('Successfully inserted into inbox:', data[0].id);
}

main();
