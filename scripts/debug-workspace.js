const fs = require('fs');
const path = require('path');
const { MongoClient } = require('mongodb');

function normalizeText(text) {
  return (text || "").toString().trim().toLowerCase().replace(/\s+/g, " ");
}

function getCompanyWorkspaceContext(database, companyName) {
  const normalized = normalizeText(companyName);
  const matchedUsers = database.users.filter(
    (entry) => normalizeText(entry.companyName) === normalized
  );

  const sharedOwnerIds = matchedUsers.map((entry) => entry.id);
  const superadmin = matchedUsers.find((entry) => entry.role === "superadmin");
  const configOwnerId = superadmin ? superadmin.id : (matchedUsers[0]?.id || "");

  return {
    workspaceId: configOwnerId,
    configOwnerId,
    sharedOwnerIds
  };
}

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

    const user = doc.users.find(u => u.email === 'amankumarschool7@gmail.com');
    console.log('User:', user);
    const workspace = getCompanyWorkspaceContext(doc, user.companyName);
    console.log('Workspace context:', workspace);
    
    // Check matched dues
    const filterSharedCompanyRecords = (records, sharedOwnerIds) => {
      const ids = new Set(sharedOwnerIds);
      return (records || []).filter((entry) => ids.has(entry.ownerId));
    };

    const matchedDues = filterSharedCompanyRecords(doc.dueRecords, workspace.sharedOwnerIds);
    console.log(`Matched dues count: ${matchedDues.length}`);
  } catch (err) {
    console.error('Error:', err);
  } finally {
    await client.close();
  }
}

main();
