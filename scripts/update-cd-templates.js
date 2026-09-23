const fs = require('fs');
const path = require('path');
const { MongoClient } = require('mongodb');

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

      // Update 30 Day Reminder (3% CD)
      if (triggerDay === 30 || name.includes('30 day')) {
        t.emailBody = 'Dear {{contactName}},\n\n{{cdMessage}}\n\nThank you for your attention in the matter.\n\nRegards,\nARB Bearings Limited';
        t.whatsappBody = 'Dear {{contactName}}, {{cdShortMessage}} — ARB Bearings Limited';
        t.smsBody = t.whatsappBody;
        t.updatedAt = new Date().toISOString();
        changedCount++;
      }
      // Update 45 Day Reminder (2% CD)
      else if (triggerDay === 45 || name.includes('45 day')) {
        t.emailBody = 'Dear {{contactName}},\n\n{{cdMessage}}\n\nThank you for your attention in the matter.\n\nRegards,\nARB Bearings Limited';
        t.whatsappBody = 'Dear {{contactName}}, {{cdShortMessage}} — ARB Bearings Limited';
        t.smsBody = t.whatsappBody;
        t.updatedAt = new Date().toISOString();
        changedCount++;
      }
    });

    // Update cashDiscountPolicies
    if (doc.cashDiscountPolicies && doc.cashDiscountPolicies.length > 0) {
      doc.cashDiscountPolicies.forEach(p => {
        p.cdMessageTemplate = "Please note that a payment of {{cdAmount}} is due within the next {{daysBeforeDue}} days to avail the {{cdDiscountPercent}}% CD benefit on the invoice.\n\nTo avail the {{cdDiscountPercent}}% CD, please ensure that the payment is made before the invoice completes {{paymentWindowDays}} days.";
        p.cdMessageWithOlderTemplate = "To avail the {{cdDiscountPercent}}% CD on {{cdAmount}}, please clear {{eligibleAmount}} before the invoice completes {{paymentWindowDays}} days to ensure that the payment is eligible for cash discount.";
        p.cdShortMessageTemplate = "Payment of {{cdAmount}} is due in {{daysBeforeDue}} days to avail {{cdDiscountPercent}}% CD. Ensure payment before {{paymentWindowDays}} days.";
        p.cdShortMessageWithOlderTemplate = "To avail {{cdDiscountPercent}}% CD on {{cdAmount}}, please clear {{eligibleAmount}} before invoice completes {{paymentWindowDays}} days.";
        p.updatedAt = new Date().toISOString();
      });
    }

    await col.updateOne({ _id: 'primary' }, {
      $set: {
        templates: doc.templates,
        cashDiscountPolicies: doc.cashDiscountPolicies
      }
    });

    console.log(`✅ Successfully updated ${changedCount} CD reminder templates and cash discount policies in MongoDB.`);
  } catch (err) {
    console.error('Error updating templates:', err);
  } finally {
    await client.close();
  }
}

main();
