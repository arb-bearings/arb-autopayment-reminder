import { randomUUID } from "node:crypto";
import nodemailer from "nodemailer";
import {
  filterSharedCompanyRecords,
  getCompanyWorkspaceContext
} from "@/lib/company-workspace";
import { findMatchingMasterContact } from "@/lib/contact-matching";
import {
  isE164PhoneNumber,
  resolveDispatchSettings
} from "@/lib/dispatch-settings";
import { readDatabase, updateDatabase } from "@/lib/storage";
import type {
  CashDiscountPolicy,
  DashboardStats,
  DispatchSettings,
  DueRecord,
  MasterContact,
  ReminderLog,
  ReminderRule,
  ReminderTemplate
} from "@/lib/types";
import {
  fillTemplate,
  formatCurrency,
  formatDate,
  getDuePartyKey,
  getBillAgeDays,
  normalizeText,
  daysBetween,
  parseEmailList,
  isValidEmailList,
  formatEmailList
} from "@/lib/utils";
import { sendPaymentReminder } from "@/services/interaktService";
import { generateOutstandingPDF } from "./pdf-generator";
import { uploadPdfToGoogleDrive } from "@/services/googleDriveService";
import { buildEmailBody, buildWhatsappBody } from "@/lib/defaults";

type ReminderContext = {
  due: DueRecord;
  contact: MasterContact;
  rule: ReminderRule;
  template: ReminderTemplate;
  cdEvaluation: CashDiscountEvaluation;
  billAgeDays: number;
  paymentSummary: PaymentSummary;
};

type ReminderChannelSelection = Partial<Record<ReminderLog["channel"], boolean>>;

type CashDiscountEvaluation = {
  eligible: boolean;
  firstBill: boolean;
  policy: CashDiscountPolicy | null;
  reason: string;
  hasOlderUnpaid: boolean;
};

type PaymentSummary = {
  currentInvoiceDue: number;
  previousDue: number;
  totalDue: number;
  previousDues: DueRecord[];
};

export function calculateDynamicDays(age: number, ruleTriggerDay: number): number {
  if (ruleTriggerDay === 30) {
    if (age < 25) return 25 - age;
    return Math.max(0, 30 - age);
  }
  if (ruleTriggerDay === 45) {
    if (age < 40) return 40 - age;
    return Math.max(0, 45 - age);
  }
  if (ruleTriggerDay === 60) {
    if (age < 50) return 50 - age;
    return Math.max(0, 60 - age);
  }
  return Math.max(0, ruleTriggerDay - age);
}

export function calculateRuleOutstanding(dues: DueRecord[], ruleTriggerDay: number, today: Date = new Date()): number {
  return dues.reduce((sum, due) => {
    const age = getBillAgeDays(due.billDate || due.invoiceDate, today);
    if (age === null || !(due.amount > 0)) return sum;

    let inBucket = false;
    if (ruleTriggerDay === 30) {
      inBucket = (age >= 25 && age <= 30);
    } else if (ruleTriggerDay === 45) {
      inBucket = (age >= 40 && age <= 45);
    } else if (ruleTriggerDay === 60) {
      inBucket = (age > 50 && age <= 60);
    } else if (ruleTriggerDay === 75) {
      inBucket = (age > 60 && age <= 90);
    } else if (ruleTriggerDay === 90) {
      inBucket = (age > 90 && age <= 120);
    } else if (ruleTriggerDay === 120) {
      inBucket = (age > 120);
    } else {
      inBucket = (age === ruleTriggerDay);
    }

    if (inBucket) {
      return sum + (due.amount || 0);
    }
    return sum;
  }, 0);
}

function escapeHtml(value: string | number) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildReminderDedupeKey(
  due: DueRecord,
  rule: ReminderRule,
  channel: ReminderLog["channel"]
) {
  return [
    normalizeText(due.dealerCode || due.customerCode || due.companyName),
    normalizeText(due.invoiceNumber || due.reference || "no-invoice"),
    due.billDate || due.invoiceDate || "no-bill-date",
    rule.id,
    channel
  ].join("|");
}

/**
 * Returns the CD discount percentage string (e.g. "3%" or "2%") when the
 * customer is eligible with NO older unpaid invoices, otherwise "".
 * 30-day policy → "3%", 45-day policy → "2%".
 */
function buildCdAmount(evaluation: CashDiscountEvaluation): string {
  if (!evaluation.eligible || !evaluation.policy || evaluation.hasOlderUnpaid) {
    return "";
  }
  return `${evaluation.policy.discountPercent}%`;
}

/**
 * Returns the full CD sentence based on eligibility and whether older unpaid
 * invoices exist. Returns "" when the bill is outside every CD window.
 *
 * No older unpaid:  "To avail the X% CD benefit, please remit us the payment by/before the due date."
 * Has older unpaid: "To avail the X% CD benefit on this invoice, please arrange to remit us
 *                    the payment of your all older unpaid invoices along with the current
 *                    invoice by/before the due date."
 */
function buildCdMessage(evaluation: CashDiscountEvaluation): string {
  if (!evaluation.eligible || !evaluation.policy) {
    return "";
  }
  const pct = `${evaluation.policy.discountPercent}%`;
  if (evaluation.hasOlderUnpaid) {
    return `To avail the ${pct} CD benefit on this invoice, please arrange to remit us the payment of your all older unpaid invoices along with the current invoice by/before the due date.`;
  }
  return `To avail the ${pct} CD benefit, please remit us the payment by/before the due date.`;
}

function getOlderUnpaidDues(due: DueRecord, allDuesForDealer: DueRecord[]) {
  const currentBillDate = new Date(due.billDate || due.invoiceDate || "");

  return allDuesForDealer
    .filter((entry) => entry.id !== due.id && entry.amount > 0)
    .filter((entry) => {
      const otherBillDate = new Date(entry.billDate || entry.invoiceDate || "");

      if (Number.isNaN(otherBillDate.getTime())) {
        return false;
      }

      if (Number.isNaN(currentBillDate.getTime())) {
        return true;
      }

      return otherBillDate.getTime() < currentBillDate.getTime();
    })
    .sort((left, right) => (left.billDate || left.invoiceDate).localeCompare(right.billDate || right.invoiceDate));
}

function buildPaymentSummary(due: DueRecord, allDuesForDealer: DueRecord[]): PaymentSummary {
  const totalDue = allDuesForDealer.reduce((sum, entry) => sum + (entry.amount || 0), 0);
  const currentInvoiceDue = due.amount || 0;
  const previousDue = totalDue - currentInvoiceDue;
  const previousDues = allDuesForDealer.filter((entry) => entry.id !== due.id);

  return {
    currentInvoiceDue,
    previousDue,
    totalDue,
    previousDues
  };
}

function buildReplacements(context: ReminderContext, senderCompany: string) {
  const actualSenderCompany = "ARB Bearings Limited";
  const billDate = context.due.billDate || context.due.invoiceDate;
  const invoiceAmount = formatCurrency(context.due.amount, context.due.currency);
  const currentInvoiceDueAmount = formatCurrency(
    context.paymentSummary.currentInvoiceDue,
    context.due.currency
  );
  const previousDueAmount = formatCurrency(context.paymentSummary.previousDue, context.due.currency);
  const totalDueAmount = formatCurrency(context.paymentSummary.totalDue, context.due.currency);
  const invoiceNumber = context.due.invoiceNumber || context.due.reference || "N/A";
  const dueDate = context.due.dueDate ? formatDate(context.due.dueDate) : "Not available";

  return {
    amount: invoiceAmount,
    billAgeDays: context.billAgeDays,
    billDate: formatDate(billDate),
    companyBillKey: getDuePartyKey(context.due),
    // cdAmount: "3%" / "2%" if eligible with NO older unpaid invoices, else ""
    cdAmount: buildCdAmount(context.cdEvaluation),
    // cdMessage: full CD sentence (handles both older-unpaid and clean cases), else ""
    cdMessage: buildCdMessage(context.cdEvaluation),
    companyName: context.due.companyName,
    company_name: context.due.companyName,
    contactName:
      (context.contact.primaryContact && context.contact.primaryContact !== "Accounts Team")
        ? context.contact.primaryContact
        : (context.due.companyName || "Accounts Team"),
    currentInvoiceDueAmount,
    current_invoice_due_amount: currentInvoiceDueAmount,
    daysBeforeDue: context.rule.triggerDay,
    dealer_name: context.due.companyName,
    dealerCode: "",
    dueDate,
    due_date: dueDate,
    invoiceAmount,
    invoice_amount: invoiceAmount,
    invoiceNumber,
    invoice_no: invoiceNumber,
    openingAmount: formatCurrency(context.due.openingAmount, context.due.currency),
    overdueDays: Math.max(0, (context.billAgeDays || 0) - 60),
    previousDueAmount,
    previous_due_amount: previousDueAmount,
    pendingAmount: formatCurrency(context.due.amount, context.due.currency),
    reference: context.due.reference || context.due.invoiceNumber || "N/A",
    reminderDay: context.rule.triggerDay,
    senderCompany: actualSenderCompany,
    totalDueAmount,
    total_due_amount: totalDueAmount
  };
}

