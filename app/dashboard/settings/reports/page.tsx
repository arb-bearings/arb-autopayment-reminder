import { DashboardShell } from "@/components/dashboard-shell";
import { ProtectedSubmitButton } from "@/components/protected-submit-button";
import { TableSearch } from "@/components/table-search";
import { canAccessReports } from "@/lib/access-control";
import { requireUser } from "@/lib/auth";
import { filterSharedCompanyRecords, getCompanyWorkspaceContextForUser } from "@/lib/company-workspace";
import { readDatabase } from "@/lib/storage";
import { formatCurrency } from "@/lib/utils";
import { redirect } from "next/navigation";

export default async function ReportsPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  if (!canAccessReports(user)) {
    redirect("/dashboard?error=Report%20access%20denied.");
  }
  const [database, params] = await Promise.all([readDatabase(), searchParams]);
  const workspace = getCompanyWorkspaceContextForUser(database, user);
  const dues = filterSharedCompanyRecords(database.dueRecords, workspace.sharedOwnerIds);
  const logs = filterSharedCompanyRecords(database.reminderLogs, workspace.sharedOwnerIds);
  const dealerTotals = Array.from(
    dues.reduce((summary, due) => {
      const key = due.companyName || due.dealerCode || "Unknown";
      summary.set(key, (summary.get(key) || 0) + due.amount);
      return summary;
    }, new Map<string, number>())
  ).sort((left, right) => right[1] - left[1]);

  return (
    <DashboardShell
      title="Reports and analytics"
      description="Generate daily activity reports and review outstanding dealer analytics."
      companyName={user.companyName}
      userName={user.name}
      isAdmin
      userRole={user.role}
      canSendManualReminders={user.canSendManualReminders}
    >
      <StatusBar params={params} />

      <section className="content-grid">
        <article className="glass-panel">
          <div className="section-heading">
            <h2>Manual report</h2>
            <p>Recipients and schedule are configured in Email Configuration.</p>
          </div>
          <form action="/api/reports/generate" method="post" className="form-stack">
            <label className="field">
              <span>Report date</span>
              <input name="reportDate" type="date" />
            </label>
            <ProtectedSubmitButton className="button">
              Generate daily report
            </ProtectedSubmitButton>
          </form>
        </article>

        <article className="glass-panel">
          <div className="section-heading">
            <h2>Analytics snapshot</h2>
            <p>{logs.length} reminder logs and {dues.length} due records in scope.</p>
          </div>
          <div className="stats-grid">
            <div className="stat-card">
              <span className="stat-label">Outstanding</span>
              <strong>{formatCurrency(dues.reduce((sum, entry) => sum + entry.amount, 0))}</strong>
            </div>
            <div className="stat-card">
              <span className="stat-label">Email Failures</span>
              <strong>{logs.filter((entry) => entry.channel === "email" && entry.status === "failed").length}</strong>
            </div>
            <div className="stat-card">
              <span className="stat-label">WhatsApp Failures</span>
              <strong>{logs.filter((entry) => entry.channel === "whatsapp" && entry.status === "failed").length}</strong>
            </div>
            <div className="stat-card">
              <span className="stat-label">Sent</span>
              <strong>{logs.filter((entry) => entry.status === "sent").length}</strong>
            </div>
          </div>
        </article>
      </section>

      <article className="glass-panel">
        <div className="section-heading">
          <h2>Top outstanding dealers</h2>
          <p>Search and export this table from the browser print dialog or downloaded workbook data.</p>
        </div>
        <TableSearch />
        <div className="table-wrap">
          <table data-searchable-table>
            <thead>
              <tr>
                <th>Dealer</th>
                <th>Total outstanding</th>
              </tr>
            </thead>
            <tbody>
              {dealerTotals.map(([dealer, amount]) => (
                <tr key={dealer}>
                  <td>{dealer}</td>
                  <td>{formatCurrency(amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </article>
    </DashboardShell>
  );
}

function StatusBar({ params }: { params: Record<string, string | string[] | undefined> }) {
  const message = typeof params.message === "string" ? params.message : "";
  const error = typeof params.error === "string" ? params.error : "";
  return message || error ? (
    <p className={`status-banner ${error ? "status-error" : "status-success"}`}>
      {decodeURIComponent(error || message)}
    </p>
  ) : null;
}
