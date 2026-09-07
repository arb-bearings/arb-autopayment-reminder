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
      console.error('No database document found.');
      return;
    }

    let modifiedCount = 0;
    const updatedRules = (doc.reminderRules || []).map(rule => {
      if (rule.triggerDay === 30 || rule.triggerDay === 45) {
        modifiedCount++;
        return {
          ...rule,
          enabled: false,
          updatedAt: new Date().toISOString()
        };
      }
      return rule;
    });

    await collection.updateOne({ _id: 'primary' }, {
      $set: { reminderRules: updatedRules }
    });

    console.log(`✅ Successfully paused ${modifiedCount} rules (30-day / 35-day CD & 45-day CD rules).`);
  } catch (err) {
    console.error('Error updating rules:', err);
  } finally {
    await client.close();
  }
}

main();
