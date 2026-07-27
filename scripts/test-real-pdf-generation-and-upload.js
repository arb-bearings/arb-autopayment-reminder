const fs = require('fs');
const path = require('path');
const { MongoClient } = require('mongodb');
const https = require('node:https');
const { generateOutstandingPDF } = require('../dist/lib/pdf-generator');

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

    const matchedDues = doc.dueRecords.filter(d => d.customerCode === 'D23009'); // Test Customer 60 Day
    const due = matchedDues.find(d => d.invoiceNumber === 'TEST-INV-55');
    const allDues = matchedDues;

    const unsortedDues = allDues.length > 0 ? allDues : [due];
    const dealerDues = [...unsortedDues].sort((a, b) => {
      const dateA = a.billDate || a.invoiceDate || "";
      const dateB = b.billDate || b.invoiceDate || "";
      return dateA.localeCompare(dateB);
    });
    const totalAmount = dealerDues.reduce((sum, item) => sum + (item.amount || 0), 0);
    const currency = due.currency || "INR";
    const customerName = due.matchedContactName || due.companyName || "Customer";
    const dealerCode = due.dealerCode || due.customerCode || "-";

    const pdfBuffer = await generateOutstandingPDF(
      customerName,
      dealerCode,
      dealerDues,
      totalAmount,
      currency,
      "dummy pdf message body",
      due.id,
      doc.reminderRules[0].id,
      doc
    );

    console.log(`Generated PDF statement size: ${pdfBuffer.length} bytes`);

    const fn = `outstanding-statement-test-inv-55.pdf`;
    const boundary = "----NodeFormBoundary" + Math.random().toString(36).slice(2);
    const header = Buffer.concat([
      Buffer.from(`--${boundary}\r\n`),
      Buffer.from(`Content-Disposition: form-data; name="reqtype"\r\n\r\n`),
      Buffer.from(`fileupload\r\n`),
      Buffer.from(`--${boundary}\r\n`),
      Buffer.from(`Content-Disposition: form-data; name="fileToUpload"; filename="${fn}"\r\n`),
      Buffer.from(`Content-Type: application/pdf\r\n\r\n`)
    ]);
    const footer = Buffer.from(`\r\n--${boundary}--\r\n`);
    const requestBody = Buffer.concat([header, pdfBuffer, footer]);

    console.log(`\nUploading real PDF...`);
    const result = await new Promise((resolve, reject) => {
      const req = https.request({
        hostname: "catbox.moe",
        port: 443,
        path: "/user/api.php",
        method: "POST",
        headers: {
          "Content-Type": `multipart/form-data; boundary=${boundary}`,
          "Content-Length": requestBody.length,
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          "Accept": "*/*"
        }
      }, (res) => {
        console.log(`Status Code: ${res.statusCode}`);
        let responseText = "";
        res.setEncoding("utf8");
        res.on("data", chunk => responseText += chunk);
        res.on("end", () => resolve(responseText));
      });

      req.on("error", (err) => reject(err));
      req.write(requestBody);
      req.end();
    });

    console.log(`Response: "${result}"`);

  } catch (err) {
    console.error('Error:', err);
  } finally {
    await client.close();
  }
}

main();
