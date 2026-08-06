import { ConfirmSubmitButton } from "@/components/confirm-submit-button";
import { DashboardShell } from "@/components/dashboard-shell";
import { ProtectedSubmitButton } from "@/components/protected-submit-button";
import { TableSearch } from "@/components/table-search";
import { isSuperAdminUser } from "@/lib/access-control";
import { filterSharedCompanyRecords, getCompanyWorkspaceContextForUser } from "@/lib/company-workspace";
import { isAdminUser, requireUser } from "@/lib/auth";
import { readDatabase } from "@/lib/storage";
import { ensureStoredMasterWorkbook } from "@/lib/workbook-sync";
import { formatDate } from "@/lib/utils";

export default async function MasterDatabasePage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const [database, params] = await Promise.all([readDatabase(), searchParams]);
  const workspace = getCompanyWorkspaceContextForUser(database, user);
  const contacts = filterSharedCompanyRecords(database.masterContacts, workspace.sharedOwnerIds);
  const isAdmin = isAdminUser(user);
  const isSuperAdmin = isSuperAdminUser(user);

  if (isAdmin && contacts.length > 0) {
    await ensureStoredMasterWorkbook(workspace.workspaceId, user.companyName);
  }

  return (
    <DashboardShell
      title="Master contact database"
      description="Keep one shared company contact sheet ready for due matching and reminder dispatch."
      companyName={user.companyName}
      userName={user.name}
      isAdmin={isAdmin}
      userRole={user.role}
      canSendManualReminders={user.canSendManualReminders}
    >
      <StatusBar params={params} />

      <section className="content-grid">
        {isAdmin ? (
          <article className="glass-panel">
            <div className="section-heading">
              <h2>Upload master Excel</h2>
              <p>
                Recommended headers: Dealer Code, Company Name, Contact Person, Email, WhatsApp,
                Phone. This shared master database is managed only by admins.
              </p>
            </div>

            <form
              action="/api/master/upload"
              method="post"
              encType="multipart/form-data"
              className="form-stack"
            >
            <label className="field">
              <span>Upload file</span>
              <input name="file" type="file" accept=".xlsx,.xlxs,.xls,.csv" required />
            </label>



              <label className="field">
                <span>Import mode</span>
                <select name="mode" defaultValue="replace">
                  <option value="replace">Replace existing master records</option>
                  <option value="append">Append to existing master records</option>
                </select>
              </label>

              <div className="button-row">
                <ProtectedSubmitButton className="button">
                  Save master database
                </ProtectedSubmitButton>
                <a className="button button-secondary" href="/api/master/sample">
                  Download sample Excel
                </a>
              </div>
            </form>

            {isSuperAdmin && contacts.length > 0 ? (
              <form action="/api/master/delete" method="post" className="compact-form">
                <ConfirmSubmitButton
                  className="button button-danger"
                  confirmationMessage="Delete the current shared master workbook and all synced contact records for this company workspace?"
                >
                  Delete current master file
                </ConfirmSubmitButton>
              </form>
            ) : null}
          </article>
        ) : (
          <article className="glass-panel">
            <div className="section-heading">
              <h2>Admin-managed master database</h2>
              <p>
                Master contact uploads and contact previews are restricted to admins.
              </p>
            </div>
          </article>
        )}

        {isAdmin ? (
          <article className="glass-panel">
            <div className="section-heading">
              <h2>Current contacts</h2>
              <p>{contacts.length} shared records available for reminder matching.</p>
            </div>

            <TableSearch />

            <div className="table-wrap">
              <table data-searchable-table>
                <thead>
                  <tr>
                    <th>No.</th>
                    <th>Dealer code</th>
                    <th>Company</th>
                    <th>Primary contact</th>
                    <th>Salesperson</th>
                    <th>Email</th>
                    <th>WhatsApp</th>
                    <th>Updated</th>
                  </tr>
                </thead>
                <tbody>
                  {contacts.length === 0 ? (
                    <tr>
                      <td colSpan={8}>Upload a master file to populate contacts.</td>
                    </tr>
                  ) : (
                    contacts.slice(0, 20).map((contact, index) => (
                      <tr key={contact.id}>
                        <td>{index + 1}</td>
                        <td>{contact.dealerCode || contact.customerCode || "N/A"}</td>
                        <td>{contact.companyName}</td>
                        <td>{contact.primaryContact || "N/A"}</td>
                        <td>{contact.salespersonName || contact.salespersonEmail || "Unassigned"}</td>
                        <td>{contact.email || "N/A"}</td>
                        <td>{contact.whatsapp || contact.sms || "N/A"}</td>
                        <td>{formatDate(contact.importedAt)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </article>
        ) : null}

        {isAdmin ? (
          <article className="glass-panel rule-span">
          <div className="section-heading">
            <h2>Edit outside the app</h2>
            <p>
              The row-by-row workbook editor has been removed. Download the current file, edit it
              in Excel or Google Sheets, then upload it back here when you are ready.
            </p>
          </div>

          {contacts.length === 0 ? (
            <p className="muted-copy">
              Upload a master file first, then you can download it, edit it outside the app, and
              re-upload the updated version.
            </p>
          ) : (
            <div className="stacked-layout">
              <p className="muted-copy">
                If you want browser editing, import the downloaded file into Google Sheets, make
                your changes there, then export it again as `.xlsx` or `.csv` and upload it here
                using replace mode.
              </p>

              <div className="button-row">
                <a className="button button-secondary" href="/api/master/download">
                  Download current master file
                </a>

                <form action="/api/master/refresh" method="post">
                  <button className="button button-secondary" type="submit">
                    Refresh from stored file
                  </button>
                </form>
              </div>

              <p className="muted-copy">
                Use `Replace existing master records` when re-uploading your edited file so the app
                fully re-syncs the latest version.
              </p>
            </div>
          )}
          </article>
        ) : null}
      </section>
    </DashboardShell>
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
