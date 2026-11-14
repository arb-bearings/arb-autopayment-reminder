const { MongoClient } = require('mongodb');
const fs = require('fs');
const path = require('path');

function normalizeCompanyName(value) {
  if (!value) return '';
  return value
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[\(\)\[\]\{\}\.,\-_'"\/\\#@!]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeCompanyNameStrict(value) {
  if (!value) return '';
  return value
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]/g, '');
}

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
    const salespersons = doc.salespersons || [];

    console.log(`Loaded ${contacts.length} contacts, ${dues.length} dues, ${salespersons.length} salespersons.`);

    // Build contact lookups
    const contactByCode = new Map();
    const contactByName = new Map();
    const contactByNorm = new Map();
    const contactByStrict = new Map();

    for (const c of contacts) {
      if (c.dealerCode) contactByCode.set(c.dealerCode.toLowerCase().trim(), c);
      if (c.companyName) {
        contactByName.set(c.companyName.toLowerCase().trim(), c);
        const normKey = normalizeCompanyName(c.companyName);
        if (normKey) contactByNorm.set(normKey, c);
        const strictKey = normalizeCompanyNameStrict(c.companyName);
        if (strictKey) contactByStrict.set(strictKey, c);
      }
    }

    // Build salesperson lookup
    const spByDealerCode = new Map();
    for (const sp of salespersons) {
      for (const code of (sp.dealerCodes || [])) {
        const c = code.toLowerCase().trim();
        if (c) spByDealerCode.set(c, sp);
      }
    }

    let newlyMatchedCount = 0;
    let newlyAssignedSpCount = 0;

    for (const due of dues) {
      let matched = null;
      const dCode = (due.dealerCode || due.customerCode || '').toLowerCase().trim();
      const dName = (due.companyName || '').toLowerCase().trim();
      const dNorm = normalizeCompanyName(due.companyName || '');
      const dStrict = normalizeCompanyNameStrict(due.companyName || '');

      if (dCode && contactByCode.has(dCode)) {
        matched = contactByCode.get(dCode);
      } else if (dName && contactByName.has(dName)) {
        matched = contactByName.get(dName);
      } else if (dNorm && contactByNorm.has(dNorm)) {
        matched = contactByNorm.get(dNorm);
      } else if (dStrict && dStrict.length >= 4 && contactByStrict.has(dStrict)) {
        matched = contactByStrict.get(dStrict);
      }

      if (matched) {
        const wasMissing = due.contactMatchStatus === 'missing' || !due.dealerCode;
        due.matchedContactId = matched.id;
        due.matchedContactName = matched.primaryContact || matched.companyName || '';
        due.matchedEmail = matched.email || '';
        due.matchedWhatsapp = matched.whatsapp || '';
        due.matchedSms = matched.sms || '';
        due.contactMatchStatus = 'matched';

        if (!due.dealerCode && matched.dealerCode) {
          due.dealerCode = matched.dealerCode;
          due.customerCode = matched.dealerCode;
        }
        if (matched.companyName && !due.companyName) {
          due.companyName = matched.companyName;
        }

        if (wasMissing) {
          newlyMatchedCount++;
        }
      }

      // Assign salesperson if missing
      if ((!due.salespersonName || due.salespersonName === 'Unassigned') && due.dealerCode) {
        const sp = spByDealerCode.get(due.dealerCode.toLowerCase().trim());
        if (sp) {
          due.salespersonId = sp.id;
          due.salespersonName = sp.name;
          due.salespersonEmail = sp.email;
          newlyAssignedSpCount++;
        }
      }
    }

    console.log(`Newly matched contacts: ${newlyMatchedCount}`);
    console.log(`Newly assigned salespersons: ${newlyAssignedSpCount}`);

    // Check Trivedi Bearing records specifically
    const trivediDues = dues.filter(d => 
      d.companyName && d.companyName.toLowerCase().includes('trivedi')
    );
    console.log(`\nTrivedi Bearing dues (${trivediDues.length}):`);
    trivediDues.forEach(d => {
      console.log(`  - Inv: ${d.invoiceNumber}, Code: ${d.dealerCode}, Contact: ${d.contactMatchStatus}, Manager: ${d.salespersonName}`);
    });

    // Save back to MongoDB
    await col.updateOne(
      { _id: 'primary' },
      { $set: { dueRecords: dues } }
    );

    console.log('\nSuccessfully saved updated dueRecords to MongoDB primary document!');
  } finally {
    await client.close();
  }
}

main().catch(console.error);
