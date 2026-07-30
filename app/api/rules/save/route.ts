import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { requireAdminUser } from "@/lib/auth";
import { requireOperationPassword } from "@/lib/access-control";
import { recordAuditLog } from "@/lib/audit";
import { getCompanyWorkspaceContextForUser } from "@/lib/company-workspace";
import { updateDatabase } from "@/lib/storage";

export async function POST(request: Request) {
  const user = await requireAdminUser();
  const formData = await request.formData();
  const ruleId = String(formData.get("ruleId") || "");
  const templateId = String(formData.get("templateId") || "");
  const now = new Date().toISOString();

  const payload = {
    name: String(formData.get("name") || "").trim(),
    triggerDay: Number(formData.get("triggerDay") || 0),
    enabled: formData.get("enabled") === "on",
    autoSend: formData.get("autoSend") === "on",
    channels: {
      email: formData.get("channelEmail") === "on",
      whatsapp: formData.get("channelWhatsapp") === "on",
      sms: formData.get("channelSms") === "on"
    },
    emailSubject: String(formData.get("emailSubject") || "").trim(),
    emailBody: String(formData.get("emailBody") || "").trim(),
    whatsappBody: String(formData.get("whatsappBody") || "").trim(),
    smsBody: String(formData.get("smsBody") || "").trim()
  };

  if (!payload.name || !payload.triggerDay || !payload.emailSubject) {
    return NextResponse.redirect(
      new URL("/dashboard/settings?error=Please%20fill%20the%20rule%20details.", request.url),
      { status: 303 }
    );
  }

  try {
    await requireOperationPassword(user, "admin_settings", String(formData.get("operationPassword") || ""));
    await updateDatabase((database) => {
    const workspace = getCompanyWorkspaceContextForUser(database, user);
    const finalRuleId = ruleId || randomUUID();
    const finalTemplateId = templateId || randomUUID();

    const rule = database.reminderRules.find(
      (entry) => entry.id === finalRuleId && entry.ownerId === workspace.configOwnerId
    );

    if (rule) {
      rule.name = payload.name;
      rule.triggerDay = payload.triggerDay;
      rule.enabled = payload.enabled;
      rule.autoSend = payload.autoSend;
      rule.channels = payload.channels;
      rule.updatedAt = now;
    } else {
      database.reminderRules.push({
        id: finalRuleId,
        ownerId: workspace.configOwnerId,
        name: payload.name,
        triggerDay: payload.triggerDay,
        enabled: payload.enabled,
        autoSend: payload.autoSend,
        channels: payload.channels,
        templateId: finalTemplateId,
        createdAt: now,
        updatedAt: now
      });
    }

    const template = database.templates.find(
      (entry) => entry.id === finalTemplateId && entry.ownerId === workspace.configOwnerId
    );

    if (template) {
      template.name = payload.name;
      template.emailSubject = payload.emailSubject;
      template.emailBody = payload.emailBody;
      template.whatsappBody = payload.whatsappBody;
      template.smsBody = payload.smsBody;
      template.updatedAt = now;
      template.userEdited = true;
    } else {
      database.templates.push({
        id: finalTemplateId,
        ownerId: workspace.configOwnerId,
        ruleId: finalRuleId,
        name: payload.name,
        emailSubject: payload.emailSubject,
        emailBody: payload.emailBody,
        whatsappBody: payload.whatsappBody,
        smsBody: payload.smsBody,
        updatedAt: now,
        userEdited: true
      });
    }
    });
    await recordAuditLog(user, "Template Changes", "success", `Saved reminder rule ${payload.name}.`);

    return NextResponse.redirect(
      new URL("/dashboard/settings/templates?message=Reminder%20rule%20saved%20successfully.", request.url),
      { status: 303 }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Reminder rule save failed.";
    await recordAuditLog(user, "Template Changes", "failed", message);
    return NextResponse.redirect(
      new URL(`/dashboard/settings/templates?error=${encodeURIComponent(message)}`, request.url),
      { status: 303 }
    );
  }
}
