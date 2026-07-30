/**
 * send-reports-now.js
 * Manually trigger the Daily Activity Report + Salesperson Summaries right now.
 * Usage: node scripts/send-reports-now.js
 */

const fs = require('fs');
const path = require('path');
const { MongoClient } = require('mongodb');
const http = require('http');

function postRequest(urlPath, sessionToken, fields = {}) {
  return new Promise((resolve, reject) => {
    const boundary = '----WebKitFormBoundary7MA4YWxkTrZu0gW';
    let body = '';
    for (const [key, value] of Object.entries(fields)) {
      body += `--${boundary}\r\n`;
      body += `Content-Disposition: form-data; name="${key}"\r\n\r\n`;
      body += `${value}\r\n`;
    }
    body += `--${boundary}--\r\n`;

    const options = {
      hostname: 'localhost',
      port: 3000,
      path: urlPath,
      method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Cookie': `apr_session=${sessionToken}`,
        'Content-Length': Buffer.byteLength(body),
      },
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => resolve({ statusCode: res.statusCode, location: res.headers.location, data }));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function getOrCreateSession(collection, doc) {
  const sa = (doc.users || []).find((u) => u.role === 'superadmin') ||
             (doc.users || [])[0];
  if (!sa) throw new Error('No users found in database');

  let session = (doc.sessions || []).find(
    (s) => s.userId === sa.id && new Date(s.expiresAt) > new Date()
  );

  if (!session) {
    console.log(`No active session for ${sa.email}. Creating one...`);
    const token = require('crypto').randomBytes(32).toString('hex');
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 1000 * 60 * 60 * 24 * 14).toISOString();
    session = {
      token,
      userId: sa.id,
      ipAddress: '127.0.0.1',
      userAgent: 'NodeScript/send-reports-now',
      lastSeenAt: now.toISOString(),
      createdAt: now.toISOString(),
      expiresAt,
    };
    doc.sessions = doc.sessions || [];
    doc.sessions.push(session);
    await collection.updateOne({ _id: 'primary' }, { $set: { sessions: doc.sessions } });
    console.log('Session created.');
  }

  console.log(`Using session for: ${sa.email} (token: ${session.token.slice(0, 8)}...)`);
  return session.token;
}

async function main() {
  // Load .env.local
  const envPath = path.join(__dirname, '..', '.env.local');
  if (!fs.existsSync(envPath)) {
    console.error('.env.local not found');
    process.exit(1);
  }
  const env = {};
  fs.readFileSync(envPath, 'utf8').split('\n').forEach((line) => {
    const m = line.trim().match(/^([^=]+)=(.*)$/);
    if (m) env[m[1].trim()] = m[2].trim();
  });

  const uri = env.MONGODB_URI;
  const dbName = env.MONGODB_DB || 'auto-payment-reminder';
  const collectionName = env.MONGODB_COLLECTION || 'app_state';

  const client = new MongoClient(uri);
  try {
    await client.connect();
    const collection = client.db(dbName).collection(collectionName);
    const doc = await collection.findOne({ _id: 'primary' });
    if (!doc) throw new Error('No app state (primary) document found');

    const sessionToken = await getOrCreateSession(collection, doc);

    // ── Step 1: Daily Activity Report ─────────────────────────────────────────
    console.log('\n─── Sending Daily Activity Report ───────────────────────────────');
    const reportRes = await postRequest('/api/reports/generate', sessionToken, {
      reportDate: '',
      operationPassword: '',
    });
    console.log(`Status: ${reportRes.statusCode}`);
    if (reportRes.location) {
      const url = new URL(reportRes.location, 'http://localhost:3000');
      const msg = url.searchParams.get('message') || url.searchParams.get('error');
      console.log(`Result: ${msg || reportRes.location}`);
    } else {
      console.log(`Body: ${reportRes.data.slice(0, 200)}`);
    }

    // ── Step 2: Salesperson Summaries (via dispatch which auto-sends summaries) ─
    console.log('\n─── Dispatching Pending Reminders + Salesperson Summaries ───────');
    const sendRes = await postRequest('/api/reminders/send', sessionToken, {
      operationPassword: '',
    });
    console.log(`Status: ${sendRes.statusCode}`);
    if (sendRes.location) {
      const url = new URL(sendRes.location, 'http://localhost:3000');
      const msg = url.searchParams.get('message') || url.searchParams.get('error');
      console.log(`Result: ${msg || sendRes.location}`);
    } else {
      console.log(`Body: ${sendRes.data.slice(0, 200)}`);
    }

    console.log('\n✅ Done. Check recipient inboxes for the reports.');
  } catch (err) {
    console.error('Error:', err.message || err);
  } finally {
    await client.close();
  }
}

main();
