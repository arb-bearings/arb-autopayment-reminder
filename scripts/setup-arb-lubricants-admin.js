const fs = require('fs');
const path = require('path');
const { MongoClient } = require('mongodb');
const { randomBytes, randomUUID, scryptSync } = require('crypto');

function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

const OPERATION_PASSWORD_KEYS = [
  { key: 'clear_logs', label: 'Clear Reminder Logs' },
  { key: 'reset_system', label: 'Reset System' },
  { key: 'clear_contacts', label: 'Clear Contact Directory' },
  { key: 'clear_dues', label: 'Clear Due Database' },
  { key: 'switch_mode', label: 'Switch Production / Test Mode' },
  { key: 'admin_settings', label: 'Admin Settings' },
  { key: 'master_upload', label: 'Master Database Upload' },
  { key: 'due_upload', label: 'Due Database Upload' },
  { key: 'dispatch', label: 'Dispatch Operations' },
  { key: 'report_generation', label: 'Report Generation' }
];

const DEFAULT_RULE_BLUEPRINTS = [
  { name: "30 Day Reminder", triggerDay: 30, enabled: true },
  { name: "45 Day Reminder", triggerDay: 45, enabled: true },
  { name: "60 Day Reminder", triggerDay: 60, enabled: true },
  { name: "75 Day Reminder", triggerDay: 75, enabled: true },
  { name: "80 Day Reminder", triggerDay: 80, enabled: false },
  { name: "85 Day Reminder", triggerDay: 85, enabled: false },
  { name: "90 Day Reminder", triggerDay: 90, enabled: true },
  { name: "95 Day Reminder", triggerDay: 95, enabled: true },
  { name: "100 Day Reminder", triggerDay: 100, enabled: true },
  { name: "110 Day Reminder", triggerDay: 110, enabled: false },
  { name: "120 Day Reminder", triggerDay: 120, enabled: false }
];

const DEFAULT_CASH_DISCOUNT_POLICIES = [
  { name: "30 Day CD", paymentWindowDays: 30, discountPercent: 3 },
  { name: "45 Day CD", paymentWindowDays: 45, discountPercent: 2 }
];

function buildSubject(triggerDay) {
  if (triggerDay === 30) return "Cash Discount Opportunity on Invoice {{invoiceNumber}}";
  if (triggerDay === 45) return "Cash Discount Reminder for Invoice {{invoiceNumber}}";
  return "Payment Reminder: Invoice {{invoiceNumber}} Due Notice";
}

function buildEmailBody(triggerDay) {
  if (triggerDay === 30) {
    return "Dear {{contactName}},\n\n{{cdMessage}}\n\nThank you for your attention in the matter.\n\nRegards,\n{{senderCompany}}";
  }
  if (triggerDay === 45) {
    return "Dear {{contactName}},\n\n{{cdMessage}}\n\nThank you for your attention in the matter.\n\nRegards,\n{{senderCompany}}";
  }
  return "Dear {{contactName}},\n\nPlease note that payment for invoice {{invoiceNumber}} with pending balance of {{pendingAmount}} is overdue.\n\nPlease clear the dues at your earliest convenience.\n\nRegards,\n{{senderCompany}}";
}

function buildWhatsappBody(triggerDay) {
  if (triggerDay === 30 || triggerDay === 45) {
    return "Dear {{contactName}}, {{cdShortMessage}} Regards, {{senderCompany}}";
  }
  return "Dear {{contactName}}, Payment for invoice {{invoiceNumber}} with pending amount {{pendingAmount}} is overdue. Please arrange payment. Regards, {{senderCompany}}";
}

