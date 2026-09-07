const fs = require('fs');
const path = require('path');
const { MongoClient } = require('mongodb');

function getPastDateString(ageDays) {
  const date = new Date();
  date.setDate(date.getDate() - ageDays);
  return date.toISOString();
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
      console.error('No database document found.');
      return;
    }

    const targetUser = doc.users.find(u => u.email === 'amankumarschool7@gmail.com');
    if (!targetUser) {
      console.error('Target user not found');
      return;
    }

    // Dealer code to target age mapping for comprehensive coverage:
    const dealerAgeMap = {
      'D23057': 28,  // 25-30 days -> 30 Day Reminder (3% CD)
      'D23077': 42,  // 40-45 days -> 45 Day Reminder (2% CD)
      'D23119': 55,  // 50-60 days -> 60 Day Reminder
      'D23157': 75,  // 60-90 days -> 75 Day Reminder (60+ Overdue)
      'D23278': 100, // 90-120 days -> 90 Day Reminder (90+ Overdue)
      'D23292': 125, // >120 days -> 120+ Day Reminder (>120 Overdue)
      'D23365': 27,  // 25-30 days -> 30 Day Reminder (3% CD)
      'D23469': 43,  // 40-45 days -> 45 Day Reminder (2% CD)
      'D23512': 58   // 50-60 days -> 60 Day Reminder
    };

    console.log('Altering bill dates of all uploaded due records in MongoDB...');
    let updatedDuesCount = 0;

    const updatedDues = (doc.dueRecords || []).map(due => {
      const code = due.dealerCode || due.customerCode;
      const targetAge = dealerAgeMap[code];

      if (targetAge !== undefined) {
        const newBillDate = getPastDateString(targetAge);
        const newDueDate = getPastDateString(targetAge - 30);
        updatedDuesCount++;

        return {
          ...due,
          billDate: newBillDate,
          invoiceDate: newBillDate,
          dueDate: newDueDate,
          overdueDays: targetAge > 30 ? targetAge - 30 : 0,
          updatedAt: new Date().toISOString()
        };
      }

      return due;
    });

    // Clear reminderLogs so fresh reminders can be generated today
    await collection.updateOne({ _id: 'primary' }, {
      $set: {
        dueRecords: updatedDues,
        reminderLogs: []
      }
    });

    console.log(`✅ Successfully updated ${updatedDuesCount} due records across ${Object.keys(dealerAgeMap).length} dealers.`);

    // Summary of updated dealers and their expected rules
    console.log('\n--- Configured Ageing & Rule Triggers ---');
    console.log('- Dealer D23057 (A. A. Enterprises): Age 28 days -> Rule: 30 Day Reminder (3% CD)');
    console.log('- Dealer D23077 (Abhijeet Agencies): Age 42 days -> Rule: 45 Day Reminder (2% CD)');
    console.log('- Dealer D23119 (Abhijeet Auto Components - Nagpur): Age 55 days -> Rule: 60 Day Reminder');
    console.log('- Dealer D23157 (Abhijeet Auto Components - Pune): Age 75 days -> Rule: 75 Day Reminder (60-90d)');
    console.log('- Dealer D23278 (Afiya Tractor Parts): Age 100 days -> Rule: 90 Day Reminder (90-120d)');
    console.log('- Dealer D23292 (Allahabad Auto Centre): Age 125 days -> Rule: 120+ Day Reminder (>120d)');
    console.log('- Dealer D23365 (Aman Spare Parts): Age 27 days -> Rule: 30 Day Reminder (3% CD)');
    console.log('- Dealer D23469 (Aman Tradings): Age 43 days -> Rule: 45 Day Reminder (2% CD)');
    console.log('- Dealer D23512 (Amar Auto Agencies): Age 58 days -> Rule: 60 Day Reminder');

  } catch (err) {
    console.error('Error updating bill ages:', err);
  } finally {
    await client.close();
  }
}

main();
