import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import {
  canDispatchReminders,
  requireOperationPassword
} from "@/lib/access-control";
import { recordAuditLog } from "@/lib/audit";
import { sendPendingReminders } from "@/lib/reminder-engine";
import { sendDailyActivityReport, sendSalespersonSummaries } from "@/lib/reports";

/**
 * POST /api/reminders/send-batch
 *
 * Sends a small batch of pending reminders by logIds.
 * Designed to complete within Vercel's serverless function timeout.
 *
 * Body (JSON):
 *   logIds: string[]          — the reminder log IDs to send in this batch
 *   operationPassword: string — dispatch operation password
 *   sendReports?: boolean     — if true, send salesperson summaries + daily report after this batch
 *
 * Returns JSON:
 *   { sent: number, failed: number, errors: string[] }
 */
export async function POST(request: NextRequest) {
  try {
    const user = await requireUser();

    if (!canDispatchReminders(user)) {
      return NextResponse.json({ error: "Reminder dispatch access denied." }, { status: 403 });
    }

    const body = await request.json() as {
      logIds?: string[];
      operationPassword?: string;
      sendReports?: boolean;
    };

    const logIds = body.logIds ?? [];
    const operationPassword = body.operationPassword ?? "";
    const sendReports = body.sendReports ?? false;

    if (logIds.length === 0) {
      return NextResponse.json({ error: "No logIds provided." }, { status: 400 });
    }

    await requireOperationPassword(user, "dispatch", operationPassword);

    // Send only this batch of reminders
    const logs = await sendPendingReminders(user.id, undefined, logIds);

    const sent = logs.filter((l) => l.status === "sent").length;
    const failed = logs.filter((l) => l.status === "failed").length;
    const errors = logs
      .filter((l) => l.status === "failed" && l.failureReason)
      .map((l) => l.failureReason);

    // Send reports only on the final batch
    if (sendReports && logs.length > 0) {
      try {
        await sendSalespersonSummaries(user, logs);
        await sendDailyActivityReport(user);
      } catch (reportError) {
        console.error("Warning: Summary report dispatch failed after batch:", reportError);
      }
    }

    return NextResponse.json({ sent, failed, errors }, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Batch send failed.";
    try {
      const user = await requireUser();
      await recordAuditLog(user, "Reminder Batch Dispatch", "failed", message);
    } catch {
      // ignore audit failures
    }
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
