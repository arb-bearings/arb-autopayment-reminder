export function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function normalizeText(value: string) {
  return value.toLowerCase().trim().replace(/\s+/g, " ");
}

export function getDuePartyKey(input: {
  dealerCode?: string;
  customerCode?: string;
  companyName?: string;
}) {
  return normalizeText(input.dealerCode || input.customerCode || input.companyName || "");
}

export function formatDate(value: string) {
  if (!value) {
    return "Not available";
  }

  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium"
  }).format(new Date(value));
}

export function formatCurrency(value: number, currency = "INR") {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency,
    maximumFractionDigits: 2
  }).format(value || 0);
}

export function daysBetween(fromDate: Date, toDate: Date) {
  const start = new Date(fromDate.getFullYear(), fromDate.getMonth(), fromDate.getDate());
  const end = new Date(toDate.getFullYear(), toDate.getMonth(), toDate.getDate());
  return Math.round((end.getTime() - start.getTime()) / 86400000);
}

export function getBillAgeDays(value: string, referenceDate = new Date()) {
  if (!value) {
    return null;
  }

  const sourceDate = new Date(value);

  if (Number.isNaN(sourceDate.getTime())) {
    return null;
  }

  return daysBetween(sourceDate, referenceDate);
}

export function getOverdueDays(billDateStr: string, referenceDate = new Date()) {
  const age = getBillAgeDays(billDateStr, referenceDate);
  if (age === null) {
    return 0;
  }
  return Math.max(0, age - 60);
}

export function formatElapsedDaysTag(value: string, referenceDate = new Date()) {
  const daysElapsed = getBillAgeDays(value, referenceDate);

  if (daysElapsed === null) {
    return "No invoice date";
  }

  if (daysElapsed === 0) {
    return "Today";
  }

  if (daysElapsed < 0) {
    const daysUntil = Math.abs(daysElapsed);
    return `In ${daysUntil} day${daysUntil === 1 ? "" : "s"}`;
  }

  return `${daysElapsed} day${daysElapsed === 1 ? "" : "s"}`;
}

export function fillTemplate(
  template: string,
  replacements: Record<string, string | number>
) {
  return template.replace(/\{\{(.*?)\}\}/g, (_, token: string) => {
    const key = token.trim();
    return String(replacements[key] ?? "");
  });
}
