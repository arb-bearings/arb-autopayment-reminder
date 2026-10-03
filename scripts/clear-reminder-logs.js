const { MongoClient } = require('mongodb');
(async () => {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db(process.env.MONGODB_DB || 'auto-payment-reminder');
  const col = process.env.MONGODB_COLLECTION || 'app_state';
  const result = await db.collection(col).updateOne(
    { _id: 'primary' },
    { $set: { reminderLogs: [], updatedAt: new Date().toISOString() } }
  );
  console.log('Modified:', result.modifiedCount);
  const doc = await db.collection(col).findOne({ _id: 'primary' }, { projection: { reminderLogs: 1 } });
  console.log('reminderLogs count after clear:', doc.reminderLogs?.length);
  await client.close();
})();
