const fs = require('fs');
const path = require('path');
const { MongoClient } = require('mongodb');
const crypto = require('crypto');

function getPastDateString(ageDays) {
  // Returns ISO string of a date exactly X days ago
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

    // Clean existing test dues
    doc.dueRecords = (doc.dueRecords || []).filter(d => !d.companyName.startsWith('Test Customer'));

    // Test dues definition
    const testDues = [
      // 1. CD eligible (NO pending dues)
      { name: 'Test Customer 30 Day CD', code: 'TST-CD-30', age: 25, amount: 30000 },
      { name: 'Test Customer 45 Day CD', code: 'TST-CD-45', age: 40, amount: 45000 },

      // 2. CD excluded (WITH pending dues)
      { name: 'Test Customer 30 Day', code: 'D23003', age: 25, amount: 30000 },
      { name: 'Test Customer 45 Day', code: 'D23007', age: 40, amount: 45000 },

      // 3. Overdue brackets (WITH pending dues)
      { name: 'Test Customer 60 Day', code: 'D23009', age: 55, amount: 60000 },
      { name: 'Test Customer 75 Day', code: 'D23008', age: 70, amount: 75000 },
      { name: 'Test Customer 80 Day', code: 'D26927', age: 75, amount: 80000 },
      { name: 'Test Customer 85 Day', code: 'D24690', age: 80, amount: 85000 },
      { name: 'Test Customer 90 Day', code: 'D23019', age: 85, amount: 90000 },
      { name: 'Test Customer 95 Day', code: 'D26923', age: 90, amount: 95000 },
      { name: 'Test Customer 100 Day', code: 'D23021', age: 95, amount: 100000 },
      { name: 'Test Customer 125 Day', code: 'D23031', age: 120, amount: 125000 }
    ];

    // Ensure we add an older invoice for D24690 (Allahabad Auto Centre / Test Customer 85 Day)
    // so it has a pending due that is older (e.g. 120 days old)
    const hasOlderD24690 = doc.dueRecords.some(d => d.dealerCode === 'D24690' && getPastDateString(120).slice(0, 10) === (d.billDate || d.invoiceDate).slice(0, 10));
    if (!hasOlderD24690) {
      doc.dueRecords.push({
        id: crypto.randomUUID(),
        ownerId,
        dealerCode: 'D24690',
        customerCode: 'D24690',
        companyName: 'Allahabad Auto Centre Older Due',
        billDate: getPastDateString(120),
        invoiceDate: getPastDateString(120),
        invoiceNumber: 'OLD-INV-85',
        dueDate: getPastDateString(90),
        openingAmount: 120000,
        amount: 120000,
        currency: 'INR',
        overdueDays: 30,
        reference: 'OLD-INV-85',
        notes: 'Older pending due for testing',
        matchedContactId: '',
        matchedContactName: 'Allahabad Auto Centre Older Due',
        matchedEmail: 'amankumarschool7@gmail.com',
        matchedWhatsapp: '9971416471',
        matchedSms: '9971416471',
        contactMatchStatus: 'matched',
        totalDueAmount: 120000,
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
    }

    testDues.forEach(td => {
      const billDate = getPastDateString(td.age);
      doc.dueRecords.push({
        id: crypto.randomUUID(),
        ownerId,
        dealerCode: td.code,
        customerCode: td.code,
        companyName: td.name,
        billDate,
        invoiceDate: billDate,
        invoiceNumber: `TEST-INV-${td.age}`,
        dueDate: getPastDateString(td.age - 30), // due 30 days after bill
        openingAmount: td.amount,
        amount: td.amount,
        currency: 'INR',
        overdueDays: td.age > 30 ? td.age - 30 : 0,
        reference: `TEST-INV-${td.age}`,
        notes: `Test record for age ${td.age}`,
        matchedContactId: '',
        matchedContactName: td.name,
        matchedEmail: 'amankumarschool7@gmail.com',
        matchedWhatsapp: '9971416471',
        matchedSms: '9971416471',
        contactMatchStatus: 'matched',
        totalDueAmount: td.amount,
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
    });

    // Ensure contacts exist in masterContacts for TST-CD-30 and TST-CD-45
    doc.masterContacts = doc.masterContacts || [];
    ['TST-CD-30', 'TST-CD-45'].forEach(code => {
      const exists = doc.masterContacts.some(c => c.ownerId === ownerId && (c.dealerCode === code || c.customerCode === code));
      if (!exists) {
        doc.masterContacts.push({
          id: crypto.randomUUID(),
          ownerId,
          dealerCode: code,
          customerCode: code,
          companyName: code === 'TST-CD-30' ? 'Test Customer 30 Day CD' : 'Test Customer 45 Day CD',
          primaryContact: 'Accounts Team',
          email: 'amankumarschool7@gmail.com',
          whatsapp: '9971416471',
          sms: '9971416471',
          alternateContact: '',
          notes: 'Test contact for CD',
          salespersonId: '',
          salespersonName: 'Aman Kumar',
          salespersonEmail: 'amankumarschool7@gmail.com',
          importedAt: new Date().toISOString(),
          raw: {}
        });
      }
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
