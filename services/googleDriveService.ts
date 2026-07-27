import { google } from "googleapis";
import { Readable } from "node:stream";
import type { IncomingMessage } from "node:http";
import https from "node:https";

// Set up Google OAuth2 Client using the credentials in .env.local
const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET
);

oauth2Client.setCredentials({
  refresh_token: process.env.GOOGLE_REFRESH_TOKEN
});

const drive = google.drive({ version: "v3", auth: oauth2Client });

/**
 * Uploads a PDF buffer to Google Drive using your personal account,
 * shares it publicly, and returns the direct download link.
 * 
 * @param pdfBuffer The generated PDF document buffer
 * @param fileName The name to store the file under in Google Drive
 * @returns The public direct download URL for the file
 */
export async function uploadPdfToGoogleDrive(pdfBuffer: Buffer, fileName: string): Promise<string> {
  // 1. Upload to x0.at to get a direct, unthrottled URL with correct Content-Type.
  try {
    const boundary = "----NodeFormBoundary" + Math.random().toString(36).slice(2);
    const header = Buffer.concat([
      Buffer.from(`--${boundary}\r\n`),
      Buffer.from(`Content-Disposition: form-data; name="file"; filename="${fileName}"\r\n`),
      Buffer.from(`Content-Type: application/pdf\r\n\r\n`)
    ]);
    const footer = Buffer.from(`\r\n--${boundary}--\r\n`);
    const requestBody = Buffer.concat([header, pdfBuffer, footer]);

    const directUrl = await new Promise<string>((resolve, reject) => {
      const req = https.request({
        hostname: "x0.at",
        port: 443,
        path: "/",
        method: "POST",
        headers: {
          "Content-Type": `multipart/form-data; boundary=${boundary}`,
          "Content-Length": requestBody.length,
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        }
      }, (res: IncomingMessage) => {
        let responseText = "";
        res.setEncoding("utf8");
        res.on("data", chunk => responseText += chunk);
        res.on("end", () => resolve(responseText.trim()));
      });

      req.on("error", (err: any) => reject(err));
      req.write(requestBody);
      req.end();
    });

    if (directUrl.startsWith("https://x0.at/")) {
      console.log(`Successfully uploaded PDF to x0.at. Direct URL: ${directUrl}`);
      return directUrl;
    } else {
      console.error(`x0.at upload returned unexpected response: ${directUrl}`);
    }
  } catch (err) {
    console.error("Failed to upload PDF statement to x0.at:", err);
  }

  // 2. Fallback: Upload to catbox.moe
  try {
    const boundary = "----NodeFormBoundary" + Math.random().toString(36).slice(2);
    const header = Buffer.concat([
      Buffer.from(`--${boundary}\r\n`),
      Buffer.from(`Content-Disposition: form-data; name="reqtype"\r\n\r\n`),
      Buffer.from(`fileupload\r\n`),
      Buffer.from(`--${boundary}\r\n`),
      Buffer.from(`Content-Disposition: form-data; name="fileToUpload"; filename="${fileName}"\r\n`),
      Buffer.from(`Content-Type: application/pdf\r\n\r\n`)
    ]);
    const footer = Buffer.from(`\r\n--${boundary}--\r\n`);
    const requestBody = Buffer.concat([header, pdfBuffer, footer]);

    const resText = await new Promise<string>((resolve, reject) => {
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
      }, (res: IncomingMessage) => {
        let responseText = "";
        res.setEncoding("utf8");
        res.on("data", chunk => responseText += chunk);
        res.on("end", () => resolve(responseText));
      });

      req.on("error", (err: any) => reject(err));
      req.write(requestBody);
      req.end();
    });

    const directUrl = resText.trim();
    if (directUrl && directUrl.startsWith("http")) {
      console.log(`Successfully uploaded PDF to catbox.moe. Direct URL: ${directUrl}`);
      return directUrl;
    } else {
      console.error(`catbox.moe returned non-HTTP response: "${resText}"`);
    }
  } catch (err) {
    console.error("Failed to upload PDF statement to catbox.moe:", err);
  }

  // 2. Fallback: Upload to Google Drive if credentials are present
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET || !process.env.GOOGLE_REFRESH_TOKEN) {
    throw new Error(
      "Missing Google OAuth2 credentials. Please make sure GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REFRESH_TOKEN are set in your .env.local file."
    );
  }

  const folderId = (process.env.GOOGLE_DRIVE_FOLDER_ID || "").trim();

  // Create stream from the buffer
  const bufferStream = new Readable();
  bufferStream.push(pdfBuffer);
  bufferStream.push(null);

  const fileMetadata: any = {
    name: fileName,
    mimeType: "application/pdf"
  };

  if (folderId) {
    fileMetadata.parents = [folderId];
  }

  // Upload file (will be owned by your personal account)
  const response = await drive.files.create({
    requestBody: fileMetadata,
    media: {
      mimeType: "application/pdf",
      body: bufferStream
    },
    fields: "id"
  });

  const fileId = response.data.id;
  if (!fileId) {
    throw new Error("Upload failed: No file ID returned from Google Drive API.");
  }

  // Make the file public so WhatsApp/Interakt servers can fetch it
  await drive.permissions.create({
    fileId: fileId,
    requestBody: {
      role: "reader",
      type: "anyone"
    }
  });

  // Google Drive uc download URL with filename parameter
  return `https://drive.google.com/uc?export=download&confirm=t&id=${fileId}&filename=${encodeURIComponent(fileName)}`;
}