async function main() {
  const envPath = path.join(__dirname, '..', '.env.local');
  if (!fs.existsSync(envPath)) {
    console.error('.env.local not found');
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
  if (!uri) {
    console.error('MONGODB_URI is missing');
    process.exit(1);
  }

  const targetEmail = env.SMTP_LUBRICANTS_USER || 'arb.lubricants1@gmail.com';
  const targetPassword = env.DEFAULT_OPERATION_PASSWORD || 'ARB@123#$';
  const appPassword = env.SMTP_LUBRICANTS_PASS || '';

  const client = new MongoClient(uri);
  await client.connect();
  console.log('Connected to MongoDB Atlas successfully.');

  try {
    // -------------------------------------------------------------
    // 1. Setup in ARB Lubricants DB
    // -------------------------------------------------------------
    const lubDbName = env.MONGODB_DB_LUBRICANTS || 'auto-payment-reminder-lubricants';
    console.log(`\n========================================`);
    console.log(`Configuring Database: ${lubDbName}`);
    console.log(`========================================`);

    const lubDb = client.db(lubDbName);
    const lubCol = lubDb.collection(env.MONGODB_COLLECTION || 'app_state');

    let lubDoc = await lubCol.findOne({ _id: 'primary' });
    if (!lubDoc) {
      lubDoc = {
        _id: 'primary',
        users: [],
        sessions: [],
        authEvents: [],
        masterContacts: [],
        dueRecords: [],
        reminderRules: [],
        templates: [],
        dispatchSettings: [],
        cashDiscountPolicies: [],
        reminderLogs: [],
        operationPasswords: [],
        salespersons: [],
        auditLogs: [],
        updatedAt: new Date().toISOString()
      };
    }

    if (!Array.isArray(lubDoc.users)) lubDoc.users = [];
    if (!Array.isArray(lubDoc.dispatchSettings)) lubDoc.dispatchSettings = [];
    if (!Array.isArray(lubDoc.reminderRules)) lubDoc.reminderRules = [];
    if (!Array.isArray(lubDoc.templates)) lubDoc.templates = [];
    if (!Array.isArray(lubDoc.cashDiscountPolicies)) lubDoc.cashDiscountPolicies = [];
    if (!Array.isArray(lubDoc.operationPasswords)) lubDoc.operationPasswords = [];

    // Find or create user
    let lubUser = lubDoc.users.find(u => u.email.toLowerCase() === targetEmail.toLowerCase());
    const now = new Date().toISOString();
    if (!lubUser) {
      lubUser = {
        id: randomUUID(),
        name: 'ARB Lubricants Super Admin',
        email: targetEmail,
        companyName: 'ARB Lubricants',
        passwordHash: hashPassword(targetPassword),
        role: 'super_admin',
        canSendManualReminders: true,
        createdAt: now,
        updatedAt: now
      };
      lubDoc.users.push(lubUser);
      console.log(`+ Created new super_admin user "${targetEmail}" with id: ${lubUser.id}`);
    } else {
      lubUser.name = 'ARB Lubricants Super Admin';
      lubUser.passwordHash = hashPassword(targetPassword);
      lubUser.role = 'super_admin';
      lubUser.canSendManualReminders = true;
      lubUser.companyName = 'ARB Lubricants';
      lubUser.updatedAt = now;
      console.log(`* Updated existing user "${targetEmail}" to super_admin and new password.`);
    }

    const companyWorkspaceId = 'company:arb-lubricants';
    const ownerIdsToConfigure = [lubUser.id, companyWorkspaceId];

    // Configure Dispatch Settings
    for (const ownerId of ownerIdsToConfigure) {
      let ds = lubDoc.dispatchSettings.find(s => s.ownerId === ownerId);
      if (!ds) {
        ds = { ownerId };
        lubDoc.dispatchSettings.push(ds);
      }
      ds.smtpHost = 'smtp.gmail.com';
      ds.smtpPort = 465;
      ds.smtpSecure = true;
      ds.smtpUser = targetEmail;
      ds.smtpPass = appPassword;
      ds.senderEmail = targetEmail;
      ds.smtpFrom = targetEmail;
      ds.senderMobileNumber = ds.senderMobileNumber || '';
      ds.smsProviderName = ds.smsProviderName || 'Twilio';
      ds.smsApiKey = ds.smsApiKey || '';
      ds.smsApiSecret = ds.smsApiSecret || '';
      ds.smsAccountSid = ds.smsAccountSid || '';
      ds.smsAuthToken = ds.smsAuthToken || '';
      ds.smsFromNumber = ds.smsFromNumber || '';
      ds.smsSenderId = ds.smsSenderId || '';
      ds.whatsappProviderName = ds.whatsappProviderName || 'Interakt';
      ds.whatsappApiKey = ds.whatsappApiKey || env.INTERAKT_API_KEY || '';
      ds.whatsappApiSecret = ds.whatsappApiSecret || '';
      ds.whatsappAccountSid = ds.whatsappAccountSid || '';
      ds.whatsappAuthToken = ds.whatsappAuthToken || '';
      ds.whatsappFromNumber = ds.whatsappFromNumber || '';
      ds.whatsappWebhookUrl = ds.whatsappWebhookUrl || '';
      ds.futureIntegrationNotes = ds.futureIntegrationNotes || '';
      ds.reportRecipients = [targetEmail];
      ds.reportFrequency = 'daily';
      ds.reportTime = '18:00';
      ds.emailEnabled = true;
      ds.whatsappEnabled = true;
      ds.smsEnabled = false;
      ds.thresholdAmount = ds.thresholdAmount || 10000;
      ds.updatedAt = now;
      console.log(`* Configured dispatch settings for ownerId: ${ownerId}`);
    }

    // Ensure default rules & templates exist
    if (lubDoc.reminderRules.length === 0) {
      console.log(`* Populating default reminder rules and templates for ${lubDbName}...`);
      for (const bp of DEFAULT_RULE_BLUEPRINTS) {
        const ruleId = randomUUID();
        const templateId = randomUUID();
        lubDoc.reminderRules.push({
          id: ruleId,
          ownerId: companyWorkspaceId,
          name: bp.name,
          triggerDay: bp.triggerDay,
          enabled: bp.enabled,
          autoSend: false,
          channels: {
            email: true,
            whatsapp: true,
            sms: false
          },
          templateId,
          createdAt: now,
          updatedAt: now
        });

        lubDoc.templates.push({
          id: templateId,
          ownerId: companyWorkspaceId,
          ruleId,
          name: bp.name,
          emailSubject: buildSubject(bp.triggerDay),
          emailBody: buildEmailBody(bp.triggerDay),
          whatsappBody: buildWhatsappBody(bp.triggerDay),
          smsBody: buildWhatsappBody(bp.triggerDay),
          updatedAt: now
        });
      }
    }

    // Ensure default CD policies exist
    if (lubDoc.cashDiscountPolicies.length === 0) {
      console.log(`* Populating default cash discount policies for ${lubDbName}...`);
      for (const cdp of DEFAULT_CASH_DISCOUNT_POLICIES) {
        lubDoc.cashDiscountPolicies.push({
          id: randomUUID(),
          ownerId: companyWorkspaceId,
          name: cdp.name,
          paymentWindowDays: cdp.paymentWindowDays,
          discountPercent: cdp.discountPercent,
          description: `Customer remains eligible for ${cdp.discountPercent}% cash discount when payment is cleared within ${cdp.paymentWindowDays} days.`,
          cdMessageTemplate: "Please note that a payment of {{cdAmount}} is due within the next {{daysBeforeDue}} days to avail the {{cdDiscountPercent}}% CD benefit on the basic value of invoice.\n\nTo avail the {{cdDiscountPercent}}% CD, please ensure that the payment is made before the invoice completes {{paymentWindowDays}} days.",
          cdMessageWithOlderTemplate: "Please note that a payment of {{cdAmount}} is due within the next {{daysBeforeDue}} days to avail the {{cdDiscountPercent}}% CD benefit on the basic value of invoice.\n\nTo avail the {{cdDiscountPercent}}% CD on {{cdAmount}}, please clear {{eligibleAmount}} before the invoice completes {{paymentWindowDays}} days to ensure that the payment is eligible for cash discount.",
          cdShortMessageTemplate: "Payment of {{cdAmount}} is due in {{daysBeforeDue}} days to avail {{cdDiscountPercent}}% CD on basic value of invoice. Ensure payment before {{paymentWindowDays}} days.",
          cdShortMessageWithOlderTemplate: "Payment of {{cdAmount}} is due in {{daysBeforeDue}} days to avail {{cdDiscountPercent}}% CD on basic value of invoice. To avail CD on {{cdAmount}}, please clear {{eligibleAmount}} before invoice completes {{paymentWindowDays}} days.",
          createdAt: now,
          updatedAt: now
        });
      }
    }

    // Configure operation passwords
    for (const op of OPERATION_PASSWORD_KEYS) {
      const existing = lubDoc.operationPasswords.find(p => p.key === op.key && (p.ownerId === lubUser.id || !p.ownerId));
      if (existing) {
        existing.passwordHash = hashPassword(targetPassword);
        existing.label = op.label;
        existing.ownerId = lubUser.id;
        existing.updatedAt = now;
      } else {
        lubDoc.operationPasswords.push({
          ownerId: lubUser.id,
          key: op.key,
          label: op.label,
          passwordHash: hashPassword(targetPassword),
          updatedAt: now
        });
      }
    }

    lubDoc.updatedAt = now;
    await lubCol.replaceOne({ _id: 'primary' }, lubDoc, { upsert: true });
    console.log(`Successfully saved ${lubDbName} configuration!`);


    // -------------------------------------------------------------
    // 2. Also ensure targetEmail is available in ARB Bearings DB
    // -------------------------------------------------------------
    const arbDbName = env.MONGODB_DB || 'auto-payment-reminder';
    console.log(`\n========================================`);
    console.log(`Configuring Database: ${arbDbName}`);
    console.log(`========================================`);

    const arbDb = client.db(arbDbName);
    const arbCol = arbDb.collection(env.MONGODB_COLLECTION || 'app_state');
    const arbDoc = await arbCol.findOne({ _id: 'primary' });

    if (arbDoc) {
      if (!Array.isArray(arbDoc.users)) arbDoc.users = [];
      let arbUser = arbDoc.users.find(u => u.email.toLowerCase() === targetEmail.toLowerCase());
      if (!arbUser) {
        arbDoc.users.push({
          id: randomUUID(),
          name: 'ARB Lubricants Super Admin',
          email: targetEmail,
          companyName: 'ARB Bearings private limited',
          passwordHash: hashPassword(targetPassword),
          role: 'super_admin',
          canSendManualReminders: true,
          createdAt: now,
          updatedAt: now
        });
        console.log(`+ Added super_admin user "${targetEmail}" to ${arbDbName}`);
      } else {
        arbUser.passwordHash = hashPassword(targetPassword);
        arbUser.role = 'super_admin';
        arbUser.canSendManualReminders = true;
        arbUser.updatedAt = now;
        console.log(`* Updated user "${targetEmail}" in ${arbDbName}`);
      }
      arbDoc.updatedAt = now;
      await arbCol.replaceOne({ _id: 'primary' }, arbDoc, { upsert: true });
      console.log(`Successfully updated ${arbDbName}!`);
    }

  } finally {
    await client.close();
    console.log('\nMongoDB connection closed.');
  }
}

main().catch(console.error);
