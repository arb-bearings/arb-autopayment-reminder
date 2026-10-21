const { MongoClient } = require('mongodb');
const fs = require('fs');
const path = require('path');

// Load .env.local if present
const envPath = path.resolve(process.cwd(), '.env.local');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx !== -1) {
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim();
      if (!process.env[key]) process.env[key] = val;
    }
  }
}

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  console.error("Missing MONGODB_URI in environment");
  process.exit(1);
}
const DB_NAME = process.env.MONGODB_DB || "auto-payment-reminder";

async function run() {
  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  const db = client.db(DB_NAME);
  const col = db.collection('app_state');
  const doc = await col.findOne({ _id: 'primary' });

  console.log("=== USERS in app_state ===");
  (doc.users || []).forEach(u => {
    console.log(`- ID: ${u.id} | Email: ${u.email} | Name: ${u.name} | Role: ${u.role} | Company: ${u.companyName}`);
  });

  console.log("\n=== DISPATCH SETTINGS in app_state ===");
  (doc.dispatchSettings || []).forEach(d => {
    console.log(`- OwnerId: ${d.ownerId} | EmailEnabled: ${d.emailEnabled} | ManagerEmailEnabled: ${d.managerEmailEnabled} | Threshold: ${d.thresholdAmount}`);
  });

  await client.close();
}

run().catch(console.error);
