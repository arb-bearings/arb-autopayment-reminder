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

  if (!doc) {
    console.log("No primary app_state doc found!");
    await client.close();
    return;
  }

  console.log("=== SALESPERSONS (MANAGERS) in app_state ===");
  const salespersons = doc.salespersons || [];
  console.log(`Found ${salespersons.length} managers:`);
  salespersons.forEach(m => {
    console.log(`- ID: ${m.id} | Name: ${m.name} | Email: ${m.email} | EmpId: ${m.employeeId} | OwnerId: ${m.ownerId} | DealerCodes (${m.dealerCodes?.length || 0}):`, m.dealerCodes);
  });

  console.log("\n=== MASTER CONTACTS (DEALERS) SAMPLE ===");
  const contacts = doc.masterContacts || [];
  console.log(`Total master contacts: ${contacts.length}`);
  contacts.slice(0, 10).forEach(c => {
    console.log(`- Code: ${c.dealerCode} | Name: ${c.dealerName} | Email: ${c.email} | Phone: ${c.phone}`);
  });

  console.log("\n=== DUES SAMPLE ===");
  const dues = doc.dueRecords || [];
  console.log(`Total due records: ${dues.length}`);
  const uniqueDealersWithDues = Array.from(new Set(dues.map(d => d.customerCode)));
  console.log(`Unique customer codes with dues: ${uniqueDealersWithDues.length}`);
  console.log("Sample customer codes with dues (first 10):", uniqueDealersWithDues.slice(0, 10));

  await client.close();
}

run().catch(console.error);
