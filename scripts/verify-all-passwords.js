const fs = require('fs');
const path = require('path');
const { MongoClient } = require('mongodb');
const { scryptSync, timingSafeEqual } = require('crypto');

function verifyPassword(password, storedHash) {
  const [salt, originalHash] = storedHash.split(':');
  if (!salt || !originalHash) return false;
  const derived = scryptSync(password, salt, 64);
  const original = Buffer.from(originalHash, 'hex');
  if (derived.length !== original.length) return false;
  return timingSafeEqual(derived, original);
}

async function verify() {
  const envContent = fs.readFileSync('.env.local', 'utf8');
  let uri = '';
  let dbName = 'auto-payment-reminder';
  for (const line of envContent.split('\n')) {
    if (line.startsWith('MONGODB_URI=')) uri = line.replace('MONGODB_URI=', '').trim();
  }

  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db(dbName);
  const doc = await db.collection('app_state').findOne({ _id: 'primary' });

  console.log('--- USER AUTH VERIFICATION ---');
  for (const u of doc.users) {
    const ok = verifyPassword('12345678', u.passwordHash);
    console.log(`User: ${u.email.padEnd(35)} | Role: ${u.role.padEnd(12)} | Password 12345678 match: ${ok}`);
  }

  console.log('\n--- OPERATION PASSWORDS VERIFICATION ---');
  for (const op of doc.operationPasswords) {
    const ok = verifyPassword('12345678', op.passwordHash);
    console.log(`Op: ${op.key.padEnd(20)} | Password 12345678 match: ${ok}`);
  }

  await client.close();
}

verify().catch(console.error);
