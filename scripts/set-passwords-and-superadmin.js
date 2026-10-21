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
  { key: 'switch_mode', label: 'Switch Production / Test Mode' }
];

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
    console.error('MONGODB_URI is not defined in .env.local');
    process.exit(1);
  }

  const dbNames = [
    env.MONGODB_DB || 'auto-payment-reminder',
    env.MONGODB_DB_LUBRICANTS || 'auto-payment-reminder-lubricants'
  ];
  const collectionName = env.MONGODB_COLLECTION || 'app_state';

  console.log(`Connecting to MongoDB...`);
  const client = new MongoClient(uri);

  try {
    await client.connect();
    console.log('MongoDB connected successfully.');

    // List all existing databases in MongoDB just to see if there are others
    const adminDb = client.db().admin();
    const dbsList = await adminDb.listDatabases();
    console.log('Available databases on cluster:', dbsList.databases.map(d => d.name));

    const targetEmail = 'arbbearings.marketing@gmail.com';
    const targetPassword = '12345678';
    const newPasswordHash = hashPassword(targetPassword);

    for (const dbName of dbNames) {
      console.log(`\n========================================`);
      console.log(`Processing database: "${dbName}"`);
      console.log(`========================================`);

      const db = client.db(dbName);
      const collection = db.collection(collectionName);

      let doc = await collection.findOne({ _id: 'primary' });

      if (!doc) {
        console.log(`No primary document found in ${dbName}. Initializing new primary document...`);
        const superAdminId = randomUUID();
        const superAdminUser = {
          id: superAdminId,
          name: 'Super Admin',
          email: targetEmail,
          companyName: dbName.includes('lubricant') ? 'ARB Lubricants' : 'ARB Bearings',
          passwordHash: hashPassword(targetPassword),
          role: 'super_admin',
          canSendManualReminders: true,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };

        const operationPasswords = OPERATION_PASSWORD_KEYS.map(op => ({
          key: op.key,
          label: op.label,
          passwordHash: hashPassword(targetPassword),
          updatedAt: new Date().toISOString()
        }));

        doc = {
          _id: 'primary',
          users: [superAdminUser],
          sessions: [],
          authEvents: [],
          masterContacts: [],
          dueRecords: [],
          reminderRules: [],
          templates: [],
          dispatchSettings: [],
          cashDiscountPolicies: [],
          reminderLogs: [],
          operationPasswords: operationPasswords,
          salespersons: [],
          auditLogs: [],
          updatedAt: new Date().toISOString()
        };

        await collection.insertOne(doc);
        console.log(`Created primary document in ${dbName} with superadmin user ${targetEmail}`);
        continue;
      }

      // 1. Update all existing users to password 12345678
      if (!Array.isArray(doc.users)) {
        doc.users = [];
      }

      console.log(`Found ${doc.users.length} existing user(s) in ${dbName}.`);

      let targetUserFound = false;
      for (const user of doc.users) {
        user.passwordHash = hashPassword(targetPassword);
        user.updatedAt = new Date().toISOString();
        console.log(`- Updated password to "${targetPassword}" for user: ${user.email} (Role: ${user.role})`);

        if (user.email.toLowerCase() === targetEmail.toLowerCase()) {
          user.role = 'super_admin';
          user.canSendManualReminders = true;
          targetUserFound = true;
          console.log(`  -> Set role to "super_admin" for ${user.email}`);
        }
      }

      // 2. If arbbearings.marketing@gmail.com does not exist in users, create it
      if (!targetUserFound) {
        const newSuperAdmin = {
          id: randomUUID(),
          name: 'Super Admin',
          email: targetEmail,
          companyName: dbName.includes('lubricant') ? 'ARB Lubricants' : 'ARB Bearings',
          passwordHash: hashPassword(targetPassword),
          role: 'super_admin',
          canSendManualReminders: true,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };
        doc.users.push(newSuperAdmin);
        console.log(`- Added new super_admin user: ${targetEmail} with password "${targetPassword}"`);
      }

      // 3. Configure all operation passwords to 12345678
      if (!Array.isArray(doc.operationPasswords)) {
        doc.operationPasswords = [];
      }

      for (const op of OPERATION_PASSWORD_KEYS) {
        const existingOp = doc.operationPasswords.find(p => p.key === op.key);
        if (existingOp) {
          existingOp.passwordHash = hashPassword(targetPassword);
          existingOp.label = op.label;
          existingOp.updatedAt = new Date().toISOString();
        } else {
          doc.operationPasswords.push({
            key: op.key,
            label: op.label,
            passwordHash: hashPassword(targetPassword),
            updatedAt: new Date().toISOString()
          });
        }
      }
      console.log(`Configured ${OPERATION_PASSWORD_KEYS.length} operation passwords (clear_logs, reset_system, clear_contacts, clear_dues, switch_mode) to "${targetPassword}".`);

      doc.updatedAt = new Date().toISOString();

      await collection.replaceOne({ _id: 'primary' }, doc, { upsert: true });
      console.log(`Successfully saved updates to database "${dbName}".`);
    }

    console.log(`\n========================================`);
    console.log(`ALL TASKS COMPLETED SUCCESSFULLY.`);
    console.log(`========================================`);
  } catch (err) {
    console.error('Error during execution:', err);
  } finally {
    await client.close();
  }
}

main();
