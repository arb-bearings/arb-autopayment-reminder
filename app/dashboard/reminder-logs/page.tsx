import { DashboardShell } from "@/components/dashboard-shell";
import { ReminderLogsClient } from "@/components/reminder-logs-client";
import { filterSharedCompanyRecords, getCompanyWorkspaceContextForUser } from "@/lib/company-workspace";
import { isAdminUser, requireUser } from "@/lib/auth";
import { readDatabase } from "@/lib/storage";

export default async function ReminderLogsPage() {
  const user = await requireUser();
  const database = await readDatabase();
  const workspace = getCompanyWorkspaceContextForUser(database, user);
  const isAdmin = isAdminUser(user);

  // Filter logs, due records, and master contacts to the company workspace scope
  const reminderLogs = filterSharedCompanyRecords(database.reminderLogs, workspace.sharedOwnerIds);
  const dueRecords = filterSharedCompanyRecords(database.dueRecords, workspace.sharedOwnerIds);
  const masterContacts = filterSharedCompanyRecords(database.masterContacts, workspace.sharedOwnerIds);

  return (
    <DashboardShell
      title="Reminder Logs"
      description="Track and inspect the history of sent reminders grouped by dealer. View elapsed days since last reminder, outstanding amounts, and individual invoice dispatches."
      companyName={user.companyName}
      userName={user.name}
      isAdmin={isAdmin}
      userRole={user.role}
      canSendManualReminders={user.canSendManualReminders}
    >
      <section className="content-grid">
        <article className="glass-panel rule-span">
          <div className="section-heading">
            <h2>Sent reminder logs by dealer</h2>
            <p>
              Logs are grouped by dealer to trace communication history. The elapsed days since the last reminder for
              each dealer is colored green if 5 or more days (eligible for next reminder), and red if less than 5 days (cooldown active). Click a
              dealer row to expand and view the full invoice list and message dispatch details.
            </p>
          </div>

          <ReminderLogsClient
            reminderLogs={reminderLogs}
            dueRecords={dueRecords}
            masterContacts={masterContacts}
          />
        </article>
      </section>
    </DashboardShell>
  );
}
