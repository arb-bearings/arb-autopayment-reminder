const fs = require('fs');
const path = require('path');
const { MongoClient } = require('mongodb');
const http = require('http');

function postRequest(urlPath, token, payload = {}) {
  return new Promise((resolve, reject) => {
    const data = new URLSearchParams();
    for (const key in payload) {
      data.append(key, payload[key]);
    }
    const dataStr = data.toString();

    const options = {
      hostname: 'localhost',
      port: 3000,
      path: urlPath,
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(dataStr),
        'Cookie': 'apr_session=' + token
      }
    };

    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        resolve({ statusCode: res.statusCode, body });
      });
    });

    req.on('error', err => reject(err));
    req.write(dataStr);
    req.end();
  });
}

async function main() {
  const envContent = fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8');
  const env = {};
  envContent.split('\n').forEach(line => {
    const m = line.trim().match(/^([^=]+)=(.*)$/);
    if (m) env[m[1].trim()] = m[2].trim();
  });

  const client = new MongoClient(env.MONGODB_URI);
  await client.connect();
  const db = client.db(env.MONGODB_DB || 'auto-payment-reminder');
  const collection = db.collection(env.MONGODB_COLLECTION || 'app_state');

  const doc = await collection.findOne({ _id: 'primary' });
  const targetUser = doc.users.find(u => u.email === 'amankumarschool7@gmail.com');

  let session = doc.sessions?.find(s => s.userId === targetUser.id && new Date(s.expiresAt) > new Date());
  if (!session) {
    const token = require('crypto').randomBytes(32).toString('hex');
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 1000 * 60 * 60 * 24 * 14).toISOString();
    session = {
      token,
      userId: targetUser.id,
      ipAddress: '127.0.0.1',
      userAgent: 'NodeScript',
      lastSeenAt: now.toISOString(),
      createdAt: now.toISOString(),
      expiresAt
    };
    doc.sessions = doc.sessions || [];
    doc.sessions.push(session);
    await collection.updateOne({ _id: 'primary' }, { $set: { sessions: doc.sessions } });
  }

  // Clear reminderLogs
  await collection.updateOne({ _id: 'primary' }, { $set: { reminderLogs: [] } });

  console.log('--- Triggering Generate Reminders ---');
  const res = await postRequest('/api/reminders/generate', session.token, {
    generationDate: '',
    operationPassword: '',
    forceAllRules: 'true'
  });
  console.log('Generate status:', res.statusCode);

  const freshDoc = await collection.findOne({ _id: 'primary' });
  const pendingLogs = (freshDoc.reminderLogs || []).filter(l => l.status === 'pending');
  console.log(`\nGenerated ${pendingLogs.length} pending reminder log(s):`);
  pendingLogs.forEach((l, idx) => {
    console.log(`[${idx + 1}] Invoice: ${l.invoiceNumber} | Ageing Stage: ${l.selectedAgeingStage} | Rule: ${l.reminderDay} Day | Dealer: ${l.dealerName}`);
  });

  await client.close();
}

main().catch(console.error);