function buildChannelEntries(
  rule: ReminderRule,
  template: ReminderTemplate,
  contact: MasterContact,
  due: DueRecord,
  channelSelection?: ReminderChannelSelection,
  settings?: DispatchSettings
): Array<[ReminderLog["channel"], boolean, string, string]> {
  const emailGloballyEnabled = settings?.emailEnabled ?? true;
  const whatsappGloballyEnabled = settings?.whatsappEnabled ?? true;
  const smsGloballyEnabled = settings?.smsEnabled ?? false;

  return [
    [
      "email",
      emailGloballyEnabled && (channelSelection?.email ?? rule.channels.email),
      formatEmailList(contact.email || due.matchedEmail),
      template.emailBody
    ],
    [
      "whatsapp",
      whatsappGloballyEnabled && (channelSelection?.whatsapp ?? rule.channels.whatsapp),
      contact.whatsapp || due.matchedWhatsapp,
      template.whatsappBody
    ],
    [
      "sms",
      smsGloballyEnabled && (channelSelection?.sms ?? rule.channels.sms),
      contact.sms || due.matchedSms,
      template.smsBody
    ]
  ];
}

function hasExistingLog(logs: ReminderLog[], dedupeKey: string, scheduledFor: string) {
  return logs.some(
    (log) =>
      (log.dedupeKey || `${log.dueId}|${log.ruleId}|${log.channel}`) === dedupeKey &&
      log.scheduledFor === scheduledFor
  );
}

function normalizePhoneNumber(value: string) {
  const trimmed = value.trim().replace(/[\s()-]/g, "");

  if (isE164PhoneNumber(trimmed)) {
    return trimmed;
  }

  if (/^[6-9]\d{9}$/.test(trimmed)) {
    return `+91${trimmed}`;
  }

  if (/^91\d{10}$/.test(trimmed)) {
    return `+${trimmed}`;
  }

  if (/^[1-9]\d{7,14}$/.test(trimmed)) {
    return `+${trimmed}`;
  }

  return trimmed;
}

function isValidEmailAddress(value: string) {
  return isValidEmailList(value);
}

function templateIncludesCdToken(template: string) {
  return /\{\{\s*cd(?:Amount|Message)\s*\}\}/i.test(template);
}

function templateIncludesPaymentSummaryToken(template: string) {
  return /\{\{\s*(?:currentInvoiceDueAmount|current_invoice_due_amount|previousDueAmount|previous_due_amount)\s*\}\}/i.test(
    template
  );
}

function composeReminderContent(
  channel: ReminderLog["channel"],
  template: string,
  replacements: Record<string, string | number>,
  evaluation: CashDiscountEvaluation,
  paymentSummary: PaymentSummary,
  currency: string
) {
  const filledTemplate = fillTemplate(template, replacements).trim();

  if (!templateIncludesPaymentSummaryToken(template)) {
    let paymentSummaryText = "";
    if (channel === "email") {
      paymentSummaryText = [
        "",
        "Outstanding Summary:",
        `Current outstanding: ${formatCurrency(paymentSummary.currentInvoiceDue, currency)}`,
        `Total outstanding: ${formatCurrency(paymentSummary.totalDue, currency)}`
      ].join("\n");
    } else if (channel === "whatsapp") {
      paymentSummaryText = [
        "",
        "*Outstanding Summary*:",
        `*Current outstanding*: ${formatCurrency(paymentSummary.currentInvoiceDue, currency)}`,
        `*Total outstanding*: ${formatCurrency(paymentSummary.totalDue, currency)}`
      ].join("\n");
    } else {
      // SMS
      paymentSummaryText = [
        "",
        "Outstanding Summary:",
        `Current outstanding: ${formatCurrency(paymentSummary.currentInvoiceDue, currency)}`,
        `Total outstanding: ${formatCurrency(paymentSummary.totalDue, currency)}`
      ].join("\n");
    }

    return `${filledTemplate}\n${paymentSummaryText}`.trim();
  }

  return filledTemplate;
}

export function buildBasicEmailHtml(content: string) {
  return `
    <!doctype html>
    <html lang="en" xmlns="http://www.w3.org/1999/xhtml">
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <meta http-equiv="X-UA-Compatible" content="IE=edge">
        <meta name="x-apple-disable-message-reformatting">
        <meta name="format-detection" content="telephone=no,address=no,email=no,date=no,url=no">
        <title>Payment Notification</title>
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
          @media screen and (max-width: 640px) {
            .email-outer-wrap {
              padding: 12px 8px !important;
            }
            .email-card {
              border-radius: 6px !important;
              padding: 18px 14px !important;
            }
            p {
              font-size: 14px !important;
              line-height: 1.55 !important;
            }
          }
        </style>
      </head>
      <body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0f172a;-webkit-font-smoothing:antialiased;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;width:100%;background:#f1f5f9;">
          <tr>
            <td align="center" class="email-outer-wrap" style="padding:24px 12px;">
              <div class="email-card" style="max-width:640px;width:100%;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:10px;padding:24px 22px;text-align:left;box-shadow:0 1px 3px rgba(0,0,0,0.05);">
                ${content
                  .split(/\n{2,}/)
                  .map((paragraph) => `<p style="margin:0 0 14px;line-height:1.6;font-size:15px;color:#334155;word-break:break-word;">${escapeHtml(paragraph).replace(/\n/g, "<br>")}</p>`)
                  .join("")}
              </div>
            </td>
          </tr>
        </table>
      </body>
    </html>
  `;
}

