import { ConfirmSubmitButton } from "@/components/confirm-submit-button";
import { DashboardShell } from "@/components/dashboard-shell";
import { TableSearch } from "@/components/table-search";
import { requireSuperAdminUser } from "@/lib/access-control";
import { getCompanyWorkspaceContextForUser } from "@/lib/company-workspace";
import { readDatabase } from "@/lib/storage";

export default async function UserManagementPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireSuperAdminUser();
  const [database, params] = await Promise.all([readDatabase(), searchParams]);
  const workspace = getCompanyWorkspaceContextForUser(database, user);

  return (
    <DashboardShell
      title="User management"
      description="Create users, assign roles, and grant manual reminder permission."
      companyName={user.companyName}
      companyCode={user.companyCode || "ARB"}
      userName={user.name}
      isAdmin
      userRole={user.role}
      canSendManualReminders={user.canSendManualReminders}
    >
      <StatusBar params={params} />

      <section className="content-grid">
        <article className="glass-panel">
          <div className="section-heading">
            <h2>Create user</h2>
            <p>New users are scoped to your company workspace.</p>
          </div>

          <form action="/api/users/save" method="post" className="form-stack">
            <input type="hidden" name="userId" value="" />
            <label className="field">
              <span>Name</span>
              <input name="name" required />
            </label>
            <label className="field">
              <span>Email</span>
              <input name="email" type="email" required />
            </label>
            <label className="field">
              <span>Password</span>
              <input name="password" type="password" minLength={8} required />
              <small className="field-help">Use 8 or more characters.</small>
            </label>
            <label className="field">
              <span>Role</span>
              <select name="role" defaultValue="user">
                <option value="user">User</option>
                <option value="admin">Admin</option>
                <option value="super_admin">Super Admin</option>
              </select>
            </label>
            <label className="checkbox-field">
              <input name="canSendManualReminders" type="checkbox" />
              <span>Can manually send reminders</span>
            </label>
            <button className="button" type="submit">
              Save user
            </button>
          </form>
        </article>

        <article className="glass-panel">
          <div className="section-heading">
            <h2>Workspace users</h2>
            <p>{workspace.companyUsers.length} users in this company.</p>
          </div>

          <TableSearch />
          <div className="table-wrap">
            <table data-searchable-table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Role</th>
                  <th>Manual send</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {workspace.companyUsers.map((entry) => (
                  <tr key={entry.id}>
                    <td>{entry.name}</td>
                    <td>{entry.email}</td>
                    <td>{entry.role.replace("_", " ")}</td>
                    <td>{entry.canSendManualReminders ? "Granted" : "View only"}</td>
                    <td>
                      <div className="table-action-stack">
                        <details>
                          <summary className="button button-secondary">Edit</summary>
                          <form action="/api/users/save" method="post" className="form-stack inline-edit-form">
                            <input type="hidden" name="userId" value={entry.id} />
                            <label className="field">
                              <span>Name</span>
                              <input name="name" defaultValue={entry.name} required />
                            </label>
                            <label className="field">
                              <span>Email</span>
                              <input name="email" type="email" defaultValue={entry.email} required />
                            </label>
                            <label className="field">
                              <span>New password</span>
                              <input name="password" type="password" minLength={8} placeholder="Leave blank to keep current" />
                              <small className="field-help">Use 8 or more characters when changing it.</small>
                            </label>
                            <label className="field">
                              <span>Role</span>
                              <select name="role" defaultValue={entry.role}>
                                <option value="user">User</option>
                                <option value="admin">Admin</option>
                                <option value="super_admin">Super Admin</option>
                              </select>
                            </label>
                            <label className="checkbox-field">
                              <input
                                name="canSendManualReminders"
                                type="checkbox"
                                defaultChecked={entry.canSendManualReminders}
                              />
                              <span>Can manually send reminders</span>
                            </label>
                            <button className="button" type="submit">
                              Update user
                            </button>
                          </form>
                        </details>

                        {entry.id === user.id ? (
                          <span className="muted-copy">Current user</span>
                        ) : (
                          <form action="/api/users/delete" method="post">
                            <input type="hidden" name="userId" value={entry.id} />
                            <ConfirmSubmitButton
                              className="button button-ghost"
                              confirmationMessage={`Delete ${entry.email}?`}
                            >
                              Delete
                            </ConfirmSubmitButton>
                          </form>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>
      </section>
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
