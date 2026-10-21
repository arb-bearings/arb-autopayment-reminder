const { MongoClient } = require('mongodb');

const fs = require('fs');
const path = require('path');

// Load .env.local if present
const envPath = path.resolve(process.cwd(), '.env.local');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx !== -1) {
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim();
      if (!process.env[key]) process.env[key] = val;
    }
  }
}

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  console.error("Missing MONGODB_URI in environment");
  process.exit(1);
}
const DB_NAME = process.env.MONGODB_DB || "auto-payment-reminder";
const COLLECTION = process.env.MONGODB_COLLECTION || "app_state";
const DOC_ID = "primary";

async function simulateGeneration() {
  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  
  const db = client.db(DB_NAME);
  const col = db.collection(COLLECTION);
  const doc = await col.findOne({ _id: DOC_ID });

  function slugify(value) {
    return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  }

  // Simulate what generateRemindersForUser does for arbbearings.marketing@gmail.com
  const user = doc.users.find(u => u.email === 'arbbearings.marketing@gmail.com');
  console.log(`User: ${user.email} id=${user.id} company="${user.companyName}"`);

  // Simulate getCompanyWorkspaceContext
  const workspaceId = `company:${slugify(user.companyName)}`;
  const companyUsers = doc.users.filter(u => 
    u.companyName.trim().toLowerCase() === user.companyName.trim().toLowerCase()
  ).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  
  const adminUser = companyUsers.find(u => u.role === 'super_admin') || companyUsers.find(u => u.role === 'admin') || companyUsers[0];
  const sharedOwnerIds = new Set([workspaceId, ...companyUsers.map(u => u.id)]);
  const configOwnerId = adminUser?.id || workspaceId;

  console.log(`\nWorkspace ID: ${workspaceId}`);
  console.log(`Config owner ID (admin user): ${configOwnerId}`);
  console.log(`Admin user: ${adminUser?.email}`);
  console.log(`Shared owner IDs: ${[...sharedOwnerIds].join(', ')}`);

  // Check rules for configOwnerId
  const rules = doc.reminderRules.filter(r => r.ownerId === configOwnerId && r.enabled);
  console.log(`\nEnabled rules for configOwnerId (${configOwnerId}): ${rules.length}`);
  rules.forEach(r => console.log(`  - "${r.name}" triggerDay=${r.triggerDay} templateId=${r.templateId}`));

  // Check templates
  const templates = doc.templates.filter(t => t.ownerId === configOwnerId);
  console.log(`\nTemplates for configOwnerId: ${templates.length}`);

  // Check dispatch settings
  const ds = doc.dispatchSettings.find(s => s.ownerId === configOwnerId);
  console.log(`\nDispatch settings for configOwnerId: ${ds ? 'FOUND' : 'NOT FOUND'}`);
  if (ds) {
    console.log(`  emailEnabled=${ds.emailEnabled} whatsappEnabled=${ds.whatsappEnabled} thresholdAmount=${ds.thresholdAmount}`);
  } else {
    console.log(`  Will use defaults: emailEnabled=true, whatsappEnabled=true, thresholdAmount=10000`);
  }

  // Check dues
  const dues = doc.dueRecords.filter(d => sharedOwnerIds.has(d.ownerId));
  const duesWithAmount = dues.filter(d => d.amount > 0);
  console.log(`\nTotal dues: ${dues.length}`);
  console.log(`Dues with amount > 0: ${duesWithAmount.length}`);

  // Check contacts
  const contacts = doc.masterContacts.filter(c => sharedOwnerIds.has(c.ownerId));
  console.log(`Total contacts: ${contacts.length}`);

  // Check existing reminder logs (5-day cooldown check)
  const today = new Date();
  const todayStr = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())).toISOString();
  console.log(`\nScheduledFor (today): ${todayStr}`);
  
  const existingLogs = doc.reminderLogs || [];
  const todayLogs = existingLogs.filter(l => l.scheduledFor === todayStr);
  console.log(`Existing logs for today: ${todayLogs.length}`);

  // Check sent logs in last 5 days
  const sentInLast5Days = existingLogs.filter(l => {
    if (l.status !== 'sent') return false;
    const logDate = new Date(l.sentAt || l.createdAt);
    if (isNaN(logDate.getTime())) return false;
    const daysDiff = Math.floor((today - logDate) / (1000*60*60*24));
    return daysDiff >= 0 && daysDiff < 5;
  });
  console.log(`Sent logs in last 5 days: ${sentInLast5Days.length}`);
  if (sentInLast5Days.length > 0) {
    const uniqueDealers = new Set(sentInLast5Days.map(l => l.dealerCode || l.dealerName));
    console.log(`  Unique dealers with recent reminders: ${uniqueDealers.size}`);
    for (const d of uniqueDealers) {
      console.log(`    - ${d}`);
    }
  }

  // Simulate the generation process: for each dealer, check if they'd qualify
  console.log("\n=== SIMULATING GENERATION ===");
  
  // Group invoices by dealer
  function getDuePartyKey(due) {
    const code = (due.dealerCode || due.customerCode || '').trim().toLowerCase();
    const name = (due.companyName || '').trim().toLowerCase();
    return code || name;
  }

  function getBillAgeDays(billDate, today) {
    if (!billDate) return null;
    const d = new Date(billDate);
    if (isNaN(d.getTime())) return null;
    return Math.floor((today.getTime() - d.getTime()) / (1000*60*60*24));
  }

  const invoicesByDealer = new Map();
  for (const due of dues) {
    if (!(due.amount > 0)) continue;
    const key = getDuePartyKey(due);
    if (!invoicesByDealer.has(key)) invoicesByDealer.set(key, []);
    invoicesByDealer.get(key).push(due);
  }

  console.log(`Total dealers with invoices: ${invoicesByDealer.size}`);

  let skippedNoContact = 0;
  let skippedNoContactMethod = 0;
  let skippedNoAge = 0;
  let skippedBelowThreshold = 0;
  let skippedNoRule = 0;
  let skippedCooldown = 0;
  let skippedAlreadyScheduled = 0;
  let eligible = 0;

  const threshold = ds?.thresholdAmount || 10000;

  for (const [dealerKey, dealerInvoices] of invoicesByDealer) {
    const repDue = dealerInvoices[0];
    
    // Find matching contact
    const matchingContact = contacts.find(c => {
      const cCode = (c.dealerCode || c.customerCode || '').trim().toLowerCase();
      const cName = (c.companyName || '').trim().toLowerCase();
      const dCode = (repDue.dealerCode || repDue.customerCode || '').trim().toLowerCase();
      const dName = (repDue.companyName || '').trim().toLowerCase();
      return (dCode && cCode && cCode === dCode) || (dName && cName && cName === dName);
    });

    if (!matchingContact) {
      skippedNoContact++;
      continue;
    }

    const hasAny = Boolean(matchingContact.email?.trim() || matchingContact.whatsapp?.trim() || matchingContact.sms?.trim());
    if (!hasAny) {
      skippedNoContactMethod++;
      continue;
    }

    // Bucket invoices by age
    const invoicesWithAge = dealerInvoices
      .map(inv => ({ inv, age: getBillAgeDays(inv.billDate || inv.invoiceDate, today) }))
      .filter(item => item.age !== null)
      .sort((a, b) => b.age - a.age);

    if (invoicesWithAge.length === 0) {
      skippedNoAge++;
      continue;
    }

    // Check accumulation against threshold
    const bucket1 = invoicesWithAge.filter(i => i.age > 120);
    const bucket2 = invoicesWithAge.filter(i => i.age > 90 && i.age <= 120);
    const bucket3 = invoicesWithAge.filter(i => i.age > 60 && i.age <= 90);
    const bucket4 = invoicesWithAge.filter(i => i.age > 45 && i.age <= 60);
    const bucket5 = invoicesWithAge.filter(i => i.age >= 40 && i.age <= 45);
    const bucketMid = invoicesWithAge.filter(i => i.age > 30 && i.age < 40);
    const bucket6 = invoicesWithAge.filter(i => i.age >= 25 && i.age <= 30);

    const sums = [
      bucket1.reduce((s, i) => s + i.inv.amount, 0),
      bucket2.reduce((s, i) => s + i.inv.amount, 0),
      bucket3.reduce((s, i) => s + i.inv.amount, 0),
      bucket4.reduce((s, i) => s + i.inv.amount, 0),
      bucket5.reduce((s, i) => s + i.inv.amount, 0),
      bucketMid.reduce((s, i) => s + i.inv.amount, 0),
      bucket6.reduce((s, i) => s + i.inv.amount, 0),
    ];

    let selectedStage = 0;
    let accumulated = 0;
    const buckets = [bucket1, bucket2, bucket3, bucket4, bucket5, bucket6];
    const sumsArr = [sums[0], sums[1], sums[2], sums[3], sums[4], sums[6]];
    const triggerDays = [120, 90, 75, 60, 45, 30];

    for (let i = 0; i < buckets.length; i++) {
      if (selectedStage > 0) break;
      if (i === 5) { // bucket6 (30-day CD), include mid bucket
        accumulated += sums[5]; // bucketMid
      }
      if (buckets[i].length > 0) {
        accumulated += sumsArr[i];
        if (accumulated >= threshold) {
          selectedStage = i + 1;
        }
      }
    }

    if (selectedStage === 0) {
      skippedBelowThreshold++;
      continue;
    }

    // Check if rule exists
    const targetDay = triggerDays[selectedStage - 1];
    const rule = rules.find(r => r.triggerDay === targetDay);
    if (!rule) {
      skippedNoRule++;
      continue;
    }

    eligible++;
  }

  console.log(`\n--- Results ---`);
  console.log(`Skipped - no matching contact: ${skippedNoContact}`);
  console.log(`Skipped - no contact method (email/whatsapp/sms): ${skippedNoContactMethod}`);
  console.log(`Skipped - no valid bill dates: ${skippedNoAge}`);
  console.log(`Skipped - below threshold (${threshold}): ${skippedBelowThreshold}`);
  console.log(`Skipped - no matching rule: ${skippedNoRule}`);
  console.log(`ELIGIBLE for reminders: ${eligible}`);

  await client.close();
  console.log("\nSimulation complete.");
}

simulateGeneration().catch(err => {
  console.error("ERROR:", err);
  process.exit(1);
});
