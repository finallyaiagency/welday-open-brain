const { Client } = require('./dashboard/node_modules/pg');
const fs = require('fs');
const dotenv = require('./dashboard/node_modules/dotenv');

dotenv.config({ path: 'dashboard/.env' });

const client = new Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function addColumn() {
  await client.connect();
  console.log("Checking if rationale column exists...");
  const res = await client.query(`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public' 
      AND table_name = 'schema_changelog'
      AND column_name = 'rationale';
  `);

  if (res.rowCount === 0) {
    console.log("Adding rationale column to schema_changelog...");
    await client.query(`ALTER TABLE public.schema_changelog ADD COLUMN rationale TEXT;`);
    console.log("Successfully added column!");
  } else {
    console.log("Column already exists.");
  }
  await client.end();
}

addColumn().catch(console.error);
