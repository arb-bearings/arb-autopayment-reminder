const fs = require('fs');
const path = require('path');
const { MongoClient } = require('mongodb');
const crypto = require('crypto');

function getPastDateString(ageDays) {
  const date = new Date();
  date.setDate(date.getDate() - ageDays);
  return date.toISOString();
}

async function testRanges() {
  const envContent = fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8');
  const env = {};
  envContent.split('\n').forEach(line => {
    const match = line.trim().match(/^([^=]+)=(.*)$/);
    if (match) env[match[1].trim()] = match[2].trim();
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
    const targetUser = doc.users.find(u => u.email === 'amankumarschool7@gmail.com');
    const ownerId = targetUser.id;

    // Test with 4 test invoices:
    // 1. Age 28 days -> Should TRIGGER 30-Day Reminder (3% CD)
    // 2. Age 33 days -> Should be PAUSED / NOT TRIGGER
    // 3. Age 42 days -> Should TRIGGER 45-Day Reminder (2% CD)
    // 4. Age 48 days -> Should be PAUSED / NOT TRIGGER
    // 5. Age 55 days -> Should TRIGGER 60-Day Reminder

    const testDues = [
      {
        id: crypto.randomUUID(),
        ownerId,
        dealerCode: 'TEST-DLR-28',
        customerCode: 'TEST-DLR-28',
        companyName: 'Test Dealer 28-day (Active 30d CD)',
        billDate: getPastDateString(28),
        invoiceDate: getPastDateString(28),
        invoiceNumber: 'INV-28D',
        dueDate: getPastDateString(-2),
        openingAmount: 25000,
        amount: 25000,
        currency: 'INR',
        reference: 'INV-28D',
        matchedContactName: 'Accounts Team',
        matchedEmail: 'amankumarschool7@gmail.com',
        matchedWhatsapp: '9971416471',
        matchedSms: '9971416471',
        contactMatchStatus: 'matched',
        totalDueAmount: 25000,
        salespersonName: 'Aman Kumar',
        salespersonEmail: 'amankumarschool7@gmail.com',
        createdBy: ownerId,
        updatedBy: ownerId,
        importedAt: new Date().toISOString(),
        raw: {}
      },
      {
        id: crypto.randomUUID(),
        ownerId,
        dealerCode: 'TEST-DLR-33',
        customerCode: 'TEST-DLR-33',
        companyName: 'Test Dealer 33-day (Paused 30-35d)',
        billDate: getPastDateString(33),
        invoiceDate: getPastDateString(33),
        invoiceNumber: 'INV-33D',
        dueDate: getPastDateString(3),
        openingAmount: 25000,
        amount: 25000,
        currency: 'INR',
        reference: 'INV-33D',
        matchedContactName: 'Accounts Team',
        matchedEmail: 'amankumarschool7@gmail.com',
        matchedWhatsapp: '9971416471',
        matchedSms: '9971416471',
        contactMatchStatus: 'matched',
        totalDueAmount: 25000,
        salespersonName: 'Aman Kumar',
        salespersonEmail: 'amankumarschool7@gmail.com',
        createdBy: ownerId,
        updatedBy: ownerId,
        importedAt: new Date().toISOString(),
        raw: {}
      },
      {
        id: crypto.randomUUID(),
        ownerId,
        dealerCode: 'TEST-DLR-42',
        customerCode: 'TEST-DLR-42',
        companyName: 'Test Dealer 42-day (Active 45d CD)',
        billDate: getPastDateString(42),
        invoiceDate: getPastDateString(42),
        invoiceNumber: 'INV-42D',
        dueDate: getPastDateString(12),
        openingAmount: 30000,
        amount: 30000,
        currency: 'INR',
        reference: 'INV-42D',
        matchedContactName: 'Accounts Team',
        matchedEmail: 'amankumarschool7@gmail.com',
        matchedWhatsapp: '9971416471',
        matchedSms: '9971416471',
        contactMatchStatus: 'matched',
        totalDueAmount: 30000,
        salespersonName: 'Aman Kumar',
        salespersonEmail: 'amankumarschool7@gmail.com',
        createdBy: ownerId,
        updatedBy: ownerId,
        importedAt: new Date().toISOString(),
        raw: {}
      },
      {
        id: crypto.randomUUID(),
        ownerId,
        dealerCode: 'TEST-DLR-48',
        customerCode: 'TEST-DLR-48',
        companyName: 'Test Dealer 48-day (Paused 45-50d)',
        billDate: getPastDateString(48),
        invoiceDate: getPastDateString(48),
        invoiceNumber: 'INV-48D',
        dueDate: getPastDateString(18),
        openingAmount: 30000,
        amount: 30000,
        currency: 'INR',
        reference: 'INV-48D',
        matchedContactName: 'Accounts Team',
        matchedEmail: 'amankumarschool7@gmail.com',
        matchedWhatsapp: '9971416471',
        matchedSms: '9971416471',
        contactMatchStatus: 'matched',
        totalDueAmount: 30000,
        salespersonName: 'Aman Kumar',
        salespersonEmail: 'amankumarschool7@gmail.com',
        createdBy: ownerId,
        updatedBy: ownerId,
        importedAt: new Date().toISOString(),
        raw: {}
      },
      {
        id: crypto.randomUUID(),
        ownerId,
        dealerCode: 'TEST-DLR-55',
        customerCode: 'TEST-DLR-55',
        companyName: 'Test Dealer 55-day (Active 60d standard)',
        billDate: getPastDateString(55),
        invoiceDate: getPastDateString(55),
        invoiceNumber: 'INV-55D',
        dueDate: getPastDateString(25),
        openingAmount: 35000,
        amount: 35000,
        currency: 'INR',
        reference: 'INV-55D',
        matchedContactName: 'Accounts Team',
        matchedEmail: 'amankumarschool7@gmail.com',
        matchedWhatsapp: '9971416471',
        matchedSms: '9971416471',
        contactMatchStatus: 'matched',
        totalDueAmount: 35000,
        salespersonName: 'Aman Kumar',
        salespersonEmail: 'amankumarschool7@gmail.com',
        createdBy: ownerId,
        updatedBy: ownerId,
        importedAt: new Date().toISOString(),
        raw: {}
      }
    ];

    const testContacts = testDues.map(d => ({
      id: crypto.randomUUID(),
      ownerId,
      dealerCode: d.dealerCode,
      customerCode: d.customerCode,
      companyName: d.companyName,
      primaryContact: 'Accounts Team',
      email: 'amankumarschool7@gmail.com',
      whatsapp: '9971416471',
      sms: '9971416471',
      alternateContact: '',
      notes: '',
      salespersonName: 'Aman Kumar',
      salespersonEmail: 'amankumarschool7@gmail.com',
      importedAt: new Date().toISOString(),
      raw: {}
    }));

    await collection.updateOne({ _id: 'primary' }, {
      $set: {
        dueRecords: testDues,
        masterContacts: testContacts,
        reminderLogs: []
      }
    });

    console.log('✅ Test seed data set. Now testing reminder generation...');
  } finally {
    await client.close();
  }
}

testRanges();
