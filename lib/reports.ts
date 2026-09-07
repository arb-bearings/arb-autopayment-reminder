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
    <td class="metric-td" style="width:25%;padding:4px;vertical-align:top;">
      <div class="metric-card-inner" style="border:1px solid #e2e8f0;border-radius:8px;padding:12px 14px;background:#ffffff;box-sizing:border-box;">
        <div class="metric-label" style="font-size:11px;color:#64748b;font-weight:700;text-transform:uppercase;letter-spacing:.03em;">${escapeHtml(label)}</div>
        <div class="metric-value" style="font-size:20px;font-weight:800;margin-top:6px;color:${accent};">${escapeHtml(value)}</div>
      </div>
    </td>
  `;
}

function buildSectionTitle(title: string) {
  return `<h2 class="section-title" style="font-size:17px;line-height:1.3;margin:22px 0 10px;color:#0f172a;font-weight:800;">${escapeHtml(title)}</h2>`;
}

function getOverdueDays(due: DueRecord, reportDate: Date) {
  const age = getBillAgeDays(due.billDate || due.invoiceDate, reportDate);
  if (age === null) {
    return 0;
  }
  return Math.max(0, age - 60);
}

export function buildDailyActivityReportHtml(input: {
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

    const ruleDealerCodes = Array.from(new Set(sentTodayLogs.map(log => log.dealerCode).filter(Boolean)));
    const dealerCount = ruleDealerCodes.length;

    // Sum of ALL open dues for these dealers (accounting for entire dealer outstanding, not just single invoices)
    const dealersAllDues = dues.filter(due =>
      ruleDealerCodes.includes(due.dealerCode || due.customerCode) ||
      ruleDealerCodes.includes(due.companyName)
    );
    const amount = dealersAllDues.reduce((sum, entry) => sum + (entry.amount || 0), 0);

    return { amount, dealerCount, remindersSentToday };
  };

  const bucketCardRows = agingBuckets.map((b) => {
    const info = getBucketInfo(b.min, b.max);
    if (info.remindersSentToday === 0) {
      return "";
    }
    return `
      <tr>
        <td class="metric-td" style="width:33.33%;padding:4px;vertical-align:top;">
          <div class="metric-card-inner" style="border:1px solid #e2e8f0;border-radius:8px;padding:12px 14px;background:#ffffff;box-sizing:border-box;">
            <div class="metric-label" style="font-size:11px;color:#64748b;font-weight:800;text-transform:uppercase;letter-spacing:.03em;line-height:1.35;word-break:break-word;">${escapeHtml(b.dealerLabel)}</div>
            <div class="metric-value" style="font-size:22px;font-weight:800;margin-top:6px;color:#0f172a;">${escapeHtml(info.dealerCount)}</div>
          </div>
        </td>
        <td class="metric-td" style="width:33.33%;padding:4px;vertical-align:top;">
          <div class="metric-card-inner" style="border:1px solid #e2e8f0;border-radius:8px;padding:12px 14px;background:#ffffff;box-sizing:border-box;">
            <div class="metric-label" style="font-size:11px;color:#64748b;font-weight:800;text-transform:uppercase;letter-spacing:.03em;line-height:1.35;">TOTAL OUTSTANDING</div>
            <div class="metric-value" style="font-size:22px;font-weight:800;margin-top:6px;color:#0f172a;">${escapeHtml(formatCurrency(info.amount, currency))}</div>
          </div>
        </td>
        <td class="metric-td" style="width:33.33%;padding:4px;vertical-align:top;">
          <div class="metric-card-inner" style="border:1px solid #e2e8f0;border-radius:8px;padding:12px 14px;background:#ffffff;box-sizing:border-box;">
            <div class="metric-label" style="font-size:11px;color:#64748b;font-weight:800;text-transform:uppercase;letter-spacing:.03em;line-height:1.35;">REMINDERS SENT TODAY</div>
            <div class="metric-value" style="font-size:22px;font-weight:800;margin-top:6px;color:#0f172a;">${escapeHtml(info.remindersSentToday)}</div>
          </div>
        </td>
      </tr>
    `;
  }).join("");

  const topOutstandingRows = topOutstanding.map((entry, index) => `
    <tr>
      <td class="table-cell" style="padding:10px 12px;border-bottom:1px solid #e2e8f0;color:#64748b;font-weight:700;font-size:13px;">${escapeHtml(index + 1)}</td>
      <td class="table-cell wrap-cell" style="padding:10px 12px;border-bottom:1px solid #e2e8f0;font-weight:700;color:#0f172a;font-size:13px;word-break:break-word;">${escapeHtml(entry.dealer)}</td>
      <td class="table-cell" style="padding:10px 12px;border-bottom:1px solid #e2e8f0;color:#334155;font-size:13px;">${escapeHtml(entry.invoiceCount)}</td>
      <td class="table-cell" style="padding:10px 12px;border-bottom:1px solid #e2e8f0;text-align:right;font-weight:700;color:#0f172a;font-size:13px;white-space:nowrap;">${escapeHtml(formatCurrency(entry.amount, currency))}</td>
    </tr>
  `).join("");

  const topOverdueRows = topOverdue.map((entry, index) => `
    <tr>
      <td class="table-cell" style="padding:10px 12px;border-bottom:1px solid #e2e8f0;color:#64748b;font-weight:700;font-size:13px;">${escapeHtml(index + 1)}</td>
      <td class="table-cell wrap-cell" style="padding:10px 12px;border-bottom:1px solid #e2e8f0;font-weight:700;color:#0f172a;font-size:13px;word-break:break-word;">${escapeHtml(entry.dealer)}</td>
      <td class="table-cell" style="padding:10px 12px;border-bottom:1px solid #e2e8f0;color:#334155;font-size:13px;">${escapeHtml(entry.invoiceCount)}</td>
      <td class="table-cell" style="padding:10px 12px;border-bottom:1px solid #e2e8f0;color:#b91c1c;font-weight:700;font-size:13px;white-space:nowrap;">${escapeHtml(`${entry.maxOverdueDays} days`)}</td>
      <td class="table-cell" style="padding:10px 12px;border-bottom:1px solid #e2e8f0;color:#334155;font-size:13px;white-space:nowrap;">${escapeHtml(entry.oldestDueDate ? formatDate(entry.oldestDueDate) : "Not available")}</td>
      <td class="table-cell" style="padding:10px 12px;border-bottom:1px solid #e2e8f0;text-align:right;font-weight:700;color:#0f172a;font-size:13px;white-space:nowrap;">${escapeHtml(formatCurrency(entry.amount, currency))}</td>
    </tr>
  `).join("");

  const salespersonRows = Array.from(salespersonGroups.entries()).map(([salesperson, records]) => {
    const amount = records.reduce((sum, entry) => sum + entry.amount, 0);
    return `
      <tr>
        <td class="table-cell wrap-cell" style="padding:10px 12px;border-bottom:1px solid #e2e8f0;font-weight:700;color:#0f172a;font-size:13px;word-break:break-word;">${escapeHtml(salesperson)}</td>
        <td class="table-cell" style="padding:10px 12px;border-bottom:1px solid #e2e8f0;color:#334155;font-size:13px;">${escapeHtml(records.length)}</td>
        <td class="table-cell" style="padding:10px 12px;border-bottom:1px solid #e2e8f0;text-align:right;font-weight:700;color:#0f172a;font-size:13px;white-space:nowrap;">${escapeHtml(formatCurrency(amount, records[0]?.currency || currency))}</td>
      </tr>
    `;
  }).join("");

  const table = (headers: string[], rows: string, emptyText = "No records found.", minWidth = "360px") => `
    <div class="table-scroll-wrapper" style="width:100%;overflow-x:auto;-webkit-overflow-scrolling:touch;border:1px solid #e2e8f0;border-radius:8px;margin-bottom:22px;background:#ffffff;">
      <table class="data-table" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;width:100%;min-width:${minWidth};">
        <thead>
          <tr style="background:#f8fafc;">
            ${headers.map((header, index) => `
              <th align="${index === headers.length - 1 ? "right" : "left"}" class="table-cell" style="padding:10px 12px;border-bottom:1px solid #e2e8f0;color:#475569;font-size:11px;text-transform:uppercase;letter-spacing:.03em;font-weight:800;white-space:nowrap;">${escapeHtml(header)}</th>
            `).join("")}
          </tr>
        </thead>
        <tbody>
          ${rows || `<tr><td colspan="${headers.length}" class="table-cell" style="padding:14px;color:#64748b;font-size:13px;text-align:center;">${escapeHtml(emptyText)}</td></tr>`}
        </tbody>
      </table>
    </div>
  `;

  return `
    <!doctype html>
    <html lang="en" xmlns="http://www.w3.org/1999/xhtml">
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <meta http-equiv="X-UA-Compatible" content="IE=edge">
        <meta name="x-apple-disable-message-reformatting">
        <meta name="format-detection" content="telephone=no,address=no,email=no,date=no,url=no">
        <title>Daily Activity Report - ${escapeHtml(day)}</title>
        <style>
          html, body {
            margin: 0 !important;
            padding: 0 !important;
            width: 100% !important;
            min-width: 100% !important;
            -webkit-text-size-adjust: 100%;
            -ms-text-size-adjust: 100%;
            background-color: #f1f5f9;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
            color: #0f172a;
          }
          * {
            box-sizing: border-box;
          }
          table {
            border-collapse: collapse !important;
            mso-table-lspace: 0pt;
            mso-table-rspace: 0pt;
          }
          @media screen and (max-width: 640px) {
            .email-outer-wrap {
              padding: 10px 6px !important;
            }
            .email-container {
              width: 100% !important;
              max-width: 100% !important;
              border-radius: 6px !important;
            }
            .header-box {
              padding: 18px 16px !important;
            }
            .content-box {
              padding: 16px 12px !important;
            }
            .header-title {
              font-size: 22px !important;
              line-height: 1.2 !important;
            }
            .section-title {
              font-size: 16px !important;
              margin: 20px 0 8px !important;
            }
            .metric-td {
              display: block !important;
              width: 100% !important;
              max-width: 100% !important;
              padding: 0 0 8px 0 !important;
              box-sizing: border-box !important;
            }
            .metric-card-inner {
              padding: 10px 12px !important;
            }
            .metric-value {
              font-size: 18px !important;
            }
            .metric-label {
              font-size: 10px !important;
            }
            .table-scroll-wrapper {
              margin-bottom: 16px !important;
              border-radius: 6px !important;
            }
            .table-cell {
              padding: 8px 8px !important;
              font-size: 11px !important;
            }
          }
        </style>
      </head>
      <body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0f172a;-webkit-font-smoothing:antialiased;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;width:100%;background:#f1f5f9;">
          <tr>
            <td align="center" class="email-outer-wrap" style="padding:24px 12px;">
              <div class="email-container" style="max-width:760px;width:100%;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:10px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.05);text-align:left;">

                <!-- Header -->
                <div class="header-box" style="padding:22px 24px;background:#0f172a;color:#ffffff;">
                  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;">
                    <tr>
                      <td style="vertical-align:middle;">
                        <div style="font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:#94a3b8;font-weight:700;">Daily Activity Report</div>
                        <h1 class="header-title" style="margin:4px 0 0;font-size:26px;font-weight:800;color:#ffffff;line-height:1.15;">${escapeHtml(day)}</h1>
                      </td>
                      <td style="text-align:right;vertical-align:middle;">
                        <svg width="34" height="28" viewBox="0 0 38 32" fill="none" xmlns="http://www.w3.org/2000/svg" style="opacity:0.4;">
                          <rect x="0" y="20" width="10" height="12" fill="white" rx="2"/>
                          <rect x="14" y="11" width="10" height="21" fill="white" rx="2"/>
                          <rect x="28" y="0" width="10" height="32" fill="white" rx="2"/>
                        </svg>
                      </td>
                    </tr>
                  </table>
                </div>

                <!-- Card grid -->
                <div class="content-box" style="padding:16px 20px 24px;">
                  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;width:100%;">
                    <!-- Row 1: Total Dealers | Total Outstanding | Reminders Sent Today -->
                    <tr>
                      <td class="metric-td" style="width:33.33%;padding:4px;vertical-align:top;">
                        <div class="metric-card-inner" style="border:1px solid #e2e8f0;border-radius:8px;padding:12px 14px;background:#ffffff;box-sizing:border-box;">
                          <div class="metric-label" style="font-size:11px;color:#64748b;font-weight:800;text-transform:uppercase;letter-spacing:.03em;line-height:1.35;">TOTAL DEALERS</div>
                          <div class="metric-value" style="font-size:22px;font-weight:800;margin-top:6px;color:#0f172a;">${escapeHtml(dealerGroups.size)}</div>
                        </div>
                      </td>
                      <td class="metric-td" style="width:33.33%;padding:4px;vertical-align:top;">
                        <div class="metric-card-inner" style="border:1px solid #e2e8f0;border-radius:8px;padding:12px 14px;background:#ffffff;box-sizing:border-box;">
                          <div class="metric-label" style="font-size:11px;color:#64748b;font-weight:800;text-transform:uppercase;letter-spacing:.03em;line-height:1.35;">TOTAL OUTSTANDING</div>
                          <div class="metric-value" style="font-size:22px;font-weight:800;margin-top:6px;color:#0f172a;">${escapeHtml(totalOutstanding)}</div>
                        </div>
                      </td>
                      <td class="metric-td" style="width:33.33%;padding:4px;vertical-align:top;">
                        <div class="metric-card-inner" style="border:1px solid #e2e8f0;border-radius:8px;padding:12px 14px;background:#ffffff;box-sizing:border-box;">
                          <div class="metric-label" style="font-size:11px;color:#64748b;font-weight:800;text-transform:uppercase;letter-spacing:.03em;line-height:1.35;">REMINDERS SENT TODAY</div>
                          <div class="metric-value" style="font-size:22px;font-weight:800;margin-top:6px;color:#0f172a;">${escapeHtml(todayLogs.filter((entry) => entry.status === "sent").length)}</div>
                        </div>
                      </td>
                    </tr>
                    <!-- Per-bucket rows -->
                    ${bucketCardRows}
                  </table>

                  <!-- Top Dealers by Outstanding -->
                  <h2 class="section-title" style="font-size:17px;margin:24px 0 10px;color:#0f172a;font-weight:800;">Top Dealers by Outstanding (Amount)</h2>
                  ${table(["Rank", "Dealer", "Invoices", "Outstanding"], topOutstandingRows, "No records found.", "340px")}

                  <!-- Top Dealers by Overdue Days -->
                  <h2 class="section-title" style="font-size:17px;margin:24px 0 10px;color:#0f172a;font-weight:800;">Top Dealers by Overdue Days</h2>
                  ${table(["Rank", "Dealer", "Invoices", "Max Overdue", "Oldest Due", "Outstanding"], topOverdueRows, "No overdue dealers.", "480px")}

                  <!-- Salesperson-wise Summary -->
                  <h2 class="section-title" style="font-size:17px;margin:24px 0 10px;color:#0f172a;font-weight:800;">Salesperson-wise Summary</h2>
                  ${table(["Salesperson", "Invoices", "Outstanding"], salespersonRows, "No records found.", "320px")}
                </div>

              </div>
            </td>
          </tr>
        </table>
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
  const dues = filterSharedCompanyRecords(database.dueRecords, workspace.sharedOwnerIds)
    .filter((due) => (due.amount || 0) > 0);
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
        <td class="metric-td" style="width:33.33%;padding:4px;vertical-align:top;">
          <div class="metric-card-inner" style="border:1px solid #e2e8f0;border-radius:8px;padding:12px 14px;background:#ffffff;box-sizing:border-box;">
            <div class="metric-label" style="font-size:11px;color:#64748b;font-weight:800;text-transform:uppercase;letter-spacing:.03em;line-height:1.35;word-break:break-word;">${escapeHtml(getDealerLabel(bracket.label))}</div>
            <div class="metric-value" style="font-size:22px;font-weight:800;margin-top:6px;color:#0f172a;">${escapeHtml(dealerCount)}</div>
          </div>
        </td>
        <td class="metric-td" style="width:33.33%;padding:4px;vertical-align:top;">
          <div class="metric-card-inner" style="border:1px solid #e2e8f0;border-radius:8px;padding:12px 14px;background:#ffffff;box-sizing:border-box;">
            <div class="metric-label" style="font-size:11px;color:#64748b;font-weight:800;text-transform:uppercase;letter-spacing:.03em;line-height:1.35;">TOTAL OUTSTANDING</div>
            <div class="metric-value" style="font-size:22px;font-weight:800;margin-top:6px;color:#0f172a;">${escapeHtml(formatCurrency(outstanding, currency))}</div>
          </div>
        </td>
        <td class="metric-td" style="width:33.33%;padding:4px;vertical-align:top;">
          <div class="metric-card-inner" style="border:1px solid #e2e8f0;border-radius:8px;padding:12px 14px;background:#ffffff;box-sizing:border-box;">
            <div class="metric-label" style="font-size:11px;color:#64748b;font-weight:800;text-transform:uppercase;letter-spacing:.03em;line-height:1.35;">REMINDERS SENT TODAY</div>
            <div class="metric-value" style="font-size:22px;font-weight:800;margin-top:6px;color:#0f172a;">${escapeHtml(remindersSentToday)}</div>
          </div>
        </td>
      </tr>
    `;
  }).join("");

  return `
    <!doctype html>
    <html lang="en" xmlns="http://www.w3.org/1999/xhtml">
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <meta http-equiv="X-UA-Compatible" content="IE=edge">
        <meta name="x-apple-disable-message-reformatting">
        <meta name="format-detection" content="telephone=no,address=no,email=no,date=no,url=no">
        <title>Salesperson Summary - ${escapeHtml(name)}</title>
        <style>
          html, body {
            margin: 0 !important;
            padding: 0 !important;
            width: 100% !important;
            min-width: 100% !important;
            -webkit-text-size-adjust: 100%;
            -ms-text-size-adjust: 100%;
            background-color: #f1f5f9;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
            color: #0f172a;
          }
          * {
            box-sizing: border-box;
          }
          table {
            border-collapse: collapse !important;
            mso-table-lspace: 0pt;
            mso-table-rspace: 0pt;
          }
          @media screen and (max-width: 640px) {
            .email-outer-wrap {
              padding: 10px 6px !important;
            }
            .email-container {
              width: 100% !important;
              max-width: 100% !important;
              border-radius: 6px !important;
            }
            .header-box {
              padding: 18px 16px !important;
            }
            .content-box {
              padding: 16px 12px !important;
            }
            .header-title {
              font-size: 20px !important;
              line-height: 1.25 !important;
            }
            .metric-td {
              display: block !important;
              width: 100% !important;
              max-width: 100% !important;
              padding: 0 0 8px 0 !important;
              box-sizing: border-box !important;
            }
            .metric-card-inner {
              padding: 10px 12px !important;
            }
            .metric-value {
              font-size: 18px !important;
            }
            .metric-label {
              font-size: 10px !important;
            }
          }
        </style>
      </head>
      <body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0f172a;-webkit-font-smoothing:antialiased;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;width:100%;background:#f1f5f9;">
          <tr>
            <td align="center" class="email-outer-wrap" style="padding:24px 12px;">
              <div class="email-container" style="max-width:720px;width:100%;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:10px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.05);text-align:left;">

                <!-- Header -->
                <div class="header-box" style="padding:22px 24px;background:#0f172a;color:#ffffff;">
                  <div style="font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:#94a3b8;font-weight:700;">SALESPERSON SUMMARY • ${escapeHtml(dayStr)}</div>
                  <h1 class="header-title" style="margin:6px 0 0;font-size:22px;font-weight:800;color:#ffffff;line-height:1.2;">${escapeHtml(name)}</h1>
                </div>

                <!-- Callout Notice -->
                <div class="content-box" style="padding:20px 22px 10px;">
                  <div style="background:#f8fafc;border-left:4px solid #0f766e;border-top:1px solid #e2e8f0;border-right:1px solid #e2e8f0;border-bottom:1px solid #e2e8f0;border-radius:6px;padding:12px 14px;margin-bottom:18px;font-size:13px;line-height:1.5;color:#334155;">
                    <strong style="color:#0f766e;">Action Required:</strong> Dealers assigned to you have invoices with due dates coming up or already pending. Please contact each dealer, remind them about the pending invoices, and ask them to arrange payment. A detailed PDF statement is attached.
                  </div>
                </div>

                <!-- Card grid -->
                <div class="content-box" style="padding:0 22px 22px;">
                  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;width:100%;">
                    <!-- Row 1: Total Dealers | Total Outstanding | Reminders Sent Today -->
                    <tr>
                      <td class="metric-td" style="width:33.33%;padding:4px;vertical-align:top;">
                        <div class="metric-card-inner" style="border:1px solid #e2e8f0;border-radius:8px;padding:12px 14px;background:#ffffff;box-sizing:border-box;">
                          <div class="metric-label" style="font-size:11px;color:#64748b;font-weight:800;text-transform:uppercase;letter-spacing:.03em;line-height:1.35;">TOTAL DEALERS</div>
                          <div class="metric-value" style="font-size:22px;font-weight:800;margin-top:6px;color:#0f172a;">${escapeHtml(uniqueDealers.size)}</div>
                        </div>
                      </td>
                      <td class="metric-td" style="width:33.33%;padding:4px;vertical-align:top;">
                        <div class="metric-card-inner" style="border:1px solid #e2e8f0;border-radius:8px;padding:12px 14px;background:#ffffff;box-sizing:border-box;">
                          <div class="metric-label" style="font-size:11px;color:#64748b;font-weight:800;text-transform:uppercase;letter-spacing:.03em;line-height:1.35;">TOTAL OUTSTANDING</div>
                          <div class="metric-value" style="font-size:22px;font-weight:800;margin-top:6px;color:#0f172a;">${escapeHtml(formatCurrency(totalOutstandingAmount, currency))}</div>
                        </div>
                      </td>
                      <td class="metric-td" style="width:33.33%;padding:4px;vertical-align:top;">
                        <div class="metric-card-inner" style="border:1px solid #e2e8f0;border-radius:8px;padding:12px 14px;background:#ffffff;box-sizing:border-box;">
                          <div class="metric-label" style="font-size:11px;color:#64748b;font-weight:800;text-transform:uppercase;letter-spacing:.03em;line-height:1.35;">REMINDERS SENT TODAY</div>
                          <div class="metric-value" style="font-size:22px;font-weight:800;margin-top:6px;color:#0f172a;">${escapeHtml(totalRemindersSent)}</div>
                        </div>
                      </td>
                    </tr>
                    <!-- Per-bucket rows -->
                    ${bucketCardRows}
                  </table>
                </div>

              </div>
            </td>
          </tr>
        </table>
      </body>
    </html>
  `;
}

export async function sendSalespersonSummaries(user: ReportUser, sentLogs: ReminderLog[]) {
  const database = await readDatabase();
  const workspace = getCompanyWorkspaceContextForUser(database, user);
  const settings = getSettings(database, user);
  const dues = filterSharedCompanyRecords(database.dueRecords, workspace.sharedOwnerIds)
    .filter((due) => (due.amount || 0) > 0);

  // Find all salespersons defined in the workspace
  const configuredSalespersons = (database.salespersons || []).filter(
    (sp) => workspace.sharedOwnerIds.has(sp.ownerId) || sp.ownerId === workspace.configOwnerId
  );

  // Collect map of salesperson email -> { name, email, phone, records }
  const salespersonMap = new Map<string, { name: string; email: string; phone?: string; records: DueRecord[] }>();

  // 1. From database.salespersons
  for (const sp of configuredSalespersons) {
    const emailKey = sp.email.trim().toLowerCase();
    if (!emailKey) continue;
    const normalizedDealerCodes = (sp.dealerCodes || []).map(code => code.trim().toLowerCase());

    const assignedDues = dues.filter(due => {
      const dueDealerCode = (due.dealerCode || due.customerCode || "").trim().toLowerCase();
      const matchCode = normalizedDealerCodes.includes(dueDealerCode);
      const matchEmail = (due.salespersonEmail || "").trim().toLowerCase() === emailKey;
      const matchName = (due.salespersonName || "").trim().toLowerCase() === sp.name.trim().toLowerCase();
      return matchCode || matchEmail || matchName;
    });

    salespersonMap.set(emailKey, {
      name: sp.name,
      email: sp.email,
      phone: sp.phoneNumber,
      records: assignedDues
    });
  }

  // 2. From dues with salespersonEmail that might not be in database.salespersons
  const groupedByDueEmail = groupBy(
    dues.filter((entry) => entry.salespersonEmail),
    (entry) => entry.salespersonEmail.trim().toLowerCase()
  );

  for (const [emailKey, records] of groupedByDueEmail.entries()) {
    if (!salespersonMap.has(emailKey)) {
      const name = records[0]?.salespersonName || emailKey;
      salespersonMap.set(emailKey, {
        name,
        email: records[0]?.salespersonEmail || emailKey,
        records
      });
    }
  }

  const results: Array<{ email: string; skipped: boolean; recipientCount: number }> = [];

  for (const [emailKey, spData] of salespersonMap.entries()) {
    try {
      const { name, email, phone, records } = spData;

      // If salesperson has no assigned dues, skip
      if (records.length === 0) {
        results.push({ email, skipped: true, recipientCount: 0 });
        continue;
      }

      const salespersonLogs = sentLogs.filter((log) =>
        records.some((due) => due.id === log.dueId || due.dealerCode === log.dealerCode)
      );

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
      console.error(`Failed to send salesperson summary to ${emailKey}:`, err);
      results.push({ email: emailKey, skipped: true, recipientCount: 0 });
    }
  }

  return results;
}
