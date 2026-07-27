const fs = require('fs');
const path = require('path');
const { MongoClient } = require('mongodb');
const crypto = require('crypto');

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

    console.log('Adding 125 Day Reminder rule and template to existing company configurations...');

    // Collect all unique ownerIds (workspaces) from users
    const ownerIds = Array.from(new Set(doc.users?.map(u => u.id).filter(Boolean)));
    // Also include ownerIds from reminderRules
    doc.reminderRules?.forEach(r => {
      if (r.ownerId) ownerIds.push(r.ownerId);
    });
    const uniqueOwnerIds = Array.from(new Set(ownerIds));

    let rulesAdded = 0;
    doc.reminderRules = doc.reminderRules || [];
    doc.templates = doc.templates || [];

    for (const ownerId of uniqueOwnerIds) {
      const has125Rule = doc.reminderRules.some(r => r.ownerId === ownerId && r.triggerDay === 125);
      if (!has125Rule) {
        const ruleId = crypto.randomUUID();
        const templateId = crypto.randomUUID();

        // Create template
        doc.templates.push({
          id: templateId,
          ownerId,
          ruleId,
          name: '125 Day Reminder',
          emailSubject: 'Invoicing Stopped: Invoice {{invoiceNumber}} — Immediate Attention Required',
          emailBody: 'INVOICE {{invoiceNumber}}\n\nDear {{contactName}},\n\nThis is to remind you that the payment against Invoice {{invoiceNumber}} dated {{billDate}}, amounting to Rs. {{amount}}, is now 120 days overdue.\n\nYour invoicing has already been stopped due to the outstanding payment. Kindly arrange to clear the outstanding amount immediately to ensure the continuation of supplies and the resumption of invoicing.\n\nThank you for your attention in the matter.\n\nRegards,\n{{senderCompany}}\n*********',
          whatsappBody: 'INVOICE {{invoiceNumber}} | Dear {{contactName}}, Invoice {{invoiceNumber}} Dated {{billDate}} of Rs. {{amount}} is 120 days overdue. Invoicing has been stopped. — {{senderCompany}}',
          smsBody: 'INVOICE {{invoiceNumber}} | Dear {{contactName}}, Invoice {{invoiceNumber}} Dated {{billDate}} of Rs. {{amount}} is 120 days overdue. Invoicing has been stopped. — {{senderCompany}}',
          updatedAt: new Date().toISOString()
        });

        // Create rule
        doc.reminderRules.push({
          id: ruleId,
          ownerId,
          name: '125 Day Reminder',
          triggerDay: 125,
          enabled: true,
          autoSend: false,
          channels: {
            email: true,
            whatsapp: true,
            sms: false
          },
          templateId,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        });

        rulesAdded++;
      }
    }

    if (rulesAdded > 0) {
      await collection.updateOne({ _id: 'primary' }, { 
        $set: { 
          reminderRules: doc.reminderRules,
          templates: doc.templates
        } 
      });
      console.log(`Successfully added 125 Day Reminder to ${rulesAdded} workspaces.`);
    } else {
      console.log('All workspaces already have the 125 Day Reminder.');
    }

  } catch (err) {
    console.error('Error:', err);
  } finally {
    await client.close();
  }
}

main();
