import axios from "axios";

const INTERAKT_MESSAGE_URL = "https://api.interakt.ai/v1/public/message/";

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

export async function sendPaymentReminder(phoneNumber, bodyValues, mediaUrl, fileName) {
  const apiKey = (process.env.INTERAKT_API_KEY || "").trim();
  const templateName = (process.env.INTERAKT_TEMPLATE_NAME || "payment_reminder").trim();
  const languageCode = (process.env.INTERAKT_LANGUAGE_CODE || "en").trim();
  const normalizedPhoneNumber = normalizePhoneNumber(phoneNumber);

  if (!apiKey) {
    throw new Error("Interakt API key is missing.");
  }

  if (!normalizedPhoneNumber) {
    throw new Error("WhatsApp recipient phone number is missing.");
  }

  const payload = {
    countryCode: "+91",
    phoneNumber: normalizedPhoneNumber,
    type: "Template",
    template: {
      name: templateName,
      languageCode,
      bodyValues: Array.isArray(bodyValues) ? bodyValues : []
    }
  };

  if (mediaUrl) {
    payload.template.headerValues = [mediaUrl];
    payload.template.fileName = fileName || "outstanding-statement.pdf";
  }

  try {
    const response = await axios.post(
      INTERAKT_MESSAGE_URL,
      payload,
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
