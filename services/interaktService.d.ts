export function sendPaymentReminder(
  phoneNumber: string,
  customerName: string,
  amount: string,
  dueDate: string,
  invoiceNumber: string
): Promise<unknown>;
