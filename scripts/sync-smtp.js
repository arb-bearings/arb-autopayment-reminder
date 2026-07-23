const { MongoClient } = require('mongodb');
const fs = require('fs');
const path = require('path');

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

  console.log('Connecting to MongoDB...');
  const client = new MongoClient(uri);
  try {
    await client.connect();
    const db = client.db(dbName);
    const collection = db.collection(collectionName);

    const doc = await collection.findOne({ _id: 'primary' });
    if (!doc) {
      console.error('No app state found');
      return;
    }

    const superadminOwnerId = 'aa9d888f-6438-4b27-8cf5-60261f1fb725';
    
    // Find dispatch settings for superadmin
    let superadminSettings = doc.dispatchSettings.find(s => s.ownerId === superadminOwnerId);
    if (!superadminSettings) {
      console.log('Superadmin dispatch settings not found. Creating new ones...');
      superadminSettings = { ownerId: superadminOwnerId };
      doc.dispatchSettings.push(superadminSettings);
    }

    // Set SMTP values from .env.local
    superadminSettings.smtpHost = env.SMTP_HOST || 'smtp.gmail.com';
    superadminSettings.smtpPort = parseInt(env.SMTP_PORT || '465', 10);
    superadminSettings.smtpSecure = env.SMTP_SECURE === 'true';
    superadminSettings.smtpUser = env.SMTP_USER || 'amankumarschool7@gmail.com';
    superadminSettings.smtpPass = env.SMTP_PASS || 'ivcj wsvi mvbs qzni';
    superadminSettings.senderEmail = env.SMTP_FROM || 'amankumarschool7@gmail.com';
    superadminSettings.smtpFrom = env.SMTP_FROM || 'amankumarschool7@gmail.com';
    superadminSettings.reportRecipients = [ 'amankumarschool7@gmail.com' ];

    console.log('Updating superadmin dispatch settings in MongoDB...');
    await collection.updateOne({ _id: 'primary' }, {
      $set: {
        dispatchSettings: doc.dispatchSettings
      }
    });

    console.log('Successfully synced database SMTP settings with .env.local.');

  } catch (err) {
    console.error('Error:', err);
  } finally {
    await client.close();
  }
}

main();
