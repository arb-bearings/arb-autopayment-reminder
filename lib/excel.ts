import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import * as XLSX from "xlsx";
import { buildDueContactMatch } from "@/lib/contact-matching";
import type { DueRecord, MasterContact, Salesperson } from "@/lib/types";

type RawRow = Record<string, string | number | boolean | Date | undefined>;
type ImportKind = "master" | "due" | "salesperson";
type WorkbookUpdateHandler = (rows: RawRow[]) => RawRow[] | Promise<RawRow[]>;

type MasterRowLookup = {
  dealerCode: string;
  companyName?: string;
  primaryContact?: string;
};

type MasterRowChanges = {
  dealerCode: string;
  companyName: string;
  primaryContact: string;
  email: string;
  whatsapp: string;
  sms: string;
  alternateContact: string;
  notes: string;
};

type DueRowLookup = {
  dealerCode: string;
  companyName?: string;
  invoiceNumber?: string;
  billDate?: string;
};

type DueRowChanges = {
  dealerCode: string;
  companyName: string;
  invoiceNumber: string;
  billDate: string;
  dueDate: string;
  openingAmount: string;
  amount: string;
  currency: string;
  overdueDays: string;
  reference: string;
  notes: string;
};

const storedWorkbookFileNames: Record<ImportKind, string> = {
  master: "master-database.xlsx",
  due: "due-database.xlsx",
  salesperson: "salesperson-database.xlsx"
};

const masterFieldCandidates = {
  dealerCode: [
    "dealer code",
    "dealer id",
    "dealer number",
    "customer code",
    "customer id",
    "customer number",
    "party code",
    "code"
  ],
  companyName: [
    "company name",
    "company",
    "dealer name",
    "client name",
    "customer name",
    "party s name",
    "party name",
    "party name",
    "name of company",
    "particulars",
    "particular"
  ],
  primaryContact: [
    "contact person",
    "primary contact",
    "contact name",
    "person",
    "contact person name",
    "contact"
  ],
  email: ["email", "email id", "mail", "email address"],
  whatsapp: [
    "whatsapp",
    "whatsapp number",
    "wa number",
    "whatsapp no",
    "whatsapp no.",
    "whatsapp mobile"
  ],
  sms: [
    "sms",
    "phone",
    "phone number",
    "phone no",
    "phone no.",
    "mobile",
    "mobile number",
    "mobile no",
    "mobile no.",
    "contact number",
    "contact no"
  ],
  alternateContact: ["alternate contact", "secondary contact", "alt contact", "alternate number"],
  notes: ["notes", "remarks", "comment"],
  salespersonId: ["salesperson id", "sales person id", "employee id", "sales employee id"],
  salespersonName: ["salesperson", "salesperson name", "sales person", "sales person name"],
  salespersonEmail: ["salesperson email", "sales person email", "sales email"]
} as const;

const dueFieldCandidates = {
  dealerCode: [
    "dealer code",
    "dealer id",
    "dealer number",
    "customer code",
    "customer id",
    "customer number",
    "party code",
    "code"
  ],
  companyName: [
    "company name",
    "company",
    "dealer name",
    "client name",
    "customer name",
    "party s name",
    "party name",
    "name of company",
    "particulars",
    "particular"
  ],
  invoiceNumber: [
    "bill no",
    "bill number",
    "invoice no",
    "invoice no.",
    "invoice number",
    "ref no",
    "ref no.",
    "reference no",
    "bill no.",
    "reference no",
    "reference no.",
    "invoice"
  ],
  billDate: [
    "bill date",
    "bill dt",
    "date",
    "invoice date",
    "invoice dt",
    "document date",
    "posting date"
  ],
  dueDate: ["due date", "payment due date", "reminder date", "due dt", "due on"],
  openingAmount: ["opening amount", "opening amt", "opening balance", "opening"],
  amount: [
    "pending",           // ← user's actual Excel column name
    "pending amount",
    "pending amt",
    "amount",
    "bill amount",
    "bill value",
    "net amount",
    "invoice amount",
    "due amount",
    "balance amount",
    "outstanding",
    "outstanding amount",
    "outstanding amt",
    // Tally and Indian ERP exports
    "closing balance",
    "closing amt",
    "closing amount",
    "balance",
    "net balance",
    "debit balance",
    "dr balance",
    "dr amount",
    "dr amt",
    "net receivable",
    "receivable amount",
    "receivable",
    "amount due",
    "net due",
    "payable amount",
    "credit amount"
  ],
  currency: ["currency"],
  overdueDays: ["overdue by days", "overdue by day", "overdue days", "ageing days", "overdue"],
  reference: ["reference", "reference number", "po number", "po no"],
  notes: ["notes", "remarks", "comment"],
  totalDueAmount: ["total due amount", "total outstanding amount", "total outstanding", "total_due_amount"],
  salespersonId: ["salesperson id", "sales person id", "employee id", "sales employee id", "salesperson_id"],
  salespersonName: ["salesperson", "salesperson name", "sales person", "sales person name", "salesperson_name"],
  salespersonEmail: ["salesperson email", "sales person email", "sales email", "salesperson_email"]
} as const;

