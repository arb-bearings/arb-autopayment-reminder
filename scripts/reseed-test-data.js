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
      console.log('No database document found.');
      return;
    }

    const targetUser = doc.users.find(u => u.email === 'amankumarschool7@gmail.com');
    if (!targetUser) {
      console.error('Target user not found');
      return;
    }
    const ownerId = targetUser.id;

    console.log(`Reseeding test data for user: ${targetUser.email} (ownerId: ${ownerId})`);

    // Clean existing test dues and the invoice starting with 5948
    doc.dueRecords = [];

    // Clean master contacts
    doc.masterContacts = (doc.masterContacts || []).filter(
      c => !c.companyName.startsWith('Test Customer') && 
           !c.companyName.startsWith('Test Dealer')
    );

    // 9 dealers corresponding to the 9 message templates
    const testRules = [
      { name: 'Test Dealer 30 Day', code: 'TST-30', age: 25, olderAge: 40, amount: 10000, olderAmount: 5000 },
      { name: 'Test Dealer 45 Day', code: 'TST-45', age: 40, olderAge: 55, amount: 15000, olderAmount: 7500 },
      { name: 'Test Dealer 60 Day', code: 'TST-60', age: 55, olderAge: 70, amount: 20000, olderAmount: 10000 },
      { name: 'Test Dealer 75 Day', code: 'TST-75', age: 70, olderAge: 85, amount: 25000, olderAmount: 12500 },
      { name: 'Test Dealer 80 Day', code: 'TST-80', age: 75, olderAge: 90, amount: 30000, olderAmount: 15000 },
      { name: 'Test Dealer 85 Day', code: 'TST-85', age: 80, olderAge: 95, amount: 35000, olderAmount: 17500 },
      { name: 'Test Dealer 90 Day', code: 'TST-90', age: 85, olderAge: 100, amount: 40000, olderAmount: 20000 },
      { name: 'Test Dealer 95 Day', code: 'TST-95', age: 90, olderAge: 105, amount: 45000, olderAmount: 22500 },
      { name: 'Test Dealer 100 Day', code: 'TST-100', age: 95, olderAge: 110, amount: 50000, olderAmount: 25000 }
    ];

    testRules.forEach(td => {
      // 1. Add current invoice
      const currentBillDate = getPastDateString(td.age);
      const isCd = td.age === 25 || td.age === 40;
      const currentInvoiceNumber = isCd ? `INV-${td.age}D-CD` : `INV-${td.age}D`;
      
      doc.dueRecords.push({
        id: crypto.randomUUID(),
        ownerId,
        dealerCode: td.code,
        customerCode: td.code,
        companyName: td.name,
        billDate: currentBillDate,
        invoiceDate: currentBillDate,
        invoiceNumber: currentInvoiceNumber,
        dueDate: getPastDateString(td.age - 30),
        openingAmount: td.amount,
        amount: td.amount,
        currency: 'INR',
        overdueDays: td.age > 30 ? td.age - 30 : 0,
        reference: currentInvoiceNumber,
        notes: `Current invoice for rule age ${td.age}`,
        matchedContactId: '',
        matchedContactName: td.name,
        matchedEmail: 'amankumarschool7@gmail.com',
        matchedWhatsapp: '9971416471',
        matchedSms: '9971416471',
        contactMatchStatus: 'matched',
        totalDueAmount: td.amount + td.olderAmount,
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

      // 2. Add older invoice (which is immediate past relative to current)
      const olderBillDate = getPastDateString(td.olderAge);
      const olderInvoiceNumber = `INV-OLD-${td.olderAge}D`;
      
      doc.dueRecords.push({
        id: crypto.randomUUID(),
        ownerId,
        dealerCode: td.code,
        customerCode: td.code,
        companyName: td.name,
        billDate: olderBillDate,
        invoiceDate: olderBillDate,
        invoiceNumber: olderInvoiceNumber,
        dueDate: getPastDateString(td.olderAge - 30),
        openingAmount: td.olderAmount,
        amount: td.olderAmount,
        currency: 'INR',
        overdueDays: td.olderAge > 30 ? td.olderAge - 30 : 0,
        reference: olderInvoiceNumber,
        notes: `Older invoice for rule age ${td.olderAge}`,
        matchedContactId: '',
        matchedContactName: td.name,
        matchedEmail: 'amankumarschool7@gmail.com',
        matchedWhatsapp: '9971416471',
        matchedSms: '9971416471',
        contactMatchStatus: 'matched',
        totalDueAmount: td.amount + td.olderAmount,
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

      // 3. Create master contact
      doc.masterContacts.push({
        id: crypto.randomUUID(),
        ownerId,
        dealerCode: td.code,
        customerCode: td.code,
        companyName: td.name,
        primaryContact: 'Accounts Team',
        email: 'amankumarschool7@gmail.com',
        whatsapp: '9971416471',
        sms: '9971416471',
        alternateContact: '',
        notes: `Test contact for ${td.name}`,
        salespersonId: '',
        salespersonName: 'Aman Kumar',
        salespersonEmail: 'amankumarschool7@gmail.com',
        importedAt: new Date().toISOString(),
        raw: {}
      });
    });

    await collection.updateOne({ _id: 'primary' }, { 
      $set: { 
        dueRecords: doc.dueRecords,
        masterContacts: doc.masterContacts
      } 
    });

    console.log('Test data successfully re-seeded.');
  } catch (err) {
    console.error('Error re-seeding:', err);
  } finally {
    await client.close();
  }
}

main();
