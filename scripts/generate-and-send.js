const fs = require('fs');
const path = require('path');
const { MongoClient } = require('mongodb');
const http = require('http');

// Helper to make a POST request with form-data
function postRequest(urlPath, sessionToken, formDataFields = {}) {
  return new Promise((resolve, reject) => {
    // Generate simple multipart/form-data or urlencoded data
    const boundary = '----WebKitFormBoundary7MA4YWxkTrZu0gW';
    let postData = '';
    
    for (const [key, value] of Object.entries(formDataFields)) {
      postData += `--${boundary}\r\n`;
      postData += `Content-Disposition: form-data; name="${key}"\r\n\r\n`;
      postData += `${value}\r\n`;
    }
    postData += `--${boundary}--\r\n`;

    const options = {
      hostname: 'localhost',
      port: 3000,
      path: urlPath,
      method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Cookie': `apr_session=${sessionToken}`,
        'Content-Length': Buffer.byteLength(postData)
      }
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          data
        });
      });
    });

    req.on('error', (e) => {
      reject(e);
    });

    req.write(postData);
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

  // 1. Connect to MongoDB to find/create an active session for superadmin@example.com
  console.log('Connecting to MongoDB...');
  const client = new MongoClient(uri);
  try {
    await client.connect();
    const db = client.db(dbName);
    const collection = db.collection(collectionName);

    const doc = await collection.findOne({ _id: 'primary' });
    if (!doc) {
      console.error('No app state found');
      return;
    }

    const sa = (doc.users || []).find(u => u.email === 'superadmin@example.com');
    if (!sa) {
      console.error('Superadmin user not found');
      return;
    }

    // Find or create an active session
    let session = (doc.sessions || []).find(s => s.userId === sa.id && new Date(s.expiresAt) > new Date());
    if (!session) {
      console.log('No active session found for superadmin. Creating a new one...');
      const token = require('crypto').randomBytes(32).toString('hex');
      const now = new Date();
      const expiresAt = new Date(now.getTime() + 1000 * 60 * 60 * 24 * 14).toISOString();
      session = {
        token,
        userId: sa.id,
        ipAddress: '127.0.0.1',
        userAgent: 'NodeScript',
        lastSeenAt: now.toISOString(),
        createdAt: now.toISOString(),
        expiresAt
      };
      doc.sessions = doc.sessions || [];
      doc.sessions.push(session);
      await collection.updateOne({ _id: 'primary' }, { $set: { sessions: doc.sessions } });
      console.log('Created new session successfully.');
    }

    const sessionToken = session.token;
    console.log(`Using session token: ${sessionToken.slice(0, 8)}...`);

    // 2. Trigger Generation
    console.log('\n--- Step 1: Triggering Reminder Generation ---');
    const genResult = await postRequest('/api/reminders/generate', sessionToken, {
      generationDate: '',
      operationPassword: ''
    });
    console.log(`Generation status code: ${genResult.statusCode}`);
    console.log(`Redirect / message: ${genResult.headers.location || 'none'}`);

    // 3. Trigger Sending
    console.log('\n--- Step 2: Triggering Reminder Dispatch (Emails / WhatsApp / Salesperson summaries) ---');
    const sendResult = await postRequest('/api/reminders/send', sessionToken, {
      operationPassword: ''
    });
    console.log(`Dispatch status code: ${sendResult.statusCode}`);
    console.log(`Redirect / message: ${sendResult.headers.location || 'none'}`);

    // 4. Print results from reminderLogs and auditLogs
    console.log('\n--- Step 3: Verifying final database state ---');
    const freshDoc = await collection.findOne({ _id: 'primary' });
    const todayStr = new Date().toISOString().slice(0, 10);
    const sentLogs = (freshDoc.reminderLogs || []).filter(log => log.scheduledFor.startsWith(todayStr) && log.status === 'sent');
    console.log(`\nTotal sent reminder logs today: ${sentLogs.length}`);
    sentLogs.forEach(log => {
      console.log(`- Invoice: ${log.invoiceNumber}, Rule: ${log.reminderDay} Day, Channel: ${log.channel}, Recipient: ${log.recipient}, Status: ${log.status}`);
    });

    const recentAudit = (freshDoc.auditLogs || [])
      .filter(a => a.action === 'Reminder Dispatch')
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
      .slice(0, 3);
    console.log('\nRecent audit logs for reminder dispatches:');
    recentAudit.forEach(a => {
      console.log(`- [${a.timestamp}] Action: ${a.action}, Status: ${a.status}, Details: ${a.details}`);
    });

  } catch (err) {
    console.error('Error running script:', err);
  } finally {
    await client.close();
  }
}

main();
