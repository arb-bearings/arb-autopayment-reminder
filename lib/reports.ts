import nodemailer from "nodemailer";
import {
  filterSharedCompanyRecords,
  getCompanyWorkspaceContextForUser
} from "@/lib/company-workspace";
import { resolveDispatchSettings } from "@/lib/dispatch-settings";
import { readDatabase } from "@/lib/storage";
import type { AppDatabase, DispatchSettings, DueRecord, ReminderLog, User, ReminderRule } from "@/lib/types";
import { daysBetween, formatCurrency, formatDate, getBillAgeDays } from "@/lib/utils";
import { generateSalespersonSummaryPDF } from "@/lib/pdf-generator";
import { uploadPdfToGoogleDrive } from "@/services/googleDriveService";
import { sendSalespersonSummaryWhatsapp } from "@/services/interaktService";

type ReportUser = Pick<User, "id" | "companyName" | "name" | "email" | "role">;

function getDay(value: string) {
  return value ? value.slice(0, 10) : "";
}

function logDay(log: ReminderLog) {
  return getDay(log.sentAt || log.scheduledFor || log.createdAt);
}

function groupBy<T>(items: T[], getKey: (item: T) => string) {
  return items.reduce((summary, item) => {
    const key = getKey(item) || "Unassigned";
    const entries = summary.get(key) || [];
    entries.push(item);
    summary.set(key, entries);
    return summary;
  }, new Map<string, T[]>());
}

function getSettings(database: AppDatabase, user: ReportUser) {
  const workspace = getCompanyWorkspaceContextForUser(database, user);
  return resolveDispatchSettings(
    database.dispatchSettings.find((entry) => entry.ownerId === workspace.configOwnerId) ?? {
      ownerId: workspace.configOwnerId
    }
  );
}

function escapeHtml(value: string | number) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

async function sendReportEmail(
  settings: DispatchSettings,
  to: string[],
  subject: string,
  text: string,
  html?: string,
  attachments?: any[]
) {
  if (to.length === 0) {
    return { skipped: true, recipientCount: 0 };
  }

  if (!settings.smtpHost || !(settings.senderEmail || settings.smtpFrom)) {
    throw new Error("SMTP settings are incomplete for report email.");
  }

  const transporter = nodemailer.createTransport({
    host: settings.smtpHost,
    port: settings.smtpPort,
    secure: settings.smtpSecure,
    connectionTimeout: 10000, // 10 seconds
    greetingTimeout: 10000,
    socketTimeout: 10000,
    auth: settings.smtpUser
      ? {
          user: settings.smtpUser,
          pass: settings.smtpPass
        }
      : undefined
  });

  await transporter.sendMail({
    from: settings.senderEmail || settings.smtpFrom,
    to,
    subject,
    text,
    html,
    attachments
  });

  return { skipped: false, recipientCount: to.length };
}

function buildMetricCard(label: string, value: string | number, accent = "#0f766e") {
  return `
    <td style="width:25%;padding:8px;vertical-align:top;">
      <div style="border:1px solid #e5e7eb;border-radius:8px;padding:14px;background:#fafafa;">
        <div style="font-size:12px;color:#6b7280;font-weight:700;text-transform:uppercase;letter-spacing:.03em;">${escapeHtml(label)}</div>
        <div style="font-size:22px;font-weight:800;margin-top:6px;color:${accent};">${escapeHtml(value)}</div>
      </div>
    </td>
  `;
}

function buildSectionTitle(title: string) {
  return `<h2 style="font-size:18px;line-height:1.3;margin:24px 0 10px;color:#111827;font-weight:800;">${escapeHtml(title)}</h2>`;
}

function getOverdueDays(due: DueRecord, reportDate: Date) {
  const age = getBillAgeDays(due.billDate || due.invoiceDate, reportDate);
  if (age === null) {
    return 0;
  }
  return Math.max(0, age - 60);
}

