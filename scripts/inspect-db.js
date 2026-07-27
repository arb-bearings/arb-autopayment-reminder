const fs = require('fs');
const path = require('path');
const { MongoClient } = require('mongodb');

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

    console.log('--- DB SUMMARY ---');
    console.log(`Users: ${doc.users?.length || 0}`);
    console.log(`Dues: ${doc.dueRecords?.length || 0}`);
    console.log(`Rules: ${doc.reminderRules?.length || 0}`);
    doc.reminderRules?.forEach(r => {
      console.log(`- Rule: "${r.name}" | triggerDay: ${r.triggerDay} | enabled: ${r.enabled}`);
    });
    console.log(`Templates: ${doc.templates?.length || 0}`);
    console.log(`Policies: ${doc.cashDiscountPolicies?.length || 0}`);
    console.log(`Logs: ${doc.reminderLogs?.length || 0}`);
    console.log(`Salespersons: ${doc.salespersons?.length || 0}`);
  } catch (err) {
    console.error(err);
  } finally {
    await client.close();
  }
}

main();
