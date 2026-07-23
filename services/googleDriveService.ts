import { google } from "googleapis";
import { Readable } from "node:stream";

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
  // 1. Upload to catbox.moe to get a direct, unthrottled URL with correct Content-Type.
  //
  // Hosting the PDF on catbox.moe guarantees a direct PDF stream with "Content-Type: application/pdf"
  // and absolutely zero bot-protection or redirects, so WhatsApp represents it as a proper PDF.
  try {
    const formData = new FormData();
    const fileBlob = new Blob([new Uint8Array(pdfBuffer)], { type: "application/pdf" });
    formData.append("reqtype", "fileupload");
    formData.append("fileToUpload", fileBlob, fileName);

    const uploadRes = await fetch("https://catbox.moe/user/api.php", {
      method: "POST",
      body: formData
    });
    
    if (uploadRes.ok) {
      const directUrl = (await uploadRes.text()).trim();
      if (directUrl && directUrl.startsWith("http")) {
        console.log(`Successfully uploaded PDF to catbox.moe. Direct URL: ${directUrl}`);
        return directUrl;
      }
    }
    console.error("catbox.moe upload failed with status:", uploadRes.status);
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
