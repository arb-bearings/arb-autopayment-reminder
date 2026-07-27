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
  const policyId = String(formData.get("policyId") || "");
  const now = new Date().toISOString();

  const payload = {
    name: String(formData.get("name") || "").trim(),
    paymentWindowDays: Number(formData.get("paymentWindowDays") || 0),
    discountPercent: Number(formData.get("discountPercent") || 0),
    enabled: formData.get("enabled") === "on",
    description: String(formData.get("description") || "").trim(),
    cdMessageTemplate: String(formData.get("cdMessageTemplate") || "").trim(),
    cdMessageWithOlderTemplate: String(formData.get("cdMessageWithOlderTemplate") || "").trim(),
    cdShortMessageTemplate: String(formData.get("cdShortMessageTemplate") || "").trim(),
    cdShortMessageWithOlderTemplate: String(formData.get("cdShortMessageWithOlderTemplate") || "").trim()
  };

  if (!payload.name || !payload.paymentWindowDays || payload.discountPercent <= 0) {
    return NextResponse.redirect(
      new URL("/dashboard/settings?error=Please%20fill%20the%20cash%20discount%20policy%20details.", request.url),
      { status: 303 }
    );
  }

  try {
    await requireOperationPassword(user, "admin_settings", String(formData.get("operationPassword") || ""));
    await updateDatabase((database) => {
    const workspace = getCompanyWorkspaceContextForUser(database, user);
    const existing = database.cashDiscountPolicies.find(
      (entry) => entry.id === policyId && entry.ownerId === workspace.configOwnerId
    );

    if (existing) {
      existing.name = payload.name;
      existing.paymentWindowDays = payload.paymentWindowDays;
      existing.discountPercent = payload.discountPercent;
      existing.enabled = payload.enabled;
      existing.description = payload.description;
      existing.cdMessageTemplate = payload.cdMessageTemplate;
      existing.cdMessageWithOlderTemplate = payload.cdMessageWithOlderTemplate;
      existing.cdShortMessageTemplate = payload.cdShortMessageTemplate;
      existing.cdShortMessageWithOlderTemplate = payload.cdShortMessageWithOlderTemplate;
      existing.updatedAt = now;
      return;
    }

    database.cashDiscountPolicies.push({
      id: randomUUID(),
      ownerId: workspace.configOwnerId,
      name: payload.name,
      paymentWindowDays: payload.paymentWindowDays,
      discountPercent: payload.discountPercent,
      enabled: payload.enabled,
      description: payload.description,
      cdMessageTemplate: payload.cdMessageTemplate,
      cdMessageWithOlderTemplate: payload.cdMessageWithOlderTemplate,
      cdShortMessageTemplate: payload.cdShortMessageTemplate,
      cdShortMessageWithOlderTemplate: payload.cdShortMessageWithOlderTemplate,
      createdAt: now,
      updatedAt: now
    });
    });
    await recordAuditLog(user, "Admin Settings", "success", `Saved CD policy ${payload.name}.`);

    return NextResponse.redirect(
      new URL("/dashboard/settings/reminders?message=Cash%20discount%20policy%20saved.", request.url),
      { status: 303 }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Cash discount policy save failed.";
    await recordAuditLog(user, "Admin Settings", "failed", message);
    return NextResponse.redirect(
      new URL(`/dashboard/settings/reminders?error=${encodeURIComponent(message)}`, request.url),
      { status: 303 }
    );
  }
}
