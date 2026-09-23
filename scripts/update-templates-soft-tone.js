const fs = require('fs');
const path = require('path');
const { MongoClient } = require('mongodb');

async function main() {
  const envPath = path.join(__dirname, '..', '.env.local');
  const envContent = fs.readFileSync(envPath, 'utf8');
  const env = {};
  envContent.split('\n').forEach(line => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const match = trimmed.match(/^([^=]+)=(.*)$/);
    if (match) env[match[1].trim()] = match[2].trim();
  });
  
  const client = new MongoClient(env.MONGODB_URI);
  try {
    await client.connect();
    const db = client.db(env.MONGODB_DB || 'auto-payment-reminder');
    const col = db.collection(env.MONGODB_COLLECTION || 'app_state');
    const doc = await col.findOne({ _id: 'primary' });
    if (!doc) {
      console.log('No DB document found');
      return;
    }

    let changedCount = 0;
    const ruleByTemplateId = new Map((doc.reminderRules || []).map(r => [r.templateId, r]));

    doc.templates.forEach((t) => {
      const rule = ruleByTemplateId.get(t.id) || (doc.reminderRules || []).find(r => r.id === t.ruleId);
      const name = (t.name || '').toLowerCase();
      const triggerDay = rule?.triggerDay;

      let changed = false;

      // Update 90 Day Reminder
      if (triggerDay === 90 || name.includes('90 day')) {
        t.emailSubject = 'Critical: Payment more than 90 days — Future Invoicing on Hold';
        t.emailBody = 'Dear {{contactName}},\n\nPlease note that the payment of {{amount}} against the invoice is now significantly overdue and has exceeded 90 days.\n\nAs per our company policy, invoicing will remain on temporary hold until the outstanding payment is cleared.\n\nWe kindly request you to arrange payment of the total overdue amount of {{amount}} at the earliest to ensure the continuation of supplies and resumption of invoicing.\n\nThank you for your attention in the matter.\n\nRegards,\nARB Bearings Limited';
        t.whatsappBody = 'Dear {{contactName}}, payment of {{amount}} is significantly overdue and has exceeded 90 days. Invoicing will remain on hold until cleared. Please arrange payment at earliest. — ARB Bearings Limited';
        t.smsBody = t.whatsappBody;
        t.updatedAt = new Date().toISOString();
        changed = true;
      }
      // Update 95 Day Reminder
      else if (triggerDay === 95 || name.includes('95 day')) {
        t.emailBody = 'Dear {{contactName}},\n\nThe payment more than 95 days of amount Rs. {{amount}} is now 90 days overdue. \n\nAs per our company policy, your invoicing will be put on hold, if the outstanding payment has not been cleared within the 90-day credit period.\n\nSo please arrange to remit the outstanding payment immediately to ensure the continuation of supplies and the resumption of invoicing.\n\nThank you for your attention in the matter.\n\nRegards,\nARB Bearings Limited';
        t.whatsappBody = 'Dear {{contactName}}, payment more than 95 days of Rs. {{amount}} is 90 days overdue. Invoicing will be on hold. — ARB Bearings Limited';
        t.smsBody = t.whatsappBody;
        t.updatedAt = new Date().toISOString();
        changed = true;
      }
      // Update 100 Day Reminder
      else if (triggerDay === 100 || name.includes('100 day')) {
        t.emailSubject = 'Invoicing on Hold: Payment more than 100 days — Immediate Attention Required';
        t.emailBody = 'Dear {{contactName}},\n\nThis is to remind you that the payment more than 100 days, amounting to Rs. {{amount}}, is now 95 days overdue.\n\nYour invoicing has been put on temporary hold due to the outstanding payment. Kindly arrange to clear the outstanding amount immediately to ensure the continuation of supplies and the resumption of invoicing.\n\nThank you for your attention in the matter.\n\nRegards,\nARB Bearings Limited';
        t.whatsappBody = 'Dear {{contactName}}, payment more than 100 days of Rs. {{amount}} is 95 days overdue. Invoicing is on hold. — ARB Bearings Limited';
        t.smsBody = t.whatsappBody;
        t.updatedAt = new Date().toISOString();
        changed = true;
      }
      // Update 110 Day Reminder
      else if (triggerDay === 110 || name.includes('110 day')) {
        t.emailSubject = 'Invoicing on Hold: Payment more than 110 days — Immediate Attention Required';
        t.emailBody = 'Dear {{contactName}},\n\nThis is to remind you that the payment more than 110 days, amounting to Rs. {{amount}}, is now 105 days overdue.\n\nYour invoicing has been put on temporary hold due to the outstanding payment. Kindly arrange to clear the outstanding amount immediately to ensure the continuation of supplies and the resumption of invoicing.\n\nThank you for your attention in the matter.\n\nRegards,\nARB Bearings Limited';
        t.whatsappBody = 'Dear {{contactName}}, payment more than 110 days of Rs. {{amount}} is 105 days overdue. Invoicing is on hold. — ARB Bearings Limited';
        t.smsBody = t.whatsappBody;
        t.updatedAt = new Date().toISOString();
        changed = true;
      }
      // Update 120 Day Reminder
      else if (triggerDay === 120 || name.includes('120 day')) {
        t.emailSubject = 'Invoicing on Hold: Payment more than 120 days — Immediate Attention Required';
        t.emailBody = 'Dear {{contactName}},\n\nThis is to remind you that the payment of {{amount}} is now significantly overdue and has exceeded 120 days.\n\nYour invoicing has been put on temporary hold due to the outstanding payment. Kindly arrange to clear the outstanding amount immediately to ensure the continuation of supplies and the resumption of invoicing.\n\nThank you for your attention in the matter.\n\nRegards,\nARB Bearings Limited';
        t.whatsappBody = 'Dear {{contactName}}, payment of {{amount}} is overdue (>120 days). Invoicing is on hold. Kindly clear immediately. — ARB Bearings Limited';
        t.smsBody = t.whatsappBody;
        t.updatedAt = new Date().toISOString();
        changed = true;
      }
      // Check if any other template has "stopped" in it and replace cleanly
      else {
        if (t.emailSubject && t.emailSubject.includes('Stopped')) {
          t.emailSubject = t.emailSubject.replace(/Stopped/g, 'on Hold');
          changed = true;
        }
        if (t.emailBody && (t.emailBody.includes('stopped') || t.emailBody.includes('Stopped'))) {
          t.emailBody = t.emailBody
            .replace(/will remain stopped/g, 'will remain on temporary hold')
            .replace(/will be stopped/g, 'will be put on hold')
            .replace(/has already been stopped/g, 'has been put on temporary hold')
            .replace(/has been stopped/g, 'is on hold');
          changed = true;
        }
        if (t.whatsappBody && (t.whatsappBody.includes('stopped') || t.whatsappBody.includes('Stopped'))) {
          t.whatsappBody = t.whatsappBody
            .replace(/will remain stopped/g, 'will remain on hold')
            .replace(/will be stopped/g, 'will be on hold')
            .replace(/has already been stopped/g, 'is on hold')
            .replace(/has been stopped/g, 'is on hold');
          changed = true;
        }
        if (t.smsBody && (t.smsBody.includes('stopped') || t.smsBody.includes('Stopped'))) {
          t.smsBody = t.whatsappBody;
          changed = true;
        }
        if (changed) {
          t.updatedAt = new Date().toISOString();
        }
      }

      if (changed) {
        changedCount++;
        console.log(`Updated template: ${t.name} (triggerDay: ${triggerDay})`);
      }
    });

    if (changedCount > 0) {
      await col.updateOne({ _id: 'primary' }, { $set: { templates: doc.templates, updatedAt: new Date().toISOString() } });
      console.log(`Successfully updated ${changedCount} templates in MongoDB!`);
    } else {
      console.log('No templates required updating.');
    }
  } finally {
    await client.close();
  }
}

main().catch(console.error);
