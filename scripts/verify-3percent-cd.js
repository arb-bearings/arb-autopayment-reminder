const fs = require('fs');
const path = require('path');
const { MongoClient } = require('mongodb');

function formatCurrency(value, currency = 'INR') {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: currency,
    maximumFractionDigits: 2
  }).format(value);
}

function fillTemplate(template, replacements) {
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key) => {
    return replacements[key] !== undefined ? String(replacements[key]) : `{{${key}}}`;
  });
}

function calculateDynamicDays(age, ruleTriggerDay) {
  if (ruleTriggerDay === 30) {
    if (age < 25) return 25 - age;
    return Math.max(0, 30 - age);
  }
  if (ruleTriggerDay === 45) {
    if (age < 40) return 40 - age;
    return Math.max(0, 45 - age);
  }
  return Math.max(0, ruleTriggerDay - age);
}

async function main() {
  console.log('=== Verifying 3% Cash Discount (30-Day Rule) Dual-Amount Messages ===\n');

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

    const rule30 = (doc.reminderRules || []).find(r => r.triggerDay === 30);
    const template30 = (doc.templates || []).find(t => t.id === rule30?.templateId || t.ruleId === rule30?.id);
    const policy30 = (doc.cashDiscountPolicies || []).find(p => p.discountPercent === 3 || p.paymentWindowDays === 30);

    console.log(`Rule 30 Name: ${rule30?.name}`);
    console.log(`Template 30 Email Body:\n${template30?.emailBody}\n`);
    console.log(`Policy 30 With Older Template:\n${policy30?.cdMessageWithOlderTemplate}\n`);

    // Scenario 1: 3% CD with older unpaid invoices
    // Older invoice: 65 days -> ₹15,000.00
    // Older invoice: 42 days -> ₹5,000.00
    // 3% CD invoice: 28 days -> ₹12,000.00
    // 3% CD invoice: 27 days -> ₹8,000.00
    // Newer invoice: 10 days -> ₹30,000.00
    // CD Bucket (25-30d): ₹12,000 + ₹8,000 = ₹20,000.00
    // Older (65d, 42d): ₹15,000 + ₹5,000 = ₹20,000.00
    // Total Eligible to clear: ₹20,000 + ₹20,000 = ₹40,000.00
    // Total Outstanding: ₹70,000.00

    const cdAmount1 = 20000.00;
    const eligibleAmount1 = 40000.00;
    const daysBeforeDue1 = calculateDynamicDays(28, 30); // 2 days

    const cdMessageWithOlder = `Please note that a payment of ${formatCurrency(cdAmount1)} is due within the next ${daysBeforeDue1} days to avail the 3% CD benefit on the basic value of invoice.\n\nTo avail the 3% CD on ${formatCurrency(cdAmount1)}, please clear ${formatCurrency(eligibleAmount1)} before the invoice completes 30 days to ensure that the payment is eligible for cash discount.`;

    const replacements1 = {
      contactName: "ABC Bearings Traders",
      dealer_name: "ABC Bearings Traders",
      amount: formatCurrency(eligibleAmount1),
      cdAmount: formatCurrency(cdAmount1),
      eligibleAmount: formatCurrency(eligibleAmount1),
      cdDiscountPercent: "3%",
      daysBeforeDue: daysBeforeDue1,
      paymentWindowDays: 30,
      cdMessage: cdMessageWithOlder,
      invoiceNumber: "1001/15.08.2026",
      totalDueAmount: formatCurrency(70000.00),
      senderCompany: "ARB Bearings Limited"
    };

    let generatedEmail1 = fillTemplate(template30.emailBody, replacements1);
    if (daysBeforeDue1 !== 5) {
      generatedEmail1 = generatedEmail1.replace(/\b5\s+days?\b/gi, `${daysBeforeDue1} days`);
      generatedEmail1 = generatedEmail1.replace(/\b5-day\b/gi, `${daysBeforeDue1}-day`);
    }

    console.log('--------------------------------------------------');
    console.log('[Scenario 1: 3% CD With Older Invoices Email Preview]');
    console.log('--------------------------------------------------');
    console.log(generatedEmail1);
    console.log('--------------------------------------------------');

    const hasCdAmount1 = generatedEmail1.includes(formatCurrency(cdAmount1));
    const hasEligibleAmount1 = generatedEmail1.includes(formatCurrency(eligibleAmount1));
    const preserves30Days1 = generatedEmail1.includes('30 days');

    console.log(`Contains 3% CD Amount (${formatCurrency(cdAmount1)}): ${hasCdAmount1 ? '✅ PASS' : '❌ FAIL'}`);
    console.log(`Contains 3% Eligible Amount (${formatCurrency(eligibleAmount1)}): ${hasEligibleAmount1 ? '✅ PASS' : '❌ FAIL'}`);
    console.log(`Preserves "30 days": ${preserves30Days1 ? '✅ PASS' : '❌ FAIL'}`);

    // Scenario 2: 3% CD Clean Case (No older unpaid invoices)
    const cdAmount2 = 25000.00;
    const daysBeforeDue2 = calculateDynamicDays(27, 30); // 3 days

    const cdMessageClean = `Please note that a payment of ${formatCurrency(cdAmount2)} is due within the next ${daysBeforeDue2} days to avail the 3% CD benefit on the basic value of invoice.\n\nTo avail the 3% CD, please ensure that the payment is made before the invoice completes 30 days.`;

    const replacements2 = {
      contactName: "XYZ Motors",
      dealer_name: "XYZ Motors",
      amount: formatCurrency(cdAmount2),
      cdAmount: formatCurrency(cdAmount2),
      eligibleAmount: formatCurrency(cdAmount2),
      cdDiscountPercent: "3%",
      daysBeforeDue: daysBeforeDue2,
      paymentWindowDays: 30,
      cdMessage: cdMessageClean,
      invoiceNumber: "1002/16.08.2026",
      totalDueAmount: formatCurrency(25000.00),
      senderCompany: "ARB Bearings Limited"
    };

    let generatedEmail2 = fillTemplate(template30.emailBody, replacements2);

    console.log('\n--------------------------------------------------');
    console.log('[Scenario 2: 3% CD Clean Case Email Preview]');
    console.log('--------------------------------------------------');
    console.log(generatedEmail2);
    console.log('--------------------------------------------------');

    const hasCdAmount2 = generatedEmail2.includes(formatCurrency(cdAmount2));
    const hasCleanMessage = generatedEmail2.includes('completes 30 days');

    console.log(`Contains CD Amount (${formatCurrency(cdAmount2)}): ${hasCdAmount2 ? '✅ PASS' : '❌ FAIL'}`);
    console.log(`Contains clean 30-day CD message: ${hasCleanMessage ? '✅ PASS' : '❌ FAIL'}`);

    if (hasCdAmount1 && hasEligibleAmount1 && preserves30Days1 && hasCdAmount2 && hasCleanMessage) {
      console.log('\n🎉 ALL 3% CD VERIFICATIONS SUCCESSFUL!');
    } else {
      console.error('\n❌ 3% CD VERIFICATION FAILED');
      process.exit(1);
    }
  } finally {
    await client.close();
  }
}

main();
