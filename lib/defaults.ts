import { randomUUID } from "node:crypto";
import { resolveDispatchSettings } from "@/lib/dispatch-settings";
import type {
  CashDiscountPolicy,
  DispatchSettings,
  ReminderRule,
  ReminderTemplate
} from "@/lib/types";

// ─── Rule Blueprints ──────────────────────────────────────────────────────────
// triggerDay = the nominal "X days" label.
// The engine fires 5 days BEFORE this day (billAgeDays === triggerDay - 5).

const defaultRuleBlueprints = [
  { name: "30 Day Reminder",  triggerDay: 30, enabled: true },
  { name: "45 Day Reminder",  triggerDay: 45, enabled: true },
  { name: "60 Day Reminder",  triggerDay: 60, enabled: true },
  { name: "75 Day Reminder",  triggerDay: 75, enabled: true },
  { name: "80 Day Reminder",  triggerDay: 80, enabled: false },
  { name: "85 Day Reminder",  triggerDay: 85, enabled: false },
  { name: "90 Day Reminder",  triggerDay: 90, enabled: true },
  { name: "95 Day Reminder",  triggerDay: 95, enabled: true },
  { name: "100 Day Reminder", triggerDay: 100, enabled: true },
  { name: "110 Day Reminder", triggerDay: 110, enabled: false },
  { name: "120 Day Reminder", triggerDay: 120, enabled: false }
];

// ─── CD Policies — 2 only ─────────────────────────────────────────────────────
const defaultCashDiscountBlueprints = [
  { name: "30 Day CD", paymentWindowDays: 30, discountPercent: 3 },
  { name: "45 Day CD", paymentWindowDays: 45, discountPercent: 2 }
];

// ─── Email Body Builders ──────────────────────────────────────────────────────

/** 30-day: first reminder for 3% CD */
function buildBody30() {
  return `Dear {{contactName}},

Please note that a payment of {{amount}} is due within the next 5 days to avail the 3% CD benefit on the invoice.

To avail the 3% CD, please ensure that the payment is made before the invoice completes 30 days.

Thank you for your attention in the matter.

Regards,
ARB Bearings Limited`;
}

/** 35-day: final reminder for 3% CD */
function buildBody35() {
  return `INVOICE {{invoiceNumber}}

Dear {{contactName}},

Please note that a payment of {{amount}} is due within the next 5 days to avail the 3% CD benefit on the invoice.

To avail the 3% CD benefit on this invoice, please make payment of total outstanding along with the current invoice by/before the due date.

Thank you for your attention in the matter.

Regards,
ARB Bearings Limited`;
}

/** 45-day: first reminder for 2% CD */
function buildBody45() {
  return `Dear {{contactName}},

Please note that a payment of {{amount}} is due within the next 5 days to avail the 2% CD benefit on the invoice.

To avail the 2% CD, please ensure that the payment is made before the invoice completes 45 days.

Thank you for your attention in the matter.

Regards,
ARB Bearings Limited`;
}

/** 50-day: final reminder for 2% CD */
function buildBody50() {
  return `INVOICE {{invoiceNumber}}

Dear {{contactName}},

Please note that a payment of {{amount}} is due within the next 5 days to avail the 2% CD benefit on the invoice.

To avail the 2% CD benefit on this invoice, please make payment of total outstanding along with the current invoice by/before the due date.

Thank you for your attention in the matter.

Regards,
ARB Bearings Limited`;
}

/** 60-day: due in 5 days */
function buildBody60() {
  return `Dear {{contactName}},

Please note that a payment of {{amount}} will become due within the next 5 days, and the total outstanding amount is {{totalDueAmount}}.

We kindly request you to arrange payment of the due amount of {{amount}} by/before the due date, as per ARB’s payment terms.

Thank you for your attention in the matter.

Regards,
ARB Bearings Limited`;
}

/** 75-day / 60+ day: overdue, pay at earliest */
function buildBody75() {
  return `Dear {{contactName}},

Please note that the payment of {{amount}} against the invoice is now overdue (has exceeded 60 days), and the total outstanding amount is {{totalDueAmount}}.

We kindly request you to arrange payment of the total overdue amount of {{amount}} at the earliest.

Thank you for your attention in the matter.

Regards,
ARB Bearings Limited`;
}

/** 80-day */
function buildBody80() {
  return `Dear {{contactName}},

The payment more than 80 days of amount Rs. {{amount}} is overdue now.

This amount is due by 75 days.

So kindly arrange to remit us the payment at urgent basis.

Thank you for your attention in the matter.

Regards,
ARB Bearings Limited`;
}

/** 85-day */
function buildBody85() {
  return `Dear {{contactName}},

The payment more than 85 days of amount Rs. {{amount}} is overdue now.

This amount is due by 80 days.

So kindly arrange to remit us the payment at most urgent basis.

Thank you for your attention in the matter.

Regards,
ARB Bearings Limited`;
}

