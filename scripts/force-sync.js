const { MongoClient } = require('mongodb');
const fs = require('fs');
const path = require('path');

async function main() {
  const envContent = fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8');
  const env = {};
  envContent.split('\n').forEach(line => {
    const m = line.trim().match(/^([^=]+)=(.*)$/);
    if (m) env[m[1].trim()] = m[2].trim();
  });

  const client = new MongoClient(env.MONGODB_URI);
  try {
    await client.connect();
    const db = client.db(env.MONGODB_DB || 'auto-payment-reminder');
    const col = db.collection(env.MONGODB_COLLECTION || 'app_state');
    const doc = await col.findOne({ _id: 'primary' });
    
    let updated = false;

    // Body 90 Text
    const body90 = `INVOICE {{invoiceNumber}}\n\nDear {{contactName}},\n\nThe payment against the Invoice {{invoiceNumber}} Dated {{billDate}} of amount Rs. {{amount}} is significantly overdue.\n\nSo kindly arrange to remit us the payment within the 5 days. If the payment remains pending beyond 90 days from the date of invoice, the future invoicing will be stopped.\n\nTo avoid any disruption, please ensure to clear this outstanding immediately.\n\nThank you for your prompt corporation in the matter.\n\nRegards,\n{{senderCompany}}`;
    
    // Body 95 Text
    const body95 = `Dear {{contactName}},\n\nThe payment against the Invoice {{invoiceNumber}} Dated {{billDate}} of amount Rs. {{amount}} is now 90 days overdue. \n\nAs per our company policy, your invoicing will be stopped effective today, as the outstanding payment has not been cleared within the 90-day credit period.\n\nSo please arrange to remit the outstanding payment immediately to ensure the continuation of supplies and the resumption of invoicing.\n\nThank you for your attention in the matter.\n\nRegards,\nARB Bearings Limited`;

    if (doc && doc.templates) {
      doc.templates.forEach(t => {
        if (t.name === '90 Day Reminder') {
          t.emailBody = body90;
          t.whatsappBody = `INVOICE {{invoiceNumber}} | Dear {{contactName}}, Invoice {{invoiceNumber}} Dated {{billDate}} of Rs. {{amount}} is significantly overdue. Pay within 5 days or future invoicing will be stopped. — {{senderCompany}}`;
          t.smsBody = t.whatsappBody;
          updated = true;
        }
        if (t.name === '95 Day Reminder') {
          t.emailBody = body95;
          t.whatsappBody = `INVOICE {{invoiceNumber}} | Dear {{contactName}}, Invoice {{invoiceNumber}} Dated {{billDate}} of Rs. {{amount}} is 90 days overdue. Invoicing will be stopped effective today. — ARB Bearings Limited`;
          t.smsBody = t.whatsappBody;
          updated = true;
        }
      });
      
      if (updated) {
        await col.updateOne({ _id: 'primary' }, { $set: { templates: doc.templates } });
        console.log("Templates successfully synced directly in MongoDB!");
      } else {
        console.log("No matching templates found to update.");
      }
    }
  } finally {
    await client.close();
  }
}

main().catch(console.error);
