import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import {
  canDispatchReminders,
  requireOperationPassword
} from "@/lib/access-control";
import { recordAuditLog } from "@/lib/audit";
import { createManualRemindersForDues, sendPendingReminders } from "@/lib/reminder-engine";
import { sendDailyActivityReport, sendSalespersonSummaries } from "@/lib/reports";

export async function POST(request: Request) {
  const user = await requireUser();
  const formData = await request.formData();
  const dueId = String(formData.get("dueId") || "").trim();
  const dueIds = formData.getAll("dueIds").map((entry) => String(entry).trim()).filter(Boolean);
  const ruleId = String(formData.get("ruleId") || "").trim();
  const bulkSelection = String(formData.get("bulkSelection") || "");
  const operationPassword = String(formData.get("operationPassword") || "");
  const selectedChannels = {
    email: formData.get("channelEmail") === "on",
    whatsapp: formData.get("channelWhatsapp") === "on",
    sms: formData.get("channelSms") === "on"
  };
  const hasChannelOverride =
    selectedChannels.email || selectedChannels.whatsapp || selectedChannels.sms;

  try {
    if (!canDispatchReminders(user)) {
      throw new Error("Reminder dispatch access denied.");
    }

    await requireOperationPassword(user, "dispatch", operationPassword);

    const selectedDueIds = dueIds.length > 0 ? dueIds : dueId ? [dueId] : [];

    if (bulkSelection === "selected" && selectedDueIds.length === 0) {
      throw new Error("Select at least one due record before dispatching reminders.");
    }

    if (selectedDueIds.length > 0 && ruleId) {
      const created = await createManualRemindersForDues(
        user.id,
        selectedDueIds,
        ruleId,
        hasChannelOverride ? selectedChannels : undefined
      );
      const logs = await sendPendingReminders(
        user.id,
        undefined,
        created.map((entry) => entry.id)
      );

      const salespersonSummaries = await sendSalespersonSummaries(user, logs);
      const ownerReport = await sendDailyActivityReport(user);
      await recordAuditLog(
        user,
        "Reminder Dispatch",
        "success",
        `Manual dispatch processed ${logs.length} reminders, sent ${salespersonSummaries.length} salesperson summaries, and sent owner report to ${ownerReport.recipientCount} recipients.`
      );

      return NextResponse.redirect(
        new URL(
          `/dashboard/dues?message=${encodeURIComponent(
            `Sent ${logs.length} manual reminder${logs.length === 1 ? "" : "s"} for ${selectedDueIds.length} selected invoice${selectedDueIds.length === 1 ? "" : "s"}, sent ${salespersonSummaries.length} salesperson summar${salespersonSummaries.length === 1 ? "y" : "ies"}, and sent owner summary to ${ownerReport.recipientCount} recipient${ownerReport.recipientCount === 1 ? "" : "s"}.`
          )}`,
          request.url
        ),
        { status: 303 }
      );
    }

    const logs = await sendPendingReminders(user.id);
    const salespersonSummaries = await sendSalespersonSummaries(user, logs);
    const ownerReport = await sendDailyActivityReport(user);
    await recordAuditLog(
      user,
      "Reminder Dispatch",
      "success",
      `Processed ${logs.length} pending reminders, sent ${salespersonSummaries.length} salesperson summaries, and sent owner report to ${ownerReport.recipientCount} recipients.`
    );
    return NextResponse.redirect(
      new URL(
        `/dashboard/dues?message=${encodeURIComponent(
          `Processed ${logs.length} pending reminders, sent ${salespersonSummaries.length} salesperson summar${salespersonSummaries.length === 1 ? "y" : "ies"}, and sent owner summary to ${ownerReport.recipientCount} recipient${ownerReport.recipientCount === 1 ? "" : "s"}.`
        )}`,
        request.url
      ),
      { status: 303 }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Sending reminders failed.";
    try {
      await recordAuditLog(user, "Reminder Dispatch", "failed", message);
    } catch (auditError) {
      console.error("Failed to record audit log:", auditError);
    }
    return NextResponse.redirect(
      new URL(`/dashboard/dues?error=${encodeURIComponent(message)}`, request.url),
      { status: 303 }
    );
  }
}