export function buildReminderEmailHtml(log: ReminderLog, due: DueRecord, allDuesForDealer: DueRecord[], database?: any) {
  const referenceDate = log.sentAt ? new Date(log.sentAt) : (log.createdAt ? new Date(log.createdAt) : new Date());

  // Keep all pending invoices for the dealer (no 90 days limit)
  const filteredDues = allDuesForDealer;

  const paymentSummary = buildPaymentSummary(due, filteredDues);
  const currency = due.currency || "INR";

  // All invoices for this dealer (for the invoice table)
  // Sort by bill date ascending so oldest appears first
  const sortedDealerDues = [...filteredDues].sort((a, b) =>
    (a.billDate || a.invoiceDate || "").localeCompare(b.billDate || b.invoiceDate || "")
  );

  const invoiceRows = sortedDealerDues.map((entry) => {
    const isCurrent = entry.id === due.id;
    const billAge = getBillAgeDays(entry.billDate || entry.invoiceDate, referenceDate);
    const ageText = billAge !== null ? `${billAge} days` : "N/A";

    let bgStyle = "background:#ffffff;"; // default to white
    if (billAge !== null) {
      if (billAge > 90) {
        bgStyle = "background:#fee2e2;"; // soft red
      } else if (billAge >= 60 && billAge <= 90) {
        bgStyle = "background:#fef9c3;"; // soft yellow
      }
    }
    const rowBg = bgStyle;
    const fontWeight = isCurrent ? "font-weight:700;" : "";
    const borderLeft = isCurrent ? "border-left:3px solid #0f766e;" : "";

    return `
    <tr style="${rowBg}">
      <td class="table-cell" style="padding:10px 12px;border-bottom:1px solid #e2e8f0;color:#334155;font-size:13px;white-space:nowrap;${fontWeight}${borderLeft}">${escapeHtml(entry.billDate ? formatDate(entry.billDate) : (entry.invoiceDate ? formatDate(entry.invoiceDate) : "N/A"))}</td>
      <td class="table-cell wrap-cell" style="padding:10px 12px;border-bottom:1px solid #e2e8f0;color:#0f172a;font-size:13px;word-break:break-word;${fontWeight}">${escapeHtml(entry.invoiceNumber || entry.reference || "N/A")}</td>
      <td class="table-cell" style="padding:10px 12px;border-bottom:1px solid #e2e8f0;color:#475569;font-size:13px;white-space:nowrap;${fontWeight}">${escapeHtml(ageText)}</td>
      <td class="table-cell" style="padding:10px 12px;border-bottom:1px solid #e2e8f0;text-align:right;color:#0f172a;font-size:13px;white-space:nowrap;${fontWeight}">${escapeHtml(formatCurrency(entry.amount, entry.currency || currency))}</td>
    </tr>
  `;
  });

  // Dynamically calculate trigger day brackets
  const rules = database?.reminderRules;
  const activeTriggerDays: number[] = Array.from(
    new Set<number>(
      ((rules || []) as any[])
        .filter((r: any) => r.enabled)
        .map((r: any) => r.triggerDay as number)
        .filter((day: any) => typeof day === "number")
    )
  ).sort((a, b) => a - b); // ascending

  const sortedTriggerDays: number[] = activeTriggerDays.length > 0 ? activeTriggerDays : [30, 45, 60, 75, 80, 85, 90, 100, 110, 120];

  const currentRule = rules?.find((r: any) => r.id === log.ruleId);
  // Use log.reminderDay (= rule.triggerDay stored at creation) as fallback — more reliable than billAgeDays
  const currentRuleDay = currentRule ? currentRule.triggerDay : (log.reminderDay || log.billAgeDays || 30);

  const today = referenceDate;

  const policies = database?.cashDiscountPolicies?.filter((p: any) => p.ownerId === due.ownerId) || [];
  const cdEvaluation = evaluateCashDiscountEligibility(due, filteredDues, policies, today, currentRuleDay);

  // Box 1 Amount = sum of all dues for this dealer in the current rule stage
  const box2Amount = calculateRuleOutstanding(allDuesForDealer, currentRuleDay, today);

  // Find all other dues for this dealer (excluding the current invoice, must be older than current invoice)
  const currentInvoiceAge = getBillAgeDays(due?.billDate || due?.invoiceDate || "", today) || 0;
  const otherDues = allDuesForDealer.filter((entry) => {
    if (entry.id === due.id || !(entry.amount > 0)) return false;
    const entryAge = getBillAgeDays(entry.billDate || entry.invoiceDate, today) || 0;
    return entryAge > currentInvoiceAge;
  });

  // Box 2 Amount = sum of all other older invoices for this dealer
  const box3Amount = otherDues.reduce((sum, entry) => sum + (entry.amount || 0), 0);
  const box3Label = `Payment More Than ${currentRuleDay} Days`;

  // Total outstanding = sum of ALL dues for this dealer
  const calculatedTotalOutstanding = filteredDues.reduce((sum, entry) => sum + (entry.amount || 0), 0);

  // Box 1 Label
  let box2Label = "";
  if (currentRuleDay === 30) {
    const daysVal = calculateDynamicDays(currentInvoiceAge, 30);
    box2Label = `Payment Due in ${daysVal} Days to Avail 3% CD`;
  } else if (currentRuleDay === 45) {
    const daysVal = calculateDynamicDays(currentInvoiceAge, 45);
    box2Label = `Payment Due in ${daysVal} Days to Avail 2% CD`;
  } else {
    const daysVal = calculateDynamicDays(currentInvoiceAge, currentRuleDay);
    box2Label = `Payment Due in ${daysVal} Days`;
  }

  const paragraphs = log.content
    .split(/\n{2,}/)
    .filter((paragraph) => !/^(Payment Summary|Outstanding Summary):/i.test(paragraph.trim()))
    .filter((paragraph) => !/^(Total|Previous|Current) outstanding:/i.test(paragraph.trim()))
    .filter((paragraph) => !/^Final Reminder To Avail \d+% CD$/i.test(paragraph.trim()));

  const dearIdx = paragraphs.findIndex(p => p.trim().startsWith("Dear"));
  if (dearIdx !== -1 && currentRuleDay <= 60) {
    paragraphs.splice(dearIdx + 1, 0, `<strong>${box2Label}</strong>`);
  }

  const bodyHtml = paragraphs
    .map((paragraph) => {
      if (paragraph.startsWith("<strong>")) {
        return `<p style="margin:-4px 0 14px;font-weight:700;color:#0f766e;font-size:15px;line-height:1.5;">${paragraph.replace(/<\/?strong>/g, "")}</p>`;
      }
      return `<p style="margin:0 0 14px;line-height:1.6;color:#334155;font-size:14px;word-break:break-word;">${escapeHtml(paragraph).replace(/\n/g, "<br>")}</p>`;
    })
    .join("");

  const rule = database?.reminderRules?.find((r: any) => r.id === log.ruleId);
  const ruleTemplate = database?.templates?.find((t: any) => (rule?.templateId ? t.id === rule.templateId : t.ruleId === log.ruleId));

  const show1 = (ruleTemplate?.pdfBox1Visible ?? rule?.pdfBox1Visible) !== false;
  const show3 = (ruleTemplate?.pdfBox3Visible ?? rule?.pdfBox3Visible) !== false;

  const label1 = (ruleTemplate?.pdfBox1Label || rule?.pdfBox1Label || "")?.trim() || box2Label;
  const label3 = (ruleTemplate?.pdfBox3Label || rule?.pdfBox3Label || "")?.trim() || "Total Outstanding";

  type EmailBox = { label: string; amount: number; color: string };
  const visibleEmailBoxes: EmailBox[] = [
    ...(show1 ? [{ label: label1, amount: box2Amount, color: "#0f172a" }] : []),
    ...(show3 ? [{ label: label3, amount: calculatedTotalOutstanding, color: "#0f766e" }] : []),
  ];

  const cellWidth = visibleEmailBoxes.length > 0 ? (100 / visibleEmailBoxes.length).toFixed(2) : "100";

  const summaryBoxesHtml = visibleEmailBoxes.length === 0 ? "" : `
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;margin:0 0 18px;table-layout:fixed;width:100%;">
      <tr>
        ${visibleEmailBoxes.map((box) => `
          <td class="stack-col" style="width:${cellWidth}%;padding:4px;vertical-align:top;">
            <div class="metric-card-inner" style="border:1px solid #e2e8f0;border-radius:8px;padding:12px 14px;background:#f8fafc;box-sizing:border-box;">
              <div class="metric-label" style="font-size:11px;color:#64748b;font-weight:700;text-transform:uppercase;letter-spacing:.02em;line-height:1.3;word-break:break-word;">${escapeHtml(box.label)}</div>
              <div class="metric-value" style="font-size:18px;font-weight:800;margin-top:6px;color:${box.color};letter-spacing:-.01em;">${escapeHtml(formatCurrency(box.amount, currency))}</div>
            </div>
          </td>
        `).join("")}
      </tr>
    </table>
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
        <title>Payment Reminder - Invoice ${escapeHtml(log.invoiceNumber || due.invoiceNumber || due.reference || "N/A")}</title>
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
              padding: 16px 14px !important;
            }
            .header-title {
              font-size: 19px !important;
              line-height: 1.25 !important;
            }
            .stack-col {
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
              font-size: 17px !important;
            }
            .table-scroll-wrapper {
              width: 100% !important;
              overflow-x: auto !important;
              -webkit-overflow-scrolling: touch !important;
              display: block !important;
              margin-bottom: 14px !important;
              border: 1px solid #e2e8f0 !important;
              border-radius: 6px !important;
            }
            .data-table {
              min-width: 320px !important;
              width: 100% !important;
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
              <div class="email-container" style="max-width:680px;width:100%;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:10px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.05);text-align:left;">
                
                <!-- Header Banner -->
                <div class="header-box" style="padding:22px 24px;background:#0f766e;color:#ffffff;">
                  <div style="font-size:11px;letter-spacing:.05em;text-transform:uppercase;color:#99f6e4;font-weight:700;">Payment Reminder</div>
                  <h1 class="header-title" style="margin:6px 0 0;font-size:21px;line-height:1.25;color:#ffffff;font-weight:800;">Invoice ${escapeHtml(log.invoiceNumber || due.invoiceNumber || due.reference || "N/A")}</h1>
                  <div style="margin-top:4px;font-size:14px;color:#ccfbf1;font-weight:500;">${escapeHtml(due.companyName || "Customer")}</div>
                </div>

                <!-- Main Content Area -->
                <div class="content-box" style="padding:22px 24px;">

                  <!-- Summary Metric Boxes -->
                  ${summaryBoxesHtml}

                  <!-- Message Body -->
                  <div style="margin-bottom:18px;">
                    ${bodyHtml}
                  </div>

                  <!-- Invoice Table -->
                  <h2 style="font-size:16px;line-height:1.3;margin:22px 0 10px;color:#0f172a;font-weight:800;">Invoice Table</h2>
                  <div class="table-scroll-wrapper" style="width:100%;overflow-x:auto;-webkit-overflow-scrolling:touch;border:1px solid #e2e8f0;border-radius:8px;margin-bottom:16px;">
                    <table class="data-table" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;width:100%;background:#ffffff;">
                      <thead>
                        <tr style="background:#f8fafc;">
                          <th align="left" class="table-cell" style="padding:10px 12px;border-bottom:1px solid #e2e8f0;color:#475569;font-size:11px;text-transform:uppercase;letter-spacing:.03em;font-weight:800;white-space:nowrap;">Invoice Date</th>
                          <th align="left" class="table-cell" style="padding:10px 12px;border-bottom:1px solid #e2e8f0;color:#475569;font-size:11px;text-transform:uppercase;letter-spacing:.03em;font-weight:800;">Invoice Number</th>
                          <th align="left" class="table-cell" style="padding:10px 12px;border-bottom:1px solid #e2e8f0;color:#475569;font-size:11px;text-transform:uppercase;letter-spacing:.03em;font-weight:800;white-space:nowrap;">Days Aged</th>
                          <th align="right" class="table-cell" style="padding:10px 12px;border-bottom:1px solid #e2e8f0;color:#475569;font-size:11px;text-transform:uppercase;letter-spacing:.03em;font-weight:800;white-space:nowrap;">Outstanding</th>
                        </tr>
                      </thead>
                      <tbody>
                        ${invoiceRows.join("") || `<tr><td colspan="4" class="table-cell" style="padding:14px;color:#64748b;font-size:13px;text-align:center;">No invoices found.</td></tr>`}
                        <tr style="background:#f8fafc;font-weight:bold;border-top:2px solid #e2e8f0;">
                          <td colspan="3" class="table-cell" style="padding:10px 12px;color:#0f172a;font-weight:800;font-size:13px;">Total Outstanding</td>
                          <td class="table-cell" style="padding:10px 12px;text-align:right;color:#0f766e;font-weight:800;font-size:13px;white-space:nowrap;">${escapeHtml(formatCurrency(paymentSummary.totalDue, currency))}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>

                  <div style="font-size:12px;color:#94a3b8;line-height:1.4;margin-top:20px;text-align:center;">
                    This is an automated payment reminder. If you have already made the payment, please disregard this notice.
                  </div>

                </div>
              </div>
            </td>
          </tr>
        </table>
      </body>
    </html>
  `;
}

