const { MongoClient } = require('mongodb');
const fs = require('fs');
const path = require('path');

async function main() {
  const envContent = fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8');
  const env = {};
  envContent.split('\n').forEach(line => {
    const m = line.trim().match(/^([^=]+)=(.*)$/);
    if (m) env[m[1].trim()] = m[2].trim();
  });

  const client = new MongoClient(env.MONGODB_URI);
  try {
    await client.connect();
    const db = client.db(env.MONGODB_DB || 'auto-payment-reminder');
    const col = db.collection(env.MONGODB_COLLECTION || 'app_state');
    const doc = await col.findOne({ _id: 'primary' });

    const targetDays = [95, 100];
    const logs = (doc.reminderLogs || []).filter(l => targetDays.includes(l.reminderDay));
    
    console.log('=== 90th/95th Day Reminder Logs ===');
    logs.forEach(l => {
      console.log(`Invoice: ${l.invoiceNumber} | RuleDay: ${l.reminderDay} | Channel: ${l.channel} | Status: ${l.status} | Recipient: ${l.recipient}`);
      if (l.failureReason) console.log(`  Reason: ${l.failureReason}`);
    });

    // Check for any 'hold' logs and restore them
    const heldLogs = (doc.reminderLogs || []).filter(l => l.status === 'hold');
    console.log(`\nHeld logs found: ${heldLogs.length}`);
    if (heldLogs.length > 0) {
      await col.updateOne(
        { _id: 'primary' },
        { $set: { 'reminderLogs.$[elem].status': 'pending' } },
        { arrayFilters: [{ 'elem.status': 'hold' }] }
      );
      console.log(`✅ Restored ${heldLogs.length} held logs back to pending`);
    }
  } finally {
    await client.close();
  }
}
main().catch(console.error);
