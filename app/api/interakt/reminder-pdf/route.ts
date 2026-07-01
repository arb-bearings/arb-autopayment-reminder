const DEFAULT_REMINDER_PDF_SOURCE_URL = "https://drive.google.com/file/d/1D2UPqYHYHo-NaqYi9lDZS_Phljqsr5H8/view?usp=drive_link";

function getGoogleDriveFileId(value: string) {
  const filePathMatch = value.match(/\/file\/d\/([^/]+)/);
  if (filePathMatch?.[1]) {
    return filePathMatch[1];
  }

  try {
    const url = new URL(value);
    return url.searchParams.get("id") || "";
  } catch {
    return "";
  }
}

function buildDirectPdfUrl(value: string) {
  const trimmed = String(value || "").trim();

  if (!trimmed) {
    return "";
  }

  const driveFileId = getGoogleDriveFileId(trimmed);
  if (driveFileId) {
    return `https://drive.google.com/uc?export=download&id=${encodeURIComponent(driveFileId)}`;
  }

  return trimmed;
}

function getSafePdfFileName() {
  const configuredName = String(process.env.INTERAKT_PDF_FILENAME || "payment-reminder.pdf").trim();
  const safeName = configuredName.replace(/["\\/]/g, "-");
  return safeName.toLowerCase().endsWith(".pdf") ? safeName : `${safeName}.pdf`;
}

export async function GET() {
  const sourceUrl = buildDirectPdfUrl(
    process.env.INTERAKT_SOURCE_PDF_URL ||
      process.env.INTERAKT_PDF_URL ||
      DEFAULT_REMINDER_PDF_SOURCE_URL
  );

  if (!sourceUrl) {
    return new Response("Reminder PDF source URL is missing.", { status: 500 });
  }

  const sourceResponse = await fetch(sourceUrl, { cache: "no-store", redirect: "follow" });

  if (!sourceResponse.ok) {
    return new Response("Reminder PDF could not be loaded.", { status: 502 });
  }

  const pdf = await sourceResponse.arrayBuffer();
  const fileName = getSafePdfFileName();

  return new Response(pdf, {
    headers: {
      "Cache-Control": "public, max-age=300",
      "Content-Disposition": `inline; filename="${fileName}"`,
      "Content-Type": "application/pdf"
    }
  });
}