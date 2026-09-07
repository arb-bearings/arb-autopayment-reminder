import { NextResponse } from "next/server";
import { canAccessReports, requireOperationPassword } from "@/lib/access-control";
import { requireUser } from "@/lib/auth";
import { recordAuditLog } from "@/lib/audit";
import { sendDailyActivityReport, sendSalespersonSummaries } from "@/lib/reports";
import { readDatabase } from "@/lib/storage";
import { filterSharedCompanyRecords, getCompanyWorkspaceContextForUser } from "@/lib/company-workspace";

export async function POST(request: Request) {
  const user = await requireUser();
  const formData = await request.formData();
  const reportDateValue = String(formData.get("reportDate") || "");
  const reportDate = reportDateValue ? new Date(reportDateValue) : new Date();

  try {
    if (!canAccessReports(user)) {
      throw new Error("Report access denied.");
    }
    await requireOperationPassword(user, "report_generation", String(formData.get("operationPassword") || ""));

    const result = await sendDailyActivityReport(user, reportDate);

    // Also dispatch Salesperson Summaries
    const database = await readDatabase();
    const workspace = getCompanyWorkspaceContextForUser(database, user);
    const day = reportDate.toISOString().slice(0, 10);
    const logs = filterSharedCompanyRecords(database.reminderLogs, workspace.sharedOwnerIds);
    const todaySentLogs = logs.filter((entry) => (entry.sentAt || entry.scheduledFor || entry.createdAt || "").slice(0, 10) === day && entry.status === "sent");
    const salespersonResults = await sendSalespersonSummaries(user, todaySentLogs);
    const salespersonCount = salespersonResults.filter((r) => !r.skipped).length;

    await recordAuditLog(
      user,
      "Report Generation",
      "success",
      `Generated report for ${result.report.date}; admin recipients: ${result.recipientCount}; salesperson summaries: ${salespersonCount}.`
    );

    const spMsg = salespersonCount > 0 ? ` and ${salespersonCount} salesperson report${salespersonCount === 1 ? "" : "s"}` : "";

    return NextResponse.redirect(
      new URL(
        `/dashboard/settings/reports?message=${encodeURIComponent(
          result.skipped && salespersonCount === 0
            ? `Report generated for ${result.report.date}. Add report recipients in Email Configuration to send it by email.`
            : `Report sent to ${result.recipientCount} admin recipient${result.recipientCount === 1 ? "" : "s"}${spMsg}.`
        )}`,
        request.url
      ),
      { status: 303 }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Report generation failed.";
    await recordAuditLog(user, "Report Generation", "failed", message);
    return NextResponse.redirect(
      new URL(`/dashboard/settings/reports?error=${encodeURIComponent(message)}`, request.url),
      { status: 303 }
    );
  }
}