function buildDailyActivityReportHtml(input: {
  day: string;
  dues: DueRecord[];
  todayLogs: ReminderLog[];
  dealerGroups: Map<string, DueRecord[]>;
  salespersonGroups: Map<string, DueRecord[]>;
  failedLogs: ReminderLog[];
  topOutstanding: Array<{ dealer: string; invoiceCount: number; amount: number }>;
  topOverdue: Array<{
    dealer: string;
    invoiceCount: number;
    amount: number;
    oldestDueDate: string;
    maxOverdueDays: number;
  }>;
  rules?: ReminderRule[];
}) {
  const {
    day,
    dues,
    todayLogs,
    dealerGroups,
    salespersonGroups,
    failedLogs,
    topOutstanding,
    topOverdue,
    rules
  } = input;
  const reportDate = new Date(day);
  const currency = dues[0]?.currency || "INR";

  const totalOutstanding = formatCurrency(
    dues.reduce((sum, entry) => sum + entry.amount, 0),
    currency
  );

  // Aging bucket definitions (decreasing order) — label shown on left card
  const agingBuckets = [
    { dealerLabel: "DEALERS MORE THAN 180 DAYS", min: 181, max: Infinity },
    { dealerLabel: "DEALERS BETWEEN 120 \u2013 180 DAYS", min: 121, max: 180 },
    { dealerLabel: "DEALERS BETWEEN 90 \u2013 120 DAYS", min: 91, max: 120 },
    { dealerLabel: "DEALERS IN 90 DAYS", min: 90, max: 90 },
    { dealerLabel: "DEALERS IN 75 DAYS", min: 75, max: 89 },
    { dealerLabel: "DEALERS IN 60 DAYS", min: 60, max: 74 },
    { dealerLabel: "DEALERS IN 45 DAYS", min: 45, max: 59 },
    { dealerLabel: "DEALERS IN 30 DAYS", min: 30, max: 44 },
  ];

  // Returns unique dealer count, total outstanding, and reminders sent today for a bucket
  const getBucketInfo = (minAge: number, maxAge: number) => {
    const matchingRules = (rules || []).filter(r => r.triggerDay >= minAge && r.triggerDay <= maxAge);
    const ruleIds = matchingRules.map(r => r.id);

    const sentTodayLogs = todayLogs.filter(
      (log) => log.status === "sent" && (ruleIds.includes(log.ruleId) || (log.reminderDay >= minAge && log.reminderDay <= maxAge))
    );
    const remindersSentToday = sentTodayLogs.length;

    const matchingDueIds = sentTodayLogs.map(log => log.dueId).filter(Boolean);
    const bucketDues = dues.filter(due => matchingDueIds.includes(due.id));
    const amount = bucketDues.reduce((sum, entry) => sum + entry.amount, 0);

    const ruleDealerCodes = Array.from(new Set(sentTodayLogs.map(log => log.dealerCode).filter(Boolean)));
    const dealerCount = ruleDealerCodes.length;

    return { amount, dealerCount, remindersSentToday };
  };

  const bucketCardRows = agingBuckets.map((b) => {
    const info = getBucketInfo(b.min, b.max);
    if (info.remindersSentToday === 0) {
      return "";
    }
    return `
      <tr>
        <td style="width:33.33%;padding:4px 5px;vertical-align:top;">
          <div style="border:1px solid #e5e7eb;border-radius:8px;padding:14px 16px;background:#ffffff;">
            <div style="font-size:11px;color:#6b7280;font-weight:800;text-transform:uppercase;letter-spacing:.04em;line-height:1.4;">${escapeHtml(b.dealerLabel)}</div>
            <div style="font-size:26px;font-weight:800;margin-top:8px;color:#111827;">${escapeHtml(info.dealerCount)}</div>
          </div>
        </td>
        <td style="width:33.33%;padding:4px 5px;vertical-align:top;">
          <div style="border:1px solid #e5e7eb;border-radius:8px;padding:14px 16px;background:#ffffff;">
            <div style="font-size:11px;color:#6b7280;font-weight:800;text-transform:uppercase;letter-spacing:.04em;line-height:1.4;">TOTAL OUTSTANDING</div>
            <div style="font-size:26px;font-weight:800;margin-top:8px;color:#111827;">${escapeHtml(formatCurrency(info.amount, currency))}</div>
          </div>
        </td>
        <td style="width:33.33%;padding:4px 5px;vertical-align:top;">
          <div style="border:1px solid #e5e7eb;border-radius:8px;padding:14px 16px;background:#ffffff;">
            <div style="font-size:11px;color:#6b7280;font-weight:800;text-transform:uppercase;letter-spacing:.04em;line-height:1.4;">REMINDERS SENT TODAY</div>
            <div style="font-size:26px;font-weight:800;margin-top:8px;color:#111827;">${escapeHtml(info.remindersSentToday)}</div>
          </div>
        </td>
      </tr>
    `;
  }).join("");

  const topOutstandingRows = topOutstanding.map((entry, index) => `
    <tr>
      <td style="padding:11px 13px;border-bottom:1px solid #e5e7eb;color:#6b7280;font-weight:700;">${escapeHtml(index + 1)}</td>
      <td style="padding:11px 13px;border-bottom:1px solid #e5e7eb;font-weight:700;color:#111827;">${escapeHtml(entry.dealer)}</td>
      <td style="padding:11px 13px;border-bottom:1px solid #e5e7eb;color:#374151;">${escapeHtml(entry.invoiceCount)}</td>
      <td style="padding:11px 13px;border-bottom:1px solid #e5e7eb;text-align:right;font-weight:700;color:#111827;">${escapeHtml(formatCurrency(entry.amount, currency))}</td>
    </tr>
  `).join("");

  const topOverdueRows = topOverdue.map((entry, index) => `
    <tr>
      <td style="padding:11px 13px;border-bottom:1px solid #e5e7eb;color:#6b7280;font-weight:700;">${escapeHtml(index + 1)}</td>
      <td style="padding:11px 13px;border-bottom:1px solid #e5e7eb;font-weight:700;color:#111827;">${escapeHtml(entry.dealer)}</td>
      <td style="padding:11px 13px;border-bottom:1px solid #e5e7eb;color:#374151;">${escapeHtml(entry.invoiceCount)}</td>
      <td style="padding:11px 13px;border-bottom:1px solid #e5e7eb;color:#991b1b;font-weight:700;">${escapeHtml(`${entry.maxOverdueDays} days`)}</td>
      <td style="padding:11px 13px;border-bottom:1px solid #e5e7eb;color:#374151;">${escapeHtml(entry.oldestDueDate ? formatDate(entry.oldestDueDate) : "Not available")}</td>
      <td style="padding:11px 13px;border-bottom:1px solid #e5e7eb;text-align:right;font-weight:700;color:#111827;">${escapeHtml(formatCurrency(entry.amount, currency))}</td>
    </tr>
  `).join("");

  const salespersonRows = Array.from(salespersonGroups.entries()).map(([salesperson, records]) => {
    const amount = records.reduce((sum, entry) => sum + entry.amount, 0);
    return `
      <tr>
        <td style="padding:11px 13px;border-bottom:1px solid #e5e7eb;font-weight:700;color:#111827;">${escapeHtml(salesperson)}</td>
        <td style="padding:11px 13px;border-bottom:1px solid #e5e7eb;color:#374151;">${escapeHtml(records.length)}</td>
        <td style="padding:11px 13px;border-bottom:1px solid #e5e7eb;text-align:right;font-weight:700;color:#111827;">${escapeHtml(formatCurrency(amount, records[0]?.currency || currency))}</td>
      </tr>
    `;
  }).join("");

  const table = (headers: string[], rows: string, emptyText = "No records found.") => `
    <table width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;">
      <thead>
        <tr style="background:#f9fafb;">
          ${headers.map((header, index) => `
            <th align="${index === headers.length - 1 ? "right" : "left"}" style="padding:12px 13px;border-bottom:1px solid #e5e7eb;color:#374151;font-size:12px;text-transform:uppercase;letter-spacing:.03em;font-weight:800;">${escapeHtml(header)}</th>
          `).join("")}
        </tr>
      </thead>
      <tbody>
        ${rows || `<tr><td colspan="${headers.length}" style="padding:14px;color:#6b7280;">${escapeHtml(emptyText)}</td></tr>`}
      </tbody>
    </table>
  `;

  return `
    <!doctype html>
    <html>
      <body style="margin:0;background:#f3f4f6;font-family:Arial,Helvetica,sans-serif;color:#111827;">
        <div style="max-width:760px;margin:0 auto;padding:28px 18px;">
          <div style="background:#ffffff;border:1px solid #e5e7eb;border-radius:10px;overflow:hidden;">

            <!-- Header -->
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;background:#111827;">
              <tr>
                <td style="padding:24px 26px 22px;">
                  <div style="font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:#9ca3af;font-weight:700;">Daily Activity Report</div>
                  <div style="margin:6px 0 0;font-size:30px;font-weight:800;color:#ffffff;line-height:1.1;">${escapeHtml(day)}</div>
                </td>
                <td style="padding:24px 26px 22px;text-align:right;vertical-align:middle;">
                  <svg width="38" height="32" viewBox="0 0 38 32" fill="none" xmlns="http://www.w3.org/2000/svg" style="opacity:0.4;">
                    <rect x="0" y="20" width="10" height="12" fill="white" rx="2"/>
                    <rect x="14" y="11" width="10" height="21" fill="white" rx="2"/>
                    <rect x="28" y="0" width="10" height="32" fill="white" rx="2"/>
                  </svg>
                </td>
              </tr>
            </table>

            <!-- Card grid -->
            <div style="padding:14px 16px 24px;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;">
                <!-- Row 1: Total Dealers | Total Outstanding | Reminders Sent Today -->
                <tr>
                  <td style="width:33.33%;padding:4px 5px;vertical-align:top;">
                    <div style="border:1px solid #e5e7eb;border-radius:8px;padding:14px 16px;background:#ffffff;">
                      <div style="font-size:11px;color:#6b7280;font-weight:800;text-transform:uppercase;letter-spacing:.04em;line-height:1.4;">TOTAL DEALERS</div>
                      <div style="font-size:26px;font-weight:800;margin-top:8px;color:#111827;">${escapeHtml(dealerGroups.size)}</div>
                    </div>
                  </td>
                  <td style="width:33.33%;padding:4px 5px;vertical-align:top;">
                    <div style="border:1px solid #e5e7eb;border-radius:8px;padding:14px 16px;background:#ffffff;">
                      <div style="font-size:11px;color:#6b7280;font-weight:800;text-transform:uppercase;letter-spacing:.04em;line-height:1.4;">TOTAL OUTSTANDING</div>
                      <div style="font-size:26px;font-weight:800;margin-top:8px;color:#111827;">${escapeHtml(totalOutstanding)}</div>
                    </div>
                  </td>
                  <td style="width:33.33%;padding:4px 5px;vertical-align:top;">
                    <div style="border:1px solid #e5e7eb;border-radius:8px;padding:14px 16px;background:#ffffff;">
                      <div style="font-size:11px;color:#6b7280;font-weight:800;text-transform:uppercase;letter-spacing:.04em;line-height:1.4;">REMINDERS SENT TODAY</div>
                      <div style="font-size:26px;font-weight:800;margin-top:8px;color:#111827;">${escapeHtml(todayLogs.filter((entry) => entry.status === "sent").length)}</div>
                    </div>
                  </td>
                </tr>
                <!-- Per-bucket rows -->
                ${bucketCardRows}
              </table>

              <!-- Top Dealers by Outstanding -->
              <h2 style="font-size:18px;margin:24px 0 12px;color:#111827;font-weight:800;">Top Dealers by Outstanding (Amount)</h2>
              <table width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;margin-bottom:24px;">
                <thead>
                  <tr style="background:#f9fafb;">
                    <th align="left" style="padding:12px 13px;border-bottom:1px solid #e5e7eb;color:#374151;font-size:12px;text-transform:uppercase;letter-spacing:.03em;font-weight:800;">Rank</th>
                    <th align="left" style="padding:12px 13px;border-bottom:1px solid #e5e7eb;color:#374151;font-size:12px;text-transform:uppercase;letter-spacing:.03em;font-weight:800;">Dealer</th>
                    <th align="left" style="padding:12px 13px;border-bottom:1px solid #e5e7eb;color:#374151;font-size:12px;text-transform:uppercase;letter-spacing:.03em;font-weight:800;">Invoices</th>
                    <th align="right" style="padding:12px 13px;border-bottom:1px solid #e5e7eb;color:#374151;font-size:12px;text-transform:uppercase;letter-spacing:.03em;font-weight:800;">Outstanding</th>
                  </tr>
                </thead>
                <tbody>
                  ${topOutstandingRows || `<tr><td colspan="4" style="padding:14px;color:#6b7280;">No records found.</td></tr>`}
                </tbody>
              </table>

              <!-- Top Dealers by Overdue Days -->
              <h2 style="font-size:18px;margin:24px 0 12px;color:#111827;font-weight:800;">Top Dealers by Overdue Days</h2>
              ${table(["Rank", "Dealer", "Invoices", "Max Overdue", "Oldest Due", "Outstanding"], topOverdueRows, "No overdue dealers.")}

              <!-- Salesperson-wise Summary -->
              <h2 style="font-size:18px;margin:24px 0 12px;color:#111827;font-weight:800;">Salesperson-wise Summary</h2>
              ${table(["Salesperson", "Invoices", "Outstanding"], salespersonRows)}
            </div>

          </div>
        </div>
      </body>
    </html>
  `;
}

