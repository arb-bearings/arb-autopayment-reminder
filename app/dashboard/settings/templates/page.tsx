import { DashboardShell } from "@/components/dashboard-shell";
import { ProtectedSubmitButton } from "@/components/protected-submit-button";
import { requireAdminUser } from "@/lib/auth";
import { getCompanyWorkspaceContextForUser } from "@/lib/company-workspace";
import { readDatabase } from "@/lib/storage";
import type { ReminderRule, ReminderTemplate } from "@/lib/types";

const tokens = [
  "{{amount}}",
  "{{billAgeDays}}",
  "{{billDate}}",
  "{{cdDiscountPercent}}",
  "{{cdEligible}}",
  "{{cdMessage}}",
  "{{cdPolicyWindowDays}}",
  "{{cdReason}}",
  "{{cdShortMessage}}",
  "{{cdShortSummary}}",
  "{{cdSummary}}",
  "{{companyBillKey}}",
  "{{companyName}}",
  "{{company_name}}",
  "{{contactName}}",
  "{{currentInvoiceDueAmount}}",
  "{{current_invoice_due_amount}}",
  "{{daysBeforeDue}}",
  "{{dealerCode}}",
  "{{dealer_name}}",
  "{{dueDate}}",
  "{{due_date}}",
  "{{invoiceAmount}}",
  "{{invoiceNumber}}",
  "{{invoice_amount}}",
  "{{invoice_no}}",
  "{{openingAmount}}",
  "{{overdueDays}}",
  "{{pendingAmount}}",
  "{{previousDueAmount}}",
  "{{previous_due_amount}}",
  "{{reference}}",
  "{{reminderDay}}",
  "{{senderCompany}}",
  "{{totalDueAmount}}",
  "{{total_due_amount}}"
];

const defaultEmailBody = `Dear {{dealer_name}},

This is a reminder regarding Invoice {{invoice_no}} for {{invoice_amount}} due on {{due_date}}.

Current invoice due: {{current_invoice_due_amount}}.
Previous due: {{previous_due_amount}}.
Total due amount: {{total_due_amount}}.
Bill age: {{billAgeDays}} days.

{{cdMessage}}

Kindly arrange payment at the earliest.

Thank you,
{{senderCompany}}`;

export default async function MessageTemplatesPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireAdminUser();
  const [database, params] = await Promise.all([readDatabase(), searchParams]);
  const workspace = getCompanyWorkspaceContextForUser(database, user);
  const rules = database.reminderRules
    .filter((entry) => entry.ownerId === workspace.configOwnerId)
    .sort((left, right) => left.triggerDay - right.triggerDay);
  const templates = database.templates.filter((entry) => entry.ownerId === workspace.configOwnerId);

  return (
    <DashboardShell
      title="Message templates"
      description="Manage reminder rules, channels, and placeholder-based message bodies."
      companyName={user.companyName}
      userName={user.name}
      isAdmin
      userRole={user.role}
      canSendManualReminders={user.canSendManualReminders}
    >
      <StatusBar params={params} />

      <article className="glass-panel">
        <div className="section-heading">
          <h2>Supported placeholders</h2>
          <p>Use these tokens in email, WhatsApp, and SMS templates.</p>
        </div>
        <div className="button-row">
          {tokens.map((token) => (
            <code key={token}>{token}</code>
          ))}
        </div>
      </article>

      <section className="stacked-layout">
        <article className="glass-panel">
          <div className="section-heading">
            <h2>Create reminder rule</h2>
            <p>Rules can be generated automatically or used manually from the dues page.</p>
          </div>
          <RuleForm />
        </article>

        {rules.map((rule) => {
          const template = templates.find((entry) => entry.id === rule.templateId);
          if (!template) {
            return null;
          }
          return (
            <article key={rule.id} className="glass-panel">
              <div className="section-heading">
                <h2>{rule.name}</h2>
                <p>
                  Triggers when bill age reaches {rule.triggerDay - 5} days{" "}
                  <span style={{ color: "red", fontWeight: "600" }}>
                    ({rule.triggerDay} days)
                  </span>
                </p>
              </div>
              <RuleForm rule={rule} template={template} />
            </article>
          );
        })}
      </section>
    </DashboardShell>
  );
}