export function evaluateCashDiscountEligibility(
  due: DueRecord,
  allDuesForDealer: DueRecord[],
  policies: CashDiscountPolicy[],
  referenceDate: Date,
  ruleTriggerDay?: number
): CashDiscountEvaluation {
  const billAgeDays = getBillAgeDays(due.billDate || due.invoiceDate, referenceDate);

  if (billAgeDays === null) {
    return {
      eligible: false,
      firstBill: false,
      policy: null,
      reason: "Bill date is missing, so CD eligibility could not be evaluated.",
      hasOlderUnpaid: false
    };
  }

  const olderBills = allDuesForDealer
    .filter((entry) => entry.id !== due.id)
    .filter((entry) => {
      const otherBillDate = new Date(entry.billDate || entry.invoiceDate || "");
      const currentBillDate = new Date(due.billDate || due.invoiceDate || "");

      return (
        !Number.isNaN(otherBillDate.getTime()) &&
        !Number.isNaN(currentBillDate.getTime()) &&
        otherBillDate.getTime() < currentBillDate.getTime()
      );
    })
    .sort((left, right) => (left.billDate || left.invoiceDate).localeCompare(right.billDate || right.invoiceDate));

  const olderUnpaidBills = olderBills
    .filter((entry) => entry.amount > 0)
    .sort((left, right) => (left.billDate || left.invoiceDate).localeCompare(right.billDate || right.invoiceDate));

  const hasOlderUnpaid = olderUnpaidBills.length > 0;

  // New logic: Grace-period ranges for CD eligibility
  let eligiblePolicy: CashDiscountPolicy | null = null;
  let discountPercent = 0;
  let paymentWindowDays = 0;

  if (billAgeDays >= 25 && billAgeDays <= 30) {
    discountPercent = 3;
    paymentWindowDays = 30;
  } else if (billAgeDays >= 40 && billAgeDays <= 45) {
    discountPercent = 2;
    paymentWindowDays = 45;
  }

  if (discountPercent > 0) {
    const policyFromDb = policies.find(
      (p) => p.enabled && p.discountPercent === discountPercent
    );
    eligiblePolicy = policyFromDb || {
      id: `temp-cd-${discountPercent}`,
      ownerId: due.ownerId,
      name: `${paymentWindowDays} Day CD`,
      paymentWindowDays,
      discountPercent,
      enabled: true,
      description: `Customer remains eligible for ${discountPercent}% cash discount when payment is cleared within ${paymentWindowDays} days.`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
  }

  if (!eligiblePolicy) {
    return {
      eligible: false,
      firstBill: olderBills.length === 0,
      policy: null,
      reason: "Bill age is outside every configured cash discount window.",
      hasOlderUnpaid
    };
  }

  const firstBill = olderBills.length === 0;

  let reason = "";
  if (hasOlderUnpaid) {
    const oldestPending = olderUnpaidBills[0];
    reason = `Eligible for ${eligiblePolicy.discountPercent}% CD under the ${eligiblePolicy.paymentWindowDays}-day policy if older unpaid invoice ${oldestPending.invoiceNumber || oldestPending.reference || "N/A"} is also cleared.`;
  } else {
    reason = firstBill
      ? `Eligible for ${eligiblePolicy.discountPercent}% CD under the ${eligiblePolicy.paymentWindowDays}-day policy because this is the first active bill on record.`
      : `Eligible for ${eligiblePolicy.discountPercent}% CD under the ${eligiblePolicy.paymentWindowDays}-day policy because no older unpaid invoices remain open.`;
  }

  return {
    eligible: true,
    firstBill,
    policy: eligiblePolicy,
    reason,
    hasOlderUnpaid
  };
}

export async function getDashboardStats(ownerId: string): Promise<DashboardStats> {
  const database = await readDatabase();
  const user = database.users.find((entry) => entry.id === ownerId);

  if (!user) {
    return {
      masterCount: 0,
      dueCount: 0,
      pendingReminders: 0,
      sentReminders: 0,
      sentByChannel: {
        email: 0,
        whatsapp: 0,
        sms: 0
      },
      totalCompanies: 0,
      totalOutstandingAmount: 0,
      todayRemindersSent: 0,
      successRate: 0,
      failureRate: 0,
      failedDeliveries: 0
    };
  }

  const workspace = getCompanyWorkspaceContext(database, user.companyName);
  const reminderLogs = filterSharedCompanyRecords(database.reminderLogs, workspace.sharedOwnerIds);
  const dues = filterSharedCompanyRecords(database.dueRecords, workspace.sharedOwnerIds);
  const deliveredLogs = reminderLogs.filter((entry) => entry.status === "sent");
  const delivered = deliveredLogs.length;
  const failed = reminderLogs.filter((entry) => entry.status === "failed").length;
  const totalProcessed = delivered + failed;
  const today = new Date().toISOString().slice(0, 10);

  return {
    masterCount: filterSharedCompanyRecords(database.masterContacts, workspace.sharedOwnerIds).length,
    dueCount: dues.length,
    pendingReminders: reminderLogs.filter((entry) => entry.status === "pending").length,
    sentReminders: delivered,
    sentByChannel: {
      email: deliveredLogs.filter((entry) => entry.channel === "email").length,
      whatsapp: deliveredLogs.filter((entry) => entry.channel === "whatsapp").length,
      sms: deliveredLogs.filter((entry) => entry.channel === "sms").length
    },
    totalCompanies: new Set(dues.map((entry) => entry.companyName).filter(Boolean)).size,
    totalOutstandingAmount: dues.reduce((sum, entry) => sum + entry.amount, 0),
    todayRemindersSent: reminderLogs.filter(
      (entry) =>
        entry.status === "sent" &&
        (entry.sentAt || entry.createdAt).slice(0, 10) === today
    ).length,
    successRate: totalProcessed === 0 ? 0 : Math.round((delivered / totalProcessed) * 100),
    failureRate: totalProcessed === 0 ? 0 : Math.round((failed / totalProcessed) * 100),
    failedDeliveries: failed
  };
}

export async function generateRemindersForUser(ownerId: string, requestedDate?: string, forceAllRules = false) {
  return updateDatabase(async (database) => {
    const user = database.users.find((entry) => entry.id === ownerId);
    if (!user) {
      throw new Error("The current user could not be found.");
    }

    const workspace = getCompanyWorkspaceContext(database, user.companyName);
    const contacts = filterSharedCompanyRecords(database.masterContacts, workspace.sharedOwnerIds);
    const dues = filterSharedCompanyRecords(database.dueRecords, workspace.sharedOwnerIds);
    const rules = database.reminderRules
      .filter((entry) => entry.ownerId === workspace.configOwnerId && entry.enabled)
      .sort((left, right) => left.triggerDay - right.triggerDay);
    const templates = database.templates.filter(
      (entry) => entry.ownerId === workspace.configOwnerId
    );
    const policies = database.cashDiscountPolicies.filter(
      (entry) => entry.ownerId === workspace.configOwnerId
    );
    const today = requestedDate ? new Date(requestedDate) : new Date();
    const scheduledFor = new Date(
      Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())
    ).toISOString();
    const created: ReminderLog[] = [];

    const rawSettings = database.dispatchSettings.find((entry) => entry.ownerId === workspace.configOwnerId);
    const settings = resolveDispatchSettings(rawSettings ?? { ownerId: workspace.configOwnerId });
    const thresholdAmount = settings.thresholdAmount ?? 10000;

    // 1. Group invoices by dealer (using getDuePartyKey)
    const invoicesByDealer = new Map<string, DueRecord[]>();
    for (const due of dues) {
      if (!(due.amount > 0)) continue; // only open/unpaid invoices
      const key = getDuePartyKey(due);
      if (!invoicesByDealer.has(key)) {
        invoicesByDealer.set(key, []);
      }
      invoicesByDealer.get(key)!.push(due);
    }

    // 2. Process each dealer
    for (const [dealerKey, dealerInvoices] of invoicesByDealer.entries()) {
      const representativeDue = dealerInvoices[0];
      const contact = findMatchingMasterContact(representativeDue, contacts);
      if (!contact) {
        continue;
      }

      // Calculate invoice age and sort from oldest to newest
      const invoicesWithAge = dealerInvoices
        .map((inv) => ({
          inv,
          age: getBillAgeDays(inv.billDate || inv.invoiceDate, today)
        }))
        .filter((item): item is { inv: DueRecord; age: number } => item.age !== null)
        .sort((a, b) => b.age - a.age); // oldest first (descending age)

      if (invoicesWithAge.length === 0) {
        continue;
      }

      // Group invoices into the 6 non-overlapping ageing buckets:
      const bucket1: DueRecord[] = []; // Age > 120
      const bucket2: DueRecord[] = []; // Age > 90 and <= 120
      const bucket3: DueRecord[] = []; // Age > 60 and <= 90
      const bucket4: DueRecord[] = []; // Age > 50 and <= 60
      const bucket5: DueRecord[] = []; // Age >= 40 and <= 45 (2% CD)
      const bucket6: DueRecord[] = []; // Age >= 25 and <= 30 (3% CD)

      for (const item of invoicesWithAge) {
        const age = item.age;
        if (age > 120) {
          bucket1.push(item.inv);
        } else if (age > 90 && age <= 120) {
          bucket2.push(item.inv);
        } else if (age > 60 && age <= 90) {
          bucket3.push(item.inv);
        } else if (age > 50 && age <= 60) {
          bucket4.push(item.inv);
        } else if (age >= 40 && age <= 45) {
          bucket5.push(item.inv);
        } else if (age >= 25 && age <= 30) {
          bucket6.push(item.inv);
        }
      }

      // Sum of pending amounts in each bucket
      const sum1 = bucket1.reduce((sum, inv) => sum + inv.amount, 0);
      const sum2 = bucket2.reduce((sum, inv) => sum + inv.amount, 0);
      const sum3 = bucket3.reduce((sum, inv) => sum + inv.amount, 0);
      const sum4 = bucket4.reduce((sum, inv) => sum + inv.amount, 0);
      const sum5 = bucket5.reduce((sum, inv) => sum + inv.amount, 0);
      const sum6 = bucket6.reduce((sum, inv) => sum + inv.amount, 0);

      // Accumulation logic: process from oldest (bucket 1) to newest (bucket 6)
      let selectedStageNum = 0; // 0 means none
      let accumulated = 0;
      let relevantAmount = 0;
      let selectedInvoices: DueRecord[] = [];

      // Check Stage 1 (120+)
      if (bucket1.length > 0) {
        accumulated += sum1;
        if (accumulated >= thresholdAmount) {
          selectedStageNum = 1;
          relevantAmount = sum1;
          selectedInvoices = bucket1;
        }
      }

      // Check Stage 2 (90–120)
      if (selectedStageNum === 0 && bucket2.length > 0) {
        accumulated += sum2;
        if (accumulated >= thresholdAmount) {
          selectedStageNum = 2;
          relevantAmount = sum2;
          selectedInvoices = bucket2;
        }
      }

      // Check Stage 3 (60–90)
      if (selectedStageNum === 0 && bucket3.length > 0) {
        accumulated += sum3;
        if (accumulated >= thresholdAmount) {
          selectedStageNum = 3;
          relevantAmount = sum3;
          selectedInvoices = bucket3;
        }
      }

      // Check Stage 4 (50–60)
      if (selectedStageNum === 0 && bucket4.length > 0) {
        accumulated += sum4;
        if (accumulated >= thresholdAmount) {
          selectedStageNum = 4;
          relevantAmount = sum4;
          selectedInvoices = bucket4;
        }
      }

      // Check Stage 5 (2% CD)
      if (selectedStageNum === 0 && bucket5.length > 0) {
        accumulated += sum5;
        if (accumulated >= thresholdAmount) {
          selectedStageNum = 5;
          relevantAmount = sum5;
          selectedInvoices = bucket5;
        }
      }

      // Check Stage 6 (3% CD)
      if (selectedStageNum === 0 && bucket6.length > 0) {
        accumulated += sum6;
        if (accumulated >= thresholdAmount) {
          selectedStageNum = 6;
          relevantAmount = sum6;
          selectedInvoices = bucket6;
        }
      }

      // If no stage crossed the threshold, do not send any reminder
      if (selectedStageNum === 0) {
        continue;
      }

      // Map selectedStageNum to rule triggerDay
      let targetTriggerDay = 0;
      let stageLabel = "";
      let reminderType = "";
      if (selectedStageNum === 1) {
        targetTriggerDay = 120;
        stageLabel = "Age > 120";
        reminderType = "120+ Overdue Reminder";
      } else if (selectedStageNum === 2) {
        targetTriggerDay = 90;
        stageLabel = "Age 90-120";
        reminderType = "90+ Overdue Reminder";
      } else if (selectedStageNum === 3) {
        targetTriggerDay = 75;
        stageLabel = "Age 60-90";
        reminderType = "60+ Overdue Reminder";
      } else if (selectedStageNum === 4) {
        targetTriggerDay = 60;
        stageLabel = "Age 50-60";
        reminderType = "50-60 Day Reminder";
      } else if (selectedStageNum === 5) {
        targetTriggerDay = 45;
        stageLabel = "Age 40-45 (2% CD)";
        reminderType = "2% Cash Discount";
      } else if (selectedStageNum === 6) {
        targetTriggerDay = 30;
        stageLabel = "Age 25-30 (3% CD)";
        reminderType = "3% Cash Discount";
      }

      // Find the enabled rule for this triggerDay
      const rule = rules.find((r) => r.triggerDay === targetTriggerDay);
      if (!rule) {
        continue;
      }

      // Check dealer-level 5-day silence window cooldown:
      const targetCode = (representativeDue.dealerCode || representativeDue.customerCode || "").trim().toLowerCase();
      const targetName = (representativeDue.companyName || "").trim().toLowerCase();

      const hasRecentSentReminder = database.reminderLogs.some((log) => {
        if (log.status !== "sent") {
          return false;
        }
        const logCode = (log.dealerCode || "").trim().toLowerCase();
        const logName = (log.dealerName || "").trim().toLowerCase();
        const matchesDealer = (targetCode && logCode && logCode === targetCode) || (targetName && logName && logName === targetName);
        if (!matchesDealer) {
          return false;
        }
        const logDateStr = log.sentAt || log.createdAt;
        if (!logDateStr) return false;
        const logDate = new Date(logDateStr);
        if (Number.isNaN(logDate.getTime())) return false;
        const days = daysBetween(logDate, today);
        return days >= 0 && days < 5; // cooldown is active if less than 5 days have passed
      });

      if (hasRecentSentReminder) {
        continue;
      }

      // Prevent duplicate sends if the scheduler runs more than once on the same day.
      const alreadyScheduledToday = database.reminderLogs.some((log) => {
        const logCode = (log.dealerCode || "").trim().toLowerCase();
        const logName = (log.dealerName || "").trim().toLowerCase();
        const matchesDealer = (targetCode && logCode && logCode === targetCode) || (targetName && logName && logName === targetName);
        return matchesDealer && log.scheduledFor === scheduledFor;
      });

      if (alreadyScheduledToday) {
        continue;
      }

      // Determine oldest invoice in the selected bucket for wording/age calculations
      const sortedSelectedInvoices = [...selectedInvoices].sort((a, b) => {
        const ageA = getBillAgeDays(a.billDate || a.invoiceDate, today) || 0;
        const ageB = getBillAgeDays(b.billDate || b.invoiceDate, today) || 0;
        return ageB - ageA; // oldest first
      });
      const oldestSelectedDue = sortedSelectedInvoices[0];
      const oldestSelectedDueAge = getBillAgeDays(oldestSelectedDue.billDate || oldestSelectedDue.invoiceDate, today) || 0;

      // Evaluate Cash Discount eligibility using the oldest invoice in the selected stage
      const cdEvaluation = evaluateCashDiscountEligibility(
        oldestSelectedDue,
        dealerInvoices,
        policies,
        today,
        rule.triggerDay
      );

      const template = templates.find((entry) => entry.id === rule.templateId);
      if (!template) {
        continue;
      }

      // Calculate total outstanding of ALL unpaid invoices for the dealer
      const totalOutstanding = dealerInvoices.reduce((sum, entry) => sum + (entry.amount || 0), 0);

      // Build custom payment summary for replacements
      const customPaymentSummary = {
        currentInvoiceDue: relevantAmount,
        previousDue: totalOutstanding - relevantAmount,
        totalDue: totalOutstanding,
        previousDues: dealerInvoices.filter((entry) => !selectedInvoices.some((si) => si.id === entry.id))
      };

      // For dynamic calculation of days relative to the bucket milestones
      const daysBeforeDueVal = calculateDynamicDays(oldestSelectedDueAge, rule.triggerDay);

      // Build custom Replacements
      const invoiceAmount = formatCurrency(relevantAmount, oldestSelectedDue.currency);
      const currentInvoiceDueAmount = formatCurrency(relevantAmount, oldestSelectedDue.currency);
      const previousDueAmount = formatCurrency(customPaymentSummary.previousDue, oldestSelectedDue.currency);
      const totalDueAmount = formatCurrency(totalOutstanding, oldestSelectedDue.currency);
      const invoiceNumber = selectedInvoices.map((inv) => inv.invoiceNumber || inv.reference || "N/A").join(", ");
      const dueDate = oldestSelectedDue.dueDate ? formatDate(oldestSelectedDue.dueDate) : "Not available";

      const replacements = {
        amount: invoiceAmount,
        billAgeDays: oldestSelectedDueAge,
        billDate: formatDate(oldestSelectedDue.billDate || oldestSelectedDue.invoiceDate),
        companyBillKey: getDuePartyKey(oldestSelectedDue),
        cdAmount: buildCdAmount(cdEvaluation),
        cdMessage: buildCdMessage(cdEvaluation),
        companyName: oldestSelectedDue.companyName,
        company_name: oldestSelectedDue.companyName,
        contactName:
          (contact.primaryContact && contact.primaryContact !== "Accounts Team")
            ? contact.primaryContact
            : (oldestSelectedDue.companyName || "Accounts Team"),
        currentInvoiceDueAmount,
        current_invoice_due_amount: currentInvoiceDueAmount,
        daysBeforeDue: daysBeforeDueVal,
        dealer_name: oldestSelectedDue.companyName,
        dealerCode: oldestSelectedDue.dealerCode || oldestSelectedDue.customerCode,
        dueDate,
        due_date: dueDate,
        invoiceAmount,
        invoice_amount: invoiceAmount,
        invoiceNumber,
        invoice_no: invoiceNumber,
        openingAmount: formatCurrency(oldestSelectedDue.openingAmount, oldestSelectedDue.currency),
        overdueDays: Math.max(0, oldestSelectedDueAge - 60),
        previousDueAmount,
        previous_due_amount: previousDueAmount,
        pendingAmount: invoiceAmount,
        reference: invoiceNumber,
        reminderDay: rule.triggerDay,
        senderCompany: user?.companyName || "ARB Bearings Limited",
        totalDueAmount,
        total_due_amount: totalDueAmount
      };

      let effectiveTemplate = template;
      if (rule.triggerDay === 30 && oldestSelectedDueAge > 30) {
        effectiveTemplate = {
          ...template,
          emailBody: buildEmailBody(35),
          whatsappBody: buildWhatsappBody(35),
          smsBody: buildWhatsappBody(35)
        };
      } else if (rule.triggerDay === 45 && oldestSelectedDueAge > 45) {
        effectiveTemplate = {
          ...template,
          emailBody: buildEmailBody(50),
          whatsappBody: buildWhatsappBody(50),
          smsBody: buildWhatsappBody(50)
        };
      }

      const channelEntries = buildChannelEntries(rule, effectiveTemplate, contact, oldestSelectedDue, undefined, settings);

      for (const [channel, enabled, recipient, body] of channelEntries) {
        if (!enabled || !recipient) {
          continue;
        }

        const dedupeKey = buildReminderDedupeKey(oldestSelectedDue, rule, channel);

        if (hasExistingLog(database.reminderLogs, dedupeKey, scheduledFor)) {
          continue;
        }

        let subject = channel === "email"
          ? fillTemplate(template.emailSubject, replacements)
          : `${rule.name} reminder`;
        let content = composeReminderContent(
          channel,
          body,
          replacements,
          cdEvaluation,
          customPaymentSummary,
          oldestSelectedDue.currency
        );

        // Dynamically replace any mentions of "5 days" or "5 day" in subject or content for rules 30, 45, and 60
        if (rule.triggerDay === 30 || rule.triggerDay === 45 || rule.triggerDay === 60) {
          const replacementText = `${daysBeforeDueVal} days`;
          subject = subject.replace(/5\s+days?/gi, replacementText);
          content = content.replace(/5\s+days?/gi, replacementText);
          subject = subject.replace(/5-day/gi, `${daysBeforeDueVal}-day`).replace(/5\s+day/gi, `${daysBeforeDueVal} day`);
          content = content.replace(/5-day/gi, `${daysBeforeDueVal}-day`).replace(/5\s+day/gi, `${daysBeforeDueVal} day`);
        }

        created.push({
          id: randomUUID(),
          ownerId: workspace.workspaceId,
          dueId: oldestSelectedDue.id,
          dedupeKey,
          contactId: contact.id,
          ruleId: rule.id,
          templateId: template.id,
          dealerCode: oldestSelectedDue.dealerCode || oldestSelectedDue.customerCode,
          invoiceNumber: oldestSelectedDue.invoiceNumber || oldestSelectedDue.reference || "",
          reminderDay: rule.triggerDay,
          billAgeDays: oldestSelectedDueAge,
          cdEligible: cdEvaluation.eligible,
          cdPolicyId: cdEvaluation.policy?.id || "",
          cdDiscountPercent: cdEvaluation.policy?.discountPercent ?? 0,
          cdReason: cdEvaluation.reason,
          channel,
          recipient,
          scheduledFor,
          status: "pending",
          subject,
          content,
          failureReason: "",
          sentAt: "",
          createdAt: new Date().toISOString(),
          dealerName: oldestSelectedDue.companyName,
          reminderType,
          selectedAgeingStage: stageLabel,
          invoiceIdsInvolved: selectedInvoices.map((inv) => inv.id),
          relevantAmount,
          totalOutstanding,
          thresholdAmount
        });
      }
    }

    database.reminderLogs.push(...created);
    return created;
  });
}

