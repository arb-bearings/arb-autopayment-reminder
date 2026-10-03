import Link from "next/link";
import { DashboardShell } from "@/components/dashboard-shell";
import { requireAdminUser } from "@/lib/auth";
import { getCompanyWorkspaceContextForUser } from "@/lib/company-workspace";
import { readDatabase } from "@/lib/storage";
import { formatCurrency } from "@/lib/utils";

const sections = [
  { label: "Dashboard", href: "/dashboard/settings", superAdminOnly: false },
  { label: "User Management", href: "/dashboard/settings/users", superAdminOnly: true },
  { label: "Password Management", href: "/dashboard/settings/passwords", superAdminOnly: true },
  { label: "Database Settings", href: "/dashboard/settings/database", superAdminOnly: false },
  { label: "Reminder Settings", href: "/dashboard/settings/reminders", superAdminOnly: false },
  { label: "Message Templates", href: "/dashboard/settings/templates", superAdminOnly: false },
  { label: "Email Configuration", href: "/dashboard/settings/email", superAdminOnly: false },
  { label: "Reports & Analytics", href: "/dashboard/settings/reports", superAdminOnly: false },
  { label: "System Logs", href: "/dashboard/settings/logs", superAdminOnly: false }
] as const;

export default async function AdminPanelPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireAdminUser();
  const [database, params] = await Promise.all([readDatabase(), searchParams]);
  const workspace = getCompanyWorkspaceContextForUser(database, user);
  const dues = database.dueRecords.filter((entry) => workspace.sharedOwnerIds.has(entry.ownerId));
  const logs = database.reminderLogs.filter((entry) => workspace.sharedOwnerIds.has(entry.ownerId));
  const sent = logs.filter((entry) => entry.status === "sent").length;
  const failed = logs.filter((entry) => entry.status === "failed").length;

  return (
    <DashboardShell
      title="Admin panel"
      description="Section-based controls for users, passwords, databases, reminders, reporting, and logs."
      companyName={user.companyName}
      userName={user.name}
      isAdmin
      userRole={user.role}
      canSendManualReminders={user.canSendManualReminders}
    >
      <StatusBar params={params} />

      <section className="stats-grid">
        <article className="stat-card glass-panel">
          <span className="stat-label">Users</span>
          <strong>{workspace.companyUsers.length}</strong>
        </article>
        <article className="stat-card glass-panel">
          <span className="stat-label">Outstanding</span>
          <strong>{formatCurrency(dues.reduce((sum, entry) => sum + entry.amount, 0))}</strong>
        </article>
        <article className="stat-card glass-panel">
          <span className="stat-label">Success Rate</span>
          <strong>{sent + failed === 0 ? 0 : Math.round((sent / (sent + failed)) * 100)}%</strong>
        </article>
        <article className="stat-card glass-panel">
          <span className="stat-label">Failed</span>
          <strong>{failed}</strong>
        </article>
      </section>

      <section className="admin-section-grid">
        {sections
          .filter((section) => !section.superAdminOnly || user.role === "super_admin")
          .map(({ label, href }) => (
          <Link key={href} className="glass-panel admin-section-link" href={href}>
            <span>{label}</span>
          </Link>
        ))}
      </section>
    </DashboardShell>
  );
}

function StatusBar({ params }: { params: Record<string, string | string[] | undefined> }) {
  const message = typeof params.message === "string" ? params.message : "";
  const error = typeof params.error === "string" ? params.error : "";

  if (!message && !error) {
    return null;
  }

  return (
    <p className={`status-banner ${error ? "status-error" : "status-success"}`}>
      {decodeURIComponent(error || message)}
    </p>
  );
}
