import pkg from 'pg';
const { Client } = pkg;
import dotenv from "dotenv";

dotenv.config({ path: "dashboard/.env" });

const client = new Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function checkSchema() {
  await client.connect();
  const res = await client.query(`
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE table_schema = 'public' 
      AND table_name = 'schema_changelog'
    ORDER BY column_name;
  `);
  console.log("Columns in schema_changelog:");
  res.rows.forEach(row => console.log(`- ${row.column_name}`));
  await client.end();
}

checkSchema().catch(console.error);