export async function createManualRemindersForDue(
  ownerId: string,
  dueId: string,
  ruleId: string,
  channelSelection?: ReminderChannelSelection
) {
  return updateDatabase((database) => {
    const user = database.users.find((entry) => entry.id === ownerId);
    if (!user) {
      throw new Error("The current user could not be found.");
    }

    const workspace = getCompanyWorkspaceContext(database, user.companyName);
    const due = database.dueRecords.find(
      (entry) => workspace.sharedOwnerIds.has(entry.ownerId) && entry.id === dueId
    );
    if (!due) {
      throw new Error("The selected invoice could not be found.");
    }

    const contact = findMatchingMasterContact(
      due,
      filterSharedCompanyRecords(database.masterContacts, workspace.sharedOwnerIds)
    );
    if (!contact) {
      throw new Error("No matching master contact was found for that invoice.");
    }

    const rule = database.reminderRules.find(
      (entry) => entry.ownerId === workspace.configOwnerId && entry.id === ruleId
    );
    if (!rule) {
      throw new Error("The selected reminder rule could not be found.");
    }

    const template = database.templates.find(
      (entry) => entry.ownerId === workspace.configOwnerId && entry.id === rule.templateId
    );
    if (!template) {
      throw new Error("The selected reminder template could not be found.");
    }

    const billAgeDays = getBillAgeDays(due.billDate || due.invoiceDate, new Date());
    if (billAgeDays === null) {
      throw new Error("The selected invoice does not have a valid bill date.");
    }

    const policies = database.cashDiscountPolicies.filter(
      (entry) => entry.ownerId === workspace.configOwnerId
    );
    const allDuesForDealer = filterSharedCompanyRecords(database.dueRecords, workspace.sharedOwnerIds).filter(
      (entry) => getDuePartyKey(entry) === getDuePartyKey(due)
    );
    const rawPaymentSummary = buildPaymentSummary(due, allDuesForDealer);
    const ruleOutstanding = calculateRuleOutstanding(allDuesForDealer, rule.triggerDay, new Date());
    const paymentSummary = {
      currentInvoiceDue: ruleOutstanding,
      previousDue: rawPaymentSummary.totalDue - ruleOutstanding,
      totalDue: rawPaymentSummary.totalDue,
      previousDues: rawPaymentSummary.previousDues
    };
    const cdEvaluation = evaluateCashDiscountEligibility(
      due,
      allDuesForDealer,
      policies,
      new Date(),
      rule.triggerDay
    );
    const scheduledFor = new Date().toISOString();
    const replacements = buildReplacements(
      { due, contact, rule, template, cdEvaluation, billAgeDays, paymentSummary },
      user?.companyName || "Your Company"
    );
    const created: ReminderLog[] = [];
    const rawSettings = database.dispatchSettings.find((entry) => entry.ownerId === workspace.configOwnerId);
    const settings = resolveDispatchSettings(rawSettings ?? { ownerId: workspace.configOwnerId });
    let effectiveTemplate = template;
    if (rule.triggerDay === 30 && billAgeDays > 30) {
      effectiveTemplate = {
        ...template,
        emailBody: buildEmailBody(35),
        whatsappBody: buildWhatsappBody(35),
        smsBody: buildWhatsappBody(35)
      };
    } else if (rule.triggerDay === 45 && billAgeDays > 45) {
      effectiveTemplate = {
        ...template,
        emailBody: buildEmailBody(50),
        whatsappBody: buildWhatsappBody(50),
        smsBody: buildWhatsappBody(50)
      };
    }

    const channelEntries = buildChannelEntries(rule, effectiveTemplate, contact, due, channelSelection, settings);

    for (const [channel, enabled, recipient, body] of channelEntries) {
      if (!enabled || !recipient) {
        continue;
      }

      let subject = channel === "email"
        ? fillTemplate(template.emailSubject, replacements)
        : `${rule.name} reminder`;
      let content = composeReminderContent(
        channel,
        body,
        replacements,
        cdEvaluation,
        paymentSummary,
        due.currency
      );

      if (rule.triggerDay === 30 || rule.triggerDay === 45 || rule.triggerDay === 60) {
        const daysVal = calculateDynamicDays(billAgeDays, rule.triggerDay);
        const replacementText = `${daysVal} days`;
        subject = subject.replace(/5\s+days?/gi, replacementText);
        content = content.replace(/5\s+days?/gi, replacementText);
        subject = subject.replace(/5-day/gi, `${daysVal}-day`).replace(/5\s+day/gi, `${daysVal} day`);
        content = content.replace(/5-day/gi, `${daysVal}-day`).replace(/5\s+day/gi, `${daysVal} day`);
      }

      created.push({
        id: randomUUID(),
        ownerId: workspace.workspaceId,
        dueId: due.id,
        dedupeKey: `${buildReminderDedupeKey(due, rule, channel)}|manual|${scheduledFor}`,
        contactId: contact.id,
        ruleId: rule.id,
        templateId: template.id,
        dealerCode: due.dealerCode || due.customerCode,
        invoiceNumber: due.invoiceNumber || due.reference || "",
        reminderDay: rule.triggerDay,
        billAgeDays,
        cdEligible: cdEvaluation.eligible,
        cdPolicyId: cdEvaluation.policy?.id || "",
        cdDiscountPercent: cdEvaluation.policy?.discountPercent ?? (rule.triggerDay === 30 ? 3 : rule.triggerDay === 45 ? 2 : 0),
        cdReason: cdEvaluation.reason,
        channel,
        recipient,
        scheduledFor,
        status: "pending",
        subject,
        content,
        failureReason: "",
        sentAt: "",
        createdAt: scheduledFor,
        dealerName: due.companyName,
        reminderType: rule.name,
        selectedAgeingStage: `Manual Trigger (nominal: ${rule.triggerDay} days)`,
        invoiceIdsInvolved: [due.id],
        relevantAmount: ruleOutstanding,
        totalOutstanding: paymentSummary.totalDue,
        thresholdAmount: settings.thresholdAmount ?? 10000
      });
    }

    if (created.length === 0) {
      throw new Error(
        "No reminder could be created. Check the selected channels and matching contact details."
      );
    }

    database.reminderLogs.push(...created);
    return created;
  });
}

