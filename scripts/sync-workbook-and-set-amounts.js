const fs = require('fs');
const path = require('path');
const { MongoClient } = require('mongodb');
const XLSX = require('xlsx');

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

    const updatedDues = (doc.dueRecords || []).map(due => {
      const code = due.dealerCode || due.customerCode;
      const targetAge = dealerAgeMap[code];

      if (targetAge !== undefined) {
        const newBillDate = getPastDateString(targetAge);
        const newDueDate = getPastDateString(targetAge - 30);
        const amount = due.amount < 10000 ? 25000 : due.amount;

        return {
          ...due,
          billDate: newBillDate,
          invoiceDate: newBillDate,
          dueDate: newDueDate,
          amount,
          openingAmount: amount,
          totalDueAmount: amount,
          overdueDays: targetAge > 30 ? targetAge - 30 : 0,
          updatedAt: new Date().toISOString()
        };
      }

      return due;
    });

    // Clear reminderLogs
    await collection.updateOne({ _id: 'primary' }, {
      $set: {
        dueRecords: updatedDues,
        reminderLogs: []
      }
    });

    console.log('✅ MongoDB dueRecords updated successfully.');

    // Also update Excel file in data/workbooks/company%3Aarb-bearings-private-limited
    const workbookDir = path.join(__dirname, '..', 'data', 'workbooks', 'company%3Aarb-bearings-private-limited');
    if (fs.existsSync(workbookDir)) {
      const dueRows = updatedDues.map(record => ({
        Date: record.billDate ? record.billDate.slice(0, 10) : '',
        'Ref. No.': record.invoiceNumber || record.reference,
        "Party's Name": record.companyName,
        'Opening Amount': record.openingAmount,
        'Pending Amount': record.amount,
        'Due on': record.dueDate ? record.dueDate.slice(0, 10) : '',
        'Overdue by days': record.overdueDays,
        'Dealer Code': record.dealerCode || record.customerCode,
        Currency: record.currency || 'INR'
      }));

      const ws = XLSX.utils.json_to_sheet(dueRows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Due Report');

      const dueDbPath = path.join(workbookDir, 'due-database.xlsx');
      const duePath = path.join(workbookDir, 'due.xlsx');
      XLSX.writeFile(wb, dueDbPath);
      XLSX.writeFile(wb, duePath);
      console.log('✅ Excel workbooks synced at:', workbookDir);
    }

  } catch (err) {
    console.error('Error:', err);
  } finally {
    await client.close();
  }
}

main();
