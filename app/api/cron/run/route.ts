import { NextResponse } from "next/server";
import { getCompanyWorkspaceContext, SUPPORTED_COMPANIES } from "@/lib/company-workspace";
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

  const summary: Array<{ company: string; email: string; generated: number; processed: number; report: string }> = [];

  for (const company of SUPPORTED_COMPANIES) {
    try {
      const database = await readDatabase(company.code);
      const users = database.users;
      const processedWorkspaces = new Set<string>();

      for (const user of users) {
        const workspace = getCompanyWorkspaceContext(database, user.companyName || company.fullName);
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

        // Send salesperson summaries if any reminders were dispatched (including auto-sent)
        const sentDuringGeneration = generated.filter((entry) => entry.status === "sent");
        const totalDispatched = [...sentDuringGeneration, ...sentLogs];

        if (totalDispatched.length > 0) {
          try {
            await sendSalespersonSummaries(user, totalDispatched);
          } catch (err) {
            console.error(`Cron: failed to send salesperson summaries for ${user.email} (${company.label}):`, err);
          }
        }

        const settings = database.dispatchSettings.find((entry) => entry.ownerId === workspace.configOwnerId);
        let report = "skipped";

        if (settings?.reportFrequency && settings.reportFrequency !== "manual") {
          await sendDailyActivityReport(user);
          report = settings.reportFrequency;
        }

        summary.push({
          company: company.label,
          email: user.email,
          generated: generated.length,
          processed,
          report
        });
      }
    } catch (err) {
      console.error(`Cron error processing company ${company.label}:`, err);
    }
  }

  return NextResponse.json({ ok: true, summary });
}
