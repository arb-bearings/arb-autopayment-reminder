/**
 * Utility functions for detecting, splitting, and extracting dealer codes and company names.
 * Common in Indian ERP / Tally / SAP exports where Party Name is exported as "D26933(Zadap Enterprise)"
 * without a dedicated dealer code column.
 */

const COMMON_NON_CODE_WORDS = new Set([
  "india",
  "pune",
  "nagpur",
  "delhi",
  "mumbai",
  "kolkata",
  "chennai",
  "jaipur",
  "indore",
  "bhopal",
  "kanpur",
  "lucknow",
  "ahmedabad",
  "surat",
  "vadodara",
  "rajkot",
  "patna",
  "ranchi",
  "raipur",
  "ludhiana",
  "chandigarh",
  "pvt",
  "ltd",
  "private",
  "limited",
  "co",
  "corp",
  "corporation",
  "branch",
  "unit",
  "main",
  "north",
  "south",
  "east",
  "west",
  "central",
  "ho",
  "ro",
  "grease",
  "bearing",
  "bearings",
  "auto",
  "automobiles",
  "agencies",
  "enterprises",
  "traders",
  "trading",
  "total",
  "subtotal",
  "gst",
  "cash",
  "credit",
  "debit",
  "bank",
  "sales",
  "purchase"
]);

export function isLikelyDealerCode(token: string | undefined | null): boolean {
  const trimmed = (token || "").trim();
  if (!trimmed || trimmed.length < 2 || trimmed.length > 20) {
    return false;
  }

  // Exclude geographic or company type words commonly found in parentheses e.g. (Pune), (India), (Pvt Ltd)
  if (COMMON_NON_CODE_WORDS.has(trimmed.toLowerCase())) {
    return false;
  }

  // Must only contain alphanumeric, hyphen, underscore, slash
  if (!/^[A-Za-z0-9\-_\/]+$/.test(trimmed)) {
    return false;
  }

  // Pattern 1: Standard Dealer Code format (Letter(s) + Digits, e.g. D26933, D23003, DLR001, TST001, DL-23003, ARB-101)
  if (/^[A-Za-z]{1,6}[-_]?\d+[A-Za-z0-9\-_]*$/i.test(trimmed)) {
    return true;
  }

  // Pattern 2: Pure numeric code with 3 to 10 digits (e.g. 23003, 10042)
  if (/^\d{3,10}$/.test(trimmed)) {
    return true;
  }

  // Pattern 3: Digits + letters/hyphen (e.g. 100-A, 23003D)
  if (/^\d+[-_]?[A-Za-z]+[A-Za-z0-9\-_]*$/i.test(trimmed)) {
    return true;
  }

  // Pattern 4: Short uppercase code with digits (e.g. DLR01, ARB1, D1)
  if (/^[A-Z0-9\-_]{2,8}$/.test(trimmed) && /\d/.test(trimmed)) {
    return true;
  }

  return false;
}

export function splitDealerCodeAndName(raw: string | undefined | null): {
  code: string;
  name: string;
} {
  const text = (raw || "").trim();
  if (!text) {
    return { code: "", name: "" };
  }

  // Format 1: CODE(NAME) or CODE [NAME] -> e.g. "D26933(Zadap Enterprise)", "D23003(A. A. Enterprises)"
  const prefixParenMatch = text.match(/^([A-Za-z0-9\-_\/]+)\s*[\(\[](.+)[\)\]]\s*$/);
  if (prefixParenMatch && isLikelyDealerCode(prefixParenMatch[1])) {
    return { code: prefixParenMatch[1].trim(), name: prefixParenMatch[2].trim() };
  }

  // Format 2: NAME (CODE) or NAME [CODE] -> e.g. "Zadap Enterprise (D26933)", "A. A. Enterprises [D23003]"
  const suffixParenMatch = text.match(/^(.+?)\s*[\(\[]([A-Za-z0-9\-_\/]+)[\)\]]\s*$/);
  if (suffixParenMatch && isLikelyDealerCode(suffixParenMatch[2])) {
    return { code: suffixParenMatch[2].trim(), name: suffixParenMatch[1].trim() };
  }

  // Format 3: [CODE] NAME or (CODE) NAME -> e.g. "[D26933] Zadap Enterprise", "(D26933) - Zadap Enterprise"
  const leadingBracketMatch = text.match(/^[\(\[]([A-Za-z0-9\-_\/]+)[\)\]]\s*[-:\/]?\s*(.+)$/);
  if (leadingBracketMatch && isLikelyDealerCode(leadingBracketMatch[1])) {
    return { code: leadingBracketMatch[1].trim(), name: leadingBracketMatch[2].trim() };
  }

  // Format 4: CODE - NAME or CODE : NAME or CODE / NAME -> e.g. "D26933 - Zadap Enterprise"
  const prefixSepMatch = text.match(/^([A-Za-z0-9\-_\/]{2,20})\s*[-:\/|]\s*(.+)$/);
  if (prefixSepMatch && isLikelyDealerCode(prefixSepMatch[1])) {
    return { code: prefixSepMatch[1].trim(), name: prefixSepMatch[2].trim() };
  }

  // Format 5: NAME - CODE -> e.g. "Zadap Enterprise - D26933"
  const suffixSepMatch = text.match(/^(.+?)\s*[-:\/|]\s*([A-Za-z0-9\-_\/]{2,20})$/);
  if (suffixSepMatch && isLikelyDealerCode(suffixSepMatch[2])) {
    return { code: suffixSepMatch[2].trim(), name: suffixSepMatch[1].trim() };
  }

  // Format 6: Leading code with space -> e.g. "D26933 Zadap Enterprise"
  const leadingSpaceMatch = text.match(/^([A-Za-z]{1,6}\d{2,10})\s+(.+)$/);
  if (leadingSpaceMatch && isLikelyDealerCode(leadingSpaceMatch[1])) {
    return { code: leadingSpaceMatch[1].trim(), name: leadingSpaceMatch[2].trim() };
  }

  // Standalone code
  if (isLikelyDealerCode(text)) {
    return { code: text, name: "" };
  }

  return { code: "", name: text };
}

export function extractDealerCodeAndName(
  rawDealerCode: string | undefined | null,
  rawCompanyName: string | undefined | null
): { dealerCode: string; companyName: string } {
  let code = (rawDealerCode || "").trim();
  let name = (rawCompanyName || "").trim();

  // If code is empty, attempt to extract code from name
  if (!code && name) {
    const extracted = splitDealerCodeAndName(name);
    if (extracted.code) {
      code = extracted.code;
    }
    if (extracted.name) {
      name = extracted.name;
    }
  } else if (code && !name) {
    // If name is empty, attempt to extract name from code
    const extracted = splitDealerCodeAndName(code);
    if (extracted.code) {
      code = extracted.code;
    }
    if (extracted.name) {
      name = extracted.name;
    }
  } else if (code && name) {
    // If both exist, but name still contains the code prefix e.g. code: "D26933", name: "D26933(Zadap Enterprise)"
    const extracted = splitDealerCodeAndName(name);
    if (extracted.code && extracted.name) {
      if (!code || extracted.code.toLowerCase() === code.toLowerCase()) {
        code = code || extracted.code;
        name = extracted.name;
      }
    }
  }

  return { dealerCode: code, companyName: name };
}
