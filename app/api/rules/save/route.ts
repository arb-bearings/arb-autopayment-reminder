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
    smsBody: String(formData.get("smsBody") || "").trim(),
    // PDF summary box controls
    pdfBox1Visible: formData.get("pdfBoxControlsPresent") === "true" ? formData.get("pdfBox1Visible") === "on" : true,
    pdfBox2Visible: formData.get("pdfBoxControlsPresent") === "true" ? formData.get("pdfBox2Visible") === "on" : true,
    pdfBox3Visible: formData.get("pdfBoxControlsPresent") === "true" ? formData.get("pdfBox3Visible") === "on" : true,
    pdfBox1Label: String(formData.get("pdfBox1Label") || "").trim(),
    pdfBox2Label: String(formData.get("pdfBox2Label") || "").trim(),
    pdfBox3Label: String(formData.get("pdfBox3Label") || "").trim()
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

    let rule = database.reminderRules.find(
      (entry) => entry.id === finalRuleId && workspace.sharedOwnerIds.has(entry.ownerId)
    );

    if (!rule && ruleId) {
      rule = database.reminderRules.find((entry) => entry.id === ruleId);
    }

    if (rule) {
      rule.name = payload.name;
      rule.triggerDay = payload.triggerDay;
      rule.enabled = payload.enabled;
      rule.autoSend = payload.autoSend;
      rule.channels = payload.channels;
      rule.pdfBox1Visible = payload.pdfBox1Visible;
      rule.pdfBox2Visible = payload.pdfBox2Visible;
      rule.pdfBox3Visible = payload.pdfBox3Visible;
      rule.pdfBox1Label = payload.pdfBox1Label;
      rule.pdfBox2Label = payload.pdfBox2Label;
      rule.pdfBox3Label = payload.pdfBox3Label;
      rule.updatedAt = now;
    } else {
      rule = {
        id: finalRuleId,
        ownerId: workspace.configOwnerId,
        name: payload.name,
        triggerDay: payload.triggerDay,
        enabled: payload.enabled,
        autoSend: payload.autoSend,
        channels: payload.channels,
        templateId: templateId || randomUUID(),
        pdfBox1Visible: payload.pdfBox1Visible,
        pdfBox2Visible: payload.pdfBox2Visible,
        pdfBox3Visible: payload.pdfBox3Visible,
        pdfBox1Label: payload.pdfBox1Label,
        pdfBox2Label: payload.pdfBox2Label,
        pdfBox3Label: payload.pdfBox3Label,
        createdAt: now,
        updatedAt: now
      };
      database.reminderRules.push(rule);
    }

    const finalTemplateId = templateId || rule.templateId || randomUUID();
    rule.templateId = finalTemplateId;

    // Find ALL templates matching this template ID or rule ID
    const matchingTemplates = database.templates.filter(
      (entry) =>
        entry.id === finalTemplateId ||
        entry.ruleId === finalRuleId ||
        (rule?.templateId && entry.id === rule.templateId)
    );

    let template = matchingTemplates[0];

    if (!template) {
      template = {
        id: finalTemplateId,
        ownerId: workspace.configOwnerId,
        ruleId: finalRuleId,
        name: payload.name,
        emailSubject: payload.emailSubject,
        emailBody: payload.emailBody,
        whatsappBody: payload.whatsappBody,
        smsBody: payload.smsBody,
        pdfBox1Visible: payload.pdfBox1Visible,
        pdfBox2Visible: payload.pdfBox2Visible,
        pdfBox3Visible: payload.pdfBox3Visible,
        pdfBox1Label: payload.pdfBox1Label,
        pdfBox2Label: payload.pdfBox2Label,
        pdfBox3Label: payload.pdfBox3Label,
        updatedAt: now,
        userEdited: true
      };
      database.templates.push(template);
    } else {
      template.name = payload.name;
      template.emailSubject = payload.emailSubject;
      template.emailBody = payload.emailBody;
      template.whatsappBody = payload.whatsappBody;
      template.smsBody = payload.smsBody;
      template.pdfBox1Visible = payload.pdfBox1Visible;
      template.pdfBox2Visible = payload.pdfBox2Visible;
      template.pdfBox3Visible = payload.pdfBox3Visible;
      template.pdfBox1Label = payload.pdfBox1Label;
      template.pdfBox2Label = payload.pdfBox2Label;
      template.pdfBox3Label = payload.pdfBox3Label;
      template.updatedAt = now;
      template.userEdited = true;
      template.ruleId = finalRuleId;
      template.id = finalTemplateId;

      // Remove any duplicate templates for this rule
      if (matchingTemplates.length > 1) {
        database.templates = database.templates.filter(
          (t) => t.id === template.id || !matchingTemplates.some((m) => m.id === t.id)
        );
      }
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
