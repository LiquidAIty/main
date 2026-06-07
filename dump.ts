import { pool } from './apps/backend/src/db/pool';
async function run() {
  try {
    const res = await pool.query('SELECT agent_io_schema FROM ag_catalog.projects WHERE id = $1', ['20ac92da-01fd-4cf6-97cc-0672421e751a']);
    console.log(JSON.stringify(res.rows[0].agent_io_schema.v3_state.decks, null, 2));
  } catch (e) {
    console.error(e);
  } finally {
    await pool.end();
  }
}
run();