/** 90-day / 90+ day: significantly overdue, future invoicing at risk */
function buildBody90() {
  return `Dear {{contactName}},

Please note that the payment of {{amount}} against the invoice is now significantly overdue and has exceeded 90 days.

As per our company policy, invoicing will remain stopped until the outstanding payment is cleared.

We kindly request you to arrange payment of the total overdue amount of {{amount}} at the earliest to ensure the continuation of supplies and resumption of invoicing.

Thank you for your attention in the matter.

Regards,
ARB Bearings Limited`;
}

function buildBody95() {
  return `Dear {{contactName}},

The payment more than 95 days of amount Rs. {{amount}} is now 90 days overdue. 

As per our company policy, your invoicing will be stopped, if the outstanding payment has not been cleared within the 90-day credit period.

So please arrange to remit the outstanding payment immediately to ensure the continuation of supplies and the resumption of invoicing.

Thank you for your attention in the matter.

Regards,
ARB Bearings Limited`;
}

function buildBody100() {
  return `Dear {{contactName}},

This is to remind you that the payment more than 100 days, amounting to Rs. {{amount}}, is now 95 days overdue.

Your invoicing has already been stopped due to the outstanding payment. Kindly arrange to clear the outstanding amount immediately to ensure the continuation of supplies and the resumption of invoicing.

Thank you for your attention in the matter.

Regards,
ARB Bearings Limited`;
}

/** 120-day / 120+ day: invoicing stopped, clear immediately */
function buildBody120() {
  return `Dear {{contactName}},

This is to remind you that the payment of {{amount}} is now significantly overdue and has exceeded 120 days.

Your invoicing has already been stopped due to the outstanding payment. Kindly arrange to clear the outstanding amount immediately to ensure the continuation of supplies and the resumption of invoicing.

Thank you for your attention in the matter.

Regards,
ARB Bearings Limited`;
}

// ─── WhatsApp / SMS Body Builders ─────────────────────────────────────────────

function buildWhatsapp30() {
  return `Dear {{contactName}}, payment of {{amount}} is due in 5 days to avail 3% CD. Ensure payment before 30 days. — ARB Bearings Limited`;
}

function buildWhatsapp35() {
  return `INVOICE {{invoiceNumber}} | Dear {{contactName}}, Final Reminder To Avail 3% CD. Payment of {{amount}} is due in 5 days. To avail the 3% CD benefit on this invoice, please make payment of total outstanding along with the current invoice by/before the due date. — ARB Bearings Limited`;
}

function buildWhatsapp45() {
  return `Dear {{contactName}}, payment of {{amount}} is due in 5 days to avail 2% CD. Ensure payment before 45 days. — ARB Bearings Limited`;
}

function buildWhatsapp50() {
  return `INVOICE {{invoiceNumber}} | Dear {{contactName}}, Final Reminder To Avail 2% CD. Payment of {{amount}} is due in 5 days. To avail the 2% CD benefit on this invoice, please make payment of total outstanding along with the current invoice by/before the due date. — ARB Bearings Limited`;
}

function buildWhatsapp60() {
  return `Dear {{contactName}}, payment of {{amount}} will become due within 5 days, and total outstanding amount is {{totalDueAmount}}. Please pay before due date. — ARB Bearings Limited`;
}

function buildWhatsapp75() {
  return `Dear {{contactName}}, payment of {{amount}} against invoice is now overdue (has exceeded 60 days), and total outstanding amount is {{totalDueAmount}}. Please arrange payment at the earliest. — ARB Bearings Limited`;
}

function buildWhatsapp80() {
  return `Dear {{contactName}}, payment more than 80 days of Rs. {{amount}} is overdue. Please arrange payment on urgent basis. — ARB Bearings Limited`;
}

function buildWhatsapp85() {
  return `Dear {{contactName}}, payment more than 85 days of Rs. {{amount}} is overdue. Arrange payment on MOST urgent basis. — ARB Bearings Limited`;
}

function buildWhatsapp90() {
  return `Dear {{contactName}}, payment of {{amount}} is significantly overdue and has exceeded 90 days. Invoicing will remain stopped until cleared. Please arrange payment at earliest. — ARB Bearings Limited`;
}

function buildWhatsapp95() {
  return `Dear {{contactName}}, payment more than 95 days of Rs. {{amount}} is 90 days overdue. Invoicing will be stopped. — ARB Bearings Limited`;
}

function buildWhatsapp100() {
  return `Dear {{contactName}}, payment more than 100 days of Rs. {{amount}} is 95 days overdue. Invoicing has been stopped. — ARB Bearings Limited`;
}

function buildWhatsapp120() {
  return `Dear {{contactName}}, payment of {{amount}} is overdue (>120 days). Invoicing has been stopped. Kindly clear immediately. — ARB Bearings Limited`;
}

// ─── Subject Lines ────────────────────────────────────────────────────────────

