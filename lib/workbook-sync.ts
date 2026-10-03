import {
  mapDueRows,
  mapMasterRows,
  readStoredWorkbookRows,
  writeStoredWorkbookRows
} from "@/lib/excel";
import { filterSharedCompanyRecords, getCompanyWorkspaceContext } from "@/lib/company-workspace";
import { buildDueContactMatch } from "@/lib/contact-matching";
import { applySalespersonMappings } from "@/lib/salesperson-mapping";
import { readDatabase, updateDatabase } from "@/lib/storage";
import type { DueRecord, MasterContact } from "@/lib/types";
import { extractDealerCodeAndName } from "@/lib/dealer-utils";
import { randomUUID } from "node:crypto";

function normalizeWorkbookHeader(value: string) {
  return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, " ");
}

function mergeRawWithCanonical(
  raw: Record<string, string>,
  canonical: Record<string, string | number>
) {
  const protectedHeaders = new Set(Object.keys(canonical).map(normalizeWorkbookHeader));
  const preservedRawEntries = Object.entries(raw || {}).filter(
    ([key]) => !protectedHeaders.has(normalizeWorkbookHeader(key))
  );

  return {
    ...Object.fromEntries(preservedRawEntries),
    ...canonical
  };
}

function rowHasManagedHeaderDuplicates(
  row: Record<string, unknown>,
  managedHeaders: string[]
) {
  const managedSet = new Set(managedHeaders.map(normalizeWorkbookHeader));
  const counts = new Map<string, number>();

  Object.keys(row).forEach((key) => {
    const normalized = normalizeWorkbookHeader(key);
    if (!managedSet.has(normalized)) {
      return;
    }

    counts.set(normalized, (counts.get(normalized) || 0) + 1);
  });

  return Array.from(counts.values()).some((count) => count > 1);
}

const masterManagedHeaders = [
  "Dealer Code",
  "Company Name",
  "Contact Person",
  "Email",
  "WhatsApp",
  "Phone"
];

const dueManagedHeaders = [
  "Date",
  "Ref. No.",
  "Party's Name",
  "Opening Amount",
  "Pending Amount",
  "Due on",
  "Overdue by days",
  "Dealer Code",
  "Currency"
];

function buildMasterWorkbookRow(record: MasterContact) {
  const extracted = extractDealerCodeAndName(
    record.dealerCode || record.customerCode,
    record.companyName
  );
  return mergeRawWithCanonical(record.raw || {}, {
    "Dealer Code": extracted.dealerCode || record.dealerCode || record.customerCode,
    "Company Name": extracted.companyName || record.companyName,
    "Contact Person": record.primaryContact,
    Email: record.email,
    WhatsApp: record.whatsapp,
    Phone: record.sms
  });
}

function buildDueWorkbookRow(record: DueRecord) {
  const extracted = extractDealerCodeAndName(
    record.dealerCode || record.customerCode,
    record.companyName
  );
  return mergeRawWithCanonical(record.raw || {}, {
    Date: (record.billDate || record.invoiceDate) ? (record.billDate || record.invoiceDate).slice(0, 10) : "",
    "Ref. No.": record.invoiceNumber || record.reference,
    "Party's Name": extracted.companyName || record.companyName,
    "Opening Amount": record.openingAmount,
    "Pending Amount": record.amount,
    "Due on": record.dueDate ? record.dueDate.slice(0, 10) : "",
    "Overdue by days": record.overdueDays,
    "Dealer Code": extracted.dealerCode || record.dealerCode || record.customerCode,
    Currency: record.currency
  });
}

