import { DashboardShell } from "@/components/dashboard-shell";
import { ChannelLabel } from "@/components/channel-label";
import { GenerationDateField } from "@/components/generation-date-field";
import { ProtectedSubmitButton } from "@/components/protected-submit-button";
import { findMatchingMasterContact } from "@/lib/contact-matching";
import {
  filterSharedCompanyRecords,
  getCompanyWorkspaceContextForUser
} from "@/lib/company-workspace";
import { isAdminUser, requireUser } from "@/lib/auth";
import { resolveDispatchSettings } from "@/lib/dispatch-settings";
import { readDatabase } from "@/lib/storage";
import { formatDate } from "@/lib/utils";
import Link from "next/link";

export default async function DispatchPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const [database, params] = await Promise.all([readDatabase(), searchParams]);
  const isAdmin = isAdminUser(user);
  const workspace = getCompanyWorkspaceContextForUser(database, user);

  const settings = resolveDispatchSettings(
    database.dispatchSettings.find((entry) => entry.ownerId === workspace.configOwnerId) ?? {
      ownerId: workspace.configOwnerId
    }
  );
  const masterContacts = filterSharedCompanyRecords(database.masterContacts, workspace.sharedOwnerIds);
  const dueRecords = filterSharedCompanyRecords(database.dueRecords, workspace.sharedOwnerIds)
    .sort((left, right) => left.dueDate.localeCompare(right.dueDate));
  const sendableDueRecords = dueRecords.filter((entry) =>
    Boolean(findMatchingMasterContact(entry, masterContacts))
  );
  const unmatchedDueCount = dueRecords.length - sendableDueRecords.length;
  const rules = database.reminderRules
    .filter((entry) => entry.ownerId === workspace.configOwnerId)
    .sort((left, right) => left.triggerDay - right.triggerDay);
  const dueRecordMap = new Map(dueRecords.map((entry) => [entry.id, entry]));
  const ruleMap = new Map(rules.map((entry) => [entry.id, entry]));
  const allReminderLogs = filterSharedCompanyRecords(database.reminderLogs, workspace.sharedOwnerIds)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  const reminderLogs = allReminderLogs;
  const today = new Date().toISOString().slice(0, 10);
  const todayGeneratedLogs = allReminderLogs.filter(
    (entry) => entry.scheduledFor.slice(0, 10) === today
  );
  const pendingCount = allReminderLogs.filter((entry) => entry.status === "pending").length;
  const failedCount = allReminderLogs.filter((entry) => entry.status === "failed").length;
  const deliveredCount = allReminderLogs.filter((entry) => entry.status === "sent").length;

  return (
    <DashboardShell
      title="Dispatch center"
      description="Generate reminders only when you choose, review the day-based queue, and send it when you are ready."
      companyName={user.companyName}
      userName={user.name}
      isAdmin={isAdmin}
    >
      <section className="dispatch-shell">
        <StatusBar params={params} />

        <article className="dispatch-hero">
          <div className="dispatch-hero-copy">
            <span className="dispatch-kicker">Multi-channel dispatch</span>
            <h2>One quiet place to control email, SMS, and WhatsApp sends.</h2>
            <p>
              Add your SMTP details and provider credentials, generate the queue, and send live
              reminders from the same panel.
            </p>
          </div>

          <div className="dispatch-metrics">
            <div className="dispatch-metric">
              <span>Pending</span>
              <strong>{pendingCount}</strong>
            </div>
            <div className="dispatch-metric">
              <span>Delivered</span>
              <strong>{deliveredCount}</strong>
            </div>
            <div className="dispatch-metric">
              <span>Failed</span>
              <strong>{failedCount}</strong>
            </div>
            <div className="dispatch-metric">
              <span>Rules</span>
              <strong>{rules.length}</strong>
            </div>
          </div>
        </article>

        <section className="dispatch-grid">
          <article className="dispatch-card dispatch-card-dark">
            <div className="dispatch-heading">
              <h2>Communication setup</h2>
              <p>
                Admin keeps provider credentials in Contact Settings. This page stays focused on
                queue generation, review, and sending.
              </p>
            </div>

            <div className="stacked-layout">
              <p className="muted-copy">
                Sender email: {settings.senderEmail || settings.smtpFrom || "Not configured"}
              </p>
              <p className="muted-copy">
                SMS sender: {settings.smsFromNumber || "Not configured"}
              </p>
              <p className="muted-copy">
                WhatsApp provider: {settings.whatsappProviderName || "Interakt"}
              </p>

              {isAdmin ? (
                <Link className="button" href="/dashboard/settings">
                  Open admin dashboard
                </Link>
              ) : (
                <p className="dispatch-note dispatch-note-plain">
                  Provider settings, rule templates, and CD policies are managed by your admin.
                </p>
              )}
            </div>
          </article>

          <article className="dispatch-card">
            <div className="dispatch-heading">
              <h2>Queue actions</h2>
              <p>
                Uploads only sync your data now. First generate reminders using the selected date
                and your bill-age rules, then send the queued reminders when you are ready.
              </p>
            </div>

            <div className="dispatch-action-stack">
              <form action="/api/reminders/generate" method="post" className="dispatch-form">
                <input type="hidden" name="forceAllRules" value="true" />
                <GenerationDateField />
                <TodayGenerationNotice count={todayGeneratedLogs.length} />
                <ProtectedSubmitButton className="button" promptOnSubmitOnly={true}>
                  Generate eligible reminders
                </ProtectedSubmitButton>
              </form>

              <form action="/api/reminders/send" method="post" className="dispatch-form">
                <ProtectedSubmitButton className="button button-secondary" promptOnSubmitOnly={true}>
                  Send generated reminders
                </ProtectedSubmitButton>
              </form>
            </div>
          </article>
        </section>

        <article className="dispatch-card">
          <div className="dispatch-heading">
            <h2>Send reminder now</h2>
            <p>
              Pick an invoice, choose a rule, and push a one-off reminder without waiting for the
              automated cycle.
            </p>
          </div>

          {sendableDueRecords.length === 0 || rules.length === 0 ? (
            <p className="dispatch-empty">
              {dueRecords.length === 0
                ? "Upload due records and create at least one reminder rule to unlock manual sending."
                : rules.length === 0
                  ? "Create at least one reminder rule to unlock manual sending."
                  : "No invoices currently resolve to a master contact. Re-upload matching master or due data first."}
            </p>
          ) : (
            <form action="/api/reminders/send" method="post" className="dispatch-form">
              <div className="dispatch-form-grid">
                <label className="field">
                  <span>Choose invoice</span>
                  <select name="dueId" defaultValue={sendableDueRecords[0]?.id}>
                    {sendableDueRecords.map((due) => (
                      <option key={due.id} value={due.id}>
                        {(due.invoiceNumber || due.reference || "No invoice number") +
                          " - " +
                          due.companyName +
                          " - Due " +
                          formatDate(due.dueDate)}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="field">
                  <span>Choose reminder</span>
                  <select name="ruleId" defaultValue={rules[0]?.id}>
                    {rules.map((rule) => (
                      <option key={rule.id} value={rule.id}>
                        {rule.name} (day {rule.triggerDay} reminder)
                        {rule.enabled ? "" : " - disabled for auto generation"}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="dispatch-toggle-grid">
                <label className="checkbox-field dispatch-check">
                  <input name="channelEmail" type="checkbox" />
                  <span>Email only if checked</span>
                </label>
                <label className="checkbox-field dispatch-check">
                  <input name="channelWhatsapp" type="checkbox" />
                  <span>WhatsApp only if checked</span>
                </label>
                <label className="checkbox-field dispatch-check">
                  <input name="channelSms" type="checkbox" />
                  <span>SMS only if checked</span>
                </label>
              </div>

              <p className="dispatch-note dispatch-note-plain">
                Leave all channel boxes unchecked to use the channels already configured on the
                selected rule.
              </p>

              {unmatchedDueCount > 0 ? (
                <p className="dispatch-note dispatch-note-plain">
                  {unmatchedDueCount} invoice{unmatchedDueCount === 1 ? "" : "s"} hidden here because
                  no matching master contact could be resolved.
                </p>
              ) : null}

              <ProtectedSubmitButton className="button" promptOnSubmitOnly={true}>
                Send selected reminder now
              </ProtectedSubmitButton>
            </form>
          )}
        </article>

        <article className="dispatch-card">
          <div className="dispatch-heading">
            <h2>Reminder queue</h2>
            <p>Showing all reminder logs across all channels.</p>
          </div>

          <div className="table-wrap dispatch-table-wrap">
            <table className="dispatch-table">
              <thead>
                <tr>
                  <th>No.</th>
                  <th>Invoice</th>
                  <th>Company</th>
                  <th>Rule</th>
                  <th>Channel</th>
                  <th>Recipient</th>
                  <th>Status</th>
                  <th>Scheduled</th>
                  <th>CD</th>
                  <th>Failure / CD note</th>
                </tr>
              </thead>
              <tbody>
                {reminderLogs.length === 0 ? (
                  <tr>
                    <td colSpan={10}>Upload a dues file to populate the queue.</td>
                  </tr>
                ) : (
                  reminderLogs.map((log, index) => {
                    const due = dueRecordMap.get(log.dueId);
                    const rule = ruleMap.get(log.ruleId);

                    return (
                      <tr key={log.id}>
                        <td>{index + 1}</td>
                        <td>{due?.invoiceNumber || due?.reference || due?.companyName || "N/A"}</td>
                        <td>
                          <div className="dispatch-company-cell">
                            <span>{due?.companyName || log.dealerCode || "N/A"}</span>
                            <span
                              className={`dispatch-badge ${
                                log.cdEligible
                                  ? "dispatch-badge-cd"
                                  : "dispatch-badge-cd dispatch-badge-cd-muted"
                              }`}
                            >
                              {log.cdEligible
                                ? `CD ${log.cdDiscountPercent}%`
                                : "No CD"}
                            </span>
                          </div>
                        </td>
                        <td>{rule?.name || "Unknown rule"}</td>
                        <td>
                          <ChannelLabel channel={log.channel} />
                        </td>
                        <td>{isAdmin ? log.recipient : "Hidden"}</td>
                        <td>
                          <span className={`dispatch-badge dispatch-status-${log.status}`}>
                            {log.status}
                          </span>
                        </td>
                        <td>{formatDate(log.scheduledFor)}</td>
                        <td>
                          {log.cdEligible
                            ? `${log.cdDiscountPercent}% eligible`
                            : "Not eligible"}
                        </td>
                        <td>{log.failureReason || log.cdReason || "-"}</td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </article>
      </section>
    </DashboardShell>
  );
}

function TodayGenerationNotice({ count }: { count: number }) {
  if (count === 0) {
    return null;
  }

  return (
    <p className="status-banner status-warning">
      Today&apos;s reminders are already generated: {count} queue record{count === 1 ? "" : "s"}.
      Generating again will skip duplicate invoice, rule, channel, and date combinations.
    </p>
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
