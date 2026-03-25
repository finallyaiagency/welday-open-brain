import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config({ path: '../.env' });

const { Client } = pg;

async function checkTable() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: {
      rejectUnauthorized: false
    }
  });

  try {
    await client.connect();
    const res = await client.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'brain_heartbeat'
    `);
    console.log(JSON.stringify(res.rows, null, 2));

    const res2 = await client.query(`
      SELECT tablename FROM pg_catalog.pg_tables WHERE schemaname = 'public'
    `);
    console.log('Available tables:');
    console.log(res2.rows.map(r => r.tablename).join(', '));

  } catch (err) {
    console.error('Error checking table:', err);
  } finally {
    await client.end();
  }
}

checkTable();
