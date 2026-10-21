import { DashboardShell } from "@/components/dashboard-shell";
import { TableSearch } from "@/components/table-search";
import { requireAdminUser } from "@/lib/auth";
import { getCompanyWorkspaceContextForUser } from "@/lib/company-workspace";
import { readDatabase } from "@/lib/storage";

function formatDateTime(value: string) {
  if (!value) {
    return "-";
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? "-"
    : new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short" }).format(parsed);
}

export default async function SystemLogsPage() {
  const user = await requireAdminUser();
  const database = await readDatabase();
  const workspace = getCompanyWorkspaceContextForUser(database, user);
  const logs = database.auditLogs
    .filter((entry) => workspace.sharedOwnerIds.has(entry.ownerId))
    .sort((left, right) => right.timestamp.localeCompare(left.timestamp))
    .slice(0, 300);

  return (
    <DashboardShell
      title="System logs"
      description="Audit trail for login, logout, uploads, dispatch, password changes, users, reports, and templates."
      companyName={user.companyName}
      companyCode={user.companyCode || "ARB"}
      userName={user.name}
      isAdmin
      userRole={user.role}
      canSendManualReminders={user.canSendManualReminders}
    >
      <article className="glass-panel">
        <div className="section-heading">
          <h2>Audit log</h2>
          <p>Showing latest {logs.length} entries.</p>
        </div>
        <TableSearch />
        <div className="table-wrap">
          <table data-searchable-table>
            <thead>
              <tr>
                <th>Timestamp</th>
                <th>User</th>
                <th>Role</th>
                <th>Action</th>
                <th>Status</th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody>
              {logs.length === 0 ? (
                <tr>
                  <td colSpan={6}>No audit logs captured yet.</td>
                </tr>
              ) : (
                logs.map((entry) => (
                  <tr key={entry.id}>
                    <td>{formatDateTime(entry.timestamp)}</td>
                    <td>{entry.userName || entry.userEmail}</td>
                    <td>{entry.role.replace("_", " ")}</td>
                    <td>{entry.action}</td>
                    <td>{entry.status}</td>
                    <td>{entry.details || "-"}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </article>
    </DashboardShell>
  );
}
