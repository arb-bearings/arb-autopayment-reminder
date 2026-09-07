import { DashboardShell } from "@/components/dashboard-shell";
import { ProtectedSubmitButton } from "@/components/protected-submit-button";
import { requireAdminUser } from "@/lib/auth";
import { getCompanyWorkspaceContextForUser } from "@/lib/company-workspace";
import { resolveDispatchSettings } from "@/lib/dispatch-settings";
import { readDatabase } from "@/lib/storage";

export default async function EmailConfigurationPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireAdminUser();
  const [database, params] = await Promise.all([readDatabase(), searchParams]);
  const workspace = getCompanyWorkspaceContextForUser(database, user);
  const settings = resolveDispatchSettings(
    database.dispatchSettings.find((entry) => entry.ownerId === workspace.configOwnerId) ?? {
      ownerId: workspace.configOwnerId
    }
  );

  return (
    <DashboardShell
      title="Email configuration"
      description="Configure SMTP, WhatsApp, SMS, report recipients, and schedule settings."
      companyName={user.companyName}
      userName={user.name}
      isAdmin
      userRole={user.role}
      canSendManualReminders={user.canSendManualReminders}
    >
      <StatusBar params={params} />

      <article className="glass-panel">
        <form action="/api/providers/save" method="post" className="rule-grid">
          <label className="field">
            <span>Sender email</span>
            <input name="senderEmail" type="email" defaultValue={settings.senderEmail || settings.smtpFrom} />
          </label>
          <label className="field">
            <span>SMTP host</span>
            <input name="smtpHost" defaultValue={settings.smtpHost} />
          </label>
          <label className="field">
            <span>SMTP port</span>
            <input name="smtpPort" type="number" defaultValue={settings.smtpPort} />
          </label>
          <label className="field">
            <span>SMTP username</span>
            <input name="smtpUser" defaultValue={settings.smtpUser} />
          </label>
          <label className="field">
            <span>SMTP password</span>
            <input name="smtpPass" type="password" defaultValue={settings.smtpPass} />
          </label>
          <label className="checkbox-field dispatch-check">
            <input name="smtpSecure" type="checkbox" defaultChecked={settings.smtpSecure} />
            <span>Secure SMTP</span>
          </label>
          <label className="field">
            <span>SMS sender number</span>
            <input name="smsFromNumber" defaultValue={settings.smsFromNumber} />
          </label>
          <label className="field">
            <span>SMS account SID</span>
            <input name="smsAccountSid" defaultValue={settings.smsAccountSid} />
          </label>
          <label className="field">
            <span>SMS auth token</span>
            <input name="smsAuthToken" type="password" defaultValue={settings.smsAuthToken} />
          </label>
          <label className="field">
            <span>WhatsApp provider</span>
            <input name="whatsappProviderName" defaultValue={settings.whatsappProviderName || "Interakt"} />
          </label>
          <label className="field">
            <span>WhatsApp webhook URL</span>
            <input name="whatsappWebhookUrl" type="url" defaultValue={settings.whatsappWebhookUrl} />
          </label>
           <p className="dispatch-note dispatch-note-plain rule-span">
            Interakt WhatsApp credentials are read from `INTERAKT_API_KEY`,
            `INTERAKT_TEMPLATE_NAME`, and `INTERAKT_LANGUAGE_CODE`.
          </p>
          <div className="rule-span" style={{ marginTop: "1.5rem", marginBottom: "1.5rem" }}>
            <h3 style={{ fontSize: "1.1rem", fontWeight: 700, marginBottom: "0.5rem", color: "var(--foreground)" }}>Global Channels Configuration</h3>
            <p className="muted-copy" style={{ marginBottom: "1rem" }}>
              Enable or disable reminder dispatches globally for each channel.
            </p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "2rem" }}>
              <label className="checkbox-field" style={{ display: "flex", alignItems: "center", gap: "0.5rem", cursor: "pointer" }}>
                <input name="emailEnabled" type="checkbox" defaultChecked={settings.emailEnabled ?? true} />
                <span>Enable Email Dispatches</span>
              </label>
              <label className="checkbox-field" style={{ display: "flex", alignItems: "center", gap: "0.5rem", cursor: "pointer" }}>
                <input name="whatsappEnabled" type="checkbox" defaultChecked={settings.whatsappEnabled ?? true} />
                <span>Enable WhatsApp Dispatches</span>
              </label>
              <label className="checkbox-field" style={{ display: "flex", alignItems: "center", gap: "0.5rem", cursor: "pointer" }}>
                <input name="smsEnabled" type="checkbox" defaultChecked={settings.smsEnabled ?? false} />
                <span>Enable SMS Dispatches</span>
              </label>
            </div>
          </div>
          <label className="field">
            <span>Payment Reminder Threshold Amount</span>
            <input name="thresholdAmount" type="number" min="0" step="any" defaultValue={settings.thresholdAmount ?? 10000} required />
          </label>
          <label className="field">
            <span>Report frequency</span>
            <select name="reportFrequency" defaultValue={settings.reportFrequency}>
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
              <option value="manual">Manual</option>
            </select>
          </label>
          <label className="field">
            <span>Report time</span>
            <input name="reportTime" type="time" defaultValue={settings.reportTime} />
          </label>
          <label className="field rule-span">
            <span>Report recipient emails</span>
            <textarea name="reportRecipients" rows={4} defaultValue={settings.reportRecipients.join("\n")} />
          </label>
          <div className="rule-span">
            <ProtectedSubmitButton className="button">
              Save email and report settings
            </ProtectedSubmitButton>
          </div>
        </form>
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
