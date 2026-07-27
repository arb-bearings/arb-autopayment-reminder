const fs = require('fs');
const path = require('path');
const { MongoClient } = require('mongodb');

function getBillAgeDays(billDateStr, today = new Date()) {
  const billDate = new Date(billDateStr);
  if (Number.isNaN(billDate.getTime())) {
    return null;
  }
  const diffTime = today.getTime() - billDate.getTime();
  return Math.floor(diffTime / (1000 * 60 * 60 * 24));
}

async function main() {
  const envPath = path.join(__dirname, '..', '.env.local');
  if (!fs.existsSync(envPath)) {
    console.error('.env.local file not found');
    process.exit(1);
  }

  const envContent = fs.readFileSync(envPath, 'utf8');
  const env = {};
  envContent.split('\n').forEach(line => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const match = trimmed.match(/^([^=]+)=(.*)$/);
    if (match) {
      env[match[1].trim()] = match[2].trim();
    }
  });

  const uri = env.MONGODB_URI;
  const dbName = env.MONGODB_DB || 'auto-payment-reminder';
  const collectionName = env.MONGODB_COLLECTION || 'app_state';

  const client = new MongoClient(uri);
  try {
    await client.connect();
    const db = client.db(dbName);
    const collection = db.collection(collectionName);
    const doc = await collection.findOne({ _id: 'primary' });
    if (!doc) {
      console.log('No database document found.');
      return;
    }

    console.log('--- DUE RECORDS IN DB ---');
    console.log(`Total dues: ${doc.dueRecords?.length || 0}`);
    const today = new Date();
    doc.dueRecords?.forEach(d => {
      const age = getBillAgeDays(d.billDate || d.invoiceDate, today);
      console.log(`- Dealer: ${d.companyName} | Code: ${d.dealerCode} | Bill Date: ${d.billDate || d.invoiceDate} | Age: ${age} days | Amount: ${d.amount} | Salesperson: ${d.salespersonName}`);
    });
  } catch (err) {
    console.error(err);
  } finally {
    await client.close();
  }
}

main();
