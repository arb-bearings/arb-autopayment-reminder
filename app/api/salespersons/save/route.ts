import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { requireAdminUser } from "@/lib/auth";
import { requireOperationPassword } from "@/lib/access-control";
import { recordAuditLog } from "@/lib/audit";
import { getCompanyWorkspaceContextForUser } from "@/lib/company-workspace";
import { parseDealerCodeList } from "@/lib/excel";
import { applySalespersonMappings } from "@/lib/salesperson-mapping";
import { updateDatabase } from "@/lib/storage";

export async function POST(request: Request) {
  const user = await requireAdminUser();
  const formData = await request.formData();
  const salespersonId = String(formData.get("salespersonId") || "");
  const payload = {
    name: String(formData.get("name") || "").trim(),
    employeeId: String(formData.get("employeeId") || "").trim(),
    email: String(formData.get("email") || "").trim(),
    phoneNumber: String(formData.get("phoneNumber") || "").trim(),
    backOfficeEmail: String(formData.get("backOfficeEmail") || "").trim(),
    dealerCodes: parseDealerCodeList(String(formData.get("dealerCodes") || ""))
  };

  if (!payload.name || !payload.employeeId || !payload.email) {
    return NextResponse.redirect(
      new URL("/dashboard/managers?error=Manager%20name,%20employee%20ID,%20and%20email%20are%20required.", request.url),
      { status: 303 }
    );
  }

  try {
    await requireOperationPassword(user, "admin_settings", String(formData.get("operationPassword") || ""));
    await updateDatabase((database) => {
      const workspace = getCompanyWorkspaceContextForUser(database, user);
      const now = new Date().toISOString();
      const finalId = salespersonId || randomUUID();
      const existing = database.salespersons.find(
        (entry) => entry.id === finalId && entry.ownerId === workspace.configOwnerId
      );

      if (existing) {
        Object.assign(existing, payload, { updatedAt: now });
      } else {
        database.salespersons.push({
          id: finalId,
          ownerId: workspace.configOwnerId,
          ...payload,
          createdAt: now,
          updatedAt: now
        });
      }

      applySalespersonMappings(
        database,
        database.salespersons.filter((entry) => entry.ownerId === workspace.configOwnerId),
        workspace.sharedOwnerIds,
        user
      );
    });
    await recordAuditLog(user, "Salesperson Configuration", "success", payload.name);

    return NextResponse.redirect(
      new URL("/dashboard/managers?message=Manager%20saved.", request.url),
      { status: 303 }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Salesperson save failed.";
    await recordAuditLog(user, "Salesperson Configuration", "failed", message);
    return NextResponse.redirect(
      new URL(`/dashboard/managers?error=${encodeURIComponent(message)}`, request.url),
      { status: 303 }
    );
  }
}
