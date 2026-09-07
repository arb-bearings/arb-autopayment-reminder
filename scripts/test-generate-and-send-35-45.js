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
        'Cookie': `apr_session=${token}`
      }
    };

    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body
        });
      });
    });

    req.on('error', err => reject(err));
    req.write(dataStr);
    req.end();
  });
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
      console.error('No database document found.');
      return;
    }

    const targetUser = doc.users.find(u => u.email === 'amankumarschool7@gmail.com');
    if (!targetUser) {
      console.error('Target user not found');
      return;
    }

    // Find or create session
    let session = doc.sessions?.find(s => s.userId === targetUser.id && s.expiresAt > new Date().toISOString());
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

    const sessionToken = session.token;
    console.log(`Using session for user: ${targetUser.email}`);

    // 1. Trigger Reminder Generation
    console.log('\n--- Step 1: Triggering Generate Reminders ---');
    const genResult = await postRequest('/api/reminders/generate', sessionToken, {
      generationDate: '',
      operationPassword: '',
      forceAllRules: 'true'
    });
    console.log(`Generation Status Code: ${genResult.statusCode}`);
    console.log(`Redirect Location: ${genResult.headers.location || 'none'}`);

    // 2. Inspect Generated Pending Logs
    const freshDoc = await collection.findOne({ _id: 'primary' });
    const pendingLogs = (freshDoc.reminderLogs || []).filter(log => log.status === 'pending');
    console.log(`\nGenerated ${pendingLogs.length} pending reminder log(s):`);
    pendingLogs.forEach((log, idx) => {
      console.log(`\n[Log ${idx + 1}]`);
      console.log(`- Company / Dealer: ${log.dealerName} (${log.dealerCode})`);
      console.log(`- Invoice Number: ${log.invoiceNumber}`);
      console.log(`- Rule ID / Trigger Day: ${log.reminderDay} Day`);
      console.log(`- Ageing Stage: ${log.selectedAgeingStage}`);
      console.log(`- Channel: ${log.channel}`);
      console.log(`- Recipient: ${log.recipient}`);
      console.log(`- Subject: ${log.subject}`);
      console.log(`- Content Preview:\n${log.content.slice(0, 250)}...`);
    });

    if (pendingLogs.length === 0) {
      console.error('No pending logs were generated!');
      return;
    }

    // 3. Trigger Dispatch / Send
    console.log('\n--- Step 2: Triggering Reminder Dispatch (Sending Emails) ---');
    const sendResult = await postRequest('/api/reminders/send', sessionToken, {
      operationPassword: ''
    });
    console.log(`Send Status Code: ${sendResult.statusCode}`);
    console.log(`Redirect Location: ${sendResult.headers.location || 'none'}`);

    // 4. Verify Final State
    const afterDoc = await collection.findOne({ _id: 'primary' });
    const sentLogs = (afterDoc.reminderLogs || []).filter(log => log.status === 'sent');
    const failedLogs = (afterDoc.reminderLogs || []).filter(log => log.status === 'failed');

    console.log(`\n--- Summary of Dispatch ---`);
    console.log(`Successfully Sent: ${sentLogs.length}`);
    sentLogs.forEach(l => {
      console.log(`✅ Sent to ${l.recipient} | Invoice: ${l.invoiceNumber} | Rule: ${l.reminderDay} Day | Subject: ${l.subject}`);
    });

    if (failedLogs.length > 0) {
      console.log(`\nFailed Dispatches: ${failedLogs.length}`);
      failedLogs.forEach(l => {
        console.log(`❌ Failed: ${l.recipient} | Invoice: ${l.invoiceNumber} | Reason: ${l.failureReason}`);
      });
    }

  } catch (err) {
    console.error('Error:', err);
  } finally {
    await client.close();
  }
}

main();
