import { DashboardShell } from "@/components/dashboard-shell";
import { ChannelLabel } from "@/components/channel-label";
import { filterSharedCompanyRecords, getCompanyWorkspaceContextForUser } from "@/lib/company-workspace";
import { isAdminUser, requireUser } from "@/lib/auth";
import { getDashboardStats } from "@/lib/reminder-engine";
import { readDatabase } from "@/lib/storage";
import { formatCurrency, formatDate, formatElapsedDaysTag, getOverdueDays } from "@/lib/utils";
import type { Route } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

export default async function DashboardOverview({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const [stats, database, params] = await Promise.all([
    getDashboardStats(user.id),
    readDatabase(),
    searchParams
  ]);
  const workspace = getCompanyWorkspaceContextForUser(database, user);
  const isAdmin = isAdminUser(user);
  const today = new Date();

  const dueRecords = filterSharedCompanyRecords(database.dueRecords, workspace.sharedOwnerIds)
    .sort((left, right) => left.dueDate.localeCompare(right.dueDate))
    .slice(0, 5);
  const reminderLogs = filterSharedCompanyRecords(database.reminderLogs, workspace.sharedOwnerIds)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .slice(0, 6);

  return (
    <DashboardShell
      title="Reminder command center"
      description="Track your imported records, check upcoming dues, and see the latest reminder activity."
      companyName={user.companyName}
      userName={user.name}
      isAdmin={isAdmin}
      userRole={user.role}
      canSendManualReminders={user.canSendManualReminders}
    >
      <StatusBar params={params} />

      <section className="stats-grid">
        {isAdmin ? (
          <StatCard href="/dashboard/master" label="Master Contacts" value={stats.masterCount} />
        ) : null}
        <StatCard href="/dashboard/dues" label="Due Records" value={stats.dueCount} />
        <StatCard
          href="/dashboard/dues?status=pending#reminder-queue"
          label="Pending Reminders"
          value={stats.pendingReminders}
        />
        <StatCard
          href="/dashboard/dues?status=sent#reminder-queue"
          label="Sent Messages"
          value={stats.sentReminders}
          detail={
            <span className="channel-summary">
              <span>
                <ChannelLabel channel="email" /> {stats.sentByChannel.email}
              </span>
              <span>
                <ChannelLabel channel="whatsapp" /> {stats.sentByChannel.whatsapp}
              </span>
              <span>
                <ChannelLabel channel="sms" /> {stats.sentByChannel.sms}
              </span>
            </span>
          }
        />
        <StatCard
          href="/dashboard/dues"
          label="Total Outstanding"
          value={formatCurrency(stats.totalOutstandingAmount)}
        />
        <StatCard
          href="/dashboard/dues?status=sent#reminder-queue"
          label="Today's Reminders"
          value={stats.todayRemindersSent}
        />
        <StatCard
          href="/dashboard/dues?status=sent#reminder-queue"
          label="Success Rate"
          value={`${stats.successRate}%`}
        />
        <StatCard
          href="/dashboard/dues?status=failed#reminder-queue"
          label="Failed Deliveries"
          value={stats.failedDeliveries}
          detail={`${stats.failureRate}% failure rate`}
        />
      </section>

      <section className="content-grid">
        <article className="glass-panel">
          <div className="section-heading">
            <h2>Upcoming dues</h2>
            <p>Generate reminders from current bill age whenever you are ready to build the queue.</p>
          </div>

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>No.</th>
                  <th>Company</th>
                  <th>Invoice</th>
                  <th>Bill age</th>
                  <th>Overdue</th>
                  <th>Due date</th>
                  <th>Pending</th>
                </tr>
              </thead>
              <tbody>
                {dueRecords.length === 0 ? (
                  <tr>
                    <td colSpan={7}>No due records uploaded yet.</td>
                  </tr>
                ) : (
                  dueRecords.map((due, index) => (
                    <tr key={due.id}>
                      <td>{index + 1}</td>
                      <td>{due.companyName}</td>
                      <td>{due.invoiceNumber || due.reference || "N/A"}</td>
                      <td>{formatElapsedDaysTag(due.billDate || due.invoiceDate, today)}</td>
                      <td>{getOverdueDays(due.billDate || due.invoiceDate, today) > 0 ? `${getOverdueDays(due.billDate || due.invoiceDate, today)} days` : "Current"}</td>
                      <td>{formatDate(due.dueDate)}</td>
                      <td>{formatCurrency(due.amount, due.currency)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </article>

        <article className="glass-panel">
          <div className="section-heading">
            <h2>Latest reminder activity</h2>
            <p>Preview what has been generated or sent.</p>
          </div>

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>No.</th>
                  <th>Channel</th>
                  <th>Recipient</th>
                  <th>Status</th>
                  <th>Scheduled</th>
                </tr>
              </thead>
              <tbody>
                {reminderLogs.length === 0 ? (
                  <tr>
                    <td colSpan={5}>No reminder activity yet.</td>
                  </tr>
                ) : (
                  reminderLogs.map((log, index) => (
                    <tr key={log.id}>
                      <td>{index + 1}</td>
                      <td>
                        <ChannelLabel channel={log.channel} />
                      </td>
                      <td>{isAdmin ? log.recipient : "Hidden"}</td>
                      <td className="capitalize">{log.status}</td>
                      <td>{formatDate(log.scheduledFor)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </article>
      </section>
    </DashboardShell>
  );
}

function StatCard({
  href,
  label,
  value,
  detail
}: {
  href: Route;
  label: string;
  value: string | number;
  detail?: ReactNode;
}) {
  return (
    <Link href={href} className="stat-card stat-card-link glass-panel">
      <span className="stat-label">{label}</span>
      <strong>{value}</strong>
      {detail ? <span className="stat-detail">{detail}</span> : null}
    </Link>
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