const salespersonFieldCandidates = {
  name: ["salesperson name", "sales person name", "salesperson", "sales person", "name"],
  employeeId: ["employee id", "salesperson id", "sales person id", "staff id", "id"],
  email: ["email", "email id", "salesperson email", "sales person email", "mail"],
  phoneNumber: ["phone", "phone number", "mobile", "mobile number", "contact number"],
  dealerCodes: [
    "dealers",
    "dealer codes",
    "dealer code",
    "dealer ids",
    "customer codes",
    "customer code",
    "assigned dealers"
  ]
} as const;

function normalizeHeader(value: string) {
  return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, " ");
}

function getCandidateHeaders(kind: ImportKind) {
  const fieldCandidates =
    kind === "master"
      ? masterFieldCandidates
      : kind === "due"
        ? dueFieldCandidates
        : salespersonFieldCandidates;
  return new Set(
    Object.values(fieldCandidates)
      .flat()
      .map((value) => normalizeHeader(value))
  );
}

function toText(value: unknown) {
  if (value instanceof Date) {
    return value.toISOString();
  }

  if (value === undefined || value === null) {
    return "";
  }

  return String(value).trim();
}

function excelSerialToIsoDate(value: number) {
  const wholeDays = Math.floor(value);
  const fractionalDay = value - wholeDays;
  const excelEpoch = Date.UTC(1899, 11, 30);
  const parsed = new Date(
    excelEpoch + wholeDays * 24 * 60 * 60 * 1000 + Math.round(fractionalDay * 24 * 60 * 60 * 1000)
  );

  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString();
}

function toDateValue(value: unknown) {
  if (!value) {
    return "";
  }

  if (typeof value === "number") {
    return excelSerialToIsoDate(value);
  }

  const text = toText(value);
  const normalized = text.replace(/[.\-]/g, "/");
  const dayFirstMatch = normalized.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);

  if (dayFirstMatch) {
    const day = Number(dayFirstMatch[1]);
    const month = Number(dayFirstMatch[2]);
    const year = Number(
      dayFirstMatch[3].length === 2 ? `20${dayFirstMatch[3]}` : dayFirstMatch[3]
    );
    const parsed = new Date(Date.UTC(year, month - 1, day));

    if (
      !Number.isNaN(parsed.getTime()) &&
      parsed.getUTCFullYear() === year &&
      parsed.getUTCMonth() === month - 1 &&
      parsed.getUTCDate() === day
    ) {
      return parsed.toISOString();
    }
  }

  const monthNameMatch = text.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{2,4})$/);

  if (monthNameMatch) {
    const day = Number(monthNameMatch[1]);
    const month = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"].indexOf(
      monthNameMatch[2].toLowerCase()
    );
    const year = Number(
      monthNameMatch[3].length === 2 ? `20${monthNameMatch[3]}` : monthNameMatch[3]
    );

    if (month >= 0) {
      const parsed = new Date(Date.UTC(year, month, day));

      if (
        !Number.isNaN(parsed.getTime()) &&
        parsed.getUTCFullYear() === year &&
        parsed.getUTCMonth() === month &&
        parsed.getUTCDate() === day
      ) {
        return parsed.toISOString();
      }
    }
  }

  const direct = new Date(text);
  return Number.isNaN(direct.getTime()) ? "" : direct.toISOString();
}

function toDateComparisonKey(value: unknown) {
  const normalizedDate = toDateValue(value);
  return normalizedDate ? normalizedDate.slice(0, 10) : "";
}

