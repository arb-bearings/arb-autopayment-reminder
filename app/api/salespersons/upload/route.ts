import { NextResponse } from "next/server";
import { requireAdminUser } from "@/lib/auth";
import { requireOperationPassword } from "@/lib/access-control";
import { recordAuditLog } from "@/lib/audit";
import { getCompanyWorkspaceContextForUser } from "@/lib/company-workspace";
import { mapSalespersonRows, parseWorkbook } from "@/lib/excel";
import { applySalespersonMappings } from "@/lib/salesperson-mapping";
import { updateDatabase } from "@/lib/storage";

function salespersonKey(entry: { employeeId: string; email: string; name: string }) {
  return (entry.employeeId || entry.email || entry.name).trim().toLowerCase();
}

export async function POST(request: Request) {
  const user = await requireAdminUser();
  const formData = await request.formData();
  const file = formData.get("file");
  const mode = String(formData.get("mode") || "replace");

  if (!(file instanceof File)) {
    return NextResponse.redirect(
      new URL("/dashboard/managers?error=Please%20upload%20a%20valid%20manager%20file.", request.url),
      { status: 303 }
    );
  }

  try {
    await requireOperationPassword(user, "admin_settings", String(formData.get("operationPassword") || ""));
    const buffer = Buffer.from(await file.arrayBuffer());
    const rows = parseWorkbook(buffer, "salesperson");

    if (rows.length === 0) {
      throw new Error("The uploaded salesperson file did not contain any rows.");
    }

    await updateDatabase((database) => {
      const workspace = getCompanyWorkspaceContextForUser(database, user);
      const imported = mapSalespersonRows(rows, workspace.configOwnerId);

      if (imported.length === 0) {
        throw new Error(
          "No salesperson rows could be imported. Include salesperson name, email, and dealer codes."
        );
      }

      if (mode === "append") {
        const existing = database.salespersons.filter(
          (entry) => entry.ownerId === workspace.configOwnerId
        );
        const existingByKey = new Map(existing.map((entry) => [salespersonKey(entry), entry]));

        imported.forEach((entry) => {
          const match = existingByKey.get(salespersonKey(entry));
          if (match) {
            match.name = entry.name;
            match.employeeId = entry.employeeId;
            match.email = entry.email;
            match.phoneNumber = entry.phoneNumber;
            match.backOfficeEmail = entry.backOfficeEmail || match.backOfficeEmail || "";
            match.dealerCodes = entry.dealerCodes;
            match.updatedAt = entry.updatedAt;
            return;
          }

          database.salespersons.push(entry);
        });
      } else {
        database.salespersons = database.salespersons.filter(
          (entry) => entry.ownerId !== workspace.configOwnerId
        );
        database.salespersons.push(...imported);
      }

      applySalespersonMappings(
        database,
        database.salespersons.filter((entry) => entry.ownerId === workspace.configOwnerId),
        workspace.sharedOwnerIds,
        user
      );
    });

    await recordAuditLog(user, "Salesperson Configuration", "success", "Salesperson file imported.");

    return NextResponse.redirect(
      new URL("/dashboard/managers?message=Manager%20file%20imported.", request.url),
      { status: 303 }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Salesperson import failed.";
    await recordAuditLog(user, "Salesperson Configuration", "failed", message);
    return NextResponse.redirect(
      new URL(`/dashboard/managers?error=${encodeURIComponent(message)}`, request.url),
      { status: 303 }
    );
  }
}
