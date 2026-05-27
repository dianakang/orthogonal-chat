const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

async function init() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  try {
    await pool.query(schema);
    console.log('Database schema initialized successfully.');
  } finally {
    await pool.end();
  }
}

init().catch((err) => {
  console.error('Failed to initialize database:', err.message);
  process.exit(1);
});