function toAmount(value: unknown) {
  if (typeof value === "number") {
    return value;
  }

  const text = toText(value).replace(/,/g, "");
  const numericText = text.match(/-?\d+(\.\d+)?/)?.[0] || "";
  const parsed = Number(numericText);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toCellValue(value: unknown) {
  if (value === undefined || value === null) {
    return "";
  }

  if (typeof value === "number" || typeof value === "boolean" || value instanceof Date) {
    return value;
  }

  const text = String(value).trim();
  if (text === "") {
    return "";
  }

  const numeric = Number(text.replace(/,/g, ""));
  return Number.isFinite(numeric) && /^-?\d+(\.\d+)?$/.test(text.replace(/,/g, ""))
    ? numeric
    : text;
}

function normalizeRow(row: RawRow) {
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [normalizeHeader(key), value])
  );
}

function expandGroupedDueRows(rows: RawRow[]) {
  let activePartyName = "";

  return rows.map((row) => {
    const normalizedRow = normalizeRow(row);
    const rowPartyName = toText(pickValue(normalizedRow, dueFieldCandidates.companyName));
    const billDate = toDateValue(pickValue(normalizedRow, dueFieldCandidates.billDate));
    const invoiceNumber = toText(pickValue(normalizedRow, dueFieldCandidates.invoiceNumber));

    if (rowPartyName && !billDate && !invoiceNumber) {
      activePartyName = rowPartyName;
    }

    if (!rowPartyName && activePartyName) {
      const companyHeader = getExistingRowKey(row, dueFieldCandidates.companyName) || "Party's Name";
      row[companyHeader] = activePartyName;
    }

    return row;
  });
}

function pickValue(row: Record<string, unknown>, candidates: readonly string[]) {
  for (const candidate of candidates) {
    const value = row[normalizeHeader(candidate)];
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      return value;
    }
  }

  return "";
}

function getExistingRowKey(row: RawRow, candidates: readonly string[]) {
  const candidateSet = new Set(candidates.map((candidate) => normalizeHeader(candidate)));

  return Object.keys(row).find((key) => candidateSet.has(normalizeHeader(key)));
}

function setRowField(
  row: RawRow,
  candidates: readonly string[],
  fallbackHeader: string,
  value: unknown
) {
  const nextRow = { ...row };
  const key = getExistingRowKey(nextRow, candidates) || fallbackHeader;
  nextRow[key] = toCellValue(value);
  return nextRow;
}

function matchesTextField(row: RawRow, candidates: readonly string[], expected: string) {
  if (!expected.trim()) {
    return true;
  }

  return normalizeHeader(toText(pickValue(row, candidates))) === normalizeHeader(expected);
}

function matchesDateField(row: RawRow, candidates: readonly string[], expected: string) {
  if (!expected.trim()) {
    return true;
  }

  return toDateComparisonKey(pickValue(row, candidates)) === toDateComparisonKey(expected);
}

function findUniqueRowIndex(
  rows: RawRow[],
  matcher: (row: RawRow) => boolean
) {
  const matches = rows
    .map((row, index) => ({ row, index }))
    .filter(({ row }) => matcher(row));

  return matches.length === 1 ? matches[0].index : -1;
}

function findMasterRowIndex(rows: RawRow[], lookup: MasterRowLookup) {
  const codeIndex = rows.findIndex((row) =>
    matchesTextField(row, masterFieldCandidates.dealerCode, lookup.dealerCode)
  );

  if (codeIndex !== -1) {
    return codeIndex;
  }

  const exactIndex = rows.findIndex(
    (row) =>
      matchesTextField(row, masterFieldCandidates.companyName, lookup.companyName || "") &&
      matchesTextField(row, masterFieldCandidates.primaryContact, lookup.primaryContact || "")
  );

  if (exactIndex !== -1) {
    return exactIndex;
  }

  return findUniqueRowIndex(
    rows,
    (row) => matchesTextField(row, masterFieldCandidates.companyName, lookup.companyName || "")
  );
}

