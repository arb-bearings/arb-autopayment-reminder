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

async function fix() {
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

  // The canonical company name used across all data
  const CANONICAL_COMPANY = "ARB Bearings private limited";
  
  // Fix user arbbearings.marketing@gmail.com - update companyName to match existing data
  const users = doc.users || [];
  let updated = false;
  
  for (const user of users) {
    const email = (user.email || '').toLowerCase();
    // Fix any user whose company name doesn't match the canonical one
    // but is meant to be an ARB Bearings user
    if (email === 'arbbearings.marketing@gmail.com') {
      console.log(`\nFixing user: ${email}`);
      console.log(`  Old companyName: "${user.companyName}"`);
      user.companyName = CANONICAL_COMPANY;
      console.log(`  New companyName: "${user.companyName}"`);
      updated = true;
    }
  }

  if (updated) {
    await col.updateOne(
      { _id: DOC_ID },
      { $set: { users: users, updatedAt: new Date().toISOString() } }
    );
    console.log("\nDatabase updated successfully!");
  } else {
    console.log("\nNo changes needed.");
  }

  // Verify the fix
  console.log("\n=== VERIFICATION ===");
  const updatedDoc = await col.findOne({ _id: DOC_ID });
  const fixedUser = updatedDoc.users.find(u => u.email === 'arbbearings.marketing@gmail.com');
  console.log(`User: ${fixedUser.email}`);
  console.log(`Company: ${fixedUser.companyName}`);
  console.log(`Role: ${fixedUser.role}`);
  
  // Check workspace context
  function slugify(value) {
    return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  }
  const workspaceId = `company:${slugify(fixedUser.companyName)}`;
  console.log(`Workspace ID: ${workspaceId}`);
  
  // Check how many dues and contacts this workspace can see
  const companyUsers = updatedDoc.users.filter(u => 
    u.companyName.trim().toLowerCase() === fixedUser.companyName.trim().toLowerCase()
  );
  const sharedOwnerIds = new Set([workspaceId, ...companyUsers.map(u => u.id)]);
  console.log(`Shared owner IDs: ${[...sharedOwnerIds].join(', ')}`);
  
  const accessibleDues = (updatedDoc.dueRecords || []).filter(d => sharedOwnerIds.has(d.ownerId));
  const accessibleContacts = (updatedDoc.masterContacts || []).filter(c => sharedOwnerIds.has(c.ownerId));
  const accessibleRules = (updatedDoc.reminderRules || []).filter(r => sharedOwnerIds.has(r.ownerId));
  
  console.log(`\nAccessible dues: ${accessibleDues.length}`);
  console.log(`Accessible contacts: ${accessibleContacts.length}`);
  console.log(`Accessible rules: ${accessibleRules.length}`);

  await client.close();
  console.log("\nDone!");
}

fix().catch(err => {
  console.error("ERROR:", err);
  process.exit(1);
});
