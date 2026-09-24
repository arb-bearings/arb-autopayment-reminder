import type { AppDatabase, Salesperson, User } from "@/lib/types";
import { extractDealerCodeAndName, splitDealerCodeAndName } from "@/lib/dealer-utils";

function normalizeDealerCode(value: string | undefined | null) {
  return (value || "").trim().toLowerCase();
}

export function applySalespersonMappings(
  database: AppDatabase,
  salespersons: Salesperson[],
  sharedOwnerIds: Set<string>,
  updatedBy: Pick<User, "id">
) {
  const dealerMap = new Map<string, Salesperson>();

  salespersons.forEach((salesperson) => {
    salesperson.dealerCodes.forEach((rawDealerCode) => {
      const extracted = splitDealerCodeAndName(rawDealerCode);
      const key = normalizeDealerCode(extracted.code || rawDealerCode);
      if (key) {
        dealerMap.set(key, salesperson);
      }
    });
  });

  database.masterContacts.forEach((contact) => {
    if (!sharedOwnerIds.has(contact.ownerId)) {
      return;
    }

    const rawCode = contact.dealerCode || contact.customerCode || "";
    const extracted = extractDealerCodeAndName(rawCode, contact.companyName);
    const key = normalizeDealerCode(extracted.dealerCode || rawCode);
    const salesperson = dealerMap.get(key);

    if (!salesperson) {
      return;
    }

    contact.salespersonId = salesperson.id;
    contact.salespersonName = salesperson.name;
    contact.salespersonEmail = salesperson.email;
  });

  database.dueRecords.forEach((due) => {
    if (!sharedOwnerIds.has(due.ownerId)) {
      return;
    }

    const rawCode = due.dealerCode || due.customerCode || "";
    const extracted = extractDealerCodeAndName(rawCode, due.companyName);
    const key = normalizeDealerCode(extracted.dealerCode || rawCode);
    const salesperson = dealerMap.get(key);

    if (!salesperson) {
      return;
    }

    due.salespersonId = salesperson.id;
    due.salespersonName = salesperson.name;
    due.salespersonEmail = salesperson.email;
    due.updatedBy = updatedBy.id;
  });
}
