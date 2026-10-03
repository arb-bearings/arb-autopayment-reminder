import { DashboardShell } from "@/components/dashboard-shell";
import { ProtectedSubmitButton } from "@/components/protected-submit-button";
import { TableSearch } from "@/components/table-search";
import { requireAdminUser } from "@/lib/auth";
import { getCompanyWorkspaceContextForUser } from "@/lib/company-workspace";
import { readDatabase } from "@/lib/storage";

export default async function ManagersPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireAdminUser();
  const [database, params] = await Promise.all([readDatabase(), searchParams]);
  const workspace = getCompanyWorkspaceContextForUser(database, user);

  const managers = database.salespersons.filter(
    (s) => s.ownerId === workspace.configOwnerId
  );

  const masterContacts = database.masterContacts.filter((c) =>
    workspace.sharedOwnerIds.has(c.ownerId)
  );

  const editId = typeof params.edit === "string" ? params.edit : "";
  const editManager = managers.find((m) => m.id === editId);

  const totalDealerAssignments = managers.reduce((sum, m) => sum + m.dealerCodes.length, 0);
  const totalDealersInMaster = masterContacts.length;

  return (
    <DashboardShell
      title="Manager Directory"
      description="Manager profiles are automatically synced from your master database."
      companyName={user.companyName}
      userName={user.name}
      isAdmin
      userRole={user.role}
      canSendManualReminders={user.canSendManualReminders}
    >
      <StatusBar params={params} />

      {/* ── Stats row ─────────────────────────────────────────────────────── */}
      <section className="stats-grid" style={{ marginBottom: "1.5rem" }}>
        <article className="stat-card glass-panel">
          <span className="stat-label">Managers</span>
          <strong>{managers.length}</strong>
        </article>
        <article className="stat-card glass-panel">
          <span className="stat-label">Dealer Assignments</span>
          <strong>{totalDealerAssignments}</strong>
        </article>
        <article className="stat-card glass-panel">
          <span className="stat-label">Dealers in Master</span>
          <strong>{totalDealersInMaster}</strong>
        </article>
        <article className="stat-card glass-panel">
          <span className="stat-label">Avg Dealers / Manager</span>
          <strong>
            {managers.length === 0
              ? "—"
              : Math.round(totalDealerAssignments / managers.length)}
          </strong>
        </article>
      </section>

      {/* ── Two-column: Add manager + Upload file ─────────────────────────── */}
      <section
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))",
          gap: "1rem",
          marginBottom: "1.5rem"
        }}
      >
        {/* Add manager manually */}
        <article className="glass-panel">
          <div className="section-heading">
            <h2>Add manager manually</h2>
            <p>Enter manager details directly. Dealer codes can be one per line or comma-separated.</p>
          </div>
          <form action="/api/salespersons/save" method="post" className="form-stack">
            <input type="hidden" name="salespersonId" value="" />
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
              <label className="field">
                <span>Manager name</span>
                <input name="name" required placeholder="e.g. Rajesh Kumar" />
              </label>
              <label className="field">
                <span>Manager code</span>
                <input name="employeeId" required placeholder="e.g. MGR-001" />
              </label>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
              <label className="field">
                <span>Email</span>
                <input name="email" type="email" required placeholder="manager@company.com" />
              </label>
              <label className="field">
                <span>Phone (optional)</span>
                <input name="phoneNumber" placeholder="e.g. 9876543210" />
              </label>
            </div>
            <label className="field">
              <span>Back office CC email (optional)</span>
              <input name="backOfficeEmail" type="email" placeholder="e.g. backoffice@company.com" />
            </label>
            <label className="field">
              <span>Dealer codes</span>
              <textarea name="dealerCodes" rows={4} placeholder="One dealer code per line, or comma-separated" />
            </label>
            <ProtectedSubmitButton className="button">Save manager</ProtectedSubmitButton>
          </form>
        </article>

        {/* Upload manager file */}
        <article className="glass-panel">
          <div className="section-heading">
            <h2>Upload manager file</h2>
            <p>
              Import from an Excel or CSV file. Managers are also auto-synced whenever you upload
              the master database — no separate step needed.
            </p>
          </div>
          <form
            action="/api/salespersons/upload"
            method="post"
            encType="multipart/form-data"
            className="form-stack"
          >
            <label className="field">
              <span>File</span>
              <input name="file" type="file" accept=".xlsx,.xls,.csv" required />
            </label>
            <label className="field">
              <span>Import mode</span>
              <select name="mode" defaultValue="replace">
                <option value="replace">Replace all current managers</option>
                <option value="append">Append / update matching managers</option>
              </select>
            </label>
            <div className="button-row">
              <ProtectedSubmitButton className="button">Upload file</ProtectedSubmitButton>
              <a className="button button-secondary" href="/api/salespersons/sample">
                Download sample
              </a>
            </div>
          </form>
        </article>
      </section>

      {/* ── Manager table ─────────────────────────────────────────────────── */}
      <section>
        <article className="glass-panel">
          <div className="section-heading">
            <h2>Current managers</h2>
            <p>
              {managers.length === 0
                ? "No managers yet — upload a master database to auto-populate."
                : `${managers.length} manager${managers.length !== 1 ? "s" : ""} — ${totalDealerAssignments} dealer assignments total.`}
            </p>
          </div>

          <TableSearch />

          <div className="table-wrap">
            <table data-searchable-table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Code</th>
                  <th>Email</th>
                  <th>Back Office CC</th>
                  <th>Dealer Codes</th>
                  <th style={{ width: "120px" }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {managers.length === 0 ? (
                  <tr>
                    <td colSpan={6} style={{ textAlign: "center", padding: "2rem", opacity: 0.6 }}>
                      Upload a master database or add a manager manually above.
                    </td>
                  </tr>
                ) : (
                  managers.map((manager) => (
                    <tr key={manager.id}>
                      <td>
                        <strong>{manager.name}</strong>
                      </td>
                      <td>
                        <code style={{ fontSize: "0.8rem", opacity: 0.85 }}>{manager.employeeId}</code>
                      </td>
                      <td>{manager.email}</td>
                      <td>
                        {manager.backOfficeEmail || <span style={{ opacity: 0.4 }}>—</span>}
                      </td>
                      <td>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.25rem", maxWidth: "380px" }}>
                          {manager.dealerCodes.map((code) => (
                            <span
                              key={code}
                              className="badge neutral"
                              style={{ fontSize: "0.72rem", padding: "0.1rem 0.35rem" }}
                            >
                              {code}
                            </span>
                          ))}
                          {manager.dealerCodes.length === 0 && (
                            <span style={{ opacity: 0.4 }}>No dealers</span>
                          )}
                        </div>
                      </td>
                      <td>
                        <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap" }}>
                          <a
                            href={`/dashboard/managers?edit=${manager.id}`}
                            className="button button-secondary"
                            style={{ fontSize: "0.8rem", padding: "0.3rem 0.65rem" }}
                          >
                            Edit
                          </a>
                          <form action="/api/salespersons/delete" method="post">
                            <input type="hidden" name="salespersonId" value={manager.id} />
                            <ProtectedSubmitButton
                              className="button button-ghost"
                              confirmationMessage={`Delete manager ${manager.name}?`}
                              style={{ fontSize: "0.8rem", padding: "0.3rem 0.65rem" }}
                            >
                              Delete
                            </ProtectedSubmitButton>
                          </form>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </article>
      </section>

      {/* ── Edit modal ────────────────────────────────────────────────────── */}
      {editManager && (
        <div className="modal-overlay">
          <div className="modal-content animate-slide-up">
            <div className="modal-header">
              <h2>Edit Manager</h2>
              <a href="/dashboard/managers" className="modal-close-btn" aria-label="Close">
                &times;
              </a>
            </div>
            <form action="/api/salespersons/save" method="post" className="form-stack">
              <input type="hidden" name="salespersonId" value={editManager.id} />
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
                <label className="field">
                  <span>Manager name</span>
                  <input name="name" defaultValue={editManager.name} required autoFocus />
                </label>
                <label className="field">
                  <span>Manager code</span>
                  <input name="employeeId" defaultValue={editManager.employeeId} required />
                </label>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
                <label className="field">
                  <span>Email</span>
                  <input name="email" type="email" defaultValue={editManager.email} required />
                </label>
                <label className="field">
                  <span>Phone (optional)</span>
                  <input name="phoneNumber" defaultValue={editManager.phoneNumber || ""} />
                </label>
              </div>
              <label className="field">
                <span>Back office CC email</span>
                <input
                  name="backOfficeEmail"
                  type="email"
                  defaultValue={editManager.backOfficeEmail || ""}
                  placeholder="e.g. backoffice@company.com"
                />
              </label>
              <label className="field">
                <span>Dealer codes</span>
                <textarea
                  name="dealerCodes"
                  rows={5}
                  defaultValue={editManager.dealerCodes.join("\n")}
                  placeholder="One dealer code per line"
                />
              </label>
              <div className="button-row" style={{ marginTop: "1rem" }}>
                <ProtectedSubmitButton className="button">Update manager</ProtectedSubmitButton>
                <a className="button button-secondary" href="/dashboard/managers">
                  Cancel
                </a>
              </div>
            </form>
          </div>
        </div>
      )}
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
