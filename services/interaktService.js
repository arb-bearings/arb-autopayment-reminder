import axios from "axios";

const INTERAKT_MESSAGE_URL = "https://api.interakt.ai/v1/public/message/";
const DEFAULT_REMINDER_PDF_SOURCE_URL = "https://drive.google.com/file/d/1D2UPqYHYHo-NaqYi9lDZS_Phljqsr5H8/view?usp=drive_link";

function normalizePhoneNumber(value) {
  const trimmed = String(value || "").trim();
  const withoutPrefix = trimmed.toLowerCase().startsWith("whatsapp:")
    ? trimmed.slice("whatsapp:".length)
    : trimmed;
  const digits = withoutPrefix.replace(/[^\d+]/g, "");

  if (digits.startsWith("+91")) {
    return digits.slice(3);
  }

  if (/^91\d{10}$/.test(digits)) {
    return digits.slice(2);
  }

  if (digits.startsWith("+")) {
    return digits.slice(1);
  }

  return digits;
}

function getGoogleDriveFileId(value) {
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

function buildDirectPdfUrl(value) {
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

function normalizeBaseUrl(value) {
  const trimmed = String(value || "").trim();

  if (!trimmed) {
    return "";
  }

  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  return withProtocol.replace(/\/+$/, "");
}

function getPublicBaseUrl() {
  return normalizeBaseUrl(
    process.env.INTERAKT_PUBLIC_BASE_URL ||
      process.env.NEXT_PUBLIC_APP_URL ||
      process.env.APP_BASE_URL ||
      process.env.VERCEL_URL ||
      ""
  );
}

function getReminderPdfUrl() {
  const configuredPdfUrl = String(process.env.INTERAKT_PDF_URL || "").trim();
  const publicBaseUrl = getPublicBaseUrl();

  if (publicBaseUrl && (!configuredPdfUrl || getGoogleDriveFileId(configuredPdfUrl))) {
    return `${publicBaseUrl}/api/interakt/reminder-pdf`;
  }

  if (configuredPdfUrl) {
    return buildDirectPdfUrl(configuredPdfUrl);
  }

  return buildDirectPdfUrl(DEFAULT_REMINDER_PDF_SOURCE_URL);
}

function buildInteraktError(error) {
  if (!axios.isAxiosError(error)) {
    return error instanceof Error ? error.message : "Interakt WhatsApp request failed.";
  }

  const payload = error.response?.data;

  if (typeof payload === "string" && payload.trim()) {
    return payload;
  }

  if (payload && typeof payload === "object") {
    const message =
      payload.message ||
      payload.error ||
      payload.errors?.[0]?.message ||
      payload.result?.message;

    if (typeof message === "string" && message.trim()) {
      return message;
    }
  }

  return error.message || "Interakt WhatsApp request failed.";
}

export async function sendPaymentReminder(phoneNumber, customerName, amount, dueDate, invoiceNumber) {
  const apiKey = (process.env.INTERAKT_API_KEY || "").trim();
  const templateName = (process.env.INTERAKT_TEMPLATE_NAME || "payment_reminder").trim();
  const languageCode = (process.env.INTERAKT_LANGUAGE_CODE || "en").trim();
  const normalizedPhoneNumber = normalizePhoneNumber(phoneNumber);
  const reminderPdfUrl = getReminderPdfUrl();

  if (!apiKey) {
    throw new Error("Interakt API key is missing.");
  }

  if (!normalizedPhoneNumber) {
    throw new Error("WhatsApp recipient phone number is missing.");
  }

  if (!reminderPdfUrl) {
    throw new Error("Interakt PDF URL is missing.");
  }

  try {
    const response = await axios.post(
      INTERAKT_MESSAGE_URL,
      {
        countryCode: "+91",
        phoneNumber: normalizedPhoneNumber,
        type: "Template",
        template: {
          name: templateName,
          languageCode,
          headerValues: [reminderPdfUrl],
          bodyValues: [customerName, amount, dueDate, invoiceNumber]
        }
      },
      {
        headers: {
          Authorization: `Basic ${apiKey}`,
          "Content-Type": "application/json"
        }
      }
    );

    return response.data;
  } catch (error) {
    throw new Error(buildInteraktError(error));
  }
}
