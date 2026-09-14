const fs = require('fs');
const path = require('path');
const { MongoClient } = require('mongodb');
const XLSX = require('xlsx');

function getPastDateString(ageDays) {
  const date = new Date();
  date.setDate(date.getDate() - ageDays);
  return date.toISOString();
}

function formatDateOnly(ageDays) {
  const date = new Date();
  date.setDate(date.getDate() - ageDays);
  return date.toISOString().split('T')[0];
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

    // Dealer code to target age & bucket configuration:
    // 1. 25-30 days (3% CD) -> Age 28 days -> Rule 30
    // 2. 40-45 days (2% CD) -> Age 42 days -> Rule 45
    // 3. 50-60 days (Due in 5d) -> Age 55 days -> Rule 60
    // 4. 60-90 days (60+ Overdue) -> Age 75 days -> Rule 75
    // 5. 90-120 days (90+ Overdue) -> Age 105 days -> Rule 90
    // 6. >120 days (120+ Overdue) -> Age 135 days -> Rule 120
    const dealerBucketConfig = {
      'D23057': { age: 28, bucket: '25-30 Days (3% CD)', rule: '30 Day Reminder', triggerDay: 30 },
      'D23077': { age: 42, bucket: '40-45 Days (2% CD)', rule: '45 Day Reminder', triggerDay: 45 },
      'D23119': { age: 55, bucket: '50-60 Days (60d Due)', rule: '60 Day Reminder', triggerDay: 60 },
      'D23157': { age: 75, bucket: '60-90 Days (60+ Overdue)', rule: '75 Day Reminder', triggerDay: 75 },
      'D23278': { age: 105, bucket: '90-120 Days (90+ Overdue)', rule: '90 Day Reminder', triggerDay: 90 },
      'D23292': { age: 135, bucket: '120+ Days (>120 Overdue)', rule: '120 Day Reminder', triggerDay: 120 },
      'D23365': { age: 27, bucket: '25-30 Days (3% CD)', rule: '30 Day Reminder', triggerDay: 30 },
      'D23469': { age: 43, bucket: '40-45 Days (2% CD)', rule: '45 Day Reminder', triggerDay: 45 },
      'D23512': { age: 58, bucket: '50-60 Days (60d Due)', rule: '60 Day Reminder', triggerDay: 60 }
    };

    console.log('--- 1. Updating Due Records in MongoDB ---');
    let updatedDuesCount = 0;
    const excelRows = [];

    const updatedDues = (doc.dueRecords || []).map(due => {
      const code = due.dealerCode || due.customerCode;
      const config = dealerBucketConfig[code];

      let targetAge = config ? config.age : 30;
      const newBillDate = getPastDateString(targetAge);
      const newDueDate = getPastDateString(targetAge > 30 ? targetAge - 30 : 0);
      const overdueDays = targetAge > 60 ? targetAge - 60 : 0;
      
      // Ensure amount >= threshold (10,000) for active test dealers
      let amount = due.amount;
      if (code === 'D23512' && amount < 10000) {
        amount = 39694; // boost to exceed 10k threshold
      } else if (code === 'D23365' && amount === 0) {
        amount = 15000;
      }
      
      const openingAmount = due.openingAmount && due.openingAmount > amount ? due.openingAmount : amount + 5000;

      updatedDuesCount++;

      // Row for Excel Export
      excelRows.push({
        'Dealer Code': code,
        'Company Name': due.companyName,
        'Invoice Number': due.invoiceNumber || due.reference || 'N/A',
        'Bill Date': formatDateOnly(targetAge),
        'Due Date': formatDateOnly(targetAge > 30 ? targetAge - 30 : 0),
        'Opening Amount': openingAmount,
        'Pending Amount': amount,
        'Currency': due.currency || 'INR',
        'Overdue by days': overdueDays,
        'Ageing Days': targetAge,
        'Ageing Bucket': config ? config.bucket : 'Other',
        'Trigger Rule': config ? config.rule : 'Standard'
      });

      return {
        ...due,
        billDate: newBillDate,
        invoiceDate: newBillDate,
        dueDate: newDueDate,
        amount,
        openingAmount,
        overdueDays,
        updatedAt: new Date().toISOString()
      };
    });

    // Enable all required reminder rules in MongoDB (including 120 Day Reminder)
    const requiredTriggerDays = [30, 45, 60, 75, 90, 120];
    const updatedRules = (doc.reminderRules || []).map(rule => {
      if (requiredTriggerDays.includes(rule.triggerDay)) {
        return { ...rule, enabled: true, updatedAt: new Date().toISOString() };
      }
      return rule;
    });

    // Save to MongoDB: updated dues, enabled rules, and cleared reminderLogs so generation runs fresh today
    await collection.updateOne({ _id: 'primary' }, {
      $set: {
        dueRecords: updatedDues,
        reminderRules: updatedRules,
        reminderLogs: []
      }
    });

    console.log(`✅ Successfully updated ${updatedDuesCount} due records in MongoDB.`);
    console.log('✅ Enabled all required rules (30, 45, 60, 75, 90, 120).');
    console.log('✅ Reset reminderLogs to allow clean immediate generation today.');

    console.log('\n--- 2. Generating Excel Due Sheets ---');
    // Build Excel Workbook
    const worksheet = XLSX.utils.json_to_sheet(excelRows);
    worksheet['!cols'] = [
      { wch: 14 }, // Dealer Code
      { wch: 45 }, // Company Name
      { wch: 30 }, // Invoice Number
      { wch: 14 }, // Bill Date
      { wch: 14 }, // Due Date
      { wch: 16 }, // Opening Amount
      { wch: 16 }, // Pending Amount
      { wch: 10 }, // Currency
      { wch: 16 }, // Overdue by days
      { wch: 12 }, // Ageing Days
      { wch: 28 }, // Ageing Bucket
      { wch: 22 }  // Trigger Rule
    ];

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Due Database');

    // Save to workspace root in multiple standard paths
    const filePaths = [
      path.join(__dirname, '..', 'sample-due-database.xlsx'),
      path.join(__dirname, '..', 'due-database-updated.xlsx'),
      path.join(__dirname, '..', 'ARB-Due-Database-All-Buckets.xlsx')
    ];

    for (const filePath of filePaths) {
      XLSX.writeFile(workbook, filePath);
      console.log(`📁 Saved Excel Sheet: ${path.basename(filePath)} (${excelRows.length} rows)`);
    }

    console.log('\n--- Bucket & Rule Coverage Summary ---');
    console.log('1. [25-30 Days] (3% CD)      -> D23057 (Balaji / A.A. Ent.), D23365 (Raghavendra / Aman Spare) -> Rule: 30 Day Reminder');
    console.log('2. [40-45 Days] (2% CD)      -> D23077 (Bhagawati / Abhijeet Ag.), D23469 (Somani / Aman Trad.) -> Rule: 45 Day Reminder');
    console.log('3. [50-60 Days] (60d Due)     -> D23119 (Durga / Abhijeet Nagpur), D23512 (Tanishq / Amar Auto) -> Rule: 60 Day Reminder');
    console.log('4. [60-90 Days] (60+ Overdue) -> D23157 (Goswami / Abhijeet Pune)                                -> Rule: 75 Day Reminder');
    console.log('5. [90-120 Days] (90+ Overdue)-> D23278 (Malwa / Afiya Tractor)                                 -> Rule: 90 Day Reminder');
    console.log('6. [120+ Days] (>120 Overdue) -> D23292 (Mohdiya / Allahabad Auto)                              -> Rule: 120 Day Reminder');

  } catch (err) {
    console.error('Error:', err);
  } finally {
    await client.close();
  }
}

main();
