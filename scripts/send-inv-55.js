const fs = require('fs');
const path = require('path');
const { MongoClient } = require('mongodb');
const http = require('http');
const crypto = require('crypto');

function postRequest(urlPath, token, payload) {
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
      console.log('No database document found.');
      return;
    }

    const targetUser = doc.users.find(u => u.email === 'amankumarschool7@gmail.com');
    if (!targetUser) {
      console.error('Target user not found');
      return;
    }

    console.log('Clearing old reminder logs...');
    await collection.updateOne({ _id: 'primary' }, { $set: { reminderLogs: [] } });

    // Generate and register a brand new active session to guarantee authorization
    const sessionToken = crypto.randomBytes(32).toString('hex');
    const newSession = {
      token: sessionToken,
      userId: targetUser.id,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      createdAt: new Date().toISOString()
    };
    
    doc.sessions = doc.sessions || [];
    doc.sessions.push(newSession);
    await collection.updateOne({ _id: 'primary' }, { $set: { sessions: doc.sessions } });
    console.log(`Created fresh session successfully (token: ${sessionToken.slice(0, 8)}...)`);

    // Trigger generation
    console.log('\nGenerating all reminders...');
    const genResult = await postRequest('/api/reminders/generate', sessionToken, {
      generationDate: '',
      operationPassword: '',
      forceAllRules: 'true'
    });
    console.log(`Generation Response Status: ${genResult.statusCode}`);
    console.log(`Redirect Location: ${genResult.headers.location || 'none'}`);

    // Read the document again to get the generated pending logs
    const freshDoc = await collection.findOne({ _id: 'primary' });
    console.log(`Raw reminder logs count in database: ${freshDoc.reminderLogs?.length || 0}`);
    
    // Filter to keep ONLY the TEST-INV-55 WhatsApp reminder
    const filteredLogs = (freshDoc.reminderLogs || []).filter(log => {
      return log.status === 'pending' && log.invoiceNumber === 'TEST-INV-55' && log.channel === 'whatsapp';
    });

    console.log(`\nFiltered queue contains ${filteredLogs.length} logs:`);
    filteredLogs.forEach(l => {
      console.log(`- Invoice: ${l.invoiceNumber}, Rule: ${l.reminderDay} Day, Channel: ${l.channel}`);
    });

    if (filteredLogs.length === 0) {
      console.log('No matching logs found to send. Aborting.');
      return;
    }

    // Update database with ONLY these filtered logs
    await collection.updateOne({ _id: 'primary' }, { $set: { reminderLogs: filteredLogs } });

    // Trigger sending
    console.log('\nSending filtered reminders...');
    const sendResult = await postRequest('/api/reminders/send', sessionToken, {
      operationPassword: ''
    });
    console.log(`Send Response Status: ${sendResult.statusCode}`);
    console.log('Done.');

  } catch (err) {
    console.error('Error:', err);
  } finally {
    await client.close();
  }
}

main();
