const fs = require('fs');
const path = require('path');
const { MongoClient } = require('mongodb');

// Simple helper to test template formatting
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
  console.log('=== Verifying CD Dual-Amount Messages Against Photo Scenario ===\n');

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

    const rule45 = (doc.reminderRules || []).find(r => r.triggerDay === 45);
    const template45 = (doc.templates || []).find(t => t.id === rule45?.templateId || t.ruleId === rule45?.id);
    const policy45 = (doc.cashDiscountPolicies || []).find(p => p.discountPercent === 2 || p.paymentWindowDays === 45);

    console.log(`Rule 45 Name: ${rule45?.name}`);
    console.log(`Template 45 Email Body:\n${template45?.emailBody}\n`);
    console.log(`Policy 45 With Older Template:\n${policy45?.cdMessageWithOlderTemplate}\n`);

    // Scenario from photo:
    // 30 Jun (74d): 8364.19
    // 24 Jul (50d): 4447.49
    // 31 Jul (43d): 6282.32
    // 01 Aug (42d): 1908.07
    // CD Bucket (40-45d): 6282.32 + 1908.07 = 8190.39
    // Older (74d, 50d): 8364.19 + 4447.49 = 12811.68
    // Total Eligible to clear: 8190.39 + 12811.68 = 21002.07

    const cdAmount = 8190.39;
    const eligibleAmount = 21002.07;
    const daysBeforeDue = calculateDynamicDays(43, 45); // 2 days

    const cdMessageWithOlder = `To avail the 2% CD on ${formatCurrency(cdAmount)}, please clear ${formatCurrency(eligibleAmount)} before the invoice completes 45 days to ensure that the payment is eligible for cash discount.`;

    const replacements = {
      contactName: "Nagpal Bearing Centre",
      dealer_name: "Nagpal Bearing Centre",
      amount: formatCurrency(eligibleAmount),
      cdAmount: formatCurrency(cdAmount),
      eligibleAmount: formatCurrency(eligibleAmount),
      cdDiscountPercent: "2%",
      daysBeforeDue: daysBeforeDue,
      paymentWindowDays: 45,
      cdMessage: cdMessageWithOlder,
      invoiceNumber: "3054/31.07.2026/P-4",
      totalDueAmount: formatCurrency(192308.99),
      senderCompany: "ARB Bearings Limited"
    };

    let generatedEmail = fillTemplate(template45.emailBody, replacements);
    if (daysBeforeDue !== 5) {
      generatedEmail = generatedEmail.replace(/\b5\s+days?\b/gi, `${daysBeforeDue} days`);
      generatedEmail = generatedEmail.replace(/\b5-day\b/gi, `${daysBeforeDue}-day`);
    }

    console.log('--------------------------------------------------');
    console.log('GENERATED EMAIL PREVIEW:');
    console.log('--------------------------------------------------');
    console.log(generatedEmail);
    console.log('--------------------------------------------------');

    const hasCdAmount = generatedEmail.includes(formatCurrency(cdAmount));
    const hasEligibleAmount = generatedEmail.includes(formatCurrency(eligibleAmount));
    const preserves45Days = generatedEmail.includes('45 days');

    console.log(`\nContains CD Amount (${formatCurrency(cdAmount)}): ${hasCdAmount ? '✅ PASS' : '❌ FAIL'}`);
    console.log(`Contains Eligible Amount (${formatCurrency(eligibleAmount)}): ${hasEligibleAmount ? '✅ PASS' : '❌ FAIL'}`);
    console.log(`Correctly preserves "45 days" (no "42 days" corruption): ${preserves45Days ? '✅ PASS' : '❌ FAIL'}`);

    if (hasCdAmount && hasEligibleAmount && preserves45Days) {
      console.log('\n🎉 VERIFICATION SUCCESSFUL!');
    } else {
      console.error('\n❌ VERIFICATION FAILED');
      process.exit(1);
    }
  } finally {
    await client.close();
  }
}

main();