export async function buildDailyActivityReport(user: ReportUser, reportDate = new Date()) {
  const database = await readDatabase();
  const workspace = getCompanyWorkspaceContextForUser(database, user);
  const day = reportDate.toISOString().slice(0, 10);
  const logs = filterSharedCompanyRecords(database.reminderLogs, workspace.sharedOwnerIds);
  const todayLogs = logs.filter((entry) => logDay(entry) === day);
  const todayDueIds = new Set(todayLogs.map((log) => log.dueId).filter(Boolean));
  const dues = filterSharedCompanyRecords(database.dueRecords, workspace.sharedOwnerIds)
    .filter((due) => todayDueIds.has(due.id));
  const dealerGroups = groupBy(dues, (entry) => entry.companyName || entry.dealerCode);
  const salespersonGroups = groupBy(dues, (entry) => entry.salespersonName || entry.salespersonEmail);
  const failedLogs = todayLogs.filter((entry) => entry.status === "failed");
  const topOutstanding = Array.from(dealerGroups.entries())
    .map(([dealer, records]) => ({
      dealer,
      invoiceCount: records.length,
      amount: records.reduce((sum, entry) => sum + entry.amount, 0)
    }))
    .sort((left, right) => right.amount - left.amount)
    .slice(0, 10);
  const topOverdue = Array.from(dealerGroups.entries())
    .map(([dealer, records]) => {
      const overdueDays = records.map((entry) => getOverdueDays(entry, reportDate));
      const datedRecords = records
        .filter((entry) => entry.dueDate && !Number.isNaN(new Date(entry.dueDate).getTime()))
        .sort((left, right) => left.dueDate.localeCompare(right.dueDate));

      return {
        dealer,
        invoiceCount: records.length,
        amount: records.reduce((sum, entry) => sum + entry.amount, 0),
        oldestDueDate: datedRecords[0]?.dueDate || "",
        maxOverdueDays: Math.max(0, ...overdueDays)
      };
    })
    .filter((entry) => entry.maxOverdueDays > 0)
    .sort((left, right) => right.maxOverdueDays - left.maxOverdueDays || right.amount - left.amount)
    .slice(0, 10);
  const overdueDues = dues.filter((entry) => getOverdueDays(entry, reportDate) > 0);
  const sentLogs = todayLogs.filter((entry) => entry.status === "sent");

  const lines = [
    `Daily Activity Report - ${day}`,
    "",
    `Total Dealers Processed: ${dealerGroups.size}`,
    `Total Companies Processed: ${new Set(dues.map((entry) => entry.companyName).filter(Boolean)).size}`,
    `Total Due Records: ${dues.length}`,
    `Total Reminders Sent: ${sentLogs.length}`,
    `WhatsApp Success Count: ${todayLogs.filter((entry) => entry.channel === "whatsapp" && entry.status === "sent").length}`,
    `WhatsApp Failure Count: ${todayLogs.filter((entry) => entry.channel === "whatsapp" && entry.status === "failed").length}`,
    `Email Success Count: ${todayLogs.filter((entry) => entry.channel === "email" && entry.status === "sent").length}`,
    `Email Failure Count: ${todayLogs.filter((entry) => entry.channel === "email" && entry.status === "failed").length}`,
    `Total Outstanding Amount: ${formatCurrency(dues.reduce((sum, entry) => sum + entry.amount, 0), dues[0]?.currency || "INR")}`,
    `Overdue Invoices: ${overdueDues.length}`,
    `Overdue Outstanding Amount: ${formatCurrency(overdueDues.reduce((sum, entry) => sum + entry.amount, 0), dues[0]?.currency || "INR")}`,
    "",
    "Salesperson-wise Summary:",
    ...Array.from(salespersonGroups.entries()).map(([salesperson, records]) => `${salesperson}: ${records.length} invoices, ${formatCurrency(records.reduce((sum, entry) => sum + entry.amount, 0), records[0]?.currency || "INR")}`),
    "",
    "Top Outstanding Dealers:",
    ...topOutstanding.map((entry) => `${entry.dealer}: ${entry.invoiceCount} invoices, ${formatCurrency(entry.amount, dues[0]?.currency || "INR")}`),
    "",
    "Top Dealers by Overdue Days:",
    ...(topOverdue.length === 0
      ? ["None"]
      : topOverdue.map((entry) => `${entry.dealer}: ${entry.maxOverdueDays} days overdue, ${entry.invoiceCount} invoices, oldest due ${entry.oldestDueDate ? formatDate(entry.oldestDueDate) : "Not available"}, ${formatCurrency(entry.amount, dues[0]?.currency || "INR")}`)),
  ];

  return {
    date: day,
    settings: getSettings(database, user),
    text: lines.join("\n"),
    html: buildDailyActivityReportHtml({
      day,
      dues,
      todayLogs,
      dealerGroups,
      salespersonGroups,
      failedLogs,
      topOutstanding,
      topOverdue,
      rules: database.reminderRules
    })
  };
}

