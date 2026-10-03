import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import {
  canDispatchReminders,
  requireOperationPassword
} from "@/lib/access-control";
import { recordAuditLog } from "@/lib/audit";
import { createManualRemindersForDues, sendPendingReminders } from "@/lib/reminder-engine";
import { sendDailyActivityReport, sendSalespersonSummaries } from "@/lib/reports";

function makeRedirect(url: URL | string, reminderCount: number, status = 303) {
  const res = NextResponse.redirect(url, { status });
  res.headers.set("x-reminder-count", String(reminderCount));
  res.headers.set("access-control-expose-headers", "x-reminder-count");
  return res;
}

function makeResponse(
  request: NextRequest | Request,
  redirectPath: string,
  reminderCount: number
) {
  const isClientFetch = (request.headers.get("x-queue-fetch") === "1");
  const redirectUrl = new URL(redirectPath, request.url).toString();
  if (isClientFetch) {
    return NextResponse.json({ count: reminderCount, redirectUrl }, { status: 200 });
  }
  return makeRedirect(redirectUrl, reminderCount);
}


export async function POST(request: NextRequest) {
  const user = await requireUser();
  const formData = await request.formData();
  const dueId = String(formData.get("dueId") || "").trim();
  const dueIds = formData.getAll("dueIds").map((entry) => String(entry).trim()).filter(Boolean);
  const ruleId = String(formData.get("ruleId") || "").trim();
  const bulkSelection = String(formData.get("bulkSelection") || "");
  const logIds = formData.getAll("logIds").map((entry) => String(entry).trim()).filter(Boolean);
  const isQueueSend = formData.get("isQueueSend") === "true";
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

      if (created.length === 0) {
        throw new Error(
          "None of the selected invoices have matching contacts in the master database. No reminders could be created or sent."
        );
      }

      const logs = await sendPendingReminders(
        user.id,
        undefined,
        created.map((entry) => entry.id)
      );

      const salespersonSummaries = await sendSalespersonSummaries(user, logs);
      const activeSalespersonCount = salespersonSummaries.filter((s) => !s.skipped).length;
      const ownerReport = await sendDailyActivityReport(user);
      await recordAuditLog(
        user,
        "Reminder Dispatch",
        "success",
        `Manual dispatch processed ${logs.length} reminders for matched contacts, sent ${activeSalespersonCount} salesperson summaries, and sent owner report to ${ownerReport.recipientCount} recipients.`
      );

      const skippedCount = selectedDueIds.length - created.length;
      const skippedNote = skippedCount > 0 ? ` (skipped ${skippedCount} invoice${skippedCount === 1 ? "" : "s"} with no matched contact)` : "";

      return makeResponse(
        request,
        `/dashboard/dues?message=${encodeURIComponent(
          `Sent ${logs.length} reminder${logs.length === 1 ? "" : "s"} for matched contacts${skippedNote}, sent ${activeSalespersonCount} salesperson summar${activeSalespersonCount === 1 ? "y" : "ies"}, and sent owner summary to ${ownerReport.recipientCount} recipient${ownerReport.recipientCount === 1 ? "" : "s"}.`
        )}`,
        logs.length
      );
    }

    let logs;
    if (isQueueSend) {
      if (logIds.length === 0) {
        throw new Error("Select at least one reminder from the queue before sending.");
      }
      logs = await sendPendingReminders(user.id, undefined, logIds);
    } else {
      logs = await sendPendingReminders(user.id);
    }

    if (logs.length === 0) {
      throw new Error("No pending reminders with matched contacts were found to send.");
    }

    const salespersonSummaries = await sendSalespersonSummaries(user, logs);
    const activeSalespersonCount = salespersonSummaries.filter((s) => !s.skipped).length;
    const ownerReport = await sendDailyActivityReport(user);
    await recordAuditLog(
      user,
      "Reminder Dispatch",
      "success",
      `Processed ${logs.length} reminders for matched contacts, sent ${activeSalespersonCount} salesperson summaries, and sent owner report to ${ownerReport.recipientCount} recipients.`
    );
    return makeResponse(
      request,
      `/dashboard/dues?message=${encodeURIComponent(
        `Sent ${logs.length} reminder${logs.length === 1 ? "" : "s"} for matched contacts, sent ${activeSalespersonCount} salesperson summar${activeSalespersonCount === 1 ? "y" : "ies"}, and sent owner summary to ${ownerReport.recipientCount} recipient${ownerReport.recipientCount === 1 ? "" : "s"}.`
      )}`,
      logs.length
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Sending reminders failed.";
    try {
      await recordAuditLog(user, "Reminder Dispatch", "failed", message);
    } catch (auditError) {
      console.error("Failed to record audit log:", auditError);
    }
    if (request.headers.get("x-queue-fetch") === "1") {
      return NextResponse.json({ error: message }, { status: 400 });
    }
    return NextResponse.redirect(
      new URL(`/dashboard/dues?error=${encodeURIComponent(message)}`, request.url),
      { status: 303 }
    );
  }
}
