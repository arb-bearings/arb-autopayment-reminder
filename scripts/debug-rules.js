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

    const user = doc.users.find(u => u.email === 'amankumarschool7@gmail.com');
    const ownerId = user.id;

    console.log(`User ID: ${ownerId}`);
    const rules = doc.reminderRules?.filter(r => r.ownerId === ownerId);
    console.log(`Total rules for user: ${rules?.length || 0}`);
    rules?.forEach(r => {
      console.log(`- Rule: "${r.name}", Trigger: ${r.triggerDay}, Enabled: ${r.enabled}`);
    });
  } catch (err) {
    console.error('Error:', err);
  } finally {
    await client.close();
  }
}

main();
