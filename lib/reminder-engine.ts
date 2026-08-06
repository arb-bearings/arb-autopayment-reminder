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
  normalizeText
} from "@/lib/utils";
import { sendPaymentReminder } from "@/services/interaktService";
import { generateOutstandingPDF } from "./pdf-generator";
import { uploadPdfToGoogleDrive } from "@/services/googleDriveService";

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
      context.contact.primaryContact ||
      context.due.matchedContactName ||
      "Accounts Team",
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
    overdueDays: context.due.overdueDays,
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
  channelSelection?: ReminderChannelSelection
): Array<[ReminderLog["channel"], boolean, string, string]> {
  return [
    [
      "email",
      channelSelection?.email ?? rule.channels.email,
      contact.email || due.matchedEmail,
      template.emailBody
    ],
    [
      "whatsapp",
      channelSelection?.whatsapp ?? rule.channels.whatsapp,
      contact.whatsapp || due.matchedWhatsapp,
      template.whatsappBody
    ],
    [
      "sms",
      channelSelection?.sms ?? rule.channels.sms,
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
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
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
        `Total outstanding: ${formatCurrency(paymentSummary.totalDue, currency)}`,
        `Previous outstanding: ${formatCurrency(paymentSummary.previousDue, currency)}`,
        `Current outstanding: ${formatCurrency(paymentSummary.currentInvoiceDue, currency)}`
      ].join("\n");
    } else if (channel === "whatsapp") {
      paymentSummaryText = [
        "",
        "*Outstanding Summary*:",
        `*Total outstanding*: ${formatCurrency(paymentSummary.totalDue, currency)}`,
        `*Previous outstanding*: ${formatCurrency(paymentSummary.previousDue, currency)}`,
        `*Current outstanding*: ${formatCurrency(paymentSummary.currentInvoiceDue, currency)}`
      ].join("\n");
    } else {
      // SMS
      paymentSummaryText = [
        "",
        "Outstanding Summary:",
        `Total outstanding: ${formatCurrency(paymentSummary.totalDue, currency)}`,
        `Previous outstanding: ${formatCurrency(paymentSummary.previousDue, currency)}`,
        `Current outstanding: ${formatCurrency(paymentSummary.currentInvoiceDue, currency)}`
      ].join("\n");
    }

    return `${filledTemplate}\n${paymentSummaryText}`.trim();
  }

  return filledTemplate;
}

function buildBasicEmailHtml(content: string) {
  return `
    <!doctype html>
    <html>
      <body style="margin:0;background:#f3f4f6;font-family:Arial,Helvetica,sans-serif;color:#111827;">
        <div style="max-width:680px;margin:0 auto;padding:28px 18px;">
          <div style="background:#ffffff;border:1px solid #e5e7eb;border-radius:10px;padding:24px;">
            ${content
              .split(/\n{2,}/)
              .map((paragraph) => `<p style="margin:0 0 14px;line-height:1.55;">${escapeHtml(paragraph).replace(/\n/g, "<br>")}</p>`)
              .join("")}
          </div>
        </div>
      </body>
    </html>
  `;
}

