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

async function diagnose() {
  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  console.log("Connected to MongoDB");

  const db = client.db(DB_NAME);
  const col = db.collection(COLLECTION);
  const doc = await col.findOne({ _id: DOC_ID });

  if (!doc) {
    console.log("ERROR: No primary document found!");
    await client.close();
    return;
  }

  // 1. Users
  console.log("\n=== USERS ===");
  const users = doc.users || [];
  console.log(`Total users: ${users.length}`);
  users.forEach(u => console.log(`  - ${u.email} (${u.role}) id=${u.id} company="${u.companyName}"`));

  // 2. Due Records
  console.log("\n=== DUE RECORDS ===");
  const dues = doc.dueRecords || [];
  console.log(`Total due records: ${dues.length}`);
  if (dues.length > 0) {
    // Show first 5
    dues.slice(0, 5).forEach(d => {
      const age = d.billDate ? Math.floor((Date.now() - new Date(d.billDate).getTime()) / (1000*60*60*24)) : 'N/A';
      console.log(`  - Dealer: "${d.companyName}" code="${d.dealerCode}" inv="${d.invoiceNumber}" amt=${d.amount} billDate=${d.billDate} age=${age} ownerId=${d.ownerId} matchStatus=${d.contactMatchStatus}`);
    });
    if (dues.length > 5) console.log(`  ... and ${dues.length - 5} more`);
  }

  // 3. Master Contacts
  console.log("\n=== MASTER CONTACTS ===");
  const contacts = doc.masterContacts || [];
  console.log(`Total master contacts: ${contacts.length}`);
  if (contacts.length > 0) {
    contacts.slice(0, 5).forEach(c => {
      console.log(`  - "${c.companyName}" code="${c.dealerCode}" email="${c.email}" whatsapp="${c.whatsapp}" ownerId=${c.ownerId}`);
    });
    if (contacts.length > 5) console.log(`  ... and ${contacts.length - 5} more`);
  }

  // 4. Reminder Rules
  console.log("\n=== REMINDER RULES ===");
  const rules = doc.reminderRules || [];
  console.log(`Total rules: ${rules.length}`);
  rules.forEach(r => console.log(`  - "${r.name}" triggerDay=${r.triggerDay} enabled=${r.enabled} ownerId=${r.ownerId} templateId=${r.templateId}`));

  // 5. Templates
  console.log("\n=== TEMPLATES ===");
  const templates = doc.templates || [];
  console.log(`Total templates: ${templates.length}`);
  templates.forEach(t => console.log(`  - id=${t.id} name="${t.name}" ownerId=${t.ownerId} ruleId=${t.ruleId} hasEmailBody=${!!t.emailBody}`));

  // 6. Dispatch Settings
  console.log("\n=== DISPATCH SETTINGS ===");
  const ds = doc.dispatchSettings || [];
  console.log(`Total dispatch settings: ${ds.length}`);
  ds.forEach(s => console.log(`  - ownerId=${s.ownerId} emailEnabled=${s.emailEnabled} whatsappEnabled=${s.whatsappEnabled} thresholdAmount=${s.thresholdAmount}`));

  // 7. Reminder Logs
  console.log("\n=== REMINDER LOGS ===");
  const logs = doc.reminderLogs || [];
  console.log(`Total reminder logs: ${logs.length}`);
  const pending = logs.filter(l => l.status === 'pending').length;
  const sent = logs.filter(l => l.status === 'sent').length;
  const failed = logs.filter(l => l.status === 'failed').length;
  console.log(`  Pending: ${pending}, Sent: ${sent}, Failed: ${failed}`);
  if (logs.length > 0) {
    // Show last 5 logs
    console.log("  Last 5 logs:");
    logs.slice(-5).forEach(l => console.log(`    - dealer="${l.dealerName}" inv="${l.invoiceNumber}" status=${l.status} channel=${l.channel} scheduledFor=${l.scheduledFor} sentAt=${l.sentAt} createdAt=${l.createdAt}`));
  }

  // 8. Cross-check: ownerIds match
  console.log("\n=== OWNER ID ANALYSIS ===");
  const userOwnerIds = new Set(users.map(u => u.id));
  const dueOwnerIds = new Set(dues.map(d => d.ownerId));
  const contactOwnerIds = new Set(contacts.map(c => c.ownerId));
  const ruleOwnerIds = new Set(rules.map(r => r.ownerId));
  console.log(`User IDs: ${[...userOwnerIds].join(', ')}`);
  console.log(`Due record owner IDs: ${[...dueOwnerIds].join(', ')}`);
  console.log(`Contact owner IDs: ${[...contactOwnerIds].join(', ')}`);
  console.log(`Rule owner IDs: ${[...ruleOwnerIds].join(', ')}`);

  // Check for mismatch
  for (const dueOwnerId of dueOwnerIds) {
    if (!userOwnerIds.has(dueOwnerId)) {
      console.log(`  WARNING: Due records ownerId "${dueOwnerId}" not found in users!`);
    }
  }
  for (const contactOwnerId of contactOwnerIds) {
    if (!userOwnerIds.has(contactOwnerId)) {
      console.log(`  WARNING: Contact ownerId "${contactOwnerId}" not found in users!`);
    }
  }

  // 9. Check matching - do dues have matching contacts?
  console.log("\n=== CONTACT MATCHING CHECK ===");
  const matchedDues = dues.filter(d => d.contactMatchStatus === 'matched');
  const missingDues = dues.filter(d => d.contactMatchStatus === 'missing' || !d.contactMatchStatus);
  console.log(`Matched dues: ${matchedDues.length}`);
  console.log(`Missing/unmatched dues: ${missingDues.length}`);
  
  if (missingDues.length > 0) {
    console.log("  Sample unmatched dues:");
    missingDues.slice(0, 5).forEach(d => {
      console.log(`    - code="${d.dealerCode}" name="${d.companyName}" matchedContactId="${d.matchedContactId || 'NONE'}" matchedEmail="${d.matchedEmail || 'NONE'}"`);
    });
  }

  // 10. Ageing analysis for matched dues
  console.log("\n=== AGEING ANALYSIS ===");
  const today = new Date();
  let ageBreakdown = { lt25: 0, b25_30: 0, b30_40: 0, b40_45: 0, b45_60: 0, b60_90: 0, b90_120: 0, gt120: 0, unknown: 0 };
  for (const d of dues) {
    if (!d.billDate) { ageBreakdown.unknown++; continue; }
    const age = Math.floor((today.getTime() - new Date(d.billDate).getTime()) / (1000*60*60*24));
    if (age < 25) ageBreakdown.lt25++;
    else if (age >= 25 && age <= 30) ageBreakdown.b25_30++;
    else if (age > 30 && age < 40) ageBreakdown.b30_40++;
    else if (age >= 40 && age <= 45) ageBreakdown.b40_45++;
    else if (age > 45 && age <= 60) ageBreakdown.b45_60++;
    else if (age > 60 && age <= 90) ageBreakdown.b60_90++;
    else if (age > 90 && age <= 120) ageBreakdown.b90_120++;
    else if (age > 120) ageBreakdown.gt120++;
  }
  console.log(`  < 25 days: ${ageBreakdown.lt25}`);
  console.log(`  25-30 days (3% CD): ${ageBreakdown.b25_30}`);
  console.log(`  30-40 days: ${ageBreakdown.b30_40}`);
  console.log(`  40-45 days (2% CD): ${ageBreakdown.b40_45}`);
  console.log(`  45-60 days: ${ageBreakdown.b45_60}`);
  console.log(`  60-90 days: ${ageBreakdown.b60_90}`);
  console.log(`  90-120 days: ${ageBreakdown.b90_120}`);
  console.log(`  > 120 days: ${ageBreakdown.gt120}`);
  console.log(`  Unknown date: ${ageBreakdown.unknown}`);

  // 11. Check threshold
  console.log("\n=== THRESHOLD ANALYSIS ===");
  const threshold = ds[0]?.thresholdAmount || 10000;
  console.log(`Threshold amount: ${threshold}`);

  // Group by dealer and check if total outstanding >= threshold
  const dealerMap = new Map();
  for (const d of dues) {
    const key = (d.dealerCode || d.companyName || '').toLowerCase().trim();
    if (!key) continue;
    if (!dealerMap.has(key)) dealerMap.set(key, { name: d.companyName, code: d.dealerCode, total: 0, count: 0, hasContact: false });
    dealerMap.get(key).total += d.amount || 0;
    dealerMap.get(key).count++;
  }
  // Check contact matching for each dealer
  for (const [key, info] of dealerMap) {
    const hasMatch = contacts.some(c => {
      const cKey = (c.dealerCode || c.companyName || '').toLowerCase().trim();
      return cKey === key;
    });
    info.hasContact = hasMatch;
  }

  let aboveThreshold = 0;
  let belowThreshold = 0;
  let aboveWithContact = 0;
  let aboveWithoutContact = 0;
  for (const [key, info] of dealerMap) {
    if (info.total >= threshold) {
      aboveThreshold++;
      if (info.hasContact) aboveWithContact++;
      else aboveWithoutContact++;
    } else {
      belowThreshold++;
    }
  }
  console.log(`Total unique dealers: ${dealerMap.size}`);
  console.log(`Dealers above threshold (${threshold}): ${aboveThreshold}`);
  console.log(`  With matching contact: ${aboveWithContact}`);
  console.log(`  Without matching contact: ${aboveWithoutContact}`);
  console.log(`Dealers below threshold: ${belowThreshold}`);

  // 12. Salespersons
  console.log("\n=== SALESPERSONS ===");
  const sp = doc.salespersons || [];
  console.log(`Total salespersons: ${sp.length}`);
  sp.forEach(s => console.log(`  - "${s.name}" email="${s.email}" dealerCodes=${(s.dealerCodes || []).length}`));

  // 13. Company workspace check
  console.log("\n=== COMPANY WORKSPACE ===");
  users.forEach(u => {
    console.log(`  User "${u.email}" companyName="${u.companyName}"`);
    const userDues = dues.filter(d => d.ownerId === u.id);
    const userContacts = contacts.filter(c => c.ownerId === u.id);
    const userRules = rules.filter(r => r.ownerId === u.id);
    console.log(`    -> Dues: ${userDues.length}, Contacts: ${userContacts.length}, Rules: ${userRules.length}`);
  });

  await client.close();
  console.log("\nDiagnosis complete.");
}

diagnose().catch(err => {
  console.error("ERROR:", err);
  process.exit(1);
});
