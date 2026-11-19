const { MongoClient } = require('mongodb');
const { randomUUID } = require('crypto');
const fs = require('fs');
const path = require('path');

async function main() {
  const envContent = fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8');
  const env = {};
  envContent.split('\n').forEach(line => {
    const m = line.trim().match(/^([^=]+)=(.*)$/);
    if (m) env[m[1].trim()] = m[2].trim().replace(/^['"]|['"]$/g, '');
  });

  const client = new MongoClient(env.MONGODB_URI);
  try {
    await client.connect();
    const db = client.db(env.MONGODB_DB || 'auto-payment-reminder');
    const col = db.collection(env.MONGODB_COLLECTION || 'app_state');
    const doc = await col.findOne({ _id: 'primary' });

    if (!doc) {
      console.error('No primary document found in MongoDB');
      return;
    }

    const contacts = doc.masterContacts || [];
    const dues = doc.dueRecords || [];
    let salespersons = doc.salespersons || [];

    // Find ST011
    const st011 = salespersons.find(s => s.employeeId === 'ST011');
    if (!st011) {
      console.error('ST011 salesperson not found');
      return;
    }

    // Identify ST011 vs ST016 contacts
    const st011Contacts = [];
    const st016Contacts = [];

    for (const c of contacts) {
      const mgrCode = (c.raw ? (c.raw['manager code'] || c.raw['Manager Code']) : '') || '';
      const mgrName = (c.raw ? (c.raw['manager name'] || c.raw['Manager Name']) : '') || '';

      if (mgrCode.toUpperCase() === 'ST016' || mgrName.toUpperCase().includes('GAUR MH')) {
        st016Contacts.push(c);
      } else if (mgrCode.toUpperCase() === 'ST011' || mgrName.toUpperCase() === 'SUDHAKAR GAUR') {
        st011Contacts.push(c);
      }
    }

    const st011Codes = [...new Set(st011Contacts.map(c => (c.dealerCode || '').toUpperCase()).filter(Boolean))].sort();
    const st016Codes = [...new Set(st016Contacts.map(c => (c.dealerCode || '').toUpperCase()).filter(Boolean))].sort();

    console.log(`ST011 dealer codes (${st011Codes.length}):`, st011Codes);
    console.log(`ST016 dealer codes (${st016Codes.length}):`, st016Codes);

    // Update ST011
    st011.name = 'SUDHAKAR GAUR';
    st011.employeeId = 'ST011';
    st011.dealerCodes = st011Codes;
    st011.updatedAt = new Date().toISOString();

    // Find or create ST016
    let st016 = salespersons.find(s => s.employeeId === 'ST016');
    if (!st016) {
      st016 = {
        id: randomUUID(),
        ownerId: st011.ownerId,
        name: 'SUDHAKAR GAUR MH',
        employeeId: 'ST016',
        email: st011.email || 'sudhakar@arb-bearings.com',
        phoneNumber: st011.phoneNumber || '',
        backOfficeEmail: st011.backOfficeEmail || 'sales@arb-bearings.com',
        dealerCodes: st016Codes,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      salespersons.push(st016);
      console.log(`Created new salesperson ST016 with id: ${st016.id}`);
    } else {
      st016.name = 'SUDHAKAR GAUR MH';
      st016.dealerCodes = st016Codes;
      st016.updatedAt = new Date().toISOString();
      console.log(`Updated existing salesperson ST016 with id: ${st016.id}`);
    }

    // Update masterContacts
    let updatedContacts = 0;
    for (const c of contacts) {
      const code = (c.dealerCode || '').toUpperCase();
      if (st016Codes.includes(code)) {
        c.salespersonId = st016.id;
        c.salespersonName = 'SUDHAKAR GAUR MH';
        c.salespersonEmail = st016.email;
        updatedContacts++;
      } else if (st011Codes.includes(code)) {
        c.salespersonId = st011.id;
        c.salespersonName = 'SUDHAKAR GAUR';
        c.salespersonEmail = st011.email;
        updatedContacts++;
      }
    }
    console.log(`Updated ${updatedContacts} master contacts`);

    // Update dueRecords
    let updatedDuesST011 = 0;
    let updatedDuesST016 = 0;
    for (const d of dues) {
      const code = (d.dealerCode || d.customerCode || '').toUpperCase();
      if (st016Codes.includes(code)) {
        d.salespersonId = st016.id;
        d.salespersonName = 'SUDHAKAR GAUR MH';
        d.salespersonEmail = st016.email;
        updatedDuesST016++;
      } else if (st011Codes.includes(code)) {
        d.salespersonId = st011.id;
        d.salespersonName = 'SUDHAKAR GAUR';
        d.salespersonEmail = st011.email;
        updatedDuesST011++;
      }
    }
    console.log(`Updated dues: ST011 = ${updatedDuesST011}, ST016 = ${updatedDuesST016}`);

    // Save back to MongoDB
    await col.updateOne(
      { _id: 'primary' },
      {
        $set: {
          salespersons,
          masterContacts: contacts,
          dueRecords: dues
        }
      }
    );

    console.log('\nSuccessfully saved updated salespersons, contacts, and dueRecords to MongoDB!');
  } finally {
    await client.close();
  }
}

main().catch(console.error);
