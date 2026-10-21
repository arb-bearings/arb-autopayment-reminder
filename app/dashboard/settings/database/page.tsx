import Link from "next/link";
import { DashboardShell } from "@/components/dashboard-shell";
import { requireAdminUser } from "@/lib/auth";
import { filterSharedCompanyRecords, getCompanyWorkspaceContextForUser } from "@/lib/company-workspace";
import { readDatabase } from "@/lib/storage";

export default async function DatabaseSettingsPage() {
  const user = await requireAdminUser();
  const database = await readDatabase();
  const workspace = getCompanyWorkspaceContextForUser(database, user);
  const masterCount = filterSharedCompanyRecords(database.masterContacts, workspace.sharedOwnerIds).length;
  const dueCount = filterSharedCompanyRecords(database.dueRecords, workspace.sharedOwnerIds).length;

  return (
    <DashboardShell
      title="Database settings"
      description="Control shared master and due database upload workspaces."
      companyName={user.companyName}
      companyCode={user.companyCode || "ARB"}
      userName={user.name}
      isAdmin
      userRole={user.role}
      canSendManualReminders={user.canSendManualReminders}
    >
      <section className="content-grid">
        <article className="glass-panel">
          <div className="section-heading">
            <h2>Master database</h2>
            <p>{masterCount} contacts available for matching.</p>
          </div>
          <Link className="button" href="/dashboard/master">
            Open master upload
          </Link>
        </article>

        <article className="glass-panel">
          <div className="section-heading">
            <h2>Due database</h2>
            <p>{dueCount} due records active for review and dispatch.</p>
          </div>
          <Link className="button" href="/dashboard/dues">
            Open dues and dispatch
          </Link>
        </article>
      </section>
    </DashboardShell>
  );
}
