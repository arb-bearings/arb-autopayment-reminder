export type UserRole = "super_admin" | "admin" | "user";

export type User = {
  id: string;
  name: string;
  email: string;
  companyName: string;
  passwordHash: string;
  role: UserRole;
  canSendManualReminders: boolean;
  createdAt: string;
  updatedAt: string;
};

export type Session = {
  token: string;
  userId: string;
  ipAddress: string;
  userAgent: string;
  lastSeenAt: string;
  createdAt: string;
  expiresAt: string;
};

export type AuthEvent = {
  id: string;
  userId: string;
  userEmail: string;
  userName: string;
  companyName: string;
  userRole: UserRole;
  type: "login" | "logout";
  sessionTokenSuffix: string;
  ipAddress: string;
  userAgent: string;
  createdAt: string;
};

export type MasterContact = {
  id: string;
  ownerId: string;
  dealerCode: string;
  customerCode: string;
  companyName: string;
  primaryContact: string;
  email: string;
  whatsapp: string;
  sms: string;
  alternateContact: string;
  notes: string;
  salespersonId: string;
  salespersonName: string;
  salespersonEmail: string;
  importedAt: string;
  raw: Record<string, string>;
};

export type DueRecord = {
  id: string;
  ownerId: string;
  dealerCode: string;
  customerCode: string;
  companyName: string;
  billDate: string;
  invoiceNumber: string;
  invoiceDate: string;
  dueDate: string;
  openingAmount: number;
  amount: number;
  currency: string;
  overdueDays: number;
  reference: string;
  notes: string;
  matchedContactId: string;
  matchedContactName: string;
  matchedEmail: string;
  matchedWhatsapp: string;
  matchedSms: string;
  contactMatchStatus: "matched" | "missing";
  totalDueAmount: number;
  salespersonId: string;
  salespersonName: string;
  salespersonEmail: string;
  lastReminderDate: string;
  reminderCount: number;
  lastDispatchStatus: string;
  createdBy: string;
  updatedBy: string;
  importedAt: string;
  raw: Record<string, string>;
};

export type ReminderRule = {
  id: string;
  ownerId: string;
  name: string;
  triggerDay: number;
  enabled: boolean;
  autoSend: boolean;
  channels: {
    email: boolean;
    whatsapp: boolean;
    sms: boolean;
  };
  templateId: string;
  createdAt: string;
  updatedAt: string;
};

export type ReminderTemplate = {
  id: string;
  ownerId: string;
  ruleId: string;
  name: string;
  emailSubject: string;
  emailBody: string;
  whatsappBody: string;
  smsBody: string;
  updatedAt: string;
};

export type DispatchSettings = {
  ownerId: string;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  smtpUser: string;
  smtpPass: string;
  senderEmail: string;
  senderMobileNumber: string;
  smtpFrom: string;
  smsProviderName: string;
  smsApiKey: string;
  smsApiSecret: string;
  smsAccountSid: string;
  smsAuthToken: string;
  smsFromNumber: string;
  smsSenderId: string;
  whatsappProviderName: string;
  whatsappApiKey: string;
  whatsappApiSecret: string;
  whatsappAccountSid: string;
  whatsappAuthToken: string;
  whatsappFromNumber: string;
  whatsappWebhookUrl: string;
  futureIntegrationNotes: string;
  reportRecipients: string[];
  reportFrequency: "daily" | "weekly" | "monthly" | "manual";
  reportTime: string;
  updatedAt: string;
};

export type CashDiscountPolicy = {
  id: string;
  ownerId: string;
  name: string;
  paymentWindowDays: number;
  discountPercent: number;
  enabled: boolean;
  description: string;
  createdAt: string;
  updatedAt: string;
};

export type ReminderLog = {
  id: string;
  ownerId: string;
  dueId: string;
  dedupeKey: string;
  contactId: string;
  ruleId: string;
  templateId: string;
  dealerCode: string;
  invoiceNumber: string;
  reminderDay: number;
  billAgeDays: number;
  cdEligible: boolean;
  cdPolicyId: string;
  cdDiscountPercent: number;
  cdReason: string;
  channel: "email" | "whatsapp" | "sms";
  recipient: string;
  scheduledFor: string;
  status: "pending" | "sent" | "failed";
  subject: string;
  content: string;
  failureReason: string;
  sentAt: string;
  createdAt: string;
  pdfUrl?: string;
};

export type OperationPasswordKey =
  | "master_upload"
  | "due_upload"
  | "dispatch"
  | "report_generation"
  | "admin_settings";

export type OperationPassword = {
  ownerId: string;
  key: OperationPasswordKey;
  label: string;
  passwordHash: string;
  updatedAt: string;
  updatedBy: string;
};

export type Salesperson = {
  id: string;
  ownerId: string;
  name: string;
  employeeId: string;
  email: string;
  phoneNumber: string;
  dealerCodes: string[];
  createdAt: string;
  updatedAt: string;
};

export type AuditLog = {
  id: string;
  ownerId: string;
  timestamp: string;
  userId: string;
  userName: string;
  userEmail: string;
  role: UserRole;
  action: string;
  status: "success" | "failed";
  details: string;
};

export type AppDatabase = {
  users: User[];
  sessions: Session[];
  authEvents: AuthEvent[];
  masterContacts: MasterContact[];
  dueRecords: DueRecord[];
  reminderRules: ReminderRule[];
  templates: ReminderTemplate[];
  dispatchSettings: DispatchSettings[];
  cashDiscountPolicies: CashDiscountPolicy[];
  reminderLogs: ReminderLog[];
  operationPasswords: OperationPassword[];
  salespersons: Salesperson[];
  auditLogs: AuditLog[];
};

export type DashboardStats = {
  masterCount: number;
  dueCount: number;
  pendingReminders: number;
  sentReminders: number;
  sentByChannel: {
    email: number;
    whatsapp: number;
    sms: number;
  };
  totalCompanies: number;
  totalOutstandingAmount: number;
  todayRemindersSent: number;
  successRate: number;
  failureRate: number;
  failedDeliveries: number;
};