export async function sendDailyActivityReport(user: ReportUser, reportDate = new Date()) {
  const report = await buildDailyActivityReport(user, reportDate);
  const recipients = report.settings.reportRecipients.filter(Boolean);
  const result = await sendReportEmail(
    report.settings,
    recipients,
    `Daily Activity Report - ${report.date}`,
    report.text,
    report.html
  );

  return { ...result, report };
}

export function buildSalespersonSummaryText(name: string, dues: DueRecord[], sentLogs: ReminderLog[], rules?: ReminderRule[]) {
  const currency = dues[0]?.currency || "INR";

  const brackets = [
    { label: "More than 180 Days", min: 181, max: Infinity },
    { label: "Between 120 and 180 Days", min: 121, max: 180 },
    { label: "Between 90 and 120 Days", min: 91, max: 120 },
    { label: "90 Days", min: 90, max: 90 },
    { label: "75 Days", min: 75, max: 89 },
    { label: "60 Days", min: 60, max: 74 },
    { label: "45 Days", min: 45, max: 59 },
    { label: "30 Days", min: 30, max: 44 }
  ];

  const sectionsText = brackets.map((bracket) => {
    const matchingRules = (rules || []).filter(r => r.triggerDay >= bracket.min && r.triggerDay <= bracket.max);
    const ruleIds = matchingRules.map(r => r.id);
    const ruleLogs = sentLogs.filter(log => ruleIds.includes(log.ruleId) || (log.reminderDay >= bracket.min && log.reminderDay <= bracket.max));

    // Only show sections with activity today
    if (ruleLogs.length === 0) {
      return "";
    }

    const ruleDealerCodes = Array.from(new Set(ruleLogs.map(log => log.dealerCode).filter(Boolean)));
    const assignedDealersCount = ruleDealerCodes.length;
    const sentTodayCount = ruleLogs.length;
    const matchingDueIds = ruleLogs.map(log => log.dueId).filter(Boolean);
    const ruleDues = dues.filter(due => matchingDueIds.includes(due.id));
    const paymentDueAmount = ruleDues.reduce((sum, d) => sum + (d.amount || 0), 0);

    // Group ruleDues by dealer
    const dealerMap = new Map<string, typeof ruleDues>();
    for (const due of ruleDues) {
      const key = due.companyName || due.dealerCode || "Unknown";
      if (!dealerMap.has(key)) dealerMap.set(key, []);
      dealerMap.get(key)!.push(due);
    }

    const lines = Array.from(dealerMap.entries()).map(([dealerName, groupDues]) => {
      const dealerAllDuesCount = dues.filter(
        (d) => (d.companyName || d.dealerCode) === dealerName
      ).length;
      const dueDates = groupDues.map(d => d.dueDate || "-").join(", ");
      const invoiceNos = groupDues.map(d => d.invoiceNumber || d.reference || "-").join(", ");
      const totalOutstanding = groupDues.reduce((sum, d) => sum + (d.amount || 0), 0);
      const matchingLog = ruleLogs.find((l) => groupDues.some(gd => gd.id === l.dueId));
      const pdfUrlStr = matchingLog?.pdfUrl ? ` | PDF: ${matchingLog.pdfUrl}` : "";
      return ` - Dealer: ${dealerName} | Total Invoices: ${dealerAllDuesCount} | Due: ${dueDates} | Invoices: ${invoiceNos} | Outstanding: ${formatCurrency(totalOutstanding, currency)}${pdfUrlStr}`;
    }).join("\n");

    const ruleLabel = bracket.label;

    return [
      `\n[Dealers in ${ruleLabel}]`,
      ` * Assigned Dealers: ${assignedDealersCount}`,
      ` * Payment Due (${bracket.label}): ${formatCurrency(paymentDueAmount, currency)}`,
      ` * Reminders Sent Today: ${sentTodayCount}`
    ].join("\n");
  }).filter(Boolean).join("\n");

  const uniqueDealers = Array.from(new Set(dues.map(d => d.companyName || d.dealerCode).filter(Boolean)));
  const totalOutstanding = dues.reduce((sum, d) => sum + (d.amount || 0), 0);

  const cdLogs = sentLogs.filter(log => log.cdEligible);
  const cdDueIds = new Set(cdLogs.map(log => log.dueId).filter(Boolean));
  const cdDues = dues.filter(due => cdDueIds.has(due.id));
  const cdOutstanding = cdDues.reduce((sum, d) => sum + (d.amount || 0), 0);

  const over90Logs = sentLogs.filter(log => (log.reminderDay || 0) > 90);
  const over90DueIds = new Set(over90Logs.map(log => log.dueId).filter(Boolean));
  const over90Dues = dues.filter(due => over90DueIds.has(due.id));
  const over90Outstanding = over90Dues.reduce((sum, d) => sum + (d.amount || 0), 0);

  return [
    `Salesperson: ${name}`,
    "",
    "Action required: Dealers assigned to you have invoices with due dates coming up or already pending. Please contact each dealer, remind them about the pending invoices, and ask them to arrange payment.",
    "",
    "Summary Table:",
    ` * Total Assigned Dealers: Count = ${uniqueDealers.length} | Outstanding = ${formatCurrency(totalOutstanding, currency)}`,
    ` * Due in CD: Count = ${cdLogs.length} | Outstanding = ${formatCurrency(cdOutstanding, currency)}`,
    ` * Due Above 90 Days: Count = ${over90Logs.length} | Outstanding = ${formatCurrency(over90Outstanding, currency)}`,
    "",
    "Rule-by-Rule Aging Breakdown:",
    sectionsText
  ].join("\n");
}

