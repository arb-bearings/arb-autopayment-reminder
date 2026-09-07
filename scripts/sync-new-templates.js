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
    
    if (!doc || !doc.templates) {
      console.log("No templates found in MongoDB primary document.");
      return;
    }

    const templates = [
      {
        names: ['30 Day Reminder', '30 Day', '30-Day Reminder'],
        emailBody: `Dear {{contactName}},\n\nPlease note that a payment of {{amount}} is due within the next 5 days to avail the 3% CD benefit on the invoice.\n\nTo avail the 3% CD, please ensure that the payment is made before the invoice completes 30 days.\n\nThank you for your attention in the matter.\n\nRegards,\nARB Bearings Limited`,
        whatsappBody: `Dear {{contactName}}, payment of {{amount}} is due in 5 days to avail 3% CD. Ensure payment before 30 days. — ARB Bearings Limited`
      },
      {
        names: ['45 Day Reminder', '45 Day', '45-Day Reminder', '45 Day Follow Up'],
        emailBody: `Dear {{contactName}},\n\nPlease note that a payment of {{amount}} is due within the next 5 days to avail the 2% CD benefit on the invoice.\n\nTo avail the 2% CD, please ensure that the payment is made before the invoice completes 45 days.\n\nThank you for your attention in the matter.\n\nRegards,\nARB Bearings Limited`,
        whatsappBody: `Dear {{contactName}}, payment of {{amount}} is due in 5 days to avail 2% CD. Ensure payment before 45 days. — ARB Bearings Limited`
      },
      {
        names: ['60 Day Reminder', '60 Day', '60-Day Reminder'],
        emailBody: `Dear {{contactName}},\n\nPlease note that a payment of {{amount}} will become due within the next 5 days, and the total outstanding amount is {{totalDueAmount}}.\n\nWe kindly request you to arrange payment of the due amount of {{amount}} by/before the due date, as per ARB’s payment terms.\n\nThank you for your attention in the matter.\n\nRegards,\nARB Bearings Limited`,
        whatsappBody: `Dear {{contactName}}, payment of {{amount}} will become due within 5 days, and total outstanding amount is {{totalDueAmount}}. Please pay before due date. — ARB Bearings Limited`
      },
      {
        names: ['75 Day Reminder', '75 Day', '75-Day Reminder', '60+ Day Reminder', '60+ Day'],
        emailBody: `Dear {{contactName}},\n\nPlease note that the payment of {{amount}} against the invoice is now overdue (has exceeded 60 days), and the total outstanding amount is {{totalDueAmount}}.\n\nWe kindly request you to arrange payment of the total overdue amount of {{amount}} at the earliest.\n\nThank you for your attention in the matter.\n\nRegards,\nARB Bearings Limited`,
        whatsappBody: `Dear {{contactName}}, payment of {{amount}} against invoice is now overdue (has exceeded 60 days), and total outstanding amount is {{totalDueAmount}}. Please arrange payment at the earliest. — ARB Bearings Limited`
      },
      {
        names: ['90 Day Reminder', '90 Day', '90-Day Reminder', '90+ Day Reminder', '90+ Day'],
        emailBody: `Dear {{contactName}},\n\nPlease note that the payment of {{amount}} against the invoice is now significantly overdue and has exceeded 90 days.\n\nAs per our company policy, invoicing will remain stopped until the outstanding payment is cleared.\n\nWe kindly request you to arrange payment of the total overdue amount of {{amount}} at the earliest to ensure the continuation of supplies and resumption of invoicing.\n\nThank you for your attention in the matter.\n\nRegards,\nARB Bearings Limited`,
        whatsappBody: `Dear {{contactName}}, payment of {{amount}} is significantly overdue and has exceeded 90 days. Invoicing will remain stopped until cleared. Please arrange payment at earliest. — ARB Bearings Limited`
      },
      {
        names: ['120 Day Reminder', '120 Day', '120-Day Reminder', '120+ Day Reminder', '120+ Day'],
        emailBody: `Dear {{contactName}},\n\nThis is to remind you that the payment of {{amount}} is now significantly overdue and has exceeded 120 days.\n\nYour invoicing has already been stopped due to the outstanding payment. Kindly arrange to clear the outstanding amount immediately to ensure the continuation of supplies and the resumption of invoicing.\n\nThank you for your attention in the matter.\n\nRegards,\nARB Bearings Limited`,
        whatsappBody: `Dear {{contactName}}, payment of {{amount}} is overdue (>120 days). Invoicing has been stopped. Kindly clear immediately. — ARB Bearings Limited`
      }
    ];

    let updateCount = 0;
    doc.templates.forEach(t => {
      const match = templates.find(item => item.names.some(n => n.toLowerCase() === t.name.toLowerCase()));
      if (match) {
        t.emailBody = match.emailBody;
        t.whatsappBody = match.whatsappBody;
        t.smsBody = match.whatsappBody;
        t.updatedAt = new Date().toISOString();
        updateCount++;
      }
    });

    if (updateCount > 0) {
      await col.updateOne({ _id: 'primary' }, { $set: { templates: doc.templates } });
      console.log(`Successfully updated ${updateCount} templates in MongoDB.`);
    } else {
      console.log("No matching templates found to update.");
    }
  } finally {
    await client.close();
  }
}

main().catch(console.error);
