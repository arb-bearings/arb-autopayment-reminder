import * as XLSX from "xlsx";

type SampleWorkbookKind = "master" | "due" | "salesperson";

type SampleWorkbookConfig = {
  fileName: string;
  sheetName: string;
  rows: Array<Record<string, string | number>>;
};

const sampleWorkbooks: Record<SampleWorkbookKind, SampleWorkbookConfig> = {
  master: {
    fileName: "sample-master-database.xlsx",
    sheetName: "Master Database",
    rows: [
      {
        "Dealer Code": "DLR-001",
        "Company Name": "Example Trading Co.",
        "Contact Person": "Ravi Sharma",
        Email: "accounts@exampletrading.com",
        WhatsApp: "919876543210",
        Phone: "919876543210"
      }
    ]
  },
  due: {
    fileName: "sample-due-database.xlsx",
    sheetName: "Due Database",
    get rows() {
      const getOffsetDate = (daysAgo: number) => {
        const d = new Date();
        d.setDate(d.getDate() - daysAgo);
        return d.toISOString().split("T")[0];
      };

      const getOffsetDueDate = (daysAgo: number, creditTerm: number) => {
        const d = new Date();
        d.setDate(d.getDate() - daysAgo + creditTerm);
        return d.toISOString().split("T")[0];
      };

      return [
        // ─── Dealer 1: Orion Wholesale (25-30 days -> 3% CD) ───
        {
          "Ref. No.": "OR-3001",
          "opening": 35000,
          "pending": 28450,
          "overdue": 0,
          "Date": getOffsetDate(28), // 28 days old -> 25-30 days (3% CD)
          "Party's Name": "Orion Wholesale Private Limited",
          "Due on": getOffsetDueDate(28, 30),
          "Dealer Code": "TST001",
          "Currency": "INR"
        },
        // ─── Dealer 2: Nimbus Surgical (40-45 days -> 2% CD) ───
        {
          "Ref. No.": "NB-4502",
          "opening": 42000,
          "pending": 31500,
          "overdue": 0,
          "Date": getOffsetDate(42), // 42 days old -> 40-45 days (2% CD)
          "Party's Name": "Nimbus Surgical Agencies",
          "Due on": getOffsetDueDate(42, 45),
          "Dealer Code": "TST002",
          "Currency": "INR"
        },
        // ─── Dealer 3: Cedar Retail (50-60 days -> 60d standard) ───
        {
          "Ref. No.": "CD-6003",
          "opening": 48720,
          "pending": 40200,
          "overdue": 0,
          "Date": getOffsetDate(55), // 55 days old -> 50-60 days (60 Day Reminder)
          "Party's Name": "Cedar Retail Mart",
          "Due on": getOffsetDueDate(55, 60),
          "Dealer Code": "TST003",
          "Currency": "INR"
        },
        // ─── Dealer 4: Apex Medico (60-90 days -> 60+ Overdue) ───
        {
          "Ref. No.": "AP-7504",
          "opening": 70500,
          "pending": 67500,
          "overdue": 15,
          "Date": getOffsetDate(75), // 75 days old -> 60-90 days (75 Day Reminder)
          "Party's Name": "Apex Medico Distributors",
          "Due on": getOffsetDueDate(75, 60),
          "Dealer Code": "TST004",
          "Currency": "INR"
        },
        // ─── Dealer 5: Zenith Pharma (90-120 days -> 90+ Overdue) ───
        {
          "Ref. No.": "ZN-9005",
          "opening": 85000,
          "pending": 85000,
          "overdue": 45,
          "Date": getOffsetDate(105), // 105 days old -> 90-120 days (90 Day Reminder)
          "Party's Name": "Zenith Pharma Labs",
          "Due on": getOffsetDueDate(105, 60),
          "Dealer Code": "TST005",
          "Currency": "INR"
        },
        // ─── Dealer 6: Allahabad Auto (120+ days -> >120 Overdue) ───
        {
          "Ref. No.": "AL-12006",
          "opening": 95000,
          "pending": 95000,
          "overdue": 75,
          "Date": getOffsetDate(135), // 135 days old -> >120 days (120 Day Reminder)
          "Party's Name": "Allahabad Auto Centre",
          "Due on": getOffsetDueDate(135, 60),
          "Dealer Code": "TST006",
          "Currency": "INR"
        }
      ];
    }
  },
  salesperson: {
    fileName: "sample-salesperson-mapping.xlsx",
    sheetName: "Salespersons",
    rows: [
      {
        "Salesperson Name": "Aman Kumar",
        "Employee ID": "SP-001",
        Email: "aman@example.com",
        "Phone Number": "919876543210",
        "Dealer Codes": "DLR-001, DLR-002"
      }
    ]
  }
};

function buildWorkbook(rows: SampleWorkbookConfig["rows"], sheetName: string) {
  const worksheet = XLSX.utils.json_to_sheet(rows);
  worksheet["!cols"] = Object.keys(rows[0] || {}).map((header) => ({
    wch: Math.max(header.length + 2, 18)
  }));

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
  return workbook;
}

export function buildSampleWorkbookResponse(kind: SampleWorkbookKind) {
  const config = sampleWorkbooks[kind];
  const workbook = buildWorkbook(config.rows, config.sheetName);
  const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });

  return new Response(buffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${config.fileName}"`
    }
  });
}