function findDueRowIndex(rows: RawRow[], lookup: DueRowLookup) {
  const exactIndex = rows.findIndex(
    (row) =>
      matchesTextField(row, dueFieldCandidates.dealerCode, lookup.dealerCode) &&
      matchesTextField(row, dueFieldCandidates.invoiceNumber, lookup.invoiceNumber || "") &&
      matchesDateField(row, dueFieldCandidates.billDate, lookup.billDate || "")
  );

  if (exactIndex !== -1) {
    return exactIndex;
  }

  const fallbackMatchers = [
    (row: RawRow) =>
      matchesTextField(row, dueFieldCandidates.dealerCode, lookup.dealerCode) &&
      matchesTextField(row, dueFieldCandidates.invoiceNumber, lookup.invoiceNumber || ""),
    (row: RawRow) =>
      matchesTextField(row, dueFieldCandidates.dealerCode, lookup.dealerCode) &&
      matchesDateField(row, dueFieldCandidates.billDate, lookup.billDate || ""),
    (row: RawRow) =>
      matchesTextField(row, dueFieldCandidates.invoiceNumber, lookup.invoiceNumber || "") &&
      matchesDateField(row, dueFieldCandidates.billDate, lookup.billDate || ""),
    (row: RawRow) =>
      matchesTextField(row, dueFieldCandidates.companyName, lookup.companyName || "") &&
      matchesTextField(row, dueFieldCandidates.invoiceNumber, lookup.invoiceNumber || ""),
    (row: RawRow) =>
      matchesTextField(row, dueFieldCandidates.invoiceNumber, lookup.invoiceNumber || ""),
    (row: RawRow) =>
      matchesTextField(row, dueFieldCandidates.companyName, lookup.companyName || "") &&
      matchesDateField(row, dueFieldCandidates.billDate, lookup.billDate || "")
  ];

  for (const matcher of fallbackMatchers) {
    const index = findUniqueRowIndex(rows, matcher);
    if (index !== -1) {
      return index;
    }
  }

  return -1;
}

function scoreHeaderRow(values: unknown[], candidates: Set<string>) {
  return values.reduce<number>((score, value) => {
    const normalized = normalizeHeader(toText(value));
    return normalized && candidates.has(normalized) ? score + 1 : score;
  }, 0);
}

function detectHeaderRow(worksheet: XLSX.WorkSheet, kind: ImportKind) {
  const rows = XLSX.utils.sheet_to_json<unknown[]>(worksheet, {
    header: 1,
    defval: "",
    raw: false,
    blankrows: false
  });
  const candidates = getCandidateHeaders(kind);
  const scanLimit = Math.min(rows.length, 10);
  let bestRowIndex = 0;
  let bestScore = -1;

  for (let index = 0; index < scanLimit; index += 1) {
    const score = scoreHeaderRow(rows[index] || [], candidates);
    if (score > bestScore) {
      bestRowIndex = index;
      bestScore = score;
    }
  }

  return bestRowIndex;
}

function isNamedHeader(value: unknown) {
  const text = toText(value);
  if (!text) {
    return false;
  }

  const normalized = normalizeHeader(text);
  return normalized !== "" && normalized !== "unnamed";
}

function resolveHeaderValues(rows: unknown[][], headerRowIndex: number) {
  const maxColumnCount = rows.reduce((max, row) => Math.max(max, row?.length || 0), 0);

  return Array.from({ length: maxColumnCount }, (_, columnIndex) => {
    const detectedHeader = rows[headerRowIndex]?.[columnIndex];
    if (isNamedHeader(detectedHeader)) {
      return toText(detectedHeader);
    }

    for (let rowIndex = headerRowIndex - 1; rowIndex >= 0; rowIndex -= 1) {
      const candidate = rows[rowIndex]?.[columnIndex];
      if (isNamedHeader(candidate)) {
        return toText(candidate);
      }
    }

    return `Unnamed: ${columnIndex}`;
  });
}

function sheetToRows(worksheet: XLSX.WorkSheet, kind: ImportKind, headerRowIndex?: number) {
  const rows = XLSX.utils.sheet_to_json<unknown[]>(worksheet, {
    header: 1,
    defval: "",
    raw: true
  });
  const resolvedHeaderRowIndex = headerRowIndex ?? detectHeaderRow(worksheet, kind);
  const headers = resolveHeaderValues(rows, resolvedHeaderRowIndex);

  return rows.slice(resolvedHeaderRowIndex + 1).map((row) =>
    Object.fromEntries(headers.map((header, index) => [header, row?.[index] ?? ""]))
  );
}

export function parseWorkbook(buffer: Buffer, kind: ImportKind) {
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true });
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];

  if (!worksheet) {
    throw new Error("The uploaded file does not contain a readable sheet.");
  }

  const headerRowIndex = detectHeaderRow(worksheet, kind);
  return sheetToRows(worksheet, kind, headerRowIndex) as RawRow[];
}

