import { NextResponse } from "next/server";
import { requireAdminUser } from "@/lib/auth";
import { requireOperationPassword } from "@/lib/access-control";
import { recordAuditLog } from "@/lib/audit";
import { getCompanyWorkspaceContextForUser } from "@/lib/company-workspace";
import { updateDatabase } from "@/lib/storage";

export async function POST(request: Request) {
  const user = await requireAdminUser();
  const formData = await request.formData();
  const salespersonId = String(formData.get("salespersonId") || "");

  try {
    await requireOperationPassword(user, "admin_settings", String(formData.get("operationPassword") || ""));
    await updateDatabase((database) => {
      const workspace = getCompanyWorkspaceContextForUser(database, user);
      database.salespersons = database.salespersons.filter(
        (entry) => !(entry.id === salespersonId && entry.ownerId === workspace.configOwnerId)
      );
      database.masterContacts.forEach((contact) => {
        if (workspace.sharedOwnerIds.has(contact.ownerId) && contact.salespersonId === salespersonId) {
          contact.salespersonId = "";
          contact.salespersonName = "";
          contact.salespersonEmail = "";
        }
      });
      database.dueRecords.forEach((due) => {
        if (workspace.sharedOwnerIds.has(due.ownerId) && due.salespersonId === salespersonId) {
          due.salespersonId = "";
          due.salespersonName = "";
          due.salespersonEmail = "";
          due.updatedBy = user.id;
        }
      });
    });
    await recordAuditLog(user, "Salesperson Configuration", "success", salespersonId);

    return NextResponse.redirect(
      new URL("/dashboard/managers?message=Manager%20deleted.", request.url),
      { status: 303 }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Salesperson delete failed.";
    await recordAuditLog(user, "Salesperson Configuration", "failed", message);
    return NextResponse.redirect(
      new URL(`/dashboard/managers?error=${encodeURIComponent(message)}`, request.url),
      { status: 303 }
    );
  }
}