function RuleForm({ rule, template }: { rule?: ReminderRule; template?: ReminderTemplate }) {
  return (
    <form action="/api/rules/save" method="post" className="rule-grid">
      <input type="hidden" name="ruleId" value={rule?.id || ""} />
      <input type="hidden" name="templateId" value={template?.id || ""} />
      <label className="field">
        <span>Rule name</span>
        <input name="name" defaultValue={rule?.name || ""} required />
      </label>
      <label className="field">
        <span>Trigger day</span>
        <input name="triggerDay" type="number" min={1} defaultValue={rule?.triggerDay || ""} required />
      </label>
      <label className="checkbox-field">
        <input name="enabled" type="checkbox" defaultChecked={rule?.enabled ?? true} />
        <span>Enabled</span>
      </label>
      <label className="checkbox-field">
        <input name="autoSend" type="checkbox" defaultChecked={rule?.autoSend ?? false} />
        <span>Auto-send when generated</span>
      </label>
      <label className="checkbox-field">
        <input name="channelEmail" type="checkbox" defaultChecked={rule?.channels.email ?? true} />
        <span>Email</span>
      </label>
      <label className="checkbox-field">
        <input name="channelWhatsapp" type="checkbox" defaultChecked={rule?.channels.whatsapp ?? true} />
        <span>WhatsApp</span>
      </label>
      <label className="checkbox-field">
        <input name="channelSms" type="checkbox" defaultChecked={rule?.channels.sms ?? false} />
        <span>SMS</span>
      </label>
      <label className="field rule-span">
        <span>Email subject</span>
        <input name="emailSubject" defaultValue={template?.emailSubject || "Payment reminder: {{invoice_no}}"} required />
      </label>
      <label className="field rule-span">
        <span>Email body</span>
        <textarea name="emailBody" rows={8} defaultValue={template?.emailBody || defaultEmailBody} required />
      </label>
      <label className="field">
        <span>WhatsApp template</span>
        <textarea name="whatsappBody" rows={5} defaultValue={template?.whatsappBody || "Dear {{dealer_name}}, reminder for {{invoice_no}} amount {{invoice_amount}}. Previous due: {{previous_due_amount}}. Total due: {{total_due_amount}}."} required />
      </label>
      <label className="field rule-span">
        <span>SMS template</span>
        <textarea name="smsBody" rows={5} defaultValue={template?.smsBody || "Reminder {{invoice_no}}: {{invoice_amount}} due. Previous due {{previous_due_amount}}. Total due {{total_due_amount}}."} required />
      </label>

      <div className="rule-span">
        <input type="hidden" name="pdfBoxControlsPresent" value="true" />
        <div className="section-heading" style={{ marginBottom: 8 }}>
          <h3 style={{ fontSize: "0.95em", margin: 0 }}>Summary boxes (Email & PDF)</h3>
          <p style={{ margin: "4px 0 0", fontSize: "0.82em", color: "var(--muted)" }}>
            Control which summary boxes appear in both the email body and PDF attachment, and customise their headings.
            Leave a heading blank to use the auto-generated text.
          </p>
        </div>

        <div className="pdf-box-controls">
          {/* Box 1 — Current Invoice */}
          <div className="pdf-box-group">
            <div className="pdf-box-group-title">
              <span className="bill-age-badge" style={{ marginRight: 6 }}>Box 1 — Left</span>
              <span style={{ fontSize: "0.8em", color: "var(--muted)" }}>Current invoice amount</span>
            </div>
            <label className="checkbox-field">
              <input name="pdfBox1Visible" type="checkbox" defaultChecked={(template?.pdfBox1Visible ?? rule?.pdfBox1Visible) !== false} />
              <span>Show this box</span>
            </label>
            <label className="field" style={{ marginTop: 6 }}>
              <span>Custom heading</span>
              <input
                name="pdfBox1Label"
                placeholder="e.g. PAYMENT DUE IN 30 DAYS (leave blank for auto)"
                defaultValue={template?.pdfBox1Label || rule?.pdfBox1Label || ""}
              />
            </label>
          </div>

          {/* Box 2 — Older Invoices */}
          <div className="pdf-box-group">
            <div className="pdf-box-group-title">
              <span className="bill-age-badge" style={{ marginRight: 6 }}>Box 2 — Middle</span>
              <span style={{ fontSize: "0.8em", color: "var(--muted)" }}>Older invoices bucket</span>
            </div>
            <label className="checkbox-field">
              <input name="pdfBox2Visible" type="checkbox" defaultChecked={(template?.pdfBox2Visible ?? rule?.pdfBox2Visible) !== false} />
              <span>Show this box</span>
            </label>
            <label className="field" style={{ marginTop: 6 }}>
              <span>Custom heading</span>
              <input
                name="pdfBox2Label"
                placeholder="e.g. PAYMENT MORE THAN 90 DAYS (leave blank for auto)"
                defaultValue={template?.pdfBox2Label || rule?.pdfBox2Label || ""}
              />
            </label>
          </div>

          {/* Box 3 — Total Outstanding */}
          <div className="pdf-box-group">
            <div className="pdf-box-group-title">
              <span className="bill-age-badge" style={{ marginRight: 6 }}>Box 3 — Right</span>
              <span style={{ fontSize: "0.8em", color: "var(--muted)" }}>Total outstanding</span>
            </div>
            <label className="checkbox-field">
              <input name="pdfBox3Visible" type="checkbox" defaultChecked={(template?.pdfBox3Visible ?? rule?.pdfBox3Visible) !== false} />
              <span>Show this box</span>
            </label>
            <label className="field" style={{ marginTop: 6 }}>
              <span>Custom heading</span>
              <input
                name="pdfBox3Label"
                placeholder="TOTAL OUTSTANDING (leave blank for auto)"
                defaultValue={template?.pdfBox3Label || rule?.pdfBox3Label || ""}
              />
            </label>
          </div>
        </div>
      </div>

      <div className="rule-span button-row" style={{ display: "flex", gap: "12px", alignItems: "center" }}>
        <ProtectedSubmitButton className="button">
          Save rule
        </ProtectedSubmitButton>
        {rule?.id && (
          <ProtectedSubmitButton
            formAction="/api/rules/delete"
            className="button button-ghost"
            style={{ color: "var(--danger)" }}
            confirmationMessage={`Delete ${rule.name}?`}
          >
            Delete rule
          </ProtectedSubmitButton>
        )}
      </div>
    </form>
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