function getWorkbookDirectoryName(ownerId: string) {
  const encodedOwnerId = encodeURIComponent(ownerId || "workspace").replace(
    /[!'()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`
  );

  if (encodedOwnerId === "." || encodedOwnerId === "..") {
    return encodedOwnerId.replace(/\./g, "%2E");
  }

  return encodedOwnerId;
}

function getWorkbookDirectory(ownerId: string) {
  const storageRoot =
    process.env.WORKBOOK_STORAGE_DIR ||
    (process.env.NODE_ENV === "production"
      ? path.join(tmpdir(), "auto-payment-reminder")
      : path.join(process.cwd(), "data"));

  return path.join(storageRoot, "workbooks", getWorkbookDirectoryName(ownerId));
}

export function getStoredWorkbookPath(ownerId: string, kind: ImportKind) {
  return path.join(getWorkbookDirectory(ownerId), storedWorkbookFileNames[kind]);
}

function readWorkbookOrThrow(buffer: Buffer, kind: ImportKind) {
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true });
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];

  if (!worksheet) {
    throw new Error(`The stored ${kind} workbook does not contain a readable sheet.`);
  }

  return { workbook, sheetName, worksheet };
}

function collectColumnOrder(
  worksheetRows: unknown[][],
  headerRowIndex: number,
  rows: RawRow[]
) {
  const sheetHeaders = (worksheetRows[headerRowIndex] || [])
    .map((value) => toText(value))
    .filter((value) => value !== "");
  const rowHeaders = rows.flatMap((row) =>
    Object.keys(row).filter((key) => key.trim() !== "")
  );

  return Array.from(new Set([...sheetHeaders, ...rowHeaders]));
}

function rebuildWorksheet(
  worksheet: XLSX.WorkSheet,
  headerRowIndex: number,
  rows: RawRow[]
) {
  const worksheetRows = XLSX.utils.sheet_to_json<unknown[]>(worksheet, {
    header: 1,
    defval: "",
    raw: true
  });
  const preservedRows = worksheetRows.slice(0, headerRowIndex);
  const columnOrder = collectColumnOrder(worksheetRows, headerRowIndex, rows);
  const nextRows = rows.map((row) => columnOrder.map((header) => row[header] ?? ""));
  const nextWorksheet = XLSX.utils.aoa_to_sheet([...preservedRows, columnOrder, ...nextRows]);

  if (worksheet["!cols"]) {
    nextWorksheet["!cols"] = worksheet["!cols"];
  }

  return nextWorksheet;
}

function buildWorkbookFromRows(rows: RawRow[], kind: ImportKind) {
  const columnOrder = Array.from(
    new Set(rows.flatMap((row) => Object.keys(row).filter((key) => key.trim() !== "")))
  );
  const worksheet = XLSX.utils.aoa_to_sheet([
    columnOrder,
    ...rows.map((row) => columnOrder.map((header) => row[header] ?? ""))
  ]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    workbook,
    worksheet,
    kind === "master"
      ? "Master Database"
      : kind === "due"
        ? "Due Database"
        : "Salespersons"
  );

  return workbook;
}

export async function writeStoredWorkbookRows(ownerId: string, kind: ImportKind, rows: RawRow[]) {
  const directory = getWorkbookDirectory(ownerId);
  const filePath = getStoredWorkbookPath(ownerId, kind);

  await mkdir(directory, { recursive: true });
  await writeFile(
    filePath,
    XLSX.write(buildWorkbookFromRows(rows, kind), { type: "buffer", bookType: "xlsx" })
  );

  return filePath;
}

export async function deleteStoredWorkbook(ownerId: string, kind: ImportKind) {
  const filePath = getStoredWorkbookPath(ownerId, kind);
  await rm(filePath, { force: true });
  return filePath;
}

export async function saveUploadedWorkbook(ownerId: string, kind: ImportKind, buffer: Buffer) {
  const rows = parseWorkbook(buffer, kind);
  return writeStoredWorkbookRows(ownerId, kind, rows);
}

export async function readStoredWorkbookRows(ownerId: string, kind: ImportKind) {
  const filePath = getStoredWorkbookPath(ownerId, kind);
  const buffer = await readFile(filePath).catch(() => {
    throw new Error(`No stored ${kind} workbook was found for this user.`);
  });
  const { workbook, sheetName, worksheet } = readWorkbookOrThrow(buffer, kind);
  const headerRowIndex = detectHeaderRow(worksheet, kind);
  const rows = sheetToRows(worksheet, kind, headerRowIndex) as RawRow[];

  return {
    filePath,
    workbook,
    sheetName,
    worksheet,
    headerRowIndex,
    rows
  };
}

