import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { requireAdminUser } from "@/lib/auth";
import { recordAuditLog } from "@/lib/audit";
import { getCompanyWorkspaceContextForUser } from "@/lib/company-workspace";
import { applySalespersonMappings } from "@/lib/salesperson-mapping";
import { readDatabase, updateDatabase } from "@/lib/storage";

export async function POST(request: Request) {
  const user = await requireAdminUser();

  try {
    const database = await readDatabase();
    const workspace = getCompanyWorkspaceContextForUser(database, user);

    // Gather all master contacts for this workspace
    const contacts = database.masterContacts.filter((c) =>
      workspace.sharedOwnerIds.has(c.ownerId)
    );

    if (contacts.length === 0) {
      return NextResponse.redirect(
        new URL(
          "/dashboard/managers?error=" +
            encodeURIComponent("No master database records found. Upload a master file first."),
          request.url
        ),
        { status: 303 }
      );
    }

    // Extract unique managers keyed by employeeId → email → name
    const managerMap = new Map<
      string,
      {
        employeeId: string;
        name: string;
        email: string;
        backOfficeEmail: string;
        dealerCodesSet: Set<string>;
      }
    >();

    for (const contact of contacts) {
      const name = contact.salespersonName?.trim() || "";
      const email = contact.salespersonEmail?.trim() || "";
      const employeeId = contact.salespersonId?.trim() || "";
      const rawBackOffice = contact.raw && typeof contact.raw === "object"
        ? (contact.raw["back office mail id"] ||
           contact.raw["back office mail ie"] ||
           contact.raw["back office email"] ||
           contact.raw["backoffice mail id"] ||
           contact.raw["backoffice email"] ||
           "")
        : "";
      const backOfficeEmail = (contact.backOfficeEmail?.trim() || rawBackOffice.trim());

      if (!name && !email) continue;

      const key = (employeeId || email || name).toLowerCase();
      const dealerCode = (contact.dealerCode || contact.customerCode || "").trim();

      const existing = managerMap.get(key);
      if (existing) {
        if (dealerCode) existing.dealerCodesSet.add(dealerCode);
        if (backOfficeEmail) {
          existing.backOfficeEmail = backOfficeEmail;
        }
      } else {
        const dealerCodesSet = new Set<string>();
        if (dealerCode) dealerCodesSet.add(dealerCode);
        managerMap.set(key, {
          employeeId: employeeId || name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
          name,
          email,
          backOfficeEmail,
          dealerCodesSet
        });
      }
    }

    if (managerMap.size === 0) {
      return NextResponse.redirect(
        new URL(
          "/dashboard/managers?error=" +
            encodeURIComponent(
              "No manager data found in master database. Make sure your master file has Manager Code, Manager Name, and Manager Email columns."
            ),
          request.url
        ),
        { status: 303 }
      );
    }

    let created = 0;
    let updated = 0;
    const now = new Date().toISOString();

    await updateDatabase((db) => {
      const existingManagers = db.salespersons.filter(
        (s) => s.ownerId === workspace.configOwnerId
      );

      for (const data of managerMap.values()) {
        // Try matching by employeeId first, then by email
        const match = existingManagers.find(
          (s) =>
            (data.employeeId && s.employeeId.toLowerCase() === data.employeeId.toLowerCase()) ||
            (data.email && s.email.toLowerCase() === data.email.toLowerCase())
        );

        if (match) {
          // Merge: update fields, union dealer codes
          match.name = data.name || match.name;
          match.email = data.email || match.email;
          match.employeeId = data.employeeId || match.employeeId;
          if (data.backOfficeEmail) {
            match.backOfficeEmail = data.backOfficeEmail;
          }
          const merged = new Set([...match.dealerCodes, ...data.dealerCodesSet]);
          match.dealerCodes = Array.from(merged).sort();
          match.updatedAt = now;
          updated++;
        } else {
          db.salespersons.push({
            id: randomUUID(),
            ownerId: workspace.configOwnerId,
            name: data.name,
            employeeId: data.employeeId,
            email: data.email,
            phoneNumber: "",
            backOfficeEmail: data.backOfficeEmail,
            dealerCodes: Array.from(data.dealerCodesSet).sort(),
            createdAt: now,
            updatedAt: now
          });
          created++;
        }
      }

      // Re-apply salesperson → due/contact mappings so everything stays in sync
      applySalespersonMappings(
        db,
        db.salespersons.filter((s) => s.ownerId === workspace.configOwnerId),
        workspace.sharedOwnerIds,
        user
      );
    });

    const total = created + updated;
    const msg = `Synced ${total} manager${total !== 1 ? "s" : ""} from master database (${created} new, ${updated} updated).`;
    await recordAuditLog(user, "Manager Sync from Master", "success", msg);

    return NextResponse.redirect(
      new URL(`/dashboard/managers?message=${encodeURIComponent(msg)}`, request.url),
      { status: 303 }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Manager sync failed.";
    await recordAuditLog(user, "Manager Sync from Master", "failed", message);
    return NextResponse.redirect(
      new URL(`/dashboard/managers?error=${encodeURIComponent(message)}`, request.url),
      { status: 303 }
    );
  }
}
