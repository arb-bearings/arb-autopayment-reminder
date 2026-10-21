const { MongoClient } = require('mongodb');
const fs = require('fs');
const path = require('path');

// Load .env.local if present
const envPath = path.resolve(process.cwd(), '.env.local');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx !== -1) {
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim();
      if (!process.env[key]) process.env[key] = val;
    }
  }
}

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  console.error("Missing MONGODB_URI in environment");
  process.exit(1);
}
const DB_NAME = process.env.MONGODB_DB || "auto-payment-reminder";

async function configureManagerAndDealers() {
  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  const db = client.db(DB_NAME);
  const col = db.collection('app_state');
  const doc = await col.findOne({ _id: 'primary' });

  if (!doc) {
    console.error("No primary app_state doc found!");
    await client.close();
    return;
  }

  const selectedDealerCodes = ['D23003', 'D23007', 'D23009', 'D23008', 'D23638', 'D26927', 'D24690'];
  const managerEmail = "amankumarschool7@gmail.com";
  const managerName = "Aman";
  const ownerId = "aa9d888f-6438-4b27-8cf5-60261f1fb725"; // superadmin / config owner ID

  // 1. Single manager Aman
  const newSalesperson = {
    id: "salesperson-aman-1",
    ownerId: ownerId,
    name: managerName,
    email: managerEmail,
    employeeId: "AMAN-01",
    phoneNumber: "+919876543210",
    backOfficeEmail: managerEmail,
    dealerCodes: selectedDealerCodes,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  doc.salespersons = [newSalesperson];

  // 2. Update masterContacts for these 7 dealers with email amankumarschool7@gmail.com
  if (!doc.masterContacts) doc.masterContacts = [];
  
  const dealerNames = {
    'D23003': 'A. A. Enterprises',
    'D23007': 'Abhijeet Agencies',
    'D23009': 'Abhijeet Auto Components (Nagpur)',
    'D23008': 'Abhijeet Auto Components (Pune)',
    'D23638': 'Aditya Associates',
    'D26927': 'Afiya Tractor Parts',
    'D24690': 'Allahabad Auto Centre'
  };

  selectedDealerCodes.forEach(code => {
    let contact = doc.masterContacts.find(c => (c.dealerCode || c.customerCode || '').trim() === code);
    if (!contact) {
      contact = {
        id: `contact-${code.toLowerCase()}`,
        ownerId: ownerId,
        dealerCode: code,
        customerCode: code,
        dealerName: dealerNames[code] || `Dealer ${code}`,
        email: managerEmail,
        phone: "+919876543210",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      doc.masterContacts.push(contact);
    } else {
      contact.email = managerEmail;
      contact.dealerName = contact.dealerName || dealerNames[code] || `Dealer ${code}`;
      contact.salespersonName = managerName;
      contact.salespersonEmail = managerEmail;
      contact.updatedAt = new Date().toISOString();
    }
  });

  // 3. Update dues for these 7 dealers to link to Manager Aman
  (doc.dueRecords || []).forEach(due => {
    const code = (due.dealerCode || due.customerCode || '').trim();
    if (selectedDealerCodes.includes(code)) {
      due.salespersonName = managerName;
      due.salespersonEmail = managerEmail;
    } else {
      // Clear salesperson link for other dues so they don't generate extra managers
      due.salespersonName = "";
      due.salespersonEmail = "";
    }
  });

  doc.updatedAt = new Date().toISOString();

  await col.replaceOne({ _id: 'primary' }, doc);
  console.log("Successfully configured single Manager Aman with 7 assigned dealers and saved to MongoDB.");

  await client.close();
}

configureManagerAndDealers().catch(console.error);
