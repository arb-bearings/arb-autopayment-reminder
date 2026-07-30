/**
 * Sends ONLY the 90th-day (95 Day rule) and 95th-day (100 Day rule) reminder emails.
 */
const fs = require('fs');
const path = require('path');
const { MongoClient } = require('mongodb');
const http = require('http');
const crypto = require('crypto');

function postRequest(urlPath, sessionToken, formDataFields = {}) {
  return new Promise((resolve, reject) => {
    const boundary = '----WebKitFormBoundary7MA4YWxkTrZu0gW';
    let postData = '';
    for (const [key, value] of Object.entries(formDataFields)) {
      postData += `--${boundary}\r\n`;
      postData += `Content-Disposition: form-data; name="${key}"\r\n\r\n`;
      postData += `${value}\r\n`;
    }
    postData += `--${boundary}--\r\n`;

    const req = http.request({
      hostname: 'localhost', port: 3000, path: urlPath, method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Cookie': `apr_session=${sessionToken}`,
        'Content-Length': Buffer.byteLength(postData)
      }
    }, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ statusCode: res.statusCode, headers: res.headers, data }));
    });
    req.on('error', reject);
    req.write(postData);
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
  try {
    await client.connect();
    const db = client.db(env.MONGODB_DB || 'auto-payment-reminder');
    const col = db.collection(env.MONGODB_COLLECTION || 'app_state');

    const doc = await col.findOne({ _id: 'primary' });
    const sa = (doc.users || []).find(u => u.email === 'superadmin@example.com');
    if (!sa) { console.error('Superadmin not found'); return; }

    // Get or create session
    let session = (doc.sessions || []).find(s => s.userId === sa.id && new Date(s.expiresAt) > new Date());
    if (!session) {
      const token = crypto.randomBytes(32).toString('hex');
      const now = new Date();
      session = {
        token, userId: sa.id, ipAddress: '127.0.0.1', userAgent: 'NodeScript',
        lastSeenAt: now.toISOString(), createdAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + 864000000 * 14).toISOString()
      };
      await col.updateOne({ _id: 'primary' }, { $push: { sessions: session } });
    }
    const sessionToken = session.token;
    console.log(`Using token: ${sessionToken.slice(0, 8)}...`);

    // Step 1: Generate ALL reminders
    console.log('\n--- Step 1: Generating reminders ---');
    const genRes = await postRequest('/api/reminders/generate', sessionToken, {
      operationPassword: '', forceAllRules: 'true'
    });
    console.log('Generate:', genRes.headers.location || genRes.statusCode);

    // Step 2: Identify the 95-day and 100-day rule IDs
    const freshDoc = await col.findOne({ _id: 'primary' });
    const targetRuleIds = new Set(
      (freshDoc.reminderRules || [])
        .filter(r => r.triggerDay === 95 || r.triggerDay === 100)
        .map(r => r.id)
    );
    console.log(`\nTarget rule IDs (day 95 and 100): ${[...targetRuleIds].join(', ')}`);

    // Step 3: Hold all pending logs that are NOT in our target rules
    const allPending = (freshDoc.reminderLogs || []).filter(l => l.status === 'pending');
    const targetLogs = allPending.filter(l => targetRuleIds.has(l.ruleId));
    const holdIds = allPending.filter(l => !targetRuleIds.has(l.ruleId)).map(l => l.id);

    console.log(`Target pending logs: ${targetLogs.length}`);
    targetLogs.forEach(l => console.log(`  - RuleDay ${l.reminderDay}: ${l.invoiceNumber} → ${l.recipient} (${l.channel})`));

    if (targetLogs.length === 0) {
      console.log('\nNo 90th/95th day logs to send. Exiting.');
      return;
    }

    if (holdIds.length > 0) {
      await col.updateOne(
        { _id: 'primary' },
        { $set: { 'reminderLogs.$[elem].status': 'hold' } },
        { arrayFilters: [{ 'elem.id': { $in: holdIds } }] }
      );
      console.log(`\nTemporarily held ${holdIds.length} other pending logs`);
    }

    // Step 4: Send (only target logs are now pending)
    console.log('\n--- Step 2: Sending 90th/95th day reminders ---');
    const sendRes = await postRequest('/api/reminders/send', sessionToken, { operationPassword: '' });
    console.log('Send:', sendRes.headers.location || sendRes.statusCode);

    // Step 5: Restore held logs
    if (holdIds.length > 0) {
      await col.updateOne(
        { _id: 'primary' },
        { $set: { 'reminderLogs.$[elem].status': 'pending' } },
        { arrayFilters: [{ 'elem.id': { $in: holdIds }, 'elem.status': 'hold' }] }
      );
      console.log(`Restored ${holdIds.length} held logs to pending`);
    }

    // Step 6: Verify
    const finalDoc = await col.findOne({ _id: 'primary' });
    const sentTargets = (finalDoc.reminderLogs || []).filter(l => l.status === 'sent' && targetRuleIds.has(l.ruleId));
    const failedTargets = (finalDoc.reminderLogs || []).filter(l => l.status === 'failed' && targetRuleIds.has(l.ruleId));

    console.log(`\n✅ Sent ${sentTargets.length} reminders:`);
    sentTargets.forEach(l => console.log(`  - RuleDay ${l.reminderDay}: ${l.invoiceNumber} → ${l.recipient}`));
    if (failedTargets.length > 0) {
      console.log(`\n❌ Failed ${failedTargets.length} reminders:`);
      failedTargets.forEach(l => console.log(`  - RuleDay ${l.reminderDay}: ${l.invoiceNumber} — ${l.failureReason}`));
    }

  } finally {
    await client.close();
  }
}

main().catch(console.error);
