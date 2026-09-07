"use client";

import { useId, useState, useMemo } from "react";
import type { ReminderLog, DueRecord, MasterContact } from "@/lib/types";
import { formatCurrency, formatDate, getBillAgeDays, daysBetween } from "@/lib/utils";
import { ChannelLabel } from "@/components/channel-label";

interface ReminderLogsClientProps {
  reminderLogs: ReminderLog[];
  dueRecords: DueRecord[];
  masterContacts: MasterContact[];
}

type SortOption = "name" | "days-desc" | "days-asc" | "date-desc" | "date-asc" | "outstanding-desc";

function formatDateTime(value: string | null) {
  if (!value) return "-";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? "-"
    : new Intl.DateTimeFormat("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hour12: true
      }).format(parsed);
}

export function ReminderLogsClient({
  reminderLogs,
  dueRecords,
  masterContacts
}: ReminderLogsClientProps) {
  const searchInputId = useId();
  const [query, setQuery] = useState("");
  const [expandedDealers, setExpandedDealers] = useState<Record<string, boolean>>({});
  const [sortBy, setSortBy] = useState<SortOption>("date-desc");
  const [openMessageId, setOpenMessageId] = useState<string | null>(null);

  // Group sent reminder logs by dealerCode or dealerName so that logs persist independently of due sheets
  const groupedDealers = useMemo(() => {
    // 1. Filter to status === 'sent'
    const sentLogs = reminderLogs.filter((log) => log.status === "sent");

    // 2. Group by dealer identifier (code or name)
    const groups: Record<string, ReminderLog[]> = {};
    for (const log of sentLogs) {
      const code =
        log.dealerCode && log.dealerCode !== "N/A"
          ? log.dealerCode.trim()
          : log.dealerName?.trim() || "N/A";
      if (!groups[code]) {
        groups[code] = [];
      }
      groups[code].push(log);
    }

    const today = new Date();

    return Object.entries(groups).map(([groupKey, logsForDealer]) => {
      // Find dealer name from dueRecords, then masterContacts, or fallback to the log itself
      const matchingDue = dueRecords.find((due) => {
        const dCode = (due.dealerCode || due.customerCode || "").trim().toLowerCase();
        const dName = (due.companyName || "").trim().toLowerCase();
        const target = groupKey.toLowerCase();
        return (dCode && dCode === target) || (dName && dName === target);
      });

      const matchingContact = masterContacts.find((c) => {
        const cCode = (c.dealerCode || "").trim().toLowerCase();
        const cName = (c.companyName || "").trim().toLowerCase();
        const target = groupKey.toLowerCase();
        return (cCode && cCode === target) || (cName && cName === target);
      });

      const companyName =
        matchingDue?.companyName ||
        matchingContact?.companyName ||
        logsForDealer.find((l) => l.dealerName)?.dealerName ||
        logsForDealer[0]?.recipient ||
        "Unknown Dealer";

      const dealerCode =
        matchingDue?.dealerCode ||
        matchingDue?.customerCode ||
        matchingContact?.dealerCode ||
        logsForDealer.find((l) => l.dealerCode && l.dealerCode !== "N/A")?.dealerCode ||
        groupKey;

      // Calculate days elapsed since the latest sent reminder was sent to this dealer
      const sentTimestamps = logsForDealer
        .map((l) => {
          const dateStr = l.sentAt || l.createdAt;
          if (!dateStr) return NaN;
          const t = new Date(dateStr).getTime();
          return Number.isNaN(t) ? NaN : t;
        })
        .filter((t) => !Number.isNaN(t));

      const latestSentTimestamp = sentTimestamps.length > 0 ? Math.max(...sentTimestamps) : null;
      const latestSentDate = latestSentTimestamp !== null ? new Date(latestSentTimestamp) : null;
      const daysElapsed =
        latestSentDate !== null ? Math.max(0, daysBetween(latestSentDate, today)) : 0;

      // Check if this dealer has active due records in the current due sheet
      const activeDues = dueRecords.filter((due) => {
        const dCode = (due.dealerCode || due.customerCode || "").trim().toLowerCase();
        const dName = (due.companyName || "").trim().toLowerCase();
        const targetCode = dealerCode.toLowerCase();
        const targetName = companyName.toLowerCase();
        return (
          (targetCode && dCode && dCode === targetCode) ||
          (targetName && dName && dName === targetName)
        );
      });

      const hasActiveDues = activeDues.length > 0;
      const totalOutstanding = activeDues.reduce(
        (sum, due) => sum + (due.amount > 0 ? due.amount : 0),
        0
      );

      const loggedTotal = logsForDealer.reduce(
        (max, log) => Math.max(max, log.totalOutstanding || log.relevantAmount || 0),
        0
      );

      // Group logs by invoice number
      const invoiceGroups: Record<
        string,
        {
          invoiceNumber: string;
          hasActiveDue: boolean;
          billDate: string;
          billAge: number | null;
          outstandingAmount: number;
          recordedAmount: number;
          currency: string;
          logs: ReminderLog[];
        }
      > = {};

      for (const log of logsForDealer) {
        const invNum = log.invoiceNumber || "N/A";
        if (!invoiceGroups[invNum]) {
          const activeDue = activeDues.find(
            (due) => due.invoiceNumber === invNum || due.reference === invNum
          );

          invoiceGroups[invNum] = {
            invoiceNumber: invNum,
            hasActiveDue: !!activeDue,
            billDate: activeDue ? activeDue.billDate || activeDue.invoiceDate : "",
            billAge: activeDue
              ? getBillAgeDays(activeDue.billDate || activeDue.invoiceDate)
              : log.billAgeDays,
            outstandingAmount: activeDue ? activeDue.amount : 0,
            recordedAmount: log.relevantAmount || log.totalOutstanding || 0,
            currency: activeDue ? activeDue.currency : "INR",
            logs: []
          };
        }
        invoiceGroups[invNum].logs.push(log);
      }

      // Sort logs for each invoice by date descending
      Object.values(invoiceGroups).forEach((group) => {
        group.logs.sort((left, right) => {
          const dateLeft = left.sentAt || left.createdAt || "";
          const dateRight = right.sentAt || right.createdAt || "";
          return dateRight.localeCompare(dateLeft);
        });
      });

      return {
        key: groupKey,
        dealerCode,
        companyName,
        daysElapsed,
        latestSentDate: latestSentDate ? latestSentDate.toISOString() : null,
        latestSentTimestamp: latestSentTimestamp || 0,
        hasActiveDues,
        totalOutstanding,
        loggedTotal,
        currency: activeDues[0]?.currency || "INR",
        invoices: Object.values(invoiceGroups).sort((a, b) =>
          b.invoiceNumber.localeCompare(a.invoiceNumber)
        ),
        totalRemindersCount: logsForDealer.length,
        salespersonName:
          activeDues[0]?.salespersonName || matchingContact?.salespersonName || "Unassigned"
      };
    });
  }, [reminderLogs, dueRecords, masterContacts]);

  // Filter based on search query
  const filteredDealers = useMemo(() => {
    const norm = query.toLowerCase().trim();
    if (!norm) return groupedDealers;

    return groupedDealers
      .map((dealer) => {
        const dealerMatches =
          dealer.companyName.toLowerCase().includes(norm) ||
          dealer.dealerCode.toLowerCase().includes(norm) ||
          dealer.salespersonName.toLowerCase().includes(norm) ||
          (dealer.latestSentDate && formatDateTime(dealer.latestSentDate).toLowerCase().includes(norm));

        const matchingInvoices = dealer.invoices.filter(
          (inv) =>
            inv.invoiceNumber.toLowerCase().includes(norm) ||
            inv.logs.some(
              (l) =>
                (l.recipient || "").toLowerCase().includes(norm) ||
                (l.subject || "").toLowerCase().includes(norm) ||
                (l.content || "").toLowerCase().includes(norm)
            )
        );

        if (dealerMatches) {
          return dealer;
        } else if (matchingInvoices.length > 0) {
          return {
            ...dealer,
            invoices: matchingInvoices
          };
        }
        return null;
      })
      .filter((g): g is NonNullable<typeof g> => g !== null);
  }, [groupedDealers, query]);

  // Sort the grouped list
  const sortedDealers = useMemo(() => {
    const list = [...filteredDealers];
    if (sortBy === "name") {
      return list.sort((a, b) => a.companyName.localeCompare(b.companyName));
    }
    if (sortBy === "days-desc") {
      return list.sort((a, b) => b.daysElapsed - a.daysElapsed);
    }
    if (sortBy === "days-asc") {
      return list.sort((a, b) => a.daysElapsed - b.daysElapsed);
    }
    if (sortBy === "date-desc") {
      return list.sort((a, b) => b.latestSentTimestamp - a.latestSentTimestamp);
    }
    if (sortBy === "date-asc") {
      return list.sort((a, b) => a.latestSentTimestamp - b.latestSentTimestamp);
    }
    if (sortBy === "outstanding-desc") {
      return list.sort((a, b) => b.totalOutstanding - a.totalOutstanding);
    }
    return list;
  }, [filteredDealers, sortBy]);

  // Automatically expand matches when searching
  useMemo(() => {
    if (query.trim()) {
      const newExpanded: Record<string, boolean> = {};
      for (const dealer of filteredDealers) {
        newExpanded[dealer.key] = true;
      }
      setExpandedDealers(newExpanded);
    }
  }, [filteredDealers, query]);

  const toggleDealer = (key: string) => {
    setExpandedDealers((prev) => ({
      ...prev,
      [key]: !prev[key]
    }));
  };

  const expandAll = () => {
    const allExpanded: Record<string, boolean> = {};
    for (const d of sortedDealers) {
      allExpanded[d.key] = true;
    }
    setExpandedDealers(allExpanded);
  };

  const collapseAll = () => {
    setExpandedDealers({});
  };

  return (
    <div className="grouped-dues-workspace">
      {/* Summary Stats Bar */}
      <div className="dues-stats-dashboard">
        <div className="dues-stat-card">
          <span className="label">Dealers in History</span>
          <span className="value">{groupedDealers.length}</span>
        </div>
        <div className="dues-stat-card">
          <span className="label">Total Sent Reminders</span>
          <span className="value">
            {reminderLogs.filter((log) => log.status === "sent").length}
          </span>
        </div>
        <div className="dues-stat-card">
          <span className="label">Avg Elapsed Days</span>
          <span className="value">
            {groupedDealers.length > 0
              ? (
                  groupedDealers.reduce((sum, d) => sum + d.daysElapsed, 0) /
                  groupedDealers.length
                ).toFixed(1) + " d"
              : "0 d"}
          </span>
        </div>
        <div className="dues-stat-card overdue">
          <span className="label">In Cooldown (&lt; 5 Days)</span>
          <span className="value" style={{ color: "var(--danger)" }}>
            {groupedDealers.filter((d) => d.daysElapsed < 5).length}
          </span>
        </div>
        <div
          className="dues-stat-card"
          style={{
            background: "rgba(40, 167, 69, 0.04)",
            borderColor: "rgba(40, 167, 69, 0.2)"
          }}
        >
          <span className="label" style={{ color: "var(--success)" }}>
            Cooldown Over (&ge; 5 Days)
          </span>
          <span className="value" style={{ color: "var(--success)" }}>
            {groupedDealers.filter((d) => d.daysElapsed >= 5).length}
          </span>
        </div>
      </div>

      {/* Controls: Search, Sort and Expansion */}
      <div className="search-and-bulk" style={{ gap: "1rem", flexWrap: "wrap" }}>
        <div className="search-wrapper" style={{ flex: "1 1 300px" }}>
          <label htmlFor={searchInputId} style={{ display: "none" }}>
            Search reminder logs
          </label>
          <input
            id={searchInputId}
            type="search"
            value={query}
            placeholder="Search dealer code, name, date, invoice number, recipient or content..."
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>

        <div
          className="sort-and-actions"
          style={{ display: "flex", gap: "0.75rem", alignItems: "center", flexWrap: "wrap" }}
        >
          <label className="checkbox-field" style={{ margin: 0 }}>
            <span style={{ fontSize: "0.9rem", fontWeight: 500 }}>Sort by:</span>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as SortOption)}
              style={{
                padding: "0.5rem 2rem 0.5rem 0.75rem",
                borderRadius: "0.5rem",
                width: "auto",
                border: "1px solid rgba(22,43,82,0.15)"
              }}
            >
              <option value="date-desc">Last Sent Date (Latest First)</option>
              <option value="date-asc">Last Sent Date (Oldest First)</option>
              <option value="name">Dealer Name (A-Z)</option>
              <option value="days-desc">Days Elapsed (High to Low)</option>
              <option value="days-asc">Days Elapsed (Low to High)</option>
              <option value="outstanding-desc">Outstanding Amount (High to Low)</option>
            </select>
          </label>

          <button
            type="button"
            className="button button-secondary"
            onClick={expandAll}
            style={{ padding: "0.55rem 1rem", fontSize: "0.85rem" }}
          >
            Expand All
          </button>
          <button
            type="button"
            className="button button-secondary"
            onClick={collapseAll}
            style={{ padding: "0.55rem 1rem", fontSize: "0.85rem" }}
          >
            Collapse All
          </button>
        </div>
      </div>

      {/* Dealer logs list */}
      <div className="party-group-list" style={{ marginTop: "1.5rem" }}>
        {sortedDealers.length === 0 ? (
          <div className="glass-panel" style={{ textAlign: "center", padding: "3rem" }}>
            <p className="muted-copy">
              {query
                ? `No reminder logs match search query "${query}".`
                : "No sent reminders recorded in history yet."}
            </p>
          </div>
        ) : (
          sortedDealers.map((dealer) => {
            const isExpanded = expandedDealers[dealer.key];
            const isLess5 = dealer.daysElapsed < 5;
            const daysLeft = Math.max(0, 5 - dealer.daysElapsed);

            return (
              <div className="party-card" key={dealer.key}>
                {/* Header Section */}
                <div className="party-header" onClick={() => toggleDealer(dealer.key)}>
                  <div className="party-title-section">
                    <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
                      <h3>{dealer.companyName}</h3>
                      <span className="badge neutral">Code: {dealer.dealerCode}</span>
                    </div>

                    <div className="party-meta" style={{ marginTop: "0.35rem", gap: "0.6rem" }}>
                      {/* Prominent Last Sent Date */}
                      <span
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "0.35rem",
                          background: "rgba(22, 43, 82, 0.06)",
                          padding: "0.25rem 0.65rem",
                          borderRadius: "0.45rem",
                          fontWeight: 600,
                          fontSize: "0.82rem",
                          color: "var(--navy-950)"
                        }}
                      >
                        📅 Last Sent: <strong>{formatDateTime(dealer.latestSentDate)}</strong>
                      </span>

                      {/* Separate Days Elapsed Counter */}
                      <span
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "0.3rem",
                          background: isLess5 ? "rgba(220, 53, 69, 0.08)" : "rgba(40, 167, 69, 0.08)",
                          border: isLess5 ? "1px solid rgba(220, 53, 69, 0.2)" : "1px solid rgba(40, 167, 69, 0.2)",
                          padding: "0.25rem 0.65rem",
                          borderRadius: "0.45rem",
                          fontSize: "0.82rem",
                          fontWeight: 600,
                          color: isLess5 ? "var(--danger)" : "var(--success)"
                        }}
                      >
                        ⏱️ Elapsed:{" "}
                        <strong style={{ fontSize: "0.95rem" }}>
                          {dealer.daysElapsed === 0 ? "0 days (Today)" : `${dealer.daysElapsed} day${dealer.daysElapsed === 1 ? "" : "s"} ago`}
                        </strong>
                      </span>

                      {/* Cooldown Status Pill */}
                      <span
                        style={{
                          fontSize: "0.75rem",
                          padding: "0.25rem 0.6rem",
                          borderRadius: "9999px",
                          fontWeight: 700,
                          background: isLess5
                            ? "rgba(220, 53, 69, 0.12)"
                            : "rgba(40, 167, 69, 0.14)",
                          color: isLess5 ? "var(--danger)" : "var(--success)"
                        }}
                      >
                        {isLess5
                          ? `⏳ Cooldown Active (${daysLeft}d left for 5-day window)`
                          : "✅ Ready for Reminder (≥ 5 Days)"}
                      </span>

                      <span className="badge neutral">
                        {dealer.totalRemindersCount} Reminder{dealer.totalRemindersCount === 1 ? "" : "s"} ({dealer.invoices.length} Inv)
                      </span>

                      <span style={{ fontSize: "0.8rem", color: "var(--muted)" }}>
                        Salesperson: {dealer.salespersonName}
                      </span>
                    </div>
                  </div>

                  <div className="party-financials">
                    <div className="financial-item">
                      <span className="fin-label">
                        {dealer.hasActiveDues ? "Current Outstanding" : "Last Recorded Total"}
                      </span>
                      <span className="fin-val pending">
                        {dealer.hasActiveDues
                          ? dealer.totalOutstanding > 0
                            ? formatCurrency(dealer.totalOutstanding, dealer.currency)
                            : "Paid / ₹0"
                          : dealer.loggedTotal > 0
                          ? `${formatCurrency(dealer.loggedTotal, dealer.currency)} (Archived)`
                          : "Historical Log"}
                      </span>
                      {!dealer.hasActiveDues && (
                        <span style={{ fontSize: "0.68rem", color: "var(--muted)", fontStyle: "italic" }}>
                          No Active Due Sheet
                        </span>
                      )}
                    </div>
                  </div>

                  <button
                    type="button"
                    className={`expand-toggle-btn ${isExpanded ? "expanded" : ""}`}
                    aria-label={isExpanded ? "Collapse dealer" : "Expand dealer"}
                  >
                    ▼
                  </button>
                </div>

                {/* Collapsible Panel */}
                {isExpanded && (
                  <div className="party-details-panel">
                    <div
                      className="table-wrap"
                      style={{
                        boxShadow: "none",
                        border: "none",
                        background: "transparent",
                        margin: 0
                      }}
                    >
                      <table className="invoice-details-table">
                        <thead>
                          <tr>
                            <th>Invoice Number</th>
                            <th>Bill Date</th>
                            <th>Bill Age</th>
                            <th>Outstanding / Status</th>
                            <th>Sent Reminders Audit Trail</th>
                          </tr>
                        </thead>
                        <tbody>
                          {dealer.invoices.map((inv) => {
                            const isPaid = inv.hasActiveDue && inv.outstandingAmount <= 0;

                            return (
                              <tr key={inv.invoiceNumber}>
                                <td style={{ fontWeight: 600 }}>{inv.invoiceNumber}</td>
                                <td>
                                  {inv.billDate
                                    ? formatDate(inv.billDate)
                                    : inv.hasActiveDue
                                    ? "Not specified"
                                    : "Logged record"}
                                </td>
                                <td>
                                  {inv.billAge !== null
                                    ? `${inv.billAge} day${inv.billAge === 1 ? "" : "s"}`
                                    : "N/A"}
                                </td>
                                <td>
                                  {inv.hasActiveDue ? (
                                    isPaid ? (
                                      <span style={{ fontWeight: 600, color: "var(--success)" }}>
                                        Paid
                                      </span>
                                    ) : (
                                      formatCurrency(inv.outstandingAmount, inv.currency)
                                    )
                                  ) : (
                                    <span style={{ color: "var(--muted)" }}>
                                      {inv.recordedAmount > 0
                                        ? `${formatCurrency(inv.recordedAmount, inv.currency)} (Recorded)`
                                        : "Historical"}
                                    </span>
                                  )}
                                </td>
                                <td>
                                  {/* Sub-list of individual reminders sent for this invoice */}
                                  <div
                                    style={{
                                      display: "flex",
                                      flexDirection: "column",
                                      gap: "0.5rem"
                                    }}
                                  >
                                    {inv.logs.map((log) => {
                                      const rawDate = log.sentAt || log.createdAt;
                                      let diffDaysText = "";
                                      let isLogRecent = false;
                                      if (rawDate) {
                                        const d = new Date(rawDate);
                                        if (!Number.isNaN(d.getTime())) {
                                          const diff = daysBetween(d, new Date());
                                          isLogRecent = diff < 5;
                                          diffDaysText = diff === 0 ? "Today (0d)" : `${diff}d ago`;
                                        }
                                      }

                                      return (
                                        <div
                                          key={log.id}
                                          style={{
                                            background: "rgba(22, 43, 82, 0.03)",
                                            border: "1px solid rgba(22, 43, 82, 0.08)",
                                            borderRadius: "0.5rem",
                                            padding: "0.5rem 0.75rem",
                                            fontSize: "0.85rem"
                                          }}
                                        >
                                          <div
                                            style={{
                                              display: "flex",
                                              justifyContent: "space-between",
                                              alignItems: "center",
                                              gap: "1rem",
                                              flexWrap: "wrap"
                                            }}
                                          >
                                            <div
                                              style={{
                                                display: "flex",
                                                gap: "0.5rem",
                                                alignItems: "center"
                                              }}
                                            >
                                              <ChannelLabel channel={log.channel} />
                                              <span style={{ color: "var(--muted)" }}>
                                                to <strong>{log.recipient}</strong>
                                              </span>
                                            </div>

                                            <div
                                              style={{
                                                display: "flex",
                                                gap: "0.5rem",
                                                alignItems: "center",
                                                flexWrap: "wrap"
                                              }}
                                            >
                                              <span className="badge neutral">
                                                Trigger: {log.reminderDay}d Rule
                                              </span>
                                              <span
                                                style={{
                                                  fontSize: "0.8rem",
                                                  color: "var(--navy-900)",
                                                  fontWeight: 500
                                                }}
                                              >
                                                📅 {formatDateTime(log.sentAt || log.createdAt)}
                                              </span>
                                              {diffDaysText && (
                                                <span
                                                  style={{
                                                    fontSize: "0.75rem",
                                                    fontWeight: 700,
                                                    padding: "0.15rem 0.45rem",
                                                    borderRadius: "0.35rem",
                                                    background: isLogRecent
                                                      ? "rgba(220, 53, 69, 0.1)"
                                                      : "rgba(40, 167, 69, 0.1)",
                                                    color: isLogRecent ? "var(--danger)" : "var(--success)"
                                                  }}
                                                >
                                                  {diffDaysText}
                                                </span>
                                              )}
                                              <button
                                                type="button"
                                                className="button button-secondary"
                                                onClick={() =>
                                                  setOpenMessageId(
                                                    openMessageId === log.id ? null : log.id
                                                  )
                                                }
                                                style={{
                                                  padding: "0.2rem 0.5rem",
                                                  fontSize: "0.75rem",
                                                  margin: 0
                                                }}
                                              >
                                                {openMessageId === log.id ? "Hide Msg" : "View Msg"}
                                              </button>
                                            </div>
                                          </div>

                                          {/* Expandable message body */}
                                          {openMessageId === log.id && (
                                            <div
                                              style={{
                                                marginTop: "0.5rem",
                                                padding: "0.5rem 0.75rem",
                                                background: "#ffffff",
                                                border: "1px solid rgba(22, 43, 82, 0.1)",
                                                borderRadius: "0.35rem",
                                                whiteSpace: "pre-wrap",
                                                fontFamily: "monospace",
                                                fontSize: "0.8rem",
                                                color: "var(--text)"
                                              }}
                                            >
                                              {log.channel === "email" && log.subject && (
                                                <div style={{ marginBottom: "0.5rem" }}>
                                                  <strong>Subject:</strong> {log.subject}
                                                  <hr
                                                    style={{
                                                      border: 0,
                                                      borderTop: "1px solid rgba(22, 43, 82, 0.08)",
                                                      margin: "0.25rem 0"
                                                    }}
                                                  />
                                                </div>
                                              )}
                                              {log.content}
                                            </div>
                                          )}
                                        </div>
                                      );
                                    })}
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
