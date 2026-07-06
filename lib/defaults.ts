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
  { name: "30 Day Reminder",  triggerDay: 30 },
  { name: "45 Day Reminder",  triggerDay: 45 },
  { name: "60 Day Reminder",  triggerDay: 60 },
  { name: "75 Day Reminder",  triggerDay: 75 },
  { name: "80 Day Reminder",  triggerDay: 80 },
  { name: "85 Day Reminder",  triggerDay: 85 },
  { name: "90 Day Reminder",  triggerDay: 90 }
];

// ─── CD Policies — 2 only ─────────────────────────────────────────────────────
const defaultCashDiscountBlueprints = [
  { name: "30 Day CD", paymentWindowDays: 30, discountPercent: 3 },
  { name: "45 Day CD", paymentWindowDays: 45, discountPercent: 2 }
];

// ─── Email Body Builders ──────────────────────────────────────────────────────

/** 30-day: due in 5 days — CD suffix is dynamic via {{cdBenefitSuffix}} */
function buildBody30() {
  return `INVOICE {{invoiceNumber}}

Dear {{contactName}},

Please note that the payment against the Invoice {{invoiceNumber}} Dated {{billDate}} of amount Rs. {{amount}} will become due within the next 5 days.

So kindly arrange to remit us the payment by/before the due date{{cdBenefitSuffix}}.

Thank you for your attention in the matter.

Regards,
{{senderCompany}}`;
}

/** 45-day: due in 5 days — CD suffix is dynamic via {{cdBenefitSuffix}} */
function buildBody45() {
  return `INVOICE {{invoiceNumber}}

Dear {{contactName}},

Please note that the payment against the Invoice {{invoiceNumber}} Dated {{billDate}} of amount Rs. {{amount}} will become due within the next 5 days.

So kindly arrange to remit us the payment by/before the due date{{cdBenefitSuffix}}.

Thank you for your attention in the matter.

Regards,
{{senderCompany}}`;
}

/** 60-day: due in 5 days, no CD */
function buildBody60() {
  return `INVOICE {{invoiceNumber}}

Dear {{contactName}},

Please note that the payment against the Invoice {{invoiceNumber}} Dated {{billDate}} of amount Rs. {{amount}} will become due within the next 5 days.

So kindly arrange to remit us the payment by/before the due date.

Thank you for your attention in the matter.

Regards,
{{senderCompany}}`;
}

/** 75-day: overdue, pay at earliest */
function buildBody75() {
  return `INVOICE {{invoiceNumber}}

Dear {{contactName}},

The payment against the Invoice {{invoiceNumber}} Dated {{billDate}} of amount Rs. {{amount}} is overdue now.

So kindly arrange to remit us the payment at earliest possible.

Thank you for your attention in the matter.

Regards,
{{senderCompany}}`;
}

/** 80-day: overdue, urgent basis */
function buildBody80() {
  return `INVOICE {{invoiceNumber}}

Dear {{contactName}},

The payment against the Invoice {{invoiceNumber}} Dated {{billDate}} of amount Rs. {{amount}} is overdue now.

So kindly arrange to remit us the payment at urgent basis.

Thank you for your attention in the matter.

Regards,
{{senderCompany}}`;
}

/** 85-day: overdue, most urgent basis */
function buildBody85() {
  return `INVOICE {{invoiceNumber}}

Dear {{contactName}},

The payment against the Invoice {{invoiceNumber}} Dated {{billDate}} of amount Rs. {{amount}} is overdue now.

So kindly arrange to remit us the payment at most urgent basis.

Thank you for your attention in the matter.

Regards,
{{senderCompany}}`;
}

/** 90-day: significantly overdue, future invoicing at risk */
function buildBody90() {
  return `INVOICE {{invoiceNumber}}

Dear {{contactName}},

The payment against the Invoice {{invoiceNumber}} Dated {{billDate}} of amount Rs. {{amount}} is significantly overdue.

So kindly arrange to remit us the payment within the 5 days. If the payment remains pending beyond 90 days from the date of invoice, the future invoicing will be stopped.

To avoid any disruption, please ensure to clear this outstanding immediately.

Thank you for your prompt corporation in the matter.

Regards,
{{senderCompany}}`;
}

// ─── WhatsApp / SMS Body Builders ─────────────────────────────────────────────

function buildWhatsapp30() {
  return `INVOICE {{invoiceNumber}} | Dear {{contactName}}, payment for Invoice {{invoiceNumber}} Dated {{billDate}} of Rs. {{amount}} is due in 5 days. Pay before due date{{cdBenefitSuffix}}. — {{senderCompany}}`;
}

function buildWhatsapp45() {
  return `INVOICE {{invoiceNumber}} | Dear {{contactName}}, payment for Invoice {{invoiceNumber}} Dated {{billDate}} of Rs. {{amount}} is due in 5 days. Pay before due date{{cdBenefitSuffix}}. — {{senderCompany}}`;
}

function buildWhatsapp60() {
  return `INVOICE {{invoiceNumber}} | Dear {{contactName}}, payment for Invoice {{invoiceNumber}} Dated {{billDate}} of Rs. {{amount}} is due in 5 days. Please pay before the due date. — {{senderCompany}}`;
}

function buildWhatsapp75() {
  return `INVOICE {{invoiceNumber}} | Dear {{contactName}}, payment for Invoice {{invoiceNumber}} Dated {{billDate}} of Rs. {{amount}} is overdue. Please pay at earliest possible. — {{senderCompany}}`;
}

function buildWhatsapp80() {
  return `INVOICE {{invoiceNumber}} | Dear {{contactName}}, Invoice {{invoiceNumber}} Dated {{billDate}} of Rs. {{amount}} is overdue. Please arrange payment on urgent basis. — {{senderCompany}}`;
}

function buildWhatsapp85() {
  return `INVOICE {{invoiceNumber}} | Dear {{contactName}}, Invoice {{invoiceNumber}} Dated {{billDate}} of Rs. {{amount}} is overdue. Arrange payment on MOST urgent basis. — {{senderCompany}}`;
}

function buildWhatsapp90() {
  return `INVOICE {{invoiceNumber}} | Dear {{contactName}}, Invoice {{invoiceNumber}} Dated {{billDate}} of Rs. {{amount}} is significantly overdue. Pay within 5 days or future invoicing will be stopped. — {{senderCompany}}`;
}

// ─── Subject Lines ────────────────────────────────────────────────────────────

function buildSubject(triggerDay: number) {
  if (triggerDay <= 60) {
    return `Outstanding: Invoice {{invoiceNumber}} due in 5 days`;
  }
  if (triggerDay === 90) {
    return `Critical: Invoice {{invoiceNumber}} — Future Invoicing at Risk`;
  }
  return `Overdue: Invoice {{invoiceNumber}} — Immediate Attention Required`;
}

// ─── Body Router ──────────────────────────────────────────────────────────────

function buildEmailBody(triggerDay: number): string {
  switch (triggerDay) {
    case 30: return buildBody30();
    case 45: return buildBody45();
    case 60: return buildBody60();
    case 75: return buildBody75();
    case 80: return buildBody80();
    case 85: return buildBody85();
    case 90: return buildBody90();
    default:  return buildBody60();
  }
}

function buildWhatsappBody(triggerDay: number): string {
  switch (triggerDay) {
    case 30: return buildWhatsapp30();
    case 45: return buildWhatsapp45();
    case 60: return buildWhatsapp60();
    case 75: return buildWhatsapp75();
    case 80: return buildWhatsapp80();
    case 85: return buildWhatsapp85();
    case 90: return buildWhatsapp90();
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
      enabled: true,
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
