const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

function loadEnv() {
  // Prefer Next.js-style local env file first.
  const candidates = ['.env.local', '.env'];
  for (const file of candidates) {
    const envPath = path.join(process.cwd(), file);
    if (fs.existsSync(envPath)) {
      require('dotenv').config({ path: envPath });
      return file;
    }
  }
  return null;
}

async function init() {
  const loaded = loadEnv();
  if (!process.env.DATABASE_URL) {
    const hint = loaded
      ? `Loaded ${loaded} but DATABASE_URL was missing.`
      : 'No .env.local or .env found.';
    throw new Error(
      `DATABASE_URL is required for db:init. ${hint} Create .env.local (see .env.example) and set DATABASE_URL=postgresql://...`
    );
  }
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
