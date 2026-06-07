import { Client } from 'pg';
import fs from 'fs';

async function run() {
  const client = new Client({
    host: 'localhost',
    port: 5433,
    database: 'liquidaity',
    user: 'liquidaity-user',
    password: 'LiquidAIty',
  });
  await client.connect();
  try {
    const res = await client.query('SELECT agent_io_schema FROM ag_catalog.projects WHERE id = $1', ['20ac92da-01fd-4cf6-97cc-0672421e751a']);
    const decks = res.rows[0].agent_io_schema.v3_state.decks;
    fs.writeFileSync('deck_dump.json', JSON.stringify(decks, null, 2));
  } catch (e) {
    console.error(e);
  } finally {
    await client.end();
  }
}
run();