export async function updateStoredWorkbookRows(
  ownerId: string,
  kind: ImportKind,
  updater: WorkbookUpdateHandler
) {
  const { filePath, workbook, sheetName, worksheet, headerRowIndex, rows } =
    await readStoredWorkbookRows(ownerId, kind);
  const nextRows = await updater(rows);

  workbook.Sheets[sheetName] = rebuildWorksheet(worksheet, headerRowIndex, nextRows);
  await writeFile(filePath, XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }));

  return {
    filePath,
    rowCount: nextRows.length,
    rows: nextRows
  };
}

export async function upsertStoredMasterWorkbookRow(
  ownerId: string,
  lookup: MasterRowLookup,
  changes: MasterRowChanges
) {
  return updateStoredWorkbookRows(ownerId, "master", (rows) => {
    const rowIndex = findMasterRowIndex(rows, lookup);

    if (rowIndex === -1) {
      throw new Error("The selected master row could not be found in the stored workbook.");
    }

    const nextRows = [...rows];
    nextRows[rowIndex] = applyMasterRowChanges(rows[rowIndex], changes);
    return nextRows;
  });
}

function applyMasterRowChanges(row: RawRow, changes: MasterRowChanges) {
  let nextRow = { ...row };
  nextRow = setRowField(
    nextRow,
    masterFieldCandidates.dealerCode,
    "Dealer Code",
    changes.dealerCode
  );
  nextRow = setRowField(
    nextRow,
    masterFieldCandidates.companyName,
    "Company Name",
    changes.companyName
  );
  nextRow = setRowField(
    nextRow,
    masterFieldCandidates.primaryContact,
    "Contact Person",
    changes.primaryContact
  );
  nextRow = setRowField(nextRow, masterFieldCandidates.email, "Email", changes.email);
  nextRow = setRowField(nextRow, masterFieldCandidates.whatsapp, "WhatsApp", changes.whatsapp);
  nextRow = setRowField(nextRow, masterFieldCandidates.sms, "Phone", changes.sms);
  nextRow = setRowField(
    nextRow,
    masterFieldCandidates.alternateContact,
    "Alternate Contact",
    changes.alternateContact
  );
  nextRow = setRowField(nextRow, masterFieldCandidates.notes, "Notes", changes.notes);
  return nextRow;
}

export async function saveStoredMasterWorkbookRows(
  ownerId: string,
  entries: Array<{
    lookup?: MasterRowLookup;
    changes: MasterRowChanges;
  }>
) {
  return updateStoredWorkbookRows(ownerId, "master", (rows) => {
    const nextRows = [...rows];

    entries.forEach((entry, index) => {
      if (!entry.changes.dealerCode.trim() || !entry.changes.companyName.trim()) {
        throw new Error(`Row ${index + 1} must include both dealer code and company name.`);
      }

      if (entry.lookup?.dealerCode?.trim()) {
        const rowIndex = findMasterRowIndex(nextRows, entry.lookup);

        if (rowIndex === -1) {
          throw new Error(
            `The stored master row for ${entry.lookup.dealerCode} could not be found.`
          );
        }

        nextRows[rowIndex] = applyMasterRowChanges(nextRows[rowIndex], entry.changes);
        return;
      }

      nextRows.push(applyMasterRowChanges({}, entry.changes));
    });

    return nextRows;
  });
}

export async function upsertStoredDueWorkbookRow(
  ownerId: string,
  lookup: DueRowLookup,
  changes: DueRowChanges
) {
  return updateStoredWorkbookRows(ownerId, "due", (rows) => {
    const rowIndex = findDueRowIndex(rows, lookup);

    if (rowIndex === -1) {
      throw new Error("The selected due row could not be found in the stored workbook.");
    }

    const nextRows = [...rows];
    nextRows[rowIndex] = applyDueRowChanges(rows[rowIndex], changes);
    return nextRows;
  });
}

function applyDueRowChanges(row: RawRow, changes: DueRowChanges) {
  let nextRow = { ...row };
  nextRow = setRowField(
    nextRow,
    dueFieldCandidates.dealerCode,
    "Dealer Code",
    changes.dealerCode
  );
  nextRow = setRowField(
    nextRow,
    dueFieldCandidates.companyName,
    "Company Name",
    changes.companyName
  );
  nextRow = setRowField(
    nextRow,
    dueFieldCandidates.invoiceNumber,
    "Invoice Number",
    changes.invoiceNumber
  );
  nextRow = setRowField(
    nextRow,
    dueFieldCandidates.billDate,
    "Bill Date",
    changes.billDate
  );
  nextRow = setRowField(nextRow, dueFieldCandidates.dueDate, "Due Date", changes.dueDate);
  nextRow = setRowField(
    nextRow,
    dueFieldCandidates.openingAmount,
    "Opening Amount",
    changes.openingAmount
  );
  nextRow = setRowField(nextRow, dueFieldCandidates.amount, "Pending Amount", changes.amount);
  nextRow = setRowField(nextRow, dueFieldCandidates.currency, "Currency", changes.currency);
  nextRow = setRowField(
    nextRow,
    dueFieldCandidates.overdueDays,
    "Overdue by days",
    changes.overdueDays
  );
  nextRow = setRowField(nextRow, dueFieldCandidates.reference, "Reference", changes.reference);
  nextRow = setRowField(nextRow, dueFieldCandidates.notes, "Notes", changes.notes);
  return nextRow;
}

