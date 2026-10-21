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

async function inspectDealers() {
  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  const db = client.db(DB_NAME);
  const col = db.collection('app_state');
  const doc = await col.findOne({ _id: 'primary' });

  const dues = doc.dueRecords || [];
  const contacts = doc.masterContacts || [];

  // Group dues by dealer code / customer code
  const dealerMap = new Map();
  for (const d of dues) {
    const code = (d.dealerCode || d.customerCode || '').trim();
    if (!code) continue;
    if (!dealerMap.has(code)) dealerMap.set(code, []);
    dealerMap.get(code).push(d);
  }

  console.log(`Found ${dealerMap.size} unique dealers with dues.`);
  const sampleDealers = Array.from(dealerMap.entries()).slice(0, 7);
  
  sampleDealers.forEach(([code, invs], idx) => {
    const contact = contacts.find(c => (c.dealerCode || c.customerCode || '').trim() === code);
    const total = invs.reduce((sum, i) => sum + (i.amount || 0), 0);
    console.log(`\nDealer ${idx+1}: Code=${code} | ContactName=${contact?.dealerName || invs[0]?.companyName} | ContactEmail=${contact?.email} | InvoicesCount=${invs.length} | TotalAmount=Rs. ${total}`);
    invs.forEach(inv => {
      console.log(`  - Inv: ${inv.invoiceNumber} | BillDate: ${inv.billDate} | Amount: ${inv.amount}`);
    });
  });

  await client.close();
}

inspectDealers().catch(console.error);