function buildSubject(triggerDay: number) {
  if (triggerDay <= 60) {
    return `Outstanding: Payment more than ${triggerDay} days due in 5 days`;
  }
  if (triggerDay === 90) {
    return `Critical: Payment more than 90 days — Future Invoicing at Risk`;
  }
  if (triggerDay >= 100 && triggerDay <= 120) {
    return `Invoicing Stopped: Payment more than ${triggerDay} days — Immediate Attention Required`;
  }
  return `Overdue: Payment more than ${triggerDay} days — Immediate Attention Required`;
}

// ─── Body Router ──────────────────────────────────────────────────────────────

export function buildEmailBody(triggerDay: number): string {
  switch (triggerDay) {
    case 30: return buildBody30();
    case 35: return buildBody35();
    case 45: return buildBody45();
    case 50: return buildBody50();
    case 60: return buildBody60();
    case 75: return buildBody75();
    case 80: return buildBody80();
    case 85: return buildBody85();
    case 90: return buildBody90();
    case 95: return buildBody95();
    case 100: return buildBody100();
    case 110: return buildBody100().replace("payment more than 100 days", "payment more than 110 days").replace("95 days", "105 days");
    case 120: return buildBody120();
    default:  return buildBody60();
  }
}

export function buildWhatsappBody(triggerDay: number): string {
  switch (triggerDay) {
    case 30: return buildWhatsapp30();
    case 35: return buildWhatsapp35();
    case 45: return buildWhatsapp45();
    case 50: return buildWhatsapp50();
    case 60: return buildWhatsapp60();
    case 75: return buildWhatsapp75();
    case 80: return buildWhatsapp80();
    case 85: return buildWhatsapp85();
    case 90: return buildWhatsapp90();
    case 95: return buildWhatsapp95();
    case 100: return buildWhatsapp100();
    case 110: return buildWhatsapp100().replace("payment more than 100 days", "payment more than 110 days").replace("95 days", "105 days");
    case 120: return buildWhatsapp120();
    default:  return buildWhatsapp60();
  }
}

// ─── Public Factory ───────────────────────────────────────────────────────────

export function createDefaultRuleSet(ownerId: string) {
  const generatedAt = new Date().toISOString();

  const templates: ReminderTemplate[] = defaultRuleBlueprints.map((rule) => {
    const templateId = randomUUID();
    return {
      id: templateId,
      ownerId,
      ruleId: "",
      name: rule.name,
      emailSubject: buildSubject(rule.triggerDay),
      emailBody: buildEmailBody(rule.triggerDay),
      whatsappBody: buildWhatsappBody(rule.triggerDay),
      smsBody: buildWhatsappBody(rule.triggerDay),
      updatedAt: generatedAt
    };
  });

  const rules: ReminderRule[] = defaultRuleBlueprints.map((rule, index) => {
    const ruleId = randomUUID();
    templates[index].ruleId = ruleId;

    return {
      id: ruleId,
      ownerId,
      name: rule.name,
      triggerDay: rule.triggerDay,
      enabled: rule.enabled,
      autoSend: false,
      channels: {
        email: true,
        whatsapp: true,
        sms: false
      },
      templateId: templates[index].id,
      createdAt: generatedAt,
      updatedAt: generatedAt
    };
  });

  const cashDiscountPolicies: CashDiscountPolicy[] = defaultCashDiscountBlueprints.map((policy) => ({
    id: randomUUID(),
    ownerId,
    name: policy.name,
    paymentWindowDays: policy.paymentWindowDays,
    discountPercent: policy.discountPercent,
    enabled: true,
    description: `Customer remains eligible for ${policy.discountPercent}% cash discount when payment is cleared within ${policy.paymentWindowDays} days and no older unpaid invoices exist.`,
    cdMessageTemplate: "To avail the {{cdDiscountPercent}}% CD benefit on this invoice, please make payment of total outstanding along with the current invoice by/before the due date.",
    cdMessageWithOlderTemplate: "To avail the {{cdDiscountPercent}}% CD benefit on this invoice, please make payment of total outstanding along with the current invoice by/before the due date.",
    cdShortMessageTemplate: "To avail the {{cdDiscountPercent}}% CD benefit on this invoice, please make payment of total outstanding along with the current invoice by/before the due date.",
    cdShortMessageWithOlderTemplate: "To avail the {{cdDiscountPercent}}% CD benefit on this invoice, please make payment of total outstanding along with the current invoice by/before the due date.",
    createdAt: generatedAt,
    updatedAt: generatedAt
  }));

  const dispatchSettings: DispatchSettings = resolveDispatchSettings({
    ownerId,
    senderMobileNumber: "",
    smsProviderName: "Twilio",
    smsSenderId: "",
    whatsappProviderName: "Interakt",
    futureIntegrationNotes: "",
    reportRecipients: [],
    reportFrequency: "daily",
    reportTime: "18:00",
    updatedAt: generatedAt
  });

  return { rules, templates, dispatchSettings, cashDiscountPolicies };
}
