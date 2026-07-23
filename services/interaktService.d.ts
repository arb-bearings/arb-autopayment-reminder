export function sendPaymentReminder(
  phoneNumber: string,
  bodyValues: string[],
  mediaUrl?: string,
  fileName?: string
): Promise<unknown>;

export function sendSalespersonSummaryWhatsapp(
  phoneNumber: string,
  salespersonName: string,
  totalOutstanding: string,
  mediaUrl?: string
): Promise<unknown>;
