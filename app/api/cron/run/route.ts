import { NextResponse } from "next/server";
import { getCompanyWorkspaceContext } from "@/lib/company-workspace";
import { generateRemindersForUser, sendPendingReminders } from "@/lib/reminder-engine";
import { sendDailyActivityReport, sendSalespersonSummaries } from "@/lib/reports";
import { readDatabase } from "@/lib/storage";

export async function POST(request: Request) {
  const configuredSecret = process.env.CRON_SECRET;
  const providedSecret =
    request.headers.get("x-cron-secret") ||
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");

  if (configuredSecret && providedSecret !== configuredSecret) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const database = await readDatabase();
  const users = database.users;
  const processedWorkspaces = new Set<string>();
  const summary: Array<{ email: string; generated: number; processed: number; report: string }> = [];

  for (const user of users) {
    const workspace = getCompanyWorkspaceContext(database, user.companyName);
    if (processedWorkspaces.has(workspace.workspaceId)) {
      continue;
    }
    processedWorkspaces.add(workspace.workspaceId);

    const generated = await generateRemindersForUser(user.id);
    const autoSendRuleIds = database.reminderRules
      .filter(
        (entry) => entry.ownerId === workspace.configOwnerId && entry.enabled && entry.autoSend
      )
      .map((entry) => entry.id);
    let sentLogs: Awaited<ReturnType<typeof sendPendingReminders>> = [];
    if (autoSendRuleIds.length > 0) {
      sentLogs = await sendPendingReminders(user.id, autoSendRuleIds);
    }
    const processed = sentLogs.length;

    // Send salesperson summaries if any reminders were dispatched
    if (processed > 0) {
      try {
        await sendSalespersonSummaries(user, sentLogs);
      } catch (err) {
        console.error(`Cron: failed to send salesperson summaries for ${user.email}:`, err);
      }
    }

    const settings = database.dispatchSettings.find((entry) => entry.ownerId === workspace.configOwnerId);
    let report = "skipped";

    if (settings?.reportFrequency && settings.reportFrequency !== "manual") {
      await sendDailyActivityReport(user);
      report = settings.reportFrequency;
    }

    summary.push({
      email: user.email,
      generated: generated.length,
      processed,
      report
    });
  }

  return NextResponse.json({ ok: true, summary });
}