export async function ensureStoredMasterWorkbook(workspaceId: string, companyName: string) {
  try {
    const { rows } = await readStoredWorkbookRows(workspaceId, "master");
    const hasDuplicateManagedHeaders = rows.some((row) =>
      rowHasManagedHeaderDuplicates(row, masterManagedHeaders)
    );

    if (!hasDuplicateManagedHeaders) {
      return { restored: false, rowCount: rows.length };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "";

    if (!message.includes("No stored master workbook")) {
      throw error;
    }
  }

  const database = await readDatabase();
  const { sharedOwnerIds } = getCompanyWorkspaceContext(database, companyName);
  const records = filterSharedCompanyRecords(database.masterContacts, sharedOwnerIds);

  if (records.length === 0) {
    return { restored: false, rowCount: 0 };
  }

  const rows = records.map(buildMasterWorkbookRow);
  await writeStoredWorkbookRows(workspaceId, "master", rows);

  return { restored: true, rowCount: rows.length };
}

export async function ensureStoredDueWorkbook(workspaceId: string, companyName: string) {
  try {
    const { rows } = await readStoredWorkbookRows(workspaceId, "due");
    const hasDuplicateManagedHeaders = rows.some((row) =>
      rowHasManagedHeaderDuplicates(row, dueManagedHeaders)
    );

    if (!hasDuplicateManagedHeaders) {
      return { restored: false, rowCount: rows.length };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "";

    if (!message.includes("No stored due workbook")) {
      throw error;
    }
  }

  const database = await readDatabase();
  const { sharedOwnerIds } = getCompanyWorkspaceContext(database, companyName);
  const records = filterSharedCompanyRecords(database.dueRecords, sharedOwnerIds);

  if (records.length === 0) {
    return { restored: false, rowCount: 0 };
  }

  const rows = records.map(buildDueWorkbookRow);
  await writeStoredWorkbookRows(workspaceId, "due", rows);

  return { restored: true, rowCount: rows.length };
}

export async function syncStoredMasterWorkbook(workspaceId: string, companyName: string) {
  const { rows } = await readStoredWorkbookRows(workspaceId, "master");
  const records = mapMasterRows(rows, workspaceId);

  if (records.length === 0) {
    throw new Error(
      "The stored master workbook no longer contains any valid rows. Please keep at least one company name row."
    );
  }

  await updateDatabase((database) => {
    const { configOwnerId, sharedOwnerIds } = getCompanyWorkspaceContext(database, companyName);
    database.masterContacts = database.masterContacts.filter(
      (entry) => !sharedOwnerIds.has(entry.ownerId)
    );
    database.masterContacts.push(...records);
    database.dueRecords = database.dueRecords.map((entry) => {
      if (!sharedOwnerIds.has(entry.ownerId)) {
        return entry;
      }

      const match = buildDueContactMatch(entry, records);
      return {
        ...entry,
        companyName: match.companyName,
        matchedContactId: match.matchedContactId,
        matchedContactName: match.matchedContactName,
        matchedEmail: match.matchedEmail,
        matchedWhatsapp: match.matchedWhatsapp,
        matchedSms: match.matchedSms,
        contactMatchStatus: match.contactMatchStatus
      };
    });
    database.reminderLogs = database.reminderLogs.filter(
      (entry) =>
        !(
          sharedOwnerIds.has(entry.ownerId) &&
          (entry.status === "pending" || entry.status === "failed")
        )
    );

    // Auto-sync managers from the freshly imported master contacts
    syncManagersFromMasterContacts(database.masterContacts.filter((c) => sharedOwnerIds.has(c.ownerId)), database, configOwnerId);

    applySalespersonMappings(
      database,
      database.salespersons.filter((entry) => entry.ownerId === configOwnerId),
      sharedOwnerIds,
      { id: workspaceId }
    );
  });

  return {
    recordCount: records.length
  };
}

/**
 * Extract unique manager profiles from master contacts and upsert them
 * into the salespersons collection (create new or merge dealer codes).
 */
function syncManagersFromMasterContacts(
  contacts: MasterContact[],
  database: Parameters<Parameters<typeof updateDatabase>[0]>[0],
  configOwnerId: string
) {
  const managerMap = new Map<string, {
    employeeId: string;
    name: string;
    email: string;
    backOfficeEmail: string;
    dealerCodesSet: Set<string>;
  }>();

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
      if (backOfficeEmail) existing.backOfficeEmail = backOfficeEmail;
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

  if (managerMap.size === 0) return;

  const now = new Date().toISOString();
  const existingManagers = database.salespersons.filter((s) => s.ownerId === configOwnerId);

  for (const data of managerMap.values()) {
    const match = existingManagers.find(
      (s) =>
        (data.employeeId && s.employeeId.toLowerCase() === data.employeeId.toLowerCase()) ||
        (data.email && s.email.toLowerCase() === data.email.toLowerCase())
    );

    if (match) {
      match.name = data.name || match.name;
      match.email = data.email || match.email;
      match.employeeId = data.employeeId || match.employeeId;
      if (data.backOfficeEmail) match.backOfficeEmail = data.backOfficeEmail;
      const merged = new Set([...match.dealerCodes, ...data.dealerCodesSet]);
      match.dealerCodes = Array.from(merged).sort();
      match.updatedAt = now;
    } else {
      database.salespersons.push({
        id: randomUUID(),
        ownerId: configOwnerId,
        name: data.name,
        employeeId: data.employeeId,
        email: data.email,
        phoneNumber: "",
        backOfficeEmail: data.backOfficeEmail,
        dealerCodes: Array.from(data.dealerCodesSet).sort(),
        createdAt: now,
        updatedAt: now
      });
    }
  }
}

export async function syncStoredDueWorkbook(workspaceId: string, companyName: string) {
  const { rows } = await readStoredWorkbookRows(workspaceId, "due");
  const database = await readDatabase();
  const { sharedOwnerIds } = getCompanyWorkspaceContext(database, companyName);
  const contacts = filterSharedCompanyRecords(database.masterContacts, sharedOwnerIds);
  const records = mapDueRows(rows, workspaceId, contacts);

  if (records.length === 0) {
    throw new Error(
      "The stored due workbook no longer contains any valid rows. Please keep bill date filled in with either dealer code or party name."
    );
  }

  await updateDatabase((database) => {
    const { configOwnerId, sharedOwnerIds } = getCompanyWorkspaceContext(database, companyName);
    database.dueRecords = database.dueRecords.filter(
      (entry) => !sharedOwnerIds.has(entry.ownerId)
    );
    database.dueRecords.push(...records);
    database.reminderLogs = database.reminderLogs.filter(
      (entry) =>
        !(
          sharedOwnerIds.has(entry.ownerId) &&
          (entry.status === "pending" || entry.status === "failed")
        )
    );
    applySalespersonMappings(
      database,
      database.salespersons.filter((entry) => entry.ownerId === configOwnerId),
      sharedOwnerIds,
      { id: workspaceId }
    );
  });

  return {
    recordCount: records.length
  };
}