export function buildSalespersonSummaryHtml(name: string, dues: DueRecord[], sentLogs: ReminderLog[], rules?: ReminderRule[]) {
  const currency = dues[0]?.currency || "INR";
  const today = new Date();
  const dayStr = today.toISOString().slice(0, 10);

  const agingBuckets = [
    { label: "More than 180 Days", min: 181, max: Infinity },
    { label: "Between 120 and 180 Days", min: 121, max: 180 },
    { label: "Between 90 and 120 Days", min: 91, max: 120 },
    { label: "90 Days", min: 90, max: 90 },
    { label: "75 Days", min: 75, max: 89 },
    { label: "60 Days", min: 60, max: 74 },
    { label: "45 Days", min: 45, max: 59 },
    { label: "30 Days", min: 30, max: 44 },
  ];

  // Summary metrics
  const uniqueDealers = new Set(dues.map((d) => d.companyName || d.dealerCode).filter(Boolean));
  const totalOutstandingAmount = dues.reduce((sum, d) => sum + (d.amount || 0), 0);
  const totalRemindersSent = sentLogs.length;

  const getDealerLabel = (label: string) => {
    if (label.toLowerCase().includes("more than 180")) {
      return "DEALERS MORE THAN 180 DAYS";
    }
    if (label.toLowerCase().includes("more than 120")) {
      return "DEALERS MORE THAN 120 DAYS";
    }
    if (label.toLowerCase().includes("between 120")) {
      return "DEALERS BETWEEN 120 \u2013 180 DAYS";
    }
    if (label.toLowerCase().includes("between 90")) {
      return "DEALERS BETWEEN 90 \u2013 120 DAYS";
    }
    return `DEALERS IN ${label.toUpperCase()}`;
  };

  const bucketCardRows = agingBuckets.map((bracket) => {
    const matchingRules = (rules || []).filter(r => r.triggerDay >= bracket.min && r.triggerDay <= bracket.max);
    const ruleIds = matchingRules.map(r => r.id);
    const ruleLogs = sentLogs.filter(log => ruleIds.includes(log.ruleId) || (log.reminderDay >= bracket.min && log.reminderDay <= bracket.max));

    const remindersSentToday = ruleLogs.length;
    if (remindersSentToday === 0) {
      return "";
    }

    const matchingDueIds = ruleLogs.map((log) => log.dueId).filter(Boolean);
    const ruleDues = dues.filter((due) => matchingDueIds.includes(due.id));
    const outstanding = ruleDues.reduce((sum, d) => sum + (d.amount || 0), 0);

    const ruleDealerCodes = Array.from(new Set(ruleLogs.map((log) => log.dealerCode).filter(Boolean)));
    const dealerCount = ruleDealerCodes.length;

    return `
      <tr>
        <td style="width:33.33%;padding:4px 5px;vertical-align:top;">
          <div style="border:1px solid #e5e7eb;border-radius:8px;padding:14px 16px;background:#ffffff;">
            <div style="font-size:11px;color:#6b7280;font-weight:800;text-transform:uppercase;letter-spacing:.04em;line-height:1.4;">${escapeHtml(getDealerLabel(bracket.label))}</div>
            <div style="font-size:26px;font-weight:800;margin-top:8px;color:#111827;">${escapeHtml(dealerCount)}</div>
          </div>
        </td>
        <td style="width:33.33%;padding:4px 5px;vertical-align:top;">
          <div style="border:1px solid #e5e7eb;border-radius:8px;padding:14px 16px;background:#ffffff;">
            <div style="font-size:11px;color:#6b7280;font-weight:800;text-transform:uppercase;letter-spacing:.04em;line-height:1.4;">TOTAL OUTSTANDING</div>
            <div style="font-size:26px;font-weight:800;margin-top:8px;color:#111827;">${escapeHtml(formatCurrency(outstanding, currency))}</div>
          </div>
        </td>
        <td style="width:33.33%;padding:4px 5px;vertical-align:top;">
          <div style="border:1px solid #e5e7eb;border-radius:8px;padding:14px 16px;background:#ffffff;">
            <div style="font-size:11px;color:#6b7280;font-weight:800;text-transform:uppercase;letter-spacing:.04em;line-height:1.4;">REMINDERS SENT TODAY</div>
            <div style="font-size:26px;font-weight:800;margin-top:8px;color:#111827;">${escapeHtml(remindersSentToday)}</div>
          </div>
        </td>
      </tr>
    `;
  }).join("");

  return `
    <!doctype html>
    <html>
      <body style="margin:0;background:#f3f4f6;font-family:Arial,Helvetica,sans-serif;color:#111827;">
        <div style="max-width:760px;margin:0 auto;padding:28px 18px;">
          <div style="background:#ffffff;border:1px solid #e5e7eb;border-radius:10px;overflow:hidden;">

            <!-- Header -->
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;background:#111827;">
              <tr>
                <td style="padding:24px 26px 22px;">
                  <div style="font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:#9ca3af;font-weight:700;">SALESPERSON SUMMARY</div>
                  <div style="margin:6px 0 0;font-size:30px;font-weight:800;color:#ffffff;line-height:1.1;">${escapeHtml(dayStr)}</div>
                </td>
              </tr>
            </table>

            <!-- Card grid -->
            <div style="padding:14px 16px 24px;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;">
                <!-- Row 1: Total Dealers | Total Outstanding | Reminders Sent Today -->
                <tr>
                  <td style="width:33.33%;padding:4px 5px;vertical-align:top;">
                    <div style="border:1px solid #e5e7eb;border-radius:8px;padding:14px 16px;background:#ffffff;">
                      <div style="font-size:11px;color:#6b7280;font-weight:800;text-transform:uppercase;letter-spacing:.04em;line-height:1.4;">TOTAL DEALERS</div>
                      <div style="font-size:26px;font-weight:800;margin-top:8px;color:#111827;">${escapeHtml(uniqueDealers.size)}</div>
                    </div>
                  </td>
                  <td style="width:33.33%;padding:4px 5px;vertical-align:top;">
                    <div style="border:1px solid #e5e7eb;border-radius:8px;padding:14px 16px;background:#ffffff;">
                      <div style="font-size:11px;color:#6b7280;font-weight:800;text-transform:uppercase;letter-spacing:.04em;line-height:1.4;">TOTAL OUTSTANDING</div>
                      <div style="font-size:26px;font-weight:800;margin-top:8px;color:#111827;">${escapeHtml(formatCurrency(totalOutstandingAmount, currency))}</div>
                    </div>
                  </td>
                  <td style="width:33.33%;padding:4px 5px;vertical-align:top;">
                    <div style="border:1px solid #e5e7eb;border-radius:8px;padding:14px 16px;background:#ffffff;">
                      <div style="font-size:11px;color:#6b7280;font-weight:800;text-transform:uppercase;letter-spacing:.04em;line-height:1.4;">REMINDERS SENT TODAY</div>
                      <div style="font-size:26px;font-weight:800;margin-top:8px;color:#111827;">${escapeHtml(totalRemindersSent)}</div>
                    </div>
                  </td>
                </tr>
                <!-- Per-bucket rows -->
                ${bucketCardRows}
              </table>
            </div>

          </div>
        </div>
      </body>
    </html>
  `;
}

