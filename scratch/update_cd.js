const fs = require('fs');
const { MongoClient } = require('mongodb');

async function main() {
  const envContent = fs.readFileSync('.env.local', 'utf8');
  const env = {};
  envContent.split('\n').forEach(line => {
    const match = line.trim().match(/^([^=]+)=(.*)$/);
    if (match) env[match[1].trim()] = match[2].trim();
  });

  const client = new MongoClient(env.MONGODB_URI);
  await client.connect();
  const db = client.db(env.MONGODB_DB || 'auto-payment-reminder');

  const newText = 'To avail the {{cdDiscountPercent}}% CD benefit on this invoice, please make payment of total outstanding along with the current invoice by/before the due date.';

  const doc = await db.collection(env.MONGODB_COLLECTION || 'app_state').findOne({ _id: 'primary' });
  if (doc && Array.isArray(doc.cashDiscountPolicies)) {
    doc.cashDiscountPolicies.forEach(p => {
      p.cdMessageTemplate = newText;
      p.cdMessageWithOlderTemplate = newText;
      p.cdShortMessageTemplate = newText;
      p.cdShortMessageWithOlderTemplate = newText;
    });

    await db.collection(env.MONGODB_COLLECTION || 'app_state').updateOne(
      { _id: 'primary' },
      { $set: { cashDiscountPolicies: doc.cashDiscountPolicies } }
    );
    console.log('Successfully updated', doc.cashDiscountPolicies.length, 'policies in MongoDB.');
  } else {
    console.log('No cashDiscountPolicies array in DB to update.');
  }

  await client.close();
}

main().catch(console.error);
