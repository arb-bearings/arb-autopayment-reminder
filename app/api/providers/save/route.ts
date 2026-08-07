import { NextResponse } from "next/server";
import { requireAdminUser } from "@/lib/auth";
import { requireOperationPassword } from "@/lib/access-control";
import { recordAuditLog } from "@/lib/audit";
import { getCompanyWorkspaceContextForUser } from "@/lib/company-workspace";
import { updateDatabase } from "@/lib/storage";
import type { DispatchSettings } from "@/lib/types";

export async function POST(request: Request) {
  const user = await requireAdminUser();
  const formData = await request.formData();

  try {
    await requireOperationPassword(user, "admin_settings", String(formData.get("operationPassword") || ""));
    await updateDatabase((database) => {
    const workspace = getCompanyWorkspaceContextForUser(database, user);
    const existing = database.dispatchSettings.find(
      (entry) => entry.ownerId === workspace.configOwnerId
    );
    const reportFrequency: DispatchSettings["reportFrequency"] =
      formData.get("reportFrequency") === "weekly" ||
      formData.get("reportFrequency") === "monthly" ||
      formData.get("reportFrequency") === "manual"
        ? (formData.get("reportFrequency") as DispatchSettings["reportFrequency"])
        : "daily";
    const nextValues: DispatchSettings = {
      ownerId: workspace.configOwnerId,
      smtpHost: String(formData.get("smtpHost") || "").trim(),
      smtpPort: Number(formData.get("smtpPort") || 587),
      smtpSecure: formData.get("smtpSecure") === "on",
      smtpUser: String(formData.get("smtpUser") || "").trim(),
      smtpPass: String(formData.get("smtpPass") || ""),
      senderEmail: String(formData.get("senderEmail") || "").trim(),
      senderMobileNumber: String(formData.get("senderMobileNumber") || "").trim(),
      smtpFrom: String(formData.get("senderEmail") || "").trim(),
      smsProviderName: String(formData.get("smsProviderName") || "Twilio").trim(),
      smsApiKey: String(formData.get("smsApiKey") || "").trim(),
      smsApiSecret: String(formData.get("smsApiSecret") || "").trim(),
      smsAccountSid: String(formData.get("smsAccountSid") || "").trim(),
      smsAuthToken: String(formData.get("smsAuthToken") || "").trim(),
      smsFromNumber: String(formData.get("smsFromNumber") || "").trim(),
      smsSenderId: String(formData.get("smsSenderId") || "").trim(),
      whatsappProviderName: String(formData.get("whatsappProviderName") || "Interakt").trim(),
      whatsappApiKey: String(formData.get("whatsappApiKey") || "").trim(),
      whatsappApiSecret: String(formData.get("whatsappApiSecret") || "").trim(),
      whatsappAccountSid: String(formData.get("whatsappAccountSid") || "").trim(),
      whatsappAuthToken: String(formData.get("whatsappAuthToken") || "").trim(),
      whatsappFromNumber: String(formData.get("whatsappFromNumber") || "").trim(),
      whatsappWebhookUrl: String(formData.get("whatsappWebhookUrl") || "").trim(),
      futureIntegrationNotes: String(formData.get("futureIntegrationNotes") || "").trim(),
      reportRecipients: String(formData.get("reportRecipients") || "")
        .split(/[,\n]/)
        .map((entry) => entry.trim())
        .filter(Boolean),
      reportFrequency,
      reportTime: String(formData.get("reportTime") || "18:00").trim(),
      emailEnabled: formData.get("emailEnabled") === "on",
      whatsappEnabled: formData.get("whatsappEnabled") === "on",
      smsEnabled: formData.get("smsEnabled") === "on",
      updatedAt: new Date().toISOString()
    };

    if (existing) {
      Object.assign(existing, nextValues);
    } else {
      database.dispatchSettings.push(nextValues);
    }
    });
    await recordAuditLog(user, "Admin Settings", "success", "Communication/report settings saved.");

    return NextResponse.redirect(
      new URL("/dashboard/settings/email?message=Communication%20settings%20saved.", request.url),
      { status: 303 }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Communication settings save failed.";
    await recordAuditLog(user, "Admin Settings", "failed", message);
    return NextResponse.redirect(
      new URL(`/dashboard/settings/email?error=${encodeURIComponent(message)}`, request.url),
      { status: 303 }
    );
  }
}