export async function sendSalespersonSummaries(user: ReportUser, sentLogs: ReminderLog[]) {
  const database = await readDatabase();
  const workspace = getCompanyWorkspaceContextForUser(database, user);
  const settings = getSettings(database, user);
  const dues = filterSharedCompanyRecords(database.dueRecords, workspace.sharedOwnerIds);
  const groups = groupBy(
    dues.filter((entry) => entry.salespersonEmail),
    (entry) => entry.salespersonEmail
  );
  const results: Array<{ email: string; skipped: boolean; recipientCount: number }> = [];

  for (const [email, records] of groups.entries()) {
    try {
      const name = records[0]?.salespersonName || email;
      const salespersonLogs = sentLogs.filter((log) =>
        records.some((due) => due.id === log.dueId || due.dealerCode === log.dealerCode)
      );

      // Skip if no reminders were sent today for this salesperson
      if (salespersonLogs.length === 0) {
        results.push({ email, skipped: true, recipientCount: 0 });
        continue;
      }

      const salespersonDueIds = new Set(salespersonLogs.map((log) => log.dueId).filter(Boolean));
      const activeRecords = records.filter(
        (due) =>
          salespersonDueIds.has(due.id) ||
          salespersonLogs.some((log) => log.dealerCode === due.dealerCode)
      );

      // Generate Salesperson summary PDF
      const pdfBuffer = await generateSalespersonSummaryPDF(
        name,
        activeRecords,
        salespersonLogs,
        database.reminderRules
      );

      const filename = `reminder-summary-${name.toLowerCase().replace(/[^a-z0-9]/g, "-")}.pdf`;
      const attachments = [
        {
          filename,
          content: pdfBuffer
        }
      ];

      const result = await sendReportEmail(
        settings,
        [email],
        `Reminder Summary - ${name}`,
        buildSalespersonSummaryText(name, activeRecords, salespersonLogs, database.reminderRules),
        buildSalespersonSummaryHtml(name, activeRecords, salespersonLogs, database.reminderRules),
        attachments
      );
      results.push({ email, ...result });

      // Check if salesperson has phone number to send WhatsApp notification
      const salespersonObj = database.salespersons?.find(
        (sp: any) => sp.email?.trim().toLowerCase() === email.trim().toLowerCase()
      );
      const phone = salespersonObj?.phoneNumber;
      if (phone && phone.trim()) {
        try {
          const driveFileName = `reminder-summary-${name.toLowerCase().replace(/[^a-z0-9]/g, "-")}-${new Date().toISOString().slice(0, 10)}.pdf`;
          const pdfUrl = await uploadPdfToGoogleDrive(pdfBuffer, driveFileName);
          const totalOutstanding = formatCurrency(
            activeRecords.reduce((sum, d) => sum + (d.amount || 0), 0),
            activeRecords[0]?.currency || "INR"
          );

          await sendSalespersonSummaryWhatsapp(
            phone,
            name,
            totalOutstanding,
            pdfUrl
          );
        } catch (wsErr) {
          console.error(`Failed to send salesperson WhatsApp summary to ${phone}:`, wsErr);
        }
      }
    } catch (err) {
      console.error(`Failed to send salesperson summary to ${email}:`, err);
      results.push({ email, skipped: true, recipientCount: 0 });
    }
  }

  return results;
}
