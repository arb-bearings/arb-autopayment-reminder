const fs = require('fs');

async function main() {
  const pdfBuffer = Buffer.from('%PDF-1.4 ... dummy pdf content ...');
  const fileName = 'test-statement.pdf';

  try {
    const formData = new FormData();
    // In Node.js environment, we should make sure the Blob has a filename or is constructed correctly
    const fileBlob = new Blob([new Uint8Array(pdfBuffer)], { type: "application/pdf" });
    formData.append("reqtype", "fileupload");
    formData.append("fileToUpload", fileBlob, fileName);

    console.log('Sending request to catbox.moe...');
    const uploadRes = await fetch("https://catbox.moe/user/api.php", {
      method: "POST",
      body: formData
    });

    console.log(`Status: ${uploadRes.status}`);
    const text = await uploadRes.text();
    console.log(`Raw response text: "${text}"`);
  } catch (err) {
    console.error('Error uploading:', err);
  }
}

main();