export async function createManualRemindersForDues(
  ownerId: string,
  dueIds: string[],
  ruleId: string,
  channelSelection?: ReminderChannelSelection
) {
  const uniqueDueIds = Array.from(new Set(dueIds.filter(Boolean)));
  const created: ReminderLog[] = [];

  for (const dueId of uniqueDueIds) {
    const entries = await createManualRemindersForDue(ownerId, dueId, ruleId, channelSelection);
    created.push(...entries);
  }

  return created;
}

async function sendEmail(
  log: ReminderLog,
  settings: DispatchSettings,
  due?: DueRecord,
  allDuesForDealer: DueRecord[] = [],
  database?: any,
  pdfBuffer?: Buffer
) {
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

  const attachments = pdfBuffer && due ? [
    {
      filename: "outstanding-statement.pdf",
      content: pdfBuffer
    }
  ] : undefined;

  const recipients = parseEmailList(log.recipient);
  const to = recipients.length > 0 ? recipients : log.recipient;

  await transporter.sendMail({
    from: settings.senderEmail || settings.smtpFrom,
    to,
    subject: log.subject,
    text: log.content,
    html: due ? buildReminderEmailHtml(log, due, allDuesForDealer, database) : buildBasicEmailHtml(log.content),
    attachments
  });
}

