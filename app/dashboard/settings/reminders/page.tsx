import { DashboardShell } from "@/components/dashboard-shell";
import { ProtectedSubmitButton } from "@/components/protected-submit-button";
import { requireAdminUser } from "@/lib/auth";
import { getCompanyWorkspaceContextForUser } from "@/lib/company-workspace";
import { readDatabase } from "@/lib/storage";

export default async function ReminderSettingsPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireAdminUser();
  const [database, params] = await Promise.all([readDatabase(), searchParams]);
  const workspace = getCompanyWorkspaceContextForUser(database, user);
  const policies = database.cashDiscountPolicies
    .filter((entry) => entry.ownerId === workspace.configOwnerId)
    .sort((left, right) => left.paymentWindowDays - right.paymentWindowDays);

  return (
    <DashboardShell
      title="Reminder settings"
      description="Configure cash-discount rules and reminder policy controls."
      companyName={user.companyName}
      userName={user.name}
      isAdmin
      userRole={user.role}
      canSendManualReminders={user.canSendManualReminders}
    >
      <StatusBar params={params} />

      <section className="stacked-layout">
        <article className="glass-panel">
          <div className="section-heading">
            <h2>Create cash discount policy</h2>
            <p>Eligibility is calculated from bill date and older unpaid invoices.</p>
          </div>
          <PolicyForm />
        </article>

        {policies.map((policy) => (
          <article key={policy.id} className="glass-panel">
            <div className="section-heading">
              <h2>{policy.name}</h2>
              <p>{policy.discountPercent}% within {policy.paymentWindowDays} days.</p>
            </div>
            <PolicyForm policy={policy} />
            <form action="/api/policies/delete" method="post" className="compact-form">
              <input type="hidden" name="policyId" value={policy.id} />
              <ProtectedSubmitButton
                className="button button-ghost"
                confirmationMessage={`Delete ${policy.name}?`}
              >
                Delete policy
              </ProtectedSubmitButton>
            </form>
          </article>
        ))}
      </section>
    </DashboardShell>
  );
}

function PolicyForm({
  policy
}: {
  policy?: {
    id: string;
    name: string;
    paymentWindowDays: number;
    discountPercent: number;
    enabled: boolean;
    description: string;
    cdMessageTemplate?: string;
    cdMessageWithOlderTemplate?: string;
    cdShortMessageTemplate?: string;
    cdShortMessageWithOlderTemplate?: string;
  };
}) {
  return (
    <form action="/api/policies/save" method="post" className="rule-grid">
      <input type="hidden" name="policyId" value={policy?.id || ""} />
      <label className="field">
        <span>Policy name</span>
        <input name="name" defaultValue={policy?.name || ""} required />
      </label>
      <label className="field">
        <span>Payment window days</span>
        <input name="paymentWindowDays" type="number" min={1} defaultValue={policy?.paymentWindowDays || ""} required />
      </label>
      <label className="field">
        <span>Discount percent</span>
        <input name="discountPercent" type="number" min={0.01} step="0.01" defaultValue={policy?.discountPercent || ""} required />
      </label>
      <label className="checkbox-field">
        <input name="enabled" type="checkbox" defaultChecked={policy?.enabled ?? true} />
        <span>Enabled</span>
      </label>
      <label className="field rule-span">
        <span>Description</span>
        <textarea name="description" rows={2} defaultValue={policy?.description || ""} required />
      </label>
      <label className="field rule-span">
        <span>Email/Long CD Message Template (Standard)</span>
        <textarea name="cdMessageTemplate" rows={2} defaultValue={policy?.cdMessageTemplate || "Please note that a payment of {{cdAmount}} is due within the next {{daysBeforeDue}} days to avail the {{cdDiscountPercent}}% CD benefit on the basic value of invoice.\n\nTo avail the {{cdDiscountPercent}}% CD, please ensure that the payment is made before the invoice completes {{paymentWindowDays}} days."} required />
      </label>
      <label className="field rule-span">
        <span>Email/Long CD Message Template (With Older Pending Bills)</span>
        <textarea name="cdMessageWithOlderTemplate" rows={2} defaultValue={policy?.cdMessageWithOlderTemplate || "Please note that a payment of {{cdAmount}} is due within the next {{daysBeforeDue}} days to avail the {{cdDiscountPercent}}% CD benefit on the basic value of invoice.\n\nTo avail the {{cdDiscountPercent}}% CD on {{cdAmount}}, please clear {{eligibleAmount}} before the invoice completes {{paymentWindowDays}} days to ensure that the payment is eligible for cash discount."} required />
      </label>
      <label className="field rule-span">
        <span>WhatsApp/Short CD Message Template (Standard)</span>
        <textarea name="cdShortMessageTemplate" rows={2} defaultValue={policy?.cdShortMessageTemplate || "Payment of {{cdAmount}} is due in {{daysBeforeDue}} days to avail {{cdDiscountPercent}}% CD on basic value of invoice. Ensure payment before {{paymentWindowDays}} days."} required />
      </label>
      <label className="field rule-span">
        <span>WhatsApp/Short CD Message Template (With Older Pending Bills)</span>
        <textarea name="cdShortMessageWithOlderTemplate" rows={2} defaultValue={policy?.cdShortMessageWithOlderTemplate || "Payment of {{cdAmount}} is due in {{daysBeforeDue}} days to avail {{cdDiscountPercent}}% CD on basic value of invoice. To avail CD on {{cdAmount}}, please clear {{eligibleAmount}} before invoice completes {{paymentWindowDays}} days."} required />
      </label>
      <div className="rule-span">
        <ProtectedSubmitButton className="button">
          Save policy
        </ProtectedSubmitButton>
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