export async function saveStoredDueWorkbookRows(
  ownerId: string,
  entries: Array<{
    lookup?: DueRowLookup;
    changes: DueRowChanges;
  }>
) {
  return updateStoredWorkbookRows(ownerId, "due", (rows) => {
    const nextRows = [...rows];

    entries.forEach((entry, index) => {
      if (
        (!entry.changes.dealerCode.trim() && !entry.changes.companyName.trim()) ||
        !entry.changes.billDate.trim()
      ) {
        throw new Error(`Row ${index + 1} must include a dealer code or company name, plus bill date.`);
      }

      if (entry.lookup?.dealerCode?.trim()) {
        const rowIndex = findDueRowIndex(nextRows, entry.lookup);

        if (rowIndex === -1) {
          throw new Error(
            `The stored workbook row for dealer ${entry.lookup.dealerCode} could not be found.`
          );
        }

        nextRows[rowIndex] = applyDueRowChanges(nextRows[rowIndex], entry.changes);
        return;
      }

      nextRows.push(applyDueRowChanges({}, entry.changes));
    });

    return nextRows;
  });
}

function matchMasterContactByDealerCode(
  dealerCode: string,
  contacts: MasterContact[]
) {
  if (!dealerCode.trim()) {
    return null;
  }

  const normalizedDealerCode = normalizeHeader(dealerCode);
  return (
    contacts.find((contact) => normalizeHeader(contact.dealerCode || contact.customerCode) === normalizedDealerCode) ??
    null
  );
}

export function mapMasterRows(rows: RawRow[], ownerId: string) {
  const importedAt = new Date().toISOString();

  return rows
    .map(normalizeRow)
    .filter(
      (row) =>
        toText(pickValue(row, masterFieldCandidates.dealerCode)) !== "" &&
        toText(pickValue(row, masterFieldCandidates.companyName)) !== ""
    )
    .map<MasterContact>((row) => {
      const dealerCode = toText(pickValue(row, masterFieldCandidates.dealerCode));

      return {
        id: randomUUID(),
        ownerId,
        dealerCode,
        customerCode: dealerCode,
        companyName: toText(pickValue(row, masterFieldCandidates.companyName)),
        primaryContact: toText(pickValue(row, masterFieldCandidates.primaryContact)),
        email: toText(pickValue(row, masterFieldCandidates.email)),
        whatsapp: toText(pickValue(row, masterFieldCandidates.whatsapp)),
        sms: toText(pickValue(row, masterFieldCandidates.sms)),
        alternateContact: toText(pickValue(row, masterFieldCandidates.alternateContact)),
        notes: toText(pickValue(row, masterFieldCandidates.notes)),
        salespersonId: toText(pickValue(row, masterFieldCandidates.salespersonId)),
        salespersonName: toText(pickValue(row, masterFieldCandidates.salespersonName)),
        salespersonEmail: toText(pickValue(row, masterFieldCandidates.salespersonEmail)),
        importedAt,
        raw: Object.fromEntries(
          Object.entries(row).map(([key, value]) => [key, toText(value)])
        )
      };
    });
}

