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

  // 1. Upload file (will be owned by your personal account)
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

  // 2. Make the file public so WhatsApp/Interakt servers can fetch it
  await drive.permissions.create({
    fileId: fileId,
    requestBody: {
      role: "reader",
      type: "anyone"
    }
  });

  // 3. Get the webContentLink which is a direct download URL that serves the actual file
  // with proper Content-Type headers (application/pdf)
  const fileInfo = await drive.files.get({
    fileId: fileId,
    fields: "webContentLink"
  });

  const webContentLink = fileInfo.data.webContentLink;

  if (webContentLink) {
    // webContentLink is a direct download link like:
    // https://drive.google.com/uc?id=FILE_ID&export=download
    // This works better than manually constructing the URL as it properly serves the PDF
    return webContentLink;
  }

  // Fallback: Use the Google Drive API direct media endpoint
  // This URL directly serves the file bytes with correct Content-Type
  return `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&key=${process.env.GOOGLE_API_KEY || ""}`;
}
