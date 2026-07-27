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
  if (!due.dueDate) {
    return 0;
  }

  const dueDate = new Date(due.dueDate);

  if (Number.isNaN(dueDate.getTime())) {
    return 0;
  }

  return Math.max(0, daysBetween(dueDate, reportDate));
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
}) {
  const {
    day,
    dues,
    todayLogs,
    dealerGroups,
    salespersonGroups,
    failedLogs,
    topOutstanding,
    topOverdue
  } = input;
  const reportDate = new Date(day);
  const currency = dues[0]?.currency || "INR";
  const sentLogs = todayLogs.filter((entry) => entry.status === "sent");
  const whatsappSuccess = sentLogs.filter((entry) => entry.channel === "whatsapp").length;
  const whatsappFailed = todayLogs.filter((entry) => entry.channel === "whatsapp" && entry.status === "failed").length;
  const emailSuccess = sentLogs.filter((entry) => entry.channel === "email").length;
  const emailFailed = todayLogs.filter((entry) => entry.channel === "email" && entry.status === "failed").length;
  const failureCount = todayLogs.filter((entry) => entry.status === "failed").length;
  const overdueDues = dues.filter((entry) => getOverdueDays(entry, reportDate) > 0);
  const overdueOutstanding = formatCurrency(
    overdueDues.reduce((sum, entry) => sum + entry.amount, 0),
    currency
  );
  const totalOutstanding = formatCurrency(
    dues.reduce((sum, entry) => sum + entry.amount, 0),
    currency
  );
  const companyCount = new Set(dues.map((entry) => entry.companyName).filter(Boolean)).size;

  // Bucket calculations
  const getBucketInfo = (minAge: number, maxAge: number) => {
    const bucketDues = dues.filter((due) => {
      const age = getBillAgeDays(due.billDate || due.invoiceDate, reportDate) ?? 0;
      return age >= minAge && age <= maxAge;
    });
    const uniqueDealersCount = new Set(bucketDues.map((d) => d.companyName || d.dealerCode).filter(Boolean)).size;
    const totalOutstandingAmount = bucketDues.reduce((sum, entry) => sum + entry.amount, 0);
    return { count: uniqueDealersCount, amount: totalOutstandingAmount };
  };

  const bucket30 = getBucketInfo(30, 44);
  const bucket45 = getBucketInfo(45, 59);
  const bucket60 = getBucketInfo(60, 74);
  const bucket90 = getBucketInfo(75, 90);
  const bucket90_120 = getBucketInfo(91, 120);
  const bucket120Plus = getBucketInfo(121, Infinity);

  const salespersonRows = Array.from(salespersonGroups.entries()).map(([salesperson, records]) => {
    const amount = records.reduce((sum, entry) => sum + entry.amount, 0);
    return `
      <tr>
        <td style="padding:11px 13px;border-bottom:1px solid #e5e7eb;font-weight:700;color:#111827;">${escapeHtml(salesperson)}</td>
        <td style="padding:11px 13px;border-bottom:1px solid #e5e7eb;color:#374151;">${escapeHtml(records.length)}</td>
        <td style="padding:11px 13px;border-bottom:1px solid #e5e7eb;text-align:right;font-weight:700;color:#111827;">${escapeHtml(formatCurrency(amount, records[0]?.currency || currency))}</td>
      </tr>
    `;
  });
  const topOutstandingRows = topOutstanding.map((entry, index) => `
    <tr>
      <td style="padding:11px 13px;border-bottom:1px solid #e5e7eb;color:#6b7280;font-weight:700;">${escapeHtml(index + 1)}</td>
      <td style="padding:11px 13px;border-bottom:1px solid #e5e7eb;font-weight:700;color:#111827;">${escapeHtml(entry.dealer)}</td>
      <td style="padding:11px 13px;border-bottom:1px solid #e5e7eb;color:#374151;">${escapeHtml(entry.invoiceCount)}</td>
      <td style="padding:11px 13px;border-bottom:1px solid #e5e7eb;text-align:right;font-weight:700;color:#111827;">${escapeHtml(formatCurrency(entry.amount, currency))}</td>
    </tr>
  `);
  const topOverdueRows = topOverdue.map((entry, index) => `
    <tr>
      <td style="padding:11px 13px;border-bottom:1px solid #e5e7eb;color:#6b7280;font-weight:700;">${escapeHtml(index + 1)}</td>
      <td style="padding:11px 13px;border-bottom:1px solid #e5e7eb;font-weight:700;color:#111827;">${escapeHtml(entry.dealer)}</td>
      <td style="padding:11px 13px;border-bottom:1px solid #e5e7eb;color:#374151;">${escapeHtml(entry.invoiceCount)}</td>
      <td style="padding:11px 13px;border-bottom:1px solid #e5e7eb;color:#991b1b;font-weight:700;">${escapeHtml(`${entry.maxOverdueDays} days`)}</td>
      <td style="padding:11px 13px;border-bottom:1px solid #e5e7eb;color:#374151;">${escapeHtml(entry.oldestDueDate ? formatDate(entry.oldestDueDate) : "Not available")}</td>
      <td style="padding:11px 13px;border-bottom:1px solid #e5e7eb;text-align:right;font-weight:700;color:#111827;">${escapeHtml(formatCurrency(entry.amount, currency))}</td>
    </tr>
  `);
  const failedRows = failedLogs.map((entry) => `
    <tr>
      <td style="padding:11px 13px;border-bottom:1px solid #fee2e2;font-weight:700;color:#991b1b;">${escapeHtml(entry.invoiceNumber || "N/A")}</td>
      <td style="padding:11px 13px;border-bottom:1px solid #fee2e2;color:#7f1d1d;">${escapeHtml(entry.channel)}</td>
      <td style="padding:11px 13px;border-bottom:1px solid #fee2e2;color:#7f1d1d;">${escapeHtml(entry.recipient || "-")}</td>
      <td style="padding:11px 13px;border-bottom:1px solid #fee2e2;color:#7f1d1d;">${escapeHtml(entry.failureReason || "Failed")}</td>
    </tr>
  `);

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
            <div style="padding:24px 26px;background:#111827;color:#ffffff;">
              <div style="font-size:13px;letter-spacing:.04em;text-transform:uppercase;color:#d1d5db;font-weight:700;">Daily Activity Report</div>
              <h1 style="margin:8px 0 0;font-size:24px;line-height:1.25;color:#ffffff;">${escapeHtml(day)}</h1>
            </div>
            <div style="padding:22px 26px;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;margin-bottom:24px;">
                <!-- Row 1: Total -->
                <tr>
                  <td style="width:50%;padding:6px;vertical-align:top;">
                    <div style="border:1px solid #e5e7eb;border-radius:8px;padding:14px;background:#fafafa;height:65px;">
                      <div style="font-size:11px;color:#6b7280;font-weight:800;text-transform:uppercase;letter-spacing:.03em;line-height:1.2;">Total Dealers</div>
                      <div style="font-size:20px;font-weight:800;margin-top:5px;color:#111827;">${escapeHtml(dealerGroups.size)}</div>
                    </div>
                  </td>
                  <td style="width:50%;padding:6px;vertical-align:top;">
                    <div style="border:1px solid #e5e7eb;border-radius:8px;padding:14px;background:#fafafa;height:65px;">
                      <div style="font-size:11px;color:#6b7280;font-weight:800;text-transform:uppercase;letter-spacing:.03em;line-height:1.2;">Total Outstanding</div>
                      <div style="font-size:20px;font-weight:800;margin-top:5px;color:#111827;">${escapeHtml(totalOutstanding)}</div>
                    </div>
                  </td>
                </tr>
                <!-- Row 2: 30 days -->
                <tr>
                  <td style="width:50%;padding:6px;vertical-align:top;">
                    <div style="border:1px solid #e5e7eb;border-radius:8px;padding:14px;background:#fafafa;height:65px;">
                      <div style="font-size:11px;color:#6b7280;font-weight:800;text-transform:uppercase;letter-spacing:.03em;line-height:1.2;">Dealers in 30 days</div>
                      <div style="font-size:20px;font-weight:800;margin-top:5px;color:#111827;">${escapeHtml(bucket30.count)}</div>
                    </div>
                  </td>
                  <td style="width:50%;padding:6px;vertical-align:top;">
                    <div style="border:1px solid #e5e7eb;border-radius:8px;padding:14px;background:#fafafa;height:65px;">
                      <div style="font-size:11px;color:#6b7280;font-weight:800;text-transform:uppercase;letter-spacing:.03em;line-height:1.2;">Total Outstanding</div>
                      <div style="font-size:20px;font-weight:800;margin-top:5px;color:#111827;">${escapeHtml(formatCurrency(bucket30.amount, currency))}</div>
                    </div>
                  </td>
                </tr>
                <!-- Row 3: 45 days -->
                <tr>
                  <td style="width:50%;padding:6px;vertical-align:top;">
                    <div style="border:1px solid #e5e7eb;border-radius:8px;padding:14px;background:#fafafa;height:65px;">
                      <div style="font-size:11px;color:#6b7280;font-weight:800;text-transform:uppercase;letter-spacing:.03em;line-height:1.2;">Dealers in 45 days</div>
                      <div style="font-size:20px;font-weight:800;margin-top:5px;color:#111827;">${escapeHtml(bucket45.count)}</div>
                    </div>
                  </td>
                  <td style="width:50%;padding:6px;vertical-align:top;">
                    <div style="border:1px solid #e5e7eb;border-radius:8px;padding:14px;background:#fafafa;height:65px;">
                      <div style="font-size:11px;color:#6b7280;font-weight:800;text-transform:uppercase;letter-spacing:.03em;line-height:1.2;">Total Outstanding</div>
                      <div style="font-size:20px;font-weight:800;margin-top:5px;color:#111827;">${escapeHtml(formatCurrency(bucket45.amount, currency))}</div>
                    </div>
                  </td>
                </tr>
                <!-- Row 4: 60 days -->
                <tr>
                  <td style="width:50%;padding:6px;vertical-align:top;">
                    <div style="border:1px solid #e5e7eb;border-radius:8px;padding:14px;background:#fafafa;height:65px;">
                      <div style="font-size:11px;color:#6b7280;font-weight:800;text-transform:uppercase;letter-spacing:.03em;line-height:1.2;">Dealers in 60 days</div>
                      <div style="font-size:20px;font-weight:800;margin-top:5px;color:#111827;">${escapeHtml(bucket60.count)}</div>
                    </div>
                  </td>
                  <td style="width:50%;padding:6px;vertical-align:top;">
                    <div style="border:1px solid #e5e7eb;border-radius:8px;padding:14px;background:#fafafa;height:65px;">
                      <div style="font-size:11px;color:#6b7280;font-weight:800;text-transform:uppercase;letter-spacing:.03em;line-height:1.2;">Total Outstanding</div>
                      <div style="font-size:20px;font-weight:800;margin-top:5px;color:#111827;">${escapeHtml(formatCurrency(bucket60.amount, currency))}</div>
                    </div>
                  </td>
                </tr>
                <!-- Row 5: 90 days -->
                <tr>
                  <td style="width:50%;padding:6px;vertical-align:top;">
                    <div style="border:1px solid #e5e7eb;border-radius:8px;padding:14px;background:#fafafa;height:65px;">
                      <div style="font-size:11px;color:#6b7280;font-weight:800;text-transform:uppercase;letter-spacing:.03em;line-height:1.2;">Dealers in 90 days</div>
                      <div style="font-size:20px;font-weight:800;margin-top:5px;color:#111827;">${escapeHtml(bucket90.count)}</div>
                    </div>
                  </td>
                  <td style="width:50%;padding:6px;vertical-align:top;">
                    <div style="border:1px solid #e5e7eb;border-radius:8px;padding:14px;background:#fafafa;height:65px;">
                      <div style="font-size:11px;color:#6b7280;font-weight:800;text-transform:uppercase;letter-spacing:.03em;line-height:1.2;">Total Outstanding</div>
                      <div style="font-size:20px;font-weight:800;margin-top:5px;color:#111827;">${escapeHtml(formatCurrency(bucket90.amount, currency))}</div>
                    </div>
                  </td>
                </tr>
                <!-- Row 6: between 90-120 days -->
                <tr>
                  <td style="width:50%;padding:6px;vertical-align:top;">
                    <div style="border:1px solid #e5e7eb;border-radius:8px;padding:14px;background:#fafafa;height:65px;">
                      <div style="font-size:11px;color:#6b7280;font-weight:800;text-transform:uppercase;letter-spacing:.03em;line-height:1.2;">Dealers in between 90 – 120 days</div>
                      <div style="font-size:20px;font-weight:800;margin-top:5px;color:#111827;">${escapeHtml(bucket90_120.count)}</div>
                    </div>
                  </td>
                  <td style="width:50%;padding:6px;vertical-align:top;">
                    <div style="border:1px solid #e5e7eb;border-radius:8px;padding:14px;background:#fafafa;height:65px;">
                      <div style="font-size:11px;color:#6b7280;font-weight:800;text-transform:uppercase;letter-spacing:.03em;line-height:1.2;">Total Outstanding</div>
                      <div style="font-size:20px;font-weight:800;margin-top:5px;color:#111827;">${escapeHtml(formatCurrency(bucket90_120.amount, currency))}</div>
                    </div>
                  </td>
                </tr>
                <!-- Row 7: More Than 120 days -->
                <tr>
                  <td style="width:50%;padding:6px;vertical-align:top;">
                    <div style="border:1px solid #e5e7eb;border-radius:8px;padding:14px;background:#fafafa;height:65px;">
                      <div style="font-size:11px;color:#6b7280;font-weight:800;text-transform:uppercase;letter-spacing:.03em;line-height:1.2;">Dealers More Than 120 days</div>
                      <div style="font-size:20px;font-weight:800;margin-top:5px;color:#111827;">${escapeHtml(bucket120Plus.count)}</div>
                    </div>
                  </td>
                  <td style="width:50%;padding:6px;vertical-align:top;">
                    <div style="border:1px solid #e5e7eb;border-radius:8px;padding:14px;background:#fafafa;height:65px;">
                      <div style="font-size:11px;color:#6b7280;font-weight:800;text-transform:uppercase;letter-spacing:.03em;line-height:1.2;">Total Outstanding</div>
                      <div style="font-size:20px;font-weight:800;margin-top:5px;color:#111827;">${escapeHtml(formatCurrency(bucket120Plus.amount, currency))}</div>
                    </div>
                  </td>
                </tr>
              </table>

              ${buildSectionTitle("Top Dealers by Outstanding")}
              ${table(["Rank", "Dealer", "Invoices", "Outstanding"], topOutstandingRows.join(""))}

              ${buildSectionTitle("Top Dealers by Overdue Days")}
              ${table(["Rank", "Dealer", "Invoices", "Max Overdue", "Oldest Due", "Outstanding"], topOverdueRows.join(""), "No overdue dealers.")}

              ${buildSectionTitle("Salesperson-wise Summary")}
              ${table(["Salesperson", "Invoices", "Outstanding"], salespersonRows.join(""))}
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
  const dues = filterSharedCompanyRecords(database.dueRecords, workspace.sharedOwnerIds);
  const logs = filterSharedCompanyRecords(database.reminderLogs, workspace.sharedOwnerIds);
  const todayLogs = logs.filter((entry) => logDay(entry) === day);
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
      topOverdue
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
    { label: "More than 120 Days", min: 121, max: Infinity },
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

  const brackets = [
    { label: "More than 120 Days", min: 121, max: Infinity },
    { label: "Between 90 and 120 Days", min: 91, max: 120 },
    { label: "90 Days", min: 90, max: 90 },
    { label: "75 Days", min: 75, max: 89 },
    { label: "60 Days", min: 60, max: 74 },
    { label: "45 Days", min: 45, max: 59 },
    { label: "30 Days", min: 30, max: 44 }
  ];

  const sectionsHtml = brackets.map((bracket) => {
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

    // Group ruleDues by dealer for one-row-per-dealer breakdown
    const dealerMap = new Map<string, typeof ruleDues>();
    for (const due of ruleDues) {
      const key = due.companyName || due.dealerCode || "Unknown";
      if (!dealerMap.has(key)) dealerMap.set(key, []);
      dealerMap.get(key)!.push(due);
    }

    const rowsHtml = Array.from(dealerMap.entries()).map(([dealerName, groupDues]) => {
      const dealerAllDuesCount = dues.filter(
        (d) => (d.companyName || d.dealerCode) === dealerName
      ).length;
      const dueDates = groupDues.map(d => d.dueDate ? formatDate(d.dueDate) : "-").join(", ");
      const invoiceNos = groupDues.map(d => d.invoiceNumber || d.reference || "-").join(", ");
      const totalOutstanding = groupDues.reduce((sum, d) => sum + (d.amount || 0), 0);
      const matchingLog = ruleLogs.find((l) => groupDues.some(gd => gd.id === l.dueId));
      const pdfLinkHtml = matchingLog?.pdfUrl
        ? `<a href="${matchingLog.pdfUrl}" style="color:#0f766e;text-decoration:underline;font-weight:700;">PDF</a>`
        : `N/A`;

      return `
        <tr>
          <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;color:#111827;font-weight:600;font-size:13px;">${escapeHtml(dealerName)}</td>
          <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;color:#374151;font-size:13px;text-align:center;">${escapeHtml(dealerAllDuesCount)}</td>
          <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;color:#374151;font-size:13px;">${escapeHtml(dueDates)}</td>
          <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;color:#374151;font-size:13px;">${escapeHtml(invoiceNos)}</td>
          <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;color:#111827;font-weight:700;text-align:right;font-size:13px;">${escapeHtml(formatCurrency(totalOutstanding, currency))}</td>
          <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;color:#0f766e;font-size:13px;font-weight:600;text-align:center;">${pdfLinkHtml}</td>
        </tr>
      `;
    }).join("");

    const ruleLabel = bracket.label;

    return `
      <div style="margin-top:32px; border-top: 1px dashed #cbd5e1; padding-top: 24px;">
        <h3 style="font-size:16px;color:#0f766e;margin:0 0 16px;font-weight:800;text-transform:uppercase;letter-spacing:.04em;border-left:4px solid #0f766e;padding-left:8px;">
          Dealers in ${escapeHtml(ruleLabel)}
        </h3>

        <!-- Rule specific boxes -->
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;margin-bottom:18px;">
          <tr>
            <td style="width:33.33%;padding:5px;">
              <div style="border:1px solid #e5e7eb;border-radius:8px;padding:12px;background:#fafafa;height:68px;">
                <div style="font-size:10px;color:#6b7280;text-transform:uppercase;font-weight:800;line-height:1.2;">Assigned Dealers</div>
                <div style="font-size:18px;font-weight:800;margin-top:4px;color:#111827;">${escapeHtml(assignedDealersCount)}</div>
              </div>
            </td>
            <td style="width:33.33%;padding:5px;">
              <div style="border:1px solid #e5e7eb;border-radius:8px;padding:12px;background:#fafafa;height:68px;">
                <div style="font-size:10px;color:#6b7280;text-transform:uppercase;font-weight:800;line-height:1.2;">Payment Due (${escapeHtml(ruleLabel)})</div>
                <div style="font-size:18px;font-weight:800;margin-top:4px;color:#0f766e;">${escapeHtml(formatCurrency(paymentDueAmount, currency))}</div>
              </div>
            </td>
            <td style="width:33.33%;padding:5px;">
              <div style="border:1px solid #e5e7eb;border-radius:8px;padding:12px;background:#fafafa;height:68px;">
                <div style="font-size:10px;color:#6b7280;text-transform:uppercase;font-weight:800;line-height:1.2;">Reminder Sent Today</div>
                <div style="font-size:18px;font-weight:800;margin-top:4px;color:#b45309;">${escapeHtml(sentTodayCount)}</div>
              </div>
            </td>
          </tr>
        </table>

      </div>
    `;
  }).filter(Boolean).join("");

  // Get total unique dealers
  const uniqueDealers = new Set(dues.map((d) => d.companyName || d.dealerCode).filter(Boolean));
  const totalOutstanding = dues.reduce((sum, entry) => sum + entry.amount, 0);

  const cdLogs = sentLogs.filter(log => log.cdEligible);
  const cdDueIds = new Set(cdLogs.map(log => log.dueId).filter(Boolean));
  const cdDues = dues.filter(due => cdDueIds.has(due.id));
  const cdOutstanding = cdDues.reduce((sum, d) => sum + (d.amount || 0), 0);

  const over90Logs = sentLogs.filter(log => (log.reminderDay || 0) > 90);
  const over90DueIds = new Set(over90Logs.map(log => log.dueId).filter(Boolean));
  const over90Dues = dues.filter(due => over90DueIds.has(due.id));
  const over90Outstanding = over90Dues.reduce((sum, d) => sum + (d.amount || 0), 0);

  return `
    <!doctype html>
    <html>
      <body style="margin:0;background:#f3f4f6;font-family:Arial,Helvetica,sans-serif;color:#111827;">
        <div style="max-width:720px;margin:0 auto;padding:28px 18px;">
          <div style="background:#ffffff;border:1px solid #e5e7eb;border-radius:10px;overflow:hidden;">
            <div style="padding:24px 26px;background:#0f766e;color:#ffffff;">
              <div style="font-size:13px;letter-spacing:.04em;text-transform:uppercase;opacity:.9;">Salesperson Reminder Summary</div>
              <h1 style="margin:8px 0 0;font-size:24px;line-height:1.25;">${escapeHtml(name)}</h1>
            </div>

            <div style="padding:22px 26px;">
              <div style="border:1px solid #99f6e4;background:#f0fdfa;border-radius:8px;padding:16px 18px;margin-bottom:20px;">
                <div style="font-size:13px;color:#0f766e;font-weight:800;text-transform:uppercase;letter-spacing:.04em;">Action Required</div>
                <p style="margin:7px 0 0;color:#134e4a;line-height:1.55;font-weight:600;">
                  Dealers assigned to you have invoices with due dates coming up or pending. Please contact each dealer, remind them about the pending invoices, and ask them to arrange payment.
                </p>
              </div>

              <h2 style="font-size:18px;margin:24px 0 12px;color:#111827;font-weight:800;">Summary Table</h2>
              <table width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;margin-bottom:22px;">
                <thead>
                  <tr style="background:#f9fafb;">
                    <th align="left" style="padding:12px 13px;border-bottom:1px solid #e5e7eb;color:#374151;font-size:12px;text-transform:uppercase;font-weight:800;">Metric</th>
                    <th align="center" style="padding:12px 13px;border-bottom:1px solid #e5e7eb;color:#374151;font-size:12px;text-transform:uppercase;font-weight:800;width:20%;">Count</th>
                    <th align="right" style="padding:12px 13px;border-bottom:1px solid #e5e7eb;color:#374151;font-size:12px;text-transform:uppercase;font-weight:800;width:30%;">Outstanding</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td style="padding:12px 13px;border-bottom:1px solid #e5e7eb;font-weight:700;color:#111827;font-size:13px;">Total Assigned Dealers</td>
                    <td align="center" style="padding:12px 13px;border-bottom:1px solid #e5e7eb;color:#374151;font-size:13px;">${escapeHtml(uniqueDealers.size)}</td>
                    <td align="right" style="padding:12px 13px;border-bottom:1px solid #e5e7eb;font-weight:700;color:#111827;font-size:13px;">${escapeHtml(formatCurrency(totalOutstanding, currency))}</td>
                  </tr>
                  <tr>
                    <td style="padding:12px 13px;border-bottom:1px solid #e5e7eb;font-weight:700;color:#111827;font-size:13px;">Due in CD</td>
                    <td align="center" style="padding:12px 13px;border-bottom:1px solid #e5e7eb;color:#374151;font-size:13px;">${escapeHtml(cdLogs.length)}</td>
                    <td align="right" style="padding:12px 13px;border-bottom:1px solid #e5e7eb;font-weight:700;color:#111827;font-size:13px;">${escapeHtml(formatCurrency(cdOutstanding, currency))}</td>
                  </tr>
                  <tr>
                    <td style="padding:12px 13px;border-bottom:1px solid #e5e7eb;font-weight:700;color:#111827;font-size:13px;">Due Above 90 Days</td>
                    <td align="center" style="padding:12px 13px;border-bottom:1px solid #e5e7eb;color:#374151;font-size:13px;">${escapeHtml(over90Logs.length)}</td>
                    <td align="right" style="padding:12px 13px;border-bottom:1px solid #e5e7eb;font-weight:700;color:#991b1b;font-size:13px;">${escapeHtml(formatCurrency(over90Outstanding, currency))}</td>
                  </tr>
                </tbody>
              </table>

              <h2 style="font-size:18px;margin:24px 0 12px;color:#111827;font-weight:800;">Dealer Aging Breakdown</h2>
              ${sectionsHtml || `<p style="color:#6b7280;font-size:14px;">No outstanding invoices found.</p>`}
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

      // Generate Salesperson summary PDF
      const pdfBuffer = await generateSalespersonSummaryPDF(
        name,
        records,
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
        buildSalespersonSummaryText(name, records, salespersonLogs, database.reminderRules),
        buildSalespersonSummaryHtml(name, records, salespersonLogs, database.reminderRules),
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
            records.reduce((sum, d) => sum + (d.amount || 0), 0),
            records[0]?.currency || "INR"
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
