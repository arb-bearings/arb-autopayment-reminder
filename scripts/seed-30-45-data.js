const fs = require('fs');
const path = require('path');
const { MongoClient } = require('mongodb');
const crypto = require('crypto');

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
    const ownerId = targetUser.id;

    console.log(`Setting up seed data for user: ${targetUser.email} (ownerId: ${ownerId})`);

    const testDues = [];
    const testContacts = [];

    // ─────────────────────────────────────────────────────────────────────────────
    // 1. Dealer 1 -> 30-Day Reminder (Age 28 days, triggers 30-Day 3% CD reminder due in 2 days)
    // ─────────────────────────────────────────────────────────────────────────────
    const d1Age = 28;
    const d1BillDate = getPastDateString(d1Age);
    const d1Inv = 'INV-30D-001';
    testDues.push({
      id: crypto.randomUUID(),
      ownerId,
      dealerCode: 'DLR-30DAY',
      customerCode: 'DLR-30DAY',
      companyName: 'Apex Bearing Distributors (30-Day Test)',
      billDate: d1BillDate,
      invoiceDate: d1BillDate,
      invoiceNumber: d1Inv,
      dueDate: getPastDateString(d1Age - 30),
      openingAmount: 25000,
      amount: 25000,
      currency: 'INR',
      overdueDays: 0,
      reference: d1Inv,
      notes: 'Seed invoice for 30-day reminder (25-30 day window / 3% CD)',
      matchedContactId: '',
      matchedContactName: 'Accounts Team - Apex Bearings',
      matchedEmail: 'amankumarschool7@gmail.com',
      matchedWhatsapp: '9971416471',
      matchedSms: '9971416471',
      contactMatchStatus: 'matched',
      totalDueAmount: 25000,
      salespersonId: '',
      salespersonName: 'Aman Kumar',
      salespersonEmail: 'amankumarschool7@gmail.com',
      lastReminderDate: '',
      reminderCount: 0,
      lastDispatchStatus: '',
      createdBy: ownerId,
      updatedBy: ownerId,
      importedAt: new Date().toISOString(),
      raw: {}
    });

    testContacts.push({
      id: crypto.randomUUID(),
      ownerId,
      dealerCode: 'DLR-30DAY',
      customerCode: 'DLR-30DAY',
      companyName: 'Apex Bearing Distributors (30-Day Test)',
      primaryContact: 'Accounts Team',
      email: 'amankumarschool7@gmail.com',
      whatsapp: '9971416471',
      sms: '9971416471',
      alternateContact: '',
      notes: 'Seed master contact for 30-day reminder test',
      salespersonId: '',
      salespersonName: 'Aman Kumar',
      salespersonEmail: 'amankumarschool7@gmail.com',
      importedAt: new Date().toISOString(),
      raw: {}
    });

    // ─────────────────────────────────────────────────────────────────────────────
    // 2. Dealer 2 -> 45-Day Reminder (Age 42 days, triggers 45-Day 2% CD reminder due in 3 days)
    // ─────────────────────────────────────────────────────────────────────────────
    const d2Age = 42;
    const d2BillDate = getPastDateString(d2Age);
    const d2Inv = 'INV-45D-001';
    testDues.push({
      id: crypto.randomUUID(),
      ownerId,
      dealerCode: 'DLR-45DAY',
      customerCode: 'DLR-45DAY',
      companyName: 'Bharat Auto Spares (45-Day Test)',
      billDate: d2BillDate,
      invoiceDate: d2BillDate,
      invoiceNumber: d2Inv,
      dueDate: getPastDateString(d2Age - 30),
      openingAmount: 30000,
      amount: 30000,
      currency: 'INR',
      overdueDays: d2Age > 30 ? d2Age - 30 : 0,
      reference: d2Inv,
      notes: 'Seed invoice for 45-day reminder (40-45 day window / 2% CD)',
      matchedContactId: '',
      matchedContactName: 'Accounts Team - Bharat Auto',
      matchedEmail: 'amankumarschool7@gmail.com',
      matchedWhatsapp: '9971416471',
      matchedSms: '9971416471',
      contactMatchStatus: 'matched',
      totalDueAmount: 30000,
      salespersonId: '',
      salespersonName: 'Aman Kumar',
      salespersonEmail: 'amankumarschool7@gmail.com',
      lastReminderDate: '',
      reminderCount: 0,
      lastDispatchStatus: '',
      createdBy: ownerId,
      updatedBy: ownerId,
      importedAt: new Date().toISOString(),
      raw: {}
    });

    testContacts.push({
      id: crypto.randomUUID(),
      ownerId,
      dealerCode: 'DLR-45DAY',
      customerCode: 'DLR-45DAY',
      companyName: 'Bharat Auto Spares (45-Day Test)',
      primaryContact: 'Accounts Team',
      email: 'amankumarschool7@gmail.com',
      whatsapp: '9971416471',
      sms: '9971416471',
      alternateContact: '',
      notes: 'Seed master contact for 45-day reminder test',
      salespersonId: '',
      salespersonName: 'Aman Kumar',
      salespersonEmail: 'amankumarschool7@gmail.com',
      importedAt: new Date().toISOString(),
      raw: {}
    });

    // Save dues & contacts, clear old logs
    await collection.updateOne({ _id: 'primary' }, {
      $set: {
        dueRecords: testDues,
        masterContacts: testContacts,
        reminderLogs: []
      }
    });

    console.log('✅ Seed data successfully saved into MongoDB.');
    console.log(`- Seed 1: ${testDues[0].companyName} (Invoice: ${testDues[0].invoiceNumber}, Age: ${d1Age} days, Amount: ₹${testDues[0].amount}) -> Triggers 30-Day Reminder (3% CD)`);
    console.log(`- Seed 2: ${testDues[1].companyName} (Invoice: ${testDues[1].invoiceNumber}, Age: ${d2Age} days, Amount: ₹${testDues[1].amount}) -> Triggers 45-Day Reminder (2% CD)`);

  } catch (err) {
    console.error('Error seeding data:', err);
  } finally {
    await client.close();
  }
}

main();
