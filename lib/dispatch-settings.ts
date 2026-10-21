import type { DispatchSettings } from "@/lib/types";

export function isE164PhoneNumber(value: string) {
  return /^\+[1-9]\d{7,14}$/.test(value.trim());
}

type PartialDispatchSettings = Partial<DispatchSettings> & Pick<DispatchSettings, "ownerId">;

export function resolveDispatchSettings(
  settings: PartialDispatchSettings | null | undefined
): DispatchSettings {
  const savedSenderEmail = (settings?.senderEmail || settings?.smtpFrom || "").trim();
  const savedSmsFromNumber = (settings?.smsFromNumber || "").trim();
  const legacySmsSenderId = (settings?.smsSenderId || "").trim();
  const envSmsFromNumber = (process.env.TWILIO_FROM_NUMBER || "").trim();
  const smsFromNumber =
    [
      savedSmsFromNumber,
      envSmsFromNumber,
      isE164PhoneNumber(legacySmsSenderId) ? legacySmsSenderId : ""
    ].find((value) => value !== "") || "";

  const isLubricants =
    Boolean(settings?.ownerId?.toLowerCase().includes("lubricant")) ||
    Boolean(settings?.senderEmail?.toLowerCase().includes("lubricant")) ||
    Boolean(settings?.smtpUser?.toLowerCase().includes("lubricant"));

  const defaultSmtpHost = (isLubricants && process.env.SMTP_LUBRICANTS_HOST) || process.env.SMTP_HOST || "smtp.gmail.com";
  const defaultSmtpPort = (isLubricants && process.env.SMTP_LUBRICANTS_PORT)
    ? Number(process.env.SMTP_LUBRICANTS_PORT)
    : Number(process.env.SMTP_PORT || 465);
  const defaultSmtpSecure = (isLubricants && process.env.SMTP_LUBRICANTS_SECURE !== undefined)
    ? process.env.SMTP_LUBRICANTS_SECURE.toLowerCase() === "true"
    : process.env.SMTP_SECURE?.toLowerCase() === "true";
  const defaultSmtpUser = (isLubricants && process.env.SMTP_LUBRICANTS_USER) || process.env.SMTP_USER || "";
  const defaultSmtpPass = (isLubricants && process.env.SMTP_LUBRICANTS_PASS) || process.env.SMTP_PASS || "";
  const defaultSmtpFrom = (isLubricants && process.env.SMTP_LUBRICANTS_FROM) || process.env.SMTP_FROM || "";

  return {
    ownerId: settings?.ownerId || "",
    smtpHost: settings?.smtpHost || defaultSmtpHost,
    smtpPort: settings?.smtpPort || defaultSmtpPort,
    smtpSecure: settings?.smtpSecure ?? defaultSmtpSecure,
    smtpUser: settings?.smtpUser || defaultSmtpUser,
    smtpPass: settings?.smtpPass || defaultSmtpPass,
    senderEmail: savedSenderEmail || defaultSmtpFrom,
    senderMobileNumber: settings?.senderMobileNumber || "",
    smtpFrom: savedSenderEmail || defaultSmtpFrom,
    smsProviderName: settings?.smsProviderName || "Twilio",
    smsApiKey: settings?.smsApiKey || process.env.TWILIO_ACCOUNT_SID || "",
    smsApiSecret: settings?.smsApiSecret || process.env.TWILIO_AUTH_TOKEN || "",
    smsAccountSid:
      settings?.smsAccountSid ||
      settings?.smsApiKey ||
      process.env.TWILIO_ACCOUNT_SID ||
      "",
    smsAuthToken:
      settings?.smsAuthToken ||
      settings?.smsApiSecret ||
      process.env.TWILIO_AUTH_TOKEN ||
      "",
    smsFromNumber,
    smsSenderId: settings?.smsSenderId || "",
    whatsappProviderName: settings?.whatsappProviderName || "Interakt",
    whatsappApiKey: settings?.whatsappApiKey || process.env.INTERAKT_API_KEY || "",
    whatsappApiSecret: settings?.whatsappApiSecret || "",
    whatsappAccountSid: settings?.whatsappAccountSid || "",
    whatsappAuthToken: settings?.whatsappAuthToken || "",
    whatsappFromNumber: settings?.whatsappFromNumber || "",
    whatsappWebhookUrl: settings?.whatsappWebhookUrl || process.env.WHATSAPP_WEBHOOK_URL || "",
    futureIntegrationNotes: settings?.futureIntegrationNotes || "",
    reportRecipients: settings?.reportRecipients || [],
    reportFrequency: settings?.reportFrequency || "daily",
    reportTime: settings?.reportTime || "18:00",
    emailEnabled: settings?.emailEnabled ?? true,
    whatsappEnabled: settings?.whatsappEnabled ?? true,
    smsEnabled: settings?.smsEnabled ?? false,
    updatedAt: settings?.updatedAt || new Date().toISOString(),
    thresholdAmount: settings?.thresholdAmount !== undefined && Number.isFinite(Number(settings.thresholdAmount)) ? Number(settings.thresholdAmount) : 10000
  };
}