export function mapDueRows(rows: RawRow[], ownerId: string, contacts: MasterContact[] = []) {
  const importedAt = new Date().toISOString();
  const expandedRows = expandGroupedDueRows(rows);

  const mappedRows = expandedRows
    .map(normalizeRow)
    .filter(
      (row) =>
        (
          toText(pickValue(row, dueFieldCandidates.dealerCode)) !== "" ||
          toText(pickValue(row, dueFieldCandidates.companyName)) !== ""
        ) &&
        toDateValue(pickValue(row, dueFieldCandidates.billDate)) !== ""
    )
    .map<DueRecord>((row) => {
      const dealerCode = toText(pickValue(row, dueFieldCandidates.dealerCode));
      const companyName = toText(pickValue(row, dueFieldCandidates.companyName));
      const billDate = toDateValue(pickValue(row, dueFieldCandidates.billDate));
      const pendingAmount = toAmount(pickValue(row, dueFieldCandidates.amount));
      const contactByDealer = matchMasterContactByDealerCode(dealerCode, contacts);
      const match = buildDueContactMatch(
        {
          dealerCode,
          customerCode: dealerCode,
          companyName,
          matchedContactId: "",
          matchedContactName: "",
          matchedEmail: "",
          matchedWhatsapp: "",
          matchedSms: "",
          contactMatchStatus: "missing"
        },
        contacts
      );

      return {
        id: randomUUID(),
        ownerId,
        dealerCode,
        customerCode: dealerCode,
        companyName: match.companyName,
        billDate,
        invoiceNumber: toText(pickValue(row, dueFieldCandidates.invoiceNumber)),
        invoiceDate: billDate,
        dueDate: toDateValue(pickValue(row, dueFieldCandidates.dueDate)),
        openingAmount: toAmount(pickValue(row, dueFieldCandidates.openingAmount)),
        amount: pendingAmount,
        currency: toText(pickValue(row, dueFieldCandidates.currency)) || "INR",
        overdueDays: Math.max(0, Math.round(toAmount(pickValue(row, dueFieldCandidates.overdueDays)))),
        reference: toText(pickValue(row, dueFieldCandidates.reference)),
        notes: toText(pickValue(row, dueFieldCandidates.notes)),
        matchedContactId: match.matchedContactId,
        matchedContactName: match.matchedContactName,
        matchedEmail: match.matchedEmail,
        matchedWhatsapp: match.matchedWhatsapp,
        matchedSms: match.matchedSms,
        contactMatchStatus: match.contactMatchStatus,
        totalDueAmount: toAmount(pickValue(row, dueFieldCandidates.totalDueAmount)) || pendingAmount,
        salespersonId:
          toText(pickValue(row, dueFieldCandidates.salespersonId)) ||
          contactByDealer?.salespersonId ||
          "",
        salespersonName:
          toText(pickValue(row, dueFieldCandidates.salespersonName)) ||
          contactByDealer?.salespersonName ||
          "",
        salespersonEmail:
          toText(pickValue(row, dueFieldCandidates.salespersonEmail)) ||
          contactByDealer?.salespersonEmail ||
          "",
        lastReminderDate: "",
        reminderCount: 0,
        lastDispatchStatus: "",
        createdBy: ownerId,
        updatedBy: ownerId,
        importedAt,
        raw: Object.fromEntries(
          Object.entries(row).map(([key, value]) => [key, toText(value)])
        )
      };
    });

  const totalByDealer = mappedRows.reduce((summary, record) => {
    const key = (record.dealerCode || record.customerCode || record.companyName).toLowerCase().trim();
    summary.set(key, (summary.get(key) || 0) + record.amount);
    return summary;
  }, new Map<string, number>());

  return mappedRows.map((record) => {
    const key = (record.dealerCode || record.customerCode || record.companyName).toLowerCase().trim();
    return {
      ...record,
      totalDueAmount: record.totalDueAmount || totalByDealer.get(key) || record.amount
    };
  });
}

export function parseDealerCodeList(value: string) {
  return value
    .split(/[\n,;]/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function mapSalespersonRows(rows: RawRow[], ownerId: string) {
  const importedAt = new Date().toISOString();

  return rows
    .map(normalizeRow)
    .map((row) => ({
      name: toText(pickValue(row, salespersonFieldCandidates.name)),
      employeeId: toText(pickValue(row, salespersonFieldCandidates.employeeId)),
      email: toText(pickValue(row, salespersonFieldCandidates.email)),
      phoneNumber: toText(pickValue(row, salespersonFieldCandidates.phoneNumber)),
      dealerCodes: parseDealerCodeList(
        toText(pickValue(row, salespersonFieldCandidates.dealerCodes))
      )
    }))
    .filter((entry) => entry.name && entry.email && entry.dealerCodes.length > 0)
    .map<Salesperson>((entry) => ({
      id: randomUUID(),
      ownerId,
      name: entry.name,
      employeeId: entry.employeeId || entry.name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
      email: entry.email,
      phoneNumber: entry.phoneNumber,
      dealerCodes: entry.dealerCodes,
      createdAt: importedAt,
      updatedAt: importedAt
    }));
}
