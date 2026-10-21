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

  console.log("=== SALESPERSONS (MANAGERS) ===");
  const managers = await db.collection('salespersons').find({}).toArray();
  console.log(`Found ${managers.length} managers:`);
  managers.forEach(m => {
    console.log(`- ID: ${m.id} | Name: ${m.name} | Email: ${m.email} | EmpId: ${m.employeeId} | OwnerId: ${m.ownerId} | DealerCodes count: ${m.dealerCodes?.length || 0}`);
  });

  console.log("\n=== MASTER CONTACTS (DEALERS) SAMPLE ===");
  const contacts = await db.collection('master_contacts').find({}).limit(10).toArray();
  console.log(`Sample contacts:`);
  contacts.forEach(c => {
    console.log(`- Code: ${c.dealerCode} | Name: ${c.dealerName} | Email: ${c.email} | Phone: ${c.phone}`);
  });

  console.log("\n=== DUES DEALS / DEALER CODES SAMPLE ===");
  const dues = await db.collection('dues').find({}).toArray();
  const uniqueDealersWithDues = new Set(dues.map(d => d.customerCode));
  console.log(`Total dues: ${dues.length}, Unique customer codes with dues: ${uniqueDealersWithDues.size}`);
  console.log("Sample customer codes with dues:", Array.from(uniqueDealersWithDues).slice(0, 10));

  await client.close();
}

run().catch(console.error);
