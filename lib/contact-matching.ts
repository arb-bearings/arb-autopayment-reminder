import type { DueRecord, MasterContact } from "@/lib/types";
import { normalizeText, normalizeCompanyName, normalizeCompanyNameStrict } from "@/lib/utils";
import { extractDealerCodeAndName } from "@/lib/dealer-utils";

type DueMatchInput = Pick<
  DueRecord,
  | "dealerCode"
  | "customerCode"
  | "companyName"
  | "matchedContactId"
  | "matchedContactName"
  | "matchedEmail"
  | "matchedWhatsapp"
  | "matchedSms"
  | "contactMatchStatus"
>;

export function findMatchingMasterContact(due: DueMatchInput, contacts: MasterContact[]) {
  const extractedDue = extractDealerCodeAndName(
    due.dealerCode || due.customerCode || "",
    due.companyName || ""
  );

  const dealerCode = normalizeText(extractedDue.dealerCode || due.dealerCode || due.customerCode || "");

  if (dealerCode) {
    const codeMatch = contacts.find((contact) => {
      const contactCode = normalizeText(contact.dealerCode || contact.customerCode || "");
      if (contactCode === dealerCode) {
        return true;
      }
      const extractedContact = extractDealerCodeAndName(
        contact.dealerCode || contact.customerCode || "",
        contact.companyName || ""
      );
      return normalizeText(extractedContact.dealerCode) === dealerCode;
    });

    if (codeMatch) {
      return codeMatch;
    }
  }

  if (due.matchedContactId) {
    const matchedContact = contacts.find((contact) => contact.id === due.matchedContactId);
    if (matchedContact) {
      return matchedContact;
    }
  }

  const companyKey = normalizeText(extractedDue.companyName || due.companyName);
  if (companyKey) {
    const companyMatch = contacts.find((contact) => {
      const cCompanyKey = normalizeText(contact.companyName);
      if (cCompanyKey === companyKey) {
        return true;
      }
      const extractedContact = extractDealerCodeAndName(
        contact.dealerCode || contact.customerCode || "",
        contact.companyName || ""
      );
      return normalizeText(extractedContact.companyName) === companyKey;
    });

    if (companyMatch) {
      return companyMatch;
    }
  }

  // Fallback 1: Normalized company name (ignores parentheses, brackets, dots, commas, &, etc.)
  const rawDueName = extractedDue.companyName || due.companyName || "";
  const normDueName = normalizeCompanyName(rawDueName);
  if (normDueName) {
    const normMatch = contacts.find((contact) => {
      const cNorm = normalizeCompanyName(contact.companyName);
      if (cNorm === normDueName) {
        return true;
      }
      const extractedContact = extractDealerCodeAndName(
        contact.dealerCode || contact.customerCode || "",
        contact.companyName || ""
      );
      return normalizeCompanyName(extractedContact.companyName) === normDueName;
    });

    if (normMatch) {
      return normMatch;
    }
  }

  // Fallback 2: Strict alphanumeric match (e.g. "LimitedNagpur" vs "Limited (Nagpur)")
  const strictDueName = normalizeCompanyNameStrict(rawDueName);
  if (strictDueName && strictDueName.length >= 4) {
    const strictMatch = contacts.find((contact) => {
      const cStrict = normalizeCompanyNameStrict(contact.companyName);
      if (cStrict === strictDueName) {
        return true;
      }
      const extractedContact = extractDealerCodeAndName(
        contact.dealerCode || contact.customerCode || "",
        contact.companyName || ""
      );
      return normalizeCompanyNameStrict(extractedContact.companyName) === strictDueName;
    });

    if (strictMatch) {
      return strictMatch;
    }
  }

  return null;
}

export function buildDueContactMatch(due: DueMatchInput, contacts: MasterContact[]) {
  const extractedDue = extractDealerCodeAndName(
    due.dealerCode || due.customerCode || "",
    due.companyName || ""
  );
  const matchedContact = findMatchingMasterContact(due, contacts);

  return {
    matchedContact,
    matchedContactId: matchedContact?.id || "",
    matchedContactName: matchedContact?.primaryContact || "",
    matchedEmail: matchedContact?.email || "",
    matchedWhatsapp: matchedContact?.whatsapp || "",
    matchedSms: matchedContact?.sms || "",
    contactMatchStatus: matchedContact ? ("matched" as const) : ("missing" as const),
    companyName: extractedDue.companyName || matchedContact?.companyName || due.companyName || "",
    dealerCode: extractedDue.dealerCode || matchedContact?.dealerCode || due.dealerCode || ""
  };
}