function buildReminderEmailHtml(log: ReminderLog, due: DueRecord, allDuesForDealer: DueRecord[], database?: any) {
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
    const rowBg = isCurrent ? "background:#fefce8;" : "";
    const fontWeight = isCurrent ? "font-weight:700;" : "";
    const billAge = getBillAgeDays(entry.billDate || entry.invoiceDate, referenceDate);
    const ageText = billAge !== null ? `${billAge} days` : "N/A";

    return `
    <tr style="${rowBg}">
      <td style="padding:11px 13px;border-bottom:1px solid #e5e7eb;color:#374151;${fontWeight}">${escapeHtml(entry.billDate ? formatDate(entry.billDate) : (entry.invoiceDate ? formatDate(entry.invoiceDate) : "N/A"))}</td>
      <td style="padding:11px 13px;border-bottom:1px solid #e5e7eb;color:#111827;${fontWeight}">${escapeHtml(entry.invoiceNumber || entry.reference || "N/A")}</td>
      <td style="padding:11px 13px;border-bottom:1px solid #e5e7eb;color:#374151;${fontWeight}">${escapeHtml(ageText)}</td>
      <td style="padding:11px 13px;border-bottom:1px solid #e5e7eb;text-align:right;color:#111827;${fontWeight}">${escapeHtml(formatCurrency(entry.amount, entry.currency || currency))}</td>
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

  // Initialize rule amount map
  const ruleAmountMap = new Map<number, number>();
  for (const r of sortedTriggerDays) {
    ruleAmountMap.set(r, 0);
  }

  // Map each invoice in allDuesForDealer to its closest rule
  for (const entry of allDuesForDealer) {
    if (entry.amount <= 0) continue;
    const age = getBillAgeDays(entry.billDate || entry.invoiceDate, today) || 0;
    
    let closestRuleDay = currentRuleDay;
    let minDiff = Infinity;
    for (const r of sortedTriggerDays) {
      const diff = Math.abs(age - (r - 5));
      if (diff < minDiff) {
        minDiff = diff;
        closestRuleDay = r;
      }
    }
    ruleAmountMap.set(closestRuleDay, (ruleAmountMap.get(closestRuleDay) || 0) + entry.amount);
  }

  // box2Amount is the amount for currentRuleDay
  const box2Amount = ruleAmountMap.get(currentRuleDay) || 0;

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
  if (currentRuleDay <= 45) {
    box2Label = cdEvaluation.eligible
      ? `Payment Due in ${currentRuleDay} Days (for CD)`
      : `Payment Due in ${currentRuleDay} Days`;
  } else {
    box2Label = `Payment Due in ${currentRuleDay} Days`;
  }

  const paragraphs = log.content
    .split(/\n{2,}/)
    .filter((paragraph) => !/^(Payment Summary|Outstanding Summary):/i.test(paragraph.trim()))
    .filter((paragraph) => !/^(Total|Previous|Current) outstanding:/i.test(paragraph.trim()));

  const dearIdx = paragraphs.findIndex(p => p.trim().startsWith("Dear"));
  if (dearIdx !== -1 && currentRuleDay <= 60) {
    paragraphs.splice(dearIdx + 1, 0, `<strong>${box2Label}</strong>`);
  }

  const bodyHtml = paragraphs
    .map((paragraph) => {
      if (paragraph.startsWith("<strong>")) {
        return `<p style="margin:-6px 0 14px;font-weight:bold;color:#0f766e;font-size:15px;">${paragraph.replace(/<\/?strong>/g, "")}</p>`;
      }
      return `<p style="margin:0 0 14px;line-height:1.55;color:#374151;">${escapeHtml(paragraph).replace(/\n/g, "<br>")}</p>`;
    })
    .join("");

  const rule = database?.reminderRules?.find((r: any) => r.id === log.ruleId);
  const ruleTemplate = database?.templates?.find((t: any) => (rule?.templateId ? t.id === rule.templateId : t.ruleId === log.ruleId));

  const show1 = (ruleTemplate?.pdfBox1Visible ?? rule?.pdfBox1Visible) !== false;
  const show2 = (ruleTemplate?.pdfBox2Visible ?? rule?.pdfBox2Visible) !== false;
  const show3 = (ruleTemplate?.pdfBox3Visible ?? rule?.pdfBox3Visible) !== false;

  const label1 = (ruleTemplate?.pdfBox1Label || rule?.pdfBox1Label || "")?.trim() || box2Label;
  const label2 = (ruleTemplate?.pdfBox2Label || rule?.pdfBox2Label || "")?.trim() || box3Label;
  const label3 = (ruleTemplate?.pdfBox3Label || rule?.pdfBox3Label || "")?.trim() || "Total Outstanding";

  type EmailBox = { label: string; amount: number; color: string };
  const visibleEmailBoxes: EmailBox[] = [
    ...(show1 ? [{ label: label1, amount: box2Amount, color: "#111827" }] : []),
    ...(show2 ? [{ label: label2, amount: box3Amount, color: "#b45309" }] : []),
    ...(show3 ? [{ label: label3, amount: calculatedTotalOutstanding, color: "#0f766e" }] : []),
  ];

  const cellWidth = visibleEmailBoxes.length > 0 ? (100 / visibleEmailBoxes.length).toFixed(2) : "100";

  const summaryBoxesHtml = visibleEmailBoxes.length === 0 ? "" : `
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;margin:0 0 18px;table-layout:fixed;">
      <tr>
        ${visibleEmailBoxes.map((box) => `
          <td style="width:${cellWidth}%;padding:0 4px;vertical-align:top;">
            <div style="border:1px solid #e5e7eb;border-radius:8px;padding:12px 10px;background:#fafafa;min-height:76px;box-sizing:border-box;">
              <div style="font-size:10px;color:#6b7280;font-weight:800;text-transform:uppercase;line-height:1.25;word-break:break-word;">${escapeHtml(box.label)}</div>
              <div style="font-size:16px;font-weight:800;margin-top:6px;color:${box.color};">${escapeHtml(formatCurrency(box.amount, currency))}</div>
            </div>
          </td>
        `).join("")}
      </tr>
    </table>
  `;

  return `
    <!doctype html>
    <html>
      <body style="margin:0;background:#f3f4f6;font-family:Arial,Helvetica,sans-serif;color:#111827;">
        <div style="max-width:720px;margin:0 auto;padding:28px 18px;">
          <div style="background:#ffffff;border:1px solid #e5e7eb;border-radius:10px;overflow:hidden;">
            <div style="padding:24px 26px;background:#0f766e;color:#ffffff;">
              <div style="font-size:13px;letter-spacing:.04em;text-transform:uppercase;color:#ccfbf1;font-weight:700;">Payment Reminder</div>
              <h1 style="margin:8px 0 0;font-size:22px;line-height:1.25;color:#ffffff;">Invoice ${escapeHtml(log.invoiceNumber || due.invoiceNumber || due.reference || "N/A")}</h1>
              <div style="margin-top:6px;font-size:14px;color:#d1fae5;">${escapeHtml(due.companyName || "Customer")}</div>
            </div>
            <div style="padding:22px 26px;">

              <!-- Outstanding Summary Boxes (Dynamic per rule configuration) -->
              ${summaryBoxesHtml}

              <div style="margin-bottom:20px;">
                ${bodyHtml}
              </div>

              <!-- Invoice Table: all invoices for this dealer code -->
              <h2 style="font-size:18px;line-height:1.3;margin:24px 0 10px;color:#111827;font-weight:800;">Invoice Table</h2>
              <table width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;">
                <thead>
                  <tr style="background:#f9fafb;">
                    <th align="left" style="padding:12px 13px;border-bottom:1px solid #e5e7eb;color:#374151;font-size:12px;text-transform:uppercase;font-weight:800;">Invoice Date</th>
                    <th align="left" style="padding:12px 13px;border-bottom:1px solid #e5e7eb;color:#374151;font-size:12px;text-transform:uppercase;font-weight:800;">Invoice Number</th>
                    <th align="left" style="padding:12px 13px;border-bottom:1px solid #e5e7eb;color:#374151;font-size:12px;text-transform:uppercase;font-weight:800;">Days Aged</th>
                    <th align="right" style="padding:12px 13px;border-bottom:1px solid #e5e7eb;color:#374151;font-size:12px;text-transform:uppercase;font-weight:800;">Outstanding</th>
                  </tr>
                </thead>
                <tbody>
                  ${invoiceRows.join("") || `<tr><td colspan="4" style="padding:14px;color:#6b7280;">No invoices found.</td></tr>`}
                  <tr style="background:#f9fafb;font-weight:bold;border-top:2px solid #e5e7eb;">
                    <td colspan="3" style="padding:11px 13px;color:#111827;font-weight:800;">Total Outstanding</td>
                    <td style="padding:11px 13px;text-align:right;color:#0f766e;font-weight:800;">${escapeHtml(formatCurrency(paymentSummary.totalDue, currency))}</td>
                  </tr>
                </tbody>
              </table>

            </div>
          </div>
        </div>
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

  const eligiblePolicy = ruleTriggerDay
    ? (policies.find((policy) => policy.enabled && policy.paymentWindowDays === ruleTriggerDay) || null)
    : (policies
        .filter((policy) => policy.enabled)
        .sort((left, right) => left.paymentWindowDays - right.paymentWindowDays)
        .find((policy) => billAgeDays <= policy.paymentWindowDays) || null);

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

    for (const due of dues) {
      const contact = findMatchingMasterContact(due, contacts);
      if (!contact) {
        continue;
      }

      const billAgeDays = getBillAgeDays(due.billDate || due.invoiceDate, today);
      if (billAgeDays === null) {
        continue;
      }

      const allDuesForDealer = dues.filter(
        (entry) => getDuePartyKey(entry) === getDuePartyKey(due)
      );
      const paymentSummary = buildPaymentSummary(due, allDuesForDealer);

      for (const rule of rules) {
        if (forceAllRules) {
          if (rules.length === 0) {
            continue;
          }
          const closestRule = rules.reduce((prev, curr) => {
            const prevDiff = Math.abs(billAgeDays - (prev.triggerDay - 5));
            const currDiff = Math.abs(billAgeDays - (curr.triggerDay - 5));
            return currDiff < prevDiff ? curr : prev;
          });
          if (rule.id !== closestRule.id) {
            continue;
          }
        } else {
          // Fire 5 days BEFORE the rule's nominal day (e.g. 30-day rule fires when bill is 25 days old)
          if (billAgeDays !== (rule.triggerDay - 5)) {
            continue;
          }
        }

        const template = templates.find((entry) => entry.id === rule.templateId);
        if (!template) {
          continue;
        }

        const cdEvaluation = evaluateCashDiscountEligibility(
          due,
          allDuesForDealer,
          policies,
          today,
          rule.triggerDay
        );

        const replacements = buildReplacements(
          { due, contact, rule, template, cdEvaluation, billAgeDays, paymentSummary },
          user?.companyName || "Your Company"
        );
        const channelEntries = buildChannelEntries(rule, template, contact, due);

        for (const [channel, enabled, recipient, body] of channelEntries) {
          if (!enabled || !recipient) {
            continue;
          }

          const dedupeKey = buildReminderDedupeKey(due, rule, channel);

          if (hasExistingLog(database.reminderLogs, dedupeKey, scheduledFor)) {
            continue;
          }

          created.push({
            id: randomUUID(),
            ownerId: workspace.workspaceId,
            dueId: due.id,
            dedupeKey,
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
            subject:
              channel === "email"
                ? fillTemplate(template.emailSubject, replacements)
                : `${rule.name} reminder`,
            content: composeReminderContent(
              channel,
              body,
              replacements,
              cdEvaluation,
              paymentSummary,
              due.currency
            ),
            failureReason: "",
            sentAt: "",
            createdAt: new Date().toISOString()
          });
        }
      }
    }

    database.reminderLogs.push(...created);
    
    /* Auto-send logic commented out so that generated reminders remain in 'pending' status for manual dispatch.
    const autoSendRuleIds = Array.from(
      new Set(created.map((entry) => entry.ruleId).filter((ruleId) => rules.find((rule) => rule.id === ruleId && rule.autoSend)))
    );

    if (autoSendRuleIds.length > 0) {
      const settings = database.dispatchSettings.find(
        (entry) => entry.ownerId === workspace.configOwnerId
      );

      if (!settings) {
        throw new Error("Dispatch settings are missing.");
      }

      const resolvedSettings = resolveDispatchSettings(settings);
      const autoSendLogs = created.filter((entry) => autoSendRuleIds.includes(entry.ruleId));

      for (const log of autoSendLogs) {
        try {
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
    }
    */

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
    const paymentSummary = buildPaymentSummary(due, allDuesForDealer);
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
    const channelEntries = buildChannelEntries(rule, template, contact, due, channelSelection);

    for (const [channel, enabled, recipient, body] of channelEntries) {
      if (!enabled || !recipient) {
        continue;
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
        subject:
          channel === "email"
            ? fillTemplate(template.emailSubject, replacements)
            : `${rule.name} reminder`,
        content: composeReminderContent(
          channel,
          body,
          replacements,
          cdEvaluation,
          paymentSummary,
          due.currency
        ),
        failureReason: "",
        sentAt: "",
        createdAt: scheduledFor
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

  await transporter.sendMail({
    from: settings.senderEmail || settings.smtpFrom,
    to: log.recipient,
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
    primaryContact: due.matchedContactName || "Accounts Team",
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

  return fillTemplate(template.emailBody, replacements);
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
  const customerName = due.matchedContactName || due.companyName || "Customer";
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
  const contactName = due.matchedContactName || due.companyName || "Customer";
  const invoiceNumber = due.invoiceNumber || due.reference || "";
  const formattedAmount = (due.amount || 0).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
  const overdueDays = (due.overdueDays || 0).toString();

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
      const customerName = due.matchedContactName || due.companyName || "Customer";
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