async function postWebhook(url: string, log: ReminderLog) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      recipient: log.recipient,
      subject: log.subject,
      message: log.content,
      channel: log.channel,
      dealerCode: log.dealerCode,
      billAgeDays: log.billAgeDays
    })
  });

  if (!response.ok) {
    throw new Error(`Webhook failed with status ${response.status}.`);
  }
}

function resolveTwilioSmsCredentials(settings: DispatchSettings) {
  return {
    accountSid:
      settings.smsAccountSid ||
      settings.smsApiKey ||
      process.env.TWILIO_ACCOUNT_SID ||
      "",
    authToken:
      settings.smsAuthToken ||
      settings.smsApiSecret ||
      process.env.TWILIO_AUTH_TOKEN ||
      ""
  };
}

async function sendTwilioMessage(
  from: string,
  to: string,
  body: string,
  channelLabel: string,
  settings: DispatchSettings
) {
  const { accountSid, authToken } = resolveTwilioSmsCredentials(settings);

  if (!accountSid) {
    throw new Error("Twilio Account SID is missing.");
  }

  if (!authToken) {
    throw new Error("Twilio Auth Token is missing.");
  }

  const form = new URLSearchParams({
    From: from,
    To: to,
    Body: body
  });

  const response = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Messages.json`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: form.toString()
    }
  );

  const rawResponse = await response.text();
  let errorMessage = `Twilio ${channelLabel} failed with status ${response.status}.`;

  if (rawResponse) {
    try {
      const payload = JSON.parse(rawResponse) as {
        message?: string;
        error_message?: string;
      };
      errorMessage = payload.message || payload.error_message || errorMessage;
    } catch {
      errorMessage = rawResponse;
    }
  }

  if (!response.ok) {
    throw new Error(errorMessage);
  }
}

async function sendTwilioSms(log: ReminderLog, settings: DispatchSettings) {
  if (!settings.smsFromNumber) {
    throw new Error("Twilio sender number is missing.");
  }

  await sendTwilioMessage(
    normalizePhoneNumber(settings.smsFromNumber),
    normalizePhoneNumber(log.recipient),
    log.content,
    "SMS",
    settings
  );
}

export async function getEmailContentForLog(
  log: ReminderLog,
  due: DueRecord,
  allDuesForDealer: DueRecord[],
  database: any
): Promise<string> {
  const rule = database.reminderRules.find((r: any) => r.id === log.ruleId);
  const template = database.templates.find((t: any) => t.id === log.templateId);
  const contact = database.masterContacts.find((c: any) => c.id === log.contactId) || {
    id: log.contactId,
    ownerId: log.ownerId,
    dealerCode: log.dealerCode,
    companyName: due.companyName,
    primaryContact: (due.matchedContactName && due.matchedContactName !== "Accounts Team")
      ? due.matchedContactName
      : (due.companyName || "Accounts Team"),
    email: log.recipient,
    whatsapp: log.recipient,
    sms: log.recipient,
    alternateContact: "",
    notes: "",
    importedAt: ""
  };

  if (!rule || !template) {
    return log.content; // fallback
  }

  const policies = database.cashDiscountPolicies.filter(
    (entry: any) => entry.ownerId === log.ownerId || entry.ownerId === due.ownerId
  );
  
  const paymentSummary = buildPaymentSummary(due, allDuesForDealer);
  const cdEvaluation = evaluateCashDiscountEligibility(
    due,
    allDuesForDealer,
    policies,
    new Date(),
    rule.triggerDay
  );

  // Find sender company name from workspace users
  const workspaceUser = database.users.find((u: any) => u.companyName);
  const senderCompany = workspaceUser?.companyName || "Your Company";

  const replacements = buildReplacements(
    { due, contact, rule, template, cdEvaluation, billAgeDays: log.billAgeDays, paymentSummary },
    senderCompany
  );

  let emailBody = template.emailBody;
  if (rule.triggerDay === 30 && (log.billAgeDays || 0) > 30) {
    emailBody = buildEmailBody(35);
  } else if (rule.triggerDay === 45 && (log.billAgeDays || 0) > 45) {
    emailBody = buildEmailBody(50);
  }

  let filled = fillTemplate(emailBody, replacements);
  if (rule.triggerDay === 30 || rule.triggerDay === 45 || rule.triggerDay === 60) {
    const daysVal = calculateDynamicDays(log.billAgeDays || 0, rule.triggerDay);
    const replacementText = `${daysVal} days`;
    filled = filled.replace(/5\s+days?/gi, replacementText);
    filled = filled.replace(/5-day/gi, `${daysVal}-day`).replace(/5\s+day/gi, `${daysVal} day`);
  }

  return filled;
}

async function sendInteraktWhatsapp(
  log: ReminderLog,
  due?: DueRecord,
  allDuesForDealer: DueRecord[] = [],
  database?: any
) {
  if (!due) {
    throw new Error("WhatsApp reminder requires an invoice record.");
  }

  // 1. Get all outstanding dues for this customer and sort them chronologically (oldest first)
  const unsortedDues = allDuesForDealer.length > 0 ? allDuesForDealer : [due];
  const dealerDues = [...unsortedDues].sort((a, b) => {
    const dateA = a.billDate || a.invoiceDate || "";
    const dateB = b.billDate || b.invoiceDate || "";
    return dateA.localeCompare(dateB);
  });
  const totalAmount = dealerDues.reduce((sum, item) => sum + (item.amount || 0), 0);
  const currency = due.currency || "INR";
  const customerName = due.companyName || due.matchedContactName || "Customer";
  const dealerCode = due.dealerCode || due.customerCode || log.dealerCode || "-";

  // 2. Fetch the corresponding email template content so the PDF has the exact email message body
  let pdfMessageBody = log.content;
  if (database) {
    try {
      pdfMessageBody = await getEmailContentForLog(log, due, dealerDues, database);
    } catch (e) {
      console.error("Failed to generate email content for WhatsApp PDF:", e);
    }
  }

  // Generate PDF — includes the same reminder message text as the email
  const pdfBuffer = await generateOutstandingPDF(
    customerName,
    dealerCode,
    dealerDues,
    totalAmount,
    currency,
    pdfMessageBody,
    log.dueId,
    log.ruleId,
    database
  );

  // 3. Upload to Google Drive and get shareable public direct download link
  const fileName = `outstanding-statement-${log.id}.pdf`;
  let mediaUrl = "";
  try {
    mediaUrl = await uploadPdfToGoogleDrive(pdfBuffer, fileName);
    log.pdfUrl = mediaUrl;
  } catch (err) {
    console.error(`Failed to upload PDF statement to Drive/Catbox for log ${log.id}:`, err);
  }

  // 4. Send WhatsApp with the PDF document
  const contactName = (due.matchedContactName && due.matchedContactName !== "Accounts Team")
    ? due.matchedContactName
    : (due.companyName || "Customer");
  const invoiceNumber = due.invoiceNumber || due.reference || "";
  const formattedAmount = (due.amount || 0).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
  const billAge = getBillAgeDays(due.billDate || due.invoiceDate, new Date()) || 0;
  const overdueDays = Math.max(0, billAge - 60).toString();

  const bodyValues = [contactName, invoiceNumber, formattedAmount, overdueDays];

  await sendPaymentReminder(log.recipient, bodyValues, mediaUrl, `statement.pdf`);
}

async function deliverReminder(
  log: ReminderLog,
  settings: DispatchSettings,
  due?: DueRecord,
  allDuesForDealer: DueRecord[] = [],
  database?: any
) {
  if (log.channel === "email") {
    if (!isValidEmailAddress(log.recipient)) {
      throw new Error(`Invalid email recipient: ${log.recipient || "missing email address"}.`);
    }

    if (!settings.smtpHost || !(settings.senderEmail || settings.smtpFrom)) {
      throw new Error("SMTP settings are incomplete.");
    }

    let pdfBuffer: Buffer | undefined;
    let pdfUrl: string | undefined;

    if (due) {
      const unsortedDues = allDuesForDealer.length > 0 ? allDuesForDealer : [due];
      const dealerDues = [...unsortedDues].sort((a, b) => {
        const dateA = a.billDate || a.invoiceDate || "";
        const dateB = b.billDate || b.invoiceDate || "";
        return dateA.localeCompare(dateB);
      });
      const totalAmount = dealerDues.reduce((sum, item) => sum + (item.amount || 0), 0);
      const currency = due.currency || "INR";
      const customerName = due.companyName || due.matchedContactName || "Customer";
      const dealerCode = due.dealerCode || due.customerCode || log.dealerCode || "-";

      let pdfMessageBody = log.content;
      if (database) {
        try {
          pdfMessageBody = await getEmailContentForLog(log, due, dealerDues, database);
        } catch (e) {
          console.error("Failed to generate email content for PDF:", e);
        }
      }

      pdfBuffer = await generateOutstandingPDF(
        customerName,
        dealerCode,
        dealerDues,
        totalAmount,
        currency,
        pdfMessageBody,
        log.dueId,
        log.ruleId,
        database
      );

      const fileName = `outstanding-statement-${log.id}.pdf`;
      try {
        pdfUrl = await uploadPdfToGoogleDrive(pdfBuffer, fileName);
        log.pdfUrl = pdfUrl;
      } catch (err) {
        console.error(`Failed to upload PDF statement to Drive/Catbox for log ${log.id}:`, err);
      }
    }

    await sendEmail(log, settings, due, allDuesForDealer, database, pdfBuffer);
    return "sent" as const;
  }

  if (log.channel === "sms") {
    await sendTwilioSms(log, settings);
    return "sent" as const;
  }

  await sendInteraktWhatsapp(log, due, allDuesForDealer, database);
  return "sent" as const;
}

export async function sendPendingReminders(ownerId: string, ruleIds?: string[], logIds?: string[]) {
  return updateDatabase(async (database) => {
    const user = database.users.find((entry) => entry.id === ownerId);
    if (!user) {
      throw new Error("The current user could not be found.");
    }

    const workspace = getCompanyWorkspaceContext(database, user.companyName);
    const settings = database.dispatchSettings.find(
      (entry) => entry.ownerId === workspace.configOwnerId
    );
    if (!settings) {
      throw new Error("Dispatch settings are missing.");
    }
    const resolvedSettings = resolveDispatchSettings(settings);

    const pendingLogs = database.reminderLogs.filter(
      (entry) =>
        workspace.sharedOwnerIds.has(entry.ownerId) &&
        entry.status === "pending" &&
        (!ruleIds || ruleIds.includes(entry.ruleId)) &&
        (!logIds || logIds.includes(entry.id))
    );

    const logs = pendingLogs;

    for (const log of logs) {
      try {
        if (log.channel === "email" && !resolvedSettings.emailEnabled) {
          throw new Error("Email dispatches are globally disabled in settings.");
        }
        if (log.channel === "whatsapp" && !resolvedSettings.whatsappEnabled) {
          throw new Error("WhatsApp dispatches are globally disabled in settings.");
        }
        if (log.channel === "sms" && !resolvedSettings.smsEnabled) {
          throw new Error("SMS dispatches are globally disabled in settings.");
        }

        const due = database.dueRecords.find((entry) => entry.id === log.dueId);
        const allDuesForDealer = due
          ? filterSharedCompanyRecords(database.dueRecords, workspace.sharedOwnerIds).filter(
              (entry) => getDuePartyKey(entry) === getDuePartyKey(due)
            )
          : [];
        const status = await deliverReminder(log, resolvedSettings, due, allDuesForDealer, database);
        log.status = status;
        log.sentAt = new Date().toISOString();
        log.failureReason = "";
        if (due) {
          due.lastReminderDate = log.sentAt;
          due.reminderCount = (due.reminderCount || 0) + 1;
          due.lastDispatchStatus = status;
          due.updatedBy = user.id;
        }
      } catch (error) {
        log.status = "failed";
        log.failureReason =
          error instanceof Error ? error.message : "Unknown sending error occurred.";
        const due = database.dueRecords.find((entry) => entry.id === log.dueId);
        if (due) {
          due.lastDispatchStatus = "failed";
          due.updatedBy = user.id;
        }
      }
    }

    return logs;
  });
}
