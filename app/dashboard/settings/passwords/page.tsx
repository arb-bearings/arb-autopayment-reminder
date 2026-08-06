import { DashboardShell } from "@/components/dashboard-shell";
import { ProtectedSubmitButton } from "@/components/protected-submit-button";
import { operationPasswordLabels, requireSuperAdminUser } from "@/lib/access-control";
import { getCompanyWorkspaceContextForUser } from "@/lib/company-workspace";
import { readDatabase } from "@/lib/storage";
import type { OperationPasswordKey } from "@/lib/types";

export default async function PasswordManagementPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireSuperAdminUser();
  const [database, params] = await Promise.all([readDatabase(), searchParams]);
  const workspace = getCompanyWorkspaceContextForUser(database, user);
  const configured = new Set(
    database.operationPasswords
      .filter((entry) => entry.ownerId === workspace.configOwnerId && entry.passwordHash)
      .map((entry) => entry.key)
  );

  return (
    <DashboardShell
      title="Password management"
      description="Configure operation passwords for protected uploads, dispatch, reporting, and admin settings."
      companyName={user.companyName}
      userName={user.name}
      isAdmin
      userRole={user.role}
      canSendManualReminders={user.canSendManualReminders}
    >
      <StatusBar params={params} />

      <article className="glass-panel">
        <div className="section-heading">
          <h2>Protected operation passwords</h2>
          <p>
            Passwords must be at least 8 characters long. Leave a field blank to keep its current
            password unchanged.
          </p>
        </div>

        <form action="/api/passwords/save" method="post" className="rule-grid">
          {(Object.keys(operationPasswordLabels) as OperationPasswordKey[]).map((key) => (
            <label key={key} className="field">
              <span>
                {operationPasswordLabels[key]} {configured.has(key) ? "(configured)" : "(not set)"}
              </span>
              <input name={key} type="password" minLength={8} placeholder="At least 8 characters" />
              <small className="field-help">Use 8 or more characters.</small>
            </label>
          ))}

          <div className="rule-span">
            <ProtectedSubmitButton className="button">
              Save operation passwords
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
