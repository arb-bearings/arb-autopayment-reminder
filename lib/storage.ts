import { readFile } from "node:fs/promises";
import path from "node:path";
import { getMongoDatabase } from "@/lib/mongodb";
import type { AppDatabase } from "@/lib/types";

const dbPath = path.join(process.cwd(), "data", "app-db.json");
const collectionName = process.env.MONGODB_COLLECTION || "app_state";
const documentId = "primary";

const defaultDatabase: AppDatabase = {
  users: [],
  sessions: [],
  authEvents: [],
  masterContacts: [],
  dueRecords: [],
  reminderRules: [],
  templates: [],
  dispatchSettings: [],
  cashDiscountPolicies: [],
  reminderLogs: [],
  operationPasswords: [],
  salespersons: [],
  auditLogs: []
};

type StoredDatabaseDocument = AppDatabase & {
  _id: string;
  migratedFromFileAt?: string;
  updatedAt: string;
};

function toStringValue(value: unknown) {
  return typeof value === "string" ? value : value === undefined || value === null ? "" : String(value);
}

function toNumberValue(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toBooleanValue(value: unknown, fallback = false) {
  return typeof value === "boolean" ? value : value === "true" ? true : value === "false" ? false : fallback;
}

function normalizeRole(value: unknown, index = 1) {
  return value === "super_admin" || value === "admin" || value === "user"
    ? value
    : index === 0
      ? "super_admin"
      : "user";
}

function normalizeDatabase(input: Partial<AppDatabase> | null | undefined): AppDatabase {
  const source = input || {};

  return {
    users: Array.isArray(source.users)
      ? source.users.map((user, index) => ({
          id: toStringValue(user?.id),
          name: toStringValue(user?.name),
          email: toStringValue(user?.email).toLowerCase(),
          companyName: toStringValue(user?.companyName),
          passwordHash: toStringValue(user?.passwordHash),
          role: normalizeRole(user?.role, index),
          canSendManualReminders: toBooleanValue((user as Record<string, unknown>)?.canSendManualReminders, true),
          createdAt: toStringValue(user?.createdAt),
          updatedAt: toStringValue((user as Record<string, unknown>)?.updatedAt || user?.createdAt)
        }))
      : [],
    sessions: Array.isArray(source.sessions)
      ? source.sessions.map((session) => ({
          token: toStringValue(session?.token),
          userId: toStringValue(session?.userId),
          ipAddress: toStringValue(session?.ipAddress),
          userAgent: toStringValue(session?.userAgent),
          lastSeenAt: toStringValue(session?.lastSeenAt || session?.createdAt),
          createdAt: toStringValue(session?.createdAt),
          expiresAt: toStringValue(session?.expiresAt)
        }))
      : [],
    authEvents: Array.isArray(source.authEvents)
      ? source.authEvents.map((event) => ({
          id: toStringValue(event?.id),
          userId: toStringValue(event?.userId),
          userEmail: toStringValue(event?.userEmail),
          userName: toStringValue(event?.userName),
          companyName: toStringValue(event?.companyName),
          userRole: normalizeRole(event?.userRole),
          type: event?.type === "logout" ? "logout" : "login",
          sessionTokenSuffix: toStringValue(event?.sessionTokenSuffix),
          ipAddress: toStringValue(event?.ipAddress),
          userAgent: toStringValue(event?.userAgent),
          createdAt: toStringValue(event?.createdAt)
        }))
      : [],
    masterContacts: Array.isArray(source.masterContacts)
      ? source.masterContacts.map((contact) => {
          const dealerCode = toStringValue(contact?.dealerCode || contact?.customerCode);
          return {
            id: toStringValue(contact?.id),
            ownerId: toStringValue(contact?.ownerId),
            dealerCode,
            customerCode: dealerCode,
            companyName: toStringValue(contact?.companyName),
            primaryContact: toStringValue(contact?.primaryContact),
            email: toStringValue(contact?.email),
            whatsapp: toStringValue(contact?.whatsapp),
            sms: toStringValue(contact?.sms),
            alternateContact: toStringValue(contact?.alternateContact),
            notes: toStringValue(contact?.notes),
            salespersonId: toStringValue((contact as Record<string, unknown>)?.salespersonId),
            salespersonName: toStringValue((contact as Record<string, unknown>)?.salespersonName),
            salespersonEmail: toStringValue((contact as Record<string, unknown>)?.salespersonEmail),
            importedAt: toStringValue(contact?.importedAt),
            raw:
              contact?.raw && typeof contact.raw === "object"
                ? Object.fromEntries(
                    Object.entries(contact.raw as Record<string, unknown>).map(([key, value]) => [
                      key,
                      toStringValue(value)
                    ])
                  )
                : {}
          };
        })
      : [],
        dueRecords: Array.isArray(source.dueRecords)
      ? source.dueRecords.map((record) => {
          const dealerCode = toStringValue(record?.dealerCode || record?.customerCode);
          const billDate = toStringValue(record?.billDate || record?.invoiceDate);
          return {
            id: toStringValue(record?.id),
            ownerId: toStringValue(record?.ownerId),
            dealerCode,
            customerCode: dealerCode,
            companyName: toStringValue(record?.companyName),
            billDate,
            invoiceNumber: toStringValue(record?.invoiceNumber),
            invoiceDate: billDate,
            dueDate: toStringValue(record?.dueDate),
            openingAmount: toNumberValue((record as Record<string, unknown>)?.openingAmount),
            amount: toNumberValue(record?.amount),
            currency: toStringValue(record?.currency) || "INR",
            overdueDays: toNumberValue((record as Record<string, unknown>)?.overdueDays, 0),
            reference: toStringValue(record?.reference),
            notes: toStringValue(record?.notes),
            matchedContactId: toStringValue(record?.matchedContactId),
            matchedContactName: toStringValue(record?.matchedContactName),
            matchedEmail: toStringValue(record?.matchedEmail),
            matchedWhatsapp: toStringValue(record?.matchedWhatsapp),
            matchedSms: toStringValue(record?.matchedSms),
            contactMatchStatus: record?.contactMatchStatus === "matched" ? "matched" : "missing",
            totalDueAmount: toNumberValue((record as Record<string, unknown>)?.totalDueAmount ?? record?.amount),
            salespersonId: toStringValue((record as Record<string, unknown>)?.salespersonId),
            salespersonName: toStringValue((record as Record<string, unknown>)?.salespersonName),
            salespersonEmail: toStringValue((record as Record<string, unknown>)?.salespersonEmail),
            lastReminderDate: toStringValue((record as Record<string, unknown>)?.lastReminderDate),
            reminderCount: toNumberValue((record as Record<string, unknown>)?.reminderCount),
            lastDispatchStatus: toStringValue((record as Record<string, unknown>)?.lastDispatchStatus),
            createdBy: toStringValue((record as Record<string, unknown>)?.createdBy),
            updatedBy: toStringValue((record as Record<string, unknown>)?.updatedBy),
            importedAt: toStringValue(record?.importedAt),
            raw:
              record?.raw && typeof record.raw === "object"
                ? Object.fromEntries(
                    Object.entries(record.raw as Record<string, unknown>).map(([key, value]) => [
                      key,
                      toStringValue(value)
                    ])
                  )
                : {}
          };
        })
      : [],
    reminderRules: Array.isArray(source.reminderRules)
      ? source.reminderRules.map((rule) => {
          const legacyRule = rule as Record<string, unknown>;
          return ({
          id: toStringValue(rule?.id),
          ownerId: toStringValue(rule?.ownerId),
          name: toStringValue(rule?.name),
          triggerDay: toNumberValue(rule?.triggerDay ?? legacyRule.daysBeforeDue),
          enabled: toBooleanValue(rule?.enabled, true),
          autoSend: toBooleanValue(rule?.autoSend, false),
          channels: {
            email: toBooleanValue(rule?.channels?.email, true),
            whatsapp: toBooleanValue(rule?.channels?.whatsapp, true),
            sms: toBooleanValue(rule?.channels?.sms, false)
          },
          templateId: toStringValue(rule?.templateId),
          createdAt: toStringValue(rule?.createdAt),
          updatedAt: toStringValue(rule?.updatedAt)
          });
        })
      : [],
    templates: Array.isArray(source.templates)
      ? source.templates.map((template) => ({
          id: toStringValue(template?.id),
          ownerId: toStringValue(template?.ownerId),
          ruleId: toStringValue(template?.ruleId),
          name: toStringValue(template?.name),
          emailSubject: toStringValue(template?.emailSubject),
          emailBody: toStringValue(template?.emailBody),
          whatsappBody: toStringValue(template?.whatsappBody),
          smsBody: toStringValue(template?.smsBody),
          updatedAt: toStringValue(template?.updatedAt)
        }))
      : [],
    dispatchSettings: Array.isArray(source.dispatchSettings)
      ? source.dispatchSettings.map((settings) => ({
          ownerId: toStringValue(settings?.ownerId),
          smtpHost: toStringValue(settings?.smtpHost),
          smtpPort: toNumberValue(settings?.smtpPort, 587),
          smtpSecure: toBooleanValue(settings?.smtpSecure, false),
          smtpUser: toStringValue(settings?.smtpUser),
          smtpPass: toStringValue(settings?.smtpPass),
          senderEmail: toStringValue(settings?.senderEmail || settings?.smtpFrom),
          senderMobileNumber: toStringValue(settings?.senderMobileNumber),
          smtpFrom: toStringValue(settings?.smtpFrom || settings?.senderEmail),
          smsProviderName: toStringValue(settings?.smsProviderName) || "Twilio",
          smsApiKey: toStringValue(settings?.smsApiKey),
          smsApiSecret: toStringValue(settings?.smsApiSecret),
          smsAccountSid: toStringValue(settings?.smsAccountSid),
          smsAuthToken: toStringValue(settings?.smsAuthToken),
          smsFromNumber: toStringValue(settings?.smsFromNumber),
          smsSenderId: toStringValue(settings?.smsSenderId),
          whatsappProviderName: toStringValue(settings?.whatsappProviderName) || "Interakt",
          whatsappApiKey: toStringValue(settings?.whatsappApiKey),
          whatsappApiSecret: toStringValue(settings?.whatsappApiSecret),
          whatsappAccountSid: toStringValue(settings?.whatsappAccountSid),
          whatsappAuthToken: toStringValue(settings?.whatsappAuthToken),
          whatsappFromNumber: toStringValue(settings?.whatsappFromNumber),
          whatsappWebhookUrl: toStringValue(settings?.whatsappWebhookUrl),
          futureIntegrationNotes: toStringValue(settings?.futureIntegrationNotes),
          reportRecipients: Array.isArray((settings as Record<string, unknown>)?.reportRecipients)
            ? ((settings as Record<string, unknown>)?.reportRecipients as unknown[]).map(toStringValue).filter(Boolean)
            : [],
          reportFrequency:
            (settings as Record<string, unknown>)?.reportFrequency === "weekly" ||
            (settings as Record<string, unknown>)?.reportFrequency === "monthly" ||
            (settings as Record<string, unknown>)?.reportFrequency === "manual"
              ? ((settings as Record<string, unknown>)?.reportFrequency as "weekly" | "monthly" | "manual")
              : "daily",
          reportTime: toStringValue((settings as Record<string, unknown>)?.reportTime) || "18:00",
          updatedAt: toStringValue(settings?.updatedAt)
        }))
      : [],
    cashDiscountPolicies: Array.isArray(source.cashDiscountPolicies)
      ? source.cashDiscountPolicies.map((policy) => ({
          id: toStringValue(policy?.id),
          ownerId: toStringValue(policy?.ownerId),
          name: toStringValue(policy?.name),
          paymentWindowDays: toNumberValue(policy?.paymentWindowDays),
          discountPercent: toNumberValue(policy?.discountPercent),
          enabled: toBooleanValue(policy?.enabled, true),
          description: toStringValue(policy?.description),
          createdAt: toStringValue(policy?.createdAt),
          updatedAt: toStringValue(policy?.updatedAt)
        }))
      : [],
    reminderLogs: Array.isArray(source.reminderLogs)
      ? source.reminderLogs.map((log) => {
          const rawStatus = (log as Record<string, unknown>)?.status;

          return {
            id: toStringValue(log?.id),
            ownerId: toStringValue(log?.ownerId),
            dueId: toStringValue(log?.dueId),
            dedupeKey: toStringValue(log?.dedupeKey),
            contactId: toStringValue(log?.contactId),
            ruleId: toStringValue(log?.ruleId),
            templateId: toStringValue(log?.templateId),
            dealerCode: toStringValue(log?.dealerCode),
            invoiceNumber: toStringValue(log?.invoiceNumber),
            reminderDay: toNumberValue(log?.reminderDay),
            billAgeDays: toNumberValue(log?.billAgeDays),
            cdEligible: toBooleanValue(log?.cdEligible, false),
            cdPolicyId: toStringValue(log?.cdPolicyId),
            cdDiscountPercent: toNumberValue(log?.cdDiscountPercent),
            cdReason: toStringValue(log?.cdReason),
            channel:
              log?.channel === "sms" || log?.channel === "whatsapp" ? log.channel : "email",
            recipient: toStringValue(log?.recipient),
            scheduledFor: toStringValue(log?.scheduledFor),
            status:
              rawStatus === "sent" || rawStatus === "failed"
                ? rawStatus
                : rawStatus === "simulated"
                  ? "sent"
                  : "pending",
            subject: toStringValue(log?.subject),
            content: toStringValue(log?.content),
            failureReason: toStringValue(log?.failureReason),
            sentAt: toStringValue(log?.sentAt),
            createdAt: toStringValue(log?.createdAt)
          };
        })
      : []
    ,
    operationPasswords: Array.isArray(source.operationPasswords)
      ? source.operationPasswords.map((entry) => ({
          ownerId: toStringValue(entry?.ownerId),
          key:
            entry?.key === "master_upload" ||
            entry?.key === "due_upload" ||
            entry?.key === "dispatch" ||
            entry?.key === "report_generation" ||
            entry?.key === "admin_settings"
              ? entry.key
              : "admin_settings",
          label: toStringValue(entry?.label),
          passwordHash: toStringValue(entry?.passwordHash),
          updatedAt: toStringValue(entry?.updatedAt),
          updatedBy: toStringValue(entry?.updatedBy)
        }))
      : [],
    salespersons: Array.isArray(source.salespersons)
      ? source.salespersons.map((entry) => ({
          id: toStringValue(entry?.id),
          ownerId: toStringValue(entry?.ownerId),
          name: toStringValue(entry?.name),
          employeeId: toStringValue(entry?.employeeId),
          email: toStringValue(entry?.email),
          phoneNumber: toStringValue(entry?.phoneNumber),
          dealerCodes: Array.isArray(entry?.dealerCodes)
            ? entry.dealerCodes.map(toStringValue).filter(Boolean)
            : [],
          createdAt: toStringValue(entry?.createdAt),
          updatedAt: toStringValue(entry?.updatedAt)
        }))
      : [],
    auditLogs: Array.isArray(source.auditLogs)
      ? source.auditLogs.map((entry) => ({
          id: toStringValue(entry?.id),
          ownerId: toStringValue(entry?.ownerId),
          timestamp: toStringValue(entry?.timestamp),
          userId: toStringValue(entry?.userId),
          userName: toStringValue(entry?.userName),
          userEmail: toStringValue(entry?.userEmail),
          role: normalizeRole(entry?.role),
          action: toStringValue(entry?.action),
          status: entry?.status === "failed" ? "failed" : "success",
          details: toStringValue(entry?.details)
        }))
      : []
  };
}

async function readLegacyFileDatabase() {
  try {
    const raw = await readFile(dbPath, "utf8");
    return JSON.parse(raw) as AppDatabase;
  } catch {
    return null;
  }
}

async function ensureDatabaseDocument() {
  const database = await getMongoDatabase();
  const collection = database.collection<StoredDatabaseDocument>(collectionName);
  const existing = await collection.findOne({ _id: documentId });

  if (existing) {
    return collection;
  }

  const legacyDatabase = await readLegacyFileDatabase();

  await collection.insertOne({
    _id: documentId,
    ...(legacyDatabase || defaultDatabase),
    migratedFromFileAt: legacyDatabase ? new Date().toISOString() : undefined,
    updatedAt: new Date().toISOString()
  });

  return collection;
}

// ─── Template Migration ───────────────────────────────────────────────────────
// Runs automatically on every readDatabase() call.
// Detects old default template format and replaces with new format.
// Idempotent: new-format templates are never re-migrated.

function buildMigratedEmailBody(triggerDay: number): string {
  const base = `INVOICE {{invoiceNumber}}\n\nDear {{contactName}},\n\n`;
  const footer = `\n\nThank you for your attention in the matter.\n\nRegards,\n{{senderCompany}}`;

  switch (triggerDay) {
    case 30:
    case 45:
      return base +
        `Please note that the payment against the Invoice {{invoiceNumber}} Dated {{billDate}} of amount Rs. {{amount}} will become due within the next 5 days.\n\nSo kindly arrange to remit us the payment by/before the due date{{cdBenefitSuffix}}.` +
        footer;
    case 60:
      return base +
        `Please note that the payment against the Invoice {{invoiceNumber}} Dated {{billDate}} of amount Rs. {{amount}} will become due within the next 5 days.\n\nSo kindly arrange to remit us the payment by/before the due date.` +
        footer;
    case 75:
      return base +
        `The payment against the Invoice {{invoiceNumber}} Dated {{billDate}} of amount Rs. {{amount}} is overdue now.\n\nSo kindly arrange to remit us the payment at earliest possible.` +
        footer;
    case 80:
      return base +
        `The payment against the Invoice {{invoiceNumber}} Dated {{billDate}} of amount Rs. {{amount}} is overdue now.\n\nSo kindly arrange to remit us the payment at urgent basis.` +
        footer;
    case 85:
      return base +
        `The payment against the Invoice {{invoiceNumber}} Dated {{billDate}} of amount Rs. {{amount}} is overdue now.\n\nSo kindly arrange to remit us the payment at most urgent basis.` +
        footer;
    case 90:
      return `INVOICE {{invoiceNumber}}\n\nDear {{contactName}},\n\nThe payment against the Invoice {{invoiceNumber}} Dated {{billDate}} of amount Rs. {{amount}} is significantly overdue.\n\nSo kindly arrange to remit us the payment within the 5 days. If the payment remains pending beyond 90 days from the date of invoice, the future invoicing will be stopped.\n\nTo avoid any disruption, please ensure to clear this outstanding immediately.\n\nThank you for your prompt corporation in the matter.\n\nRegards,\n{{senderCompany}}`;
    default:
      return ""; // Unknown trigger day — skip migration
  }
}

function buildMigratedEmailSubject(triggerDay: number): string {
  if (triggerDay <= 60) return `Outstanding: Invoice {{invoiceNumber}} due in 5 days`;
  if (triggerDay === 90) return `Critical: Invoice {{invoiceNumber}} — Future Invoicing at Risk`;
  return `Overdue: Invoice {{invoiceNumber}} — Immediate Attention Required`;
}

function buildMigratedWhatsappBody(triggerDay: number): string {
  switch (triggerDay) {
    case 30:
    case 45:
      return `INVOICE {{invoiceNumber}} | Dear {{contactName}}, payment for Invoice {{invoiceNumber}} Dated {{billDate}} of Rs. {{amount}} is due in 5 days. Pay before due date{{cdBenefitSuffix}}. — {{senderCompany}}`;
    case 60:
      return `INVOICE {{invoiceNumber}} | Dear {{contactName}}, payment for Invoice {{invoiceNumber}} Dated {{billDate}} of Rs. {{amount}} is due in 5 days. Please pay before the due date. — {{senderCompany}}`;
    case 75:
      return `INVOICE {{invoiceNumber}} | Dear {{contactName}}, Invoice {{invoiceNumber}} Dated {{billDate}} of Rs. {{amount}} is overdue. Please pay at earliest possible. — {{senderCompany}}`;
    case 80:
      return `INVOICE {{invoiceNumber}} | Dear {{contactName}}, Invoice {{invoiceNumber}} Dated {{billDate}} of Rs. {{amount}} is overdue. Please arrange payment on urgent basis. — {{senderCompany}}`;
    case 85:
      return `INVOICE {{invoiceNumber}} | Dear {{contactName}}, Invoice {{invoiceNumber}} Dated {{billDate}} of Rs. {{amount}} is overdue. Arrange payment on MOST urgent basis. — {{senderCompany}}`;
    case 90:
      return `INVOICE {{invoiceNumber}} | Dear {{contactName}}, Invoice {{invoiceNumber}} Dated {{billDate}} of Rs. {{amount}} is significantly overdue. Pay within 5 days or future invoicing will be stopped. — {{senderCompany}}`;
    default:
      return ""; // Unknown trigger day — skip migration
  }
}

function migrateTemplates(db: AppDatabase): AppDatabase {
  // Build a map from templateId → rule so we can look up triggerDay per template
  const ruleByTemplateId = new Map(db.reminderRules.map((rule) => [rule.templateId, rule]));

  const knownTriggerDays = new Set([30, 45, 60, 75, 80, 85, 90]);

  const migratedTemplates = db.templates.map((template) => {
    const rule = ruleByTemplateId.get(template.id);
    if (!rule) return template; // No linked rule — leave untouched

    // Only apply canonical body for known standard trigger days.
    // Unknown trigger days (custom rules) are left as-is.
    if (!knownTriggerDays.has(rule.triggerDay)) return template;

    const newEmailBody = buildMigratedEmailBody(rule.triggerDay);
    const newWhatsappBody = buildMigratedWhatsappBody(rule.triggerDay);
    if (!newEmailBody) return template;

    return {
      ...template,
      emailSubject: buildMigratedEmailSubject(rule.triggerDay),
      emailBody: newEmailBody,
      whatsappBody: newWhatsappBody || template.whatsappBody,
      smsBody: newWhatsappBody || template.smsBody
    };
  });

  return { ...db, templates: migratedTemplates };
}

export async function readDatabase() {
  const collection = await ensureDatabaseDocument();
  const document = await collection.findOne({ _id: documentId });

  if (!document) {
    throw new Error("MongoDB app state document was not found.");
  }

  const { _id, migratedFromFileAt, updatedAt, ...appDatabase } = document;
  // Normalize then apply auto-migration for old-format templates
  return migrateTemplates(normalizeDatabase(appDatabase));
}

export async function writeDatabase(database: AppDatabase) {
  const collection = await ensureDatabaseDocument();
  const normalized = normalizeDatabase(database);

  await collection.updateOne(
    { _id: documentId },
    {
      $set: {
        ...normalized,
        updatedAt: new Date().toISOString()
      }
    },
    { upsert: true }
  );
}

export async function updateDatabase<T>(updater: (database: AppDatabase) => T | Promise<T>) {
  const database = await readDatabase();
  const result = await updater(database);
  await writeDatabase(database);
  return result;
}
