"use client";

import { useId, useState, useMemo } from "react";
import type { DueRecord, MasterContact } from "@/lib/types";
import { formatCurrency, formatDate, formatElapsedDaysTag } from "@/lib/utils";
import { findMatchingMasterContact } from "@/lib/contact-matching";

interface GroupedDuesTableProps {
  dueRecords: DueRecord[];
  masterContacts: MasterContact[];
  canDispatch: boolean;
}

export function GroupedDuesTable({
  dueRecords,
  masterContacts,
  canDispatch
}: GroupedDuesTableProps) {
  const searchInputId = useId();
  const [query, setQuery] = useState("");
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Group by dealerCode, customerCode, or companyName
  const groupedData = useMemo(() => {
    const groups: Record<string, {
      dealerCode: string;
      companyName: string;
      salespersonName: string;
      salespersonEmail: string;
      invoices: DueRecord[];
      totalOpening: number;
      totalPending: number;
      totalAdvance: number;
      overdueCount: number;
      dueCount: number;
      currency: string;
    }> = {};

    for (const record of dueRecords) {
      const code = record.dealerCode || record.customerCode || "N/A";
      const name = record.companyName || "Unknown Party";
      // Grouping key: prefer code if available, else name
      const key = code !== "N/A" ? `code:${code}` : `name:${name}`;

      if (!groups[key]) {
        groups[key] = {
          dealerCode: code,
          companyName: name,
          salespersonName: record.salespersonName || "Unassigned",
          salespersonEmail: record.salespersonEmail || "",
          invoices: [],
          totalOpening: 0,
          totalPending: 0,
          totalAdvance: 0,
          overdueCount: 0,
          dueCount: 0,
          currency: record.currency || "INR"
        };
      }

      const group = groups[key];
      group.invoices.push(record);
      group.totalOpening += record.openingAmount || 0;
      
      if (record.amount < 0) {
        group.totalAdvance += Math.abs(record.amount);
      } else {
        group.totalPending += record.amount || 0;
      }

      if (record.overdueDays > 0) {
        group.overdueCount += 1;
      } else {
        group.dueCount += 1;
      }
    }

    return Object.entries(groups).map(([key, data]) => ({
      key,
      ...data
    }));
  }, [dueRecords]);

  // Filter based on search query
  const filteredGroups = useMemo(() => {
    const norm = query.toLowerCase().trim();
    if (!norm) return groupedData;

    return groupedData.map(group => {
      // Check if group details match
      const groupMatches =
        group.companyName.toLowerCase().includes(norm) ||
        group.dealerCode.toLowerCase().includes(norm) ||
        group.salespersonName.toLowerCase().includes(norm);

      // Check if individual invoices match
      const matchingInvoices = group.invoices.filter(inv => 
        (inv.invoiceNumber || "").toLowerCase().includes(norm) ||
        (inv.reference || "").toLowerCase().includes(norm) ||
        formatDate(inv.dueDate).toLowerCase().includes(norm)
      );

      if (groupMatches) {
        return group; // Keep the whole group
      } else if (matchingInvoices.length > 0) {
        return {
          ...group,
          invoices: matchingInvoices // Keep only matching invoices in the group
        };
      }
      return null;
    }).filter((g): g is NonNullable<typeof g> => g !== null);
  }, [groupedData, query]);

  // Automatically expand groups that have an active search query matching their content
  useMemo(() => {
    if (query.trim()) {
      const newExpanded: Record<string, boolean> = {};
      for (const group of filteredGroups) {
        newExpanded[group.key] = true;
      }
      setExpandedGroups(newExpanded);
    }
  }, [filteredGroups, query]);

  // Set of all sendable invoice IDs across current filtered groups
  const sendableFilteredInvoiceIds = useMemo(() => {
    const ids = new Set<string>();
    for (const group of filteredGroups) {
      for (const inv of group.invoices) {
        if (findMatchingMasterContact(inv, masterContacts)) {
          ids.add(inv.id);
        }
      }
    }
    return ids;
  }, [filteredGroups, masterContacts]);

  // Master checkbox toggle
  const isAllSelected = sendableFilteredInvoiceIds.size > 0 && 
    Array.from(sendableFilteredInvoiceIds).every(id => selectedIds.has(id));

  const handleSelectAllToggle = () => {
    const next = new Set(selectedIds);
    if (isAllSelected) {
      // Deselect all in filtered list
      for (const id of sendableFilteredInvoiceIds) {
        next.delete(id);
      }
    } else {
      // Select all in filtered list
      for (const id of sendableFilteredInvoiceIds) {
        next.add(id);
      }
    }
    setSelectedIds(next);
  };

  // Group level checkbox toggle
  const handleGroupSelectToggle = (invoices: DueRecord[]) => {
    const sendableInGroup = invoices.filter(inv => findMatchingMasterContact(inv, masterContacts));
    const allGroupSendableSelected = sendableInGroup.length > 0 && 
      sendableInGroup.every(inv => selectedIds.has(inv.id));

    const next = new Set(selectedIds);
    if (allGroupSendableSelected) {
      for (const inv of sendableInGroup) {
        next.delete(inv.id);
      }
    } else {
      for (const inv of sendableInGroup) {
        next.add(inv.id);
      }
    }
    setSelectedIds(next);
  };

  // Single invoice checkbox toggle
  const handleInvoiceSelectToggle = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    setSelectedIds(next);
  };

  const toggleGroup = (key: string) => {
    setExpandedGroups(prev => ({
      ...prev,
      [key]: !prev[key]
    }));
  };

  // Calculate totals for dashboard widgets
  const stats = useMemo(() => {
    let outstanding = 0;
    let advance = 0;
    let overdueCount = 0;
    let activeParties = groupedData.length;

    for (const group of groupedData) {
      outstanding += group.totalPending;
      advance += group.totalAdvance;
      overdueCount += group.overdueCount;
    }

    return {
      outstanding,
      advance,
      overdueCount,
      activeParties
    };
  }, [groupedData]);

  return (
    <div className="grouped-dues-workspace">
      {/* Summary Widgets Dashboard */}
      <div className="dues-stats-dashboard">
        <div className="dues-stat-card">
          <span className="label">Total Parties</span>
          <span className="value">{stats.activeParties}</span>
        </div>
        <div className="dues-stat-card">
          <span className="label">Total Invoices</span>
          <span className="value">{dueRecords.length}</span>
        </div>
        <div className="dues-stat-card">
          <span className="label">Total Outstanding</span>
          <span className="value">{formatCurrency(stats.outstanding)}</span>
        </div>
        <div className="dues-stat-card advance">
          <span className="label">Total Advance</span>
          <span className="value">{formatCurrency(stats.advance)}</span>
        </div>
        <div className="dues-stat-card overdue">
          <span className="label">Overdue Invoices</span>
          <span className="value">{stats.overdueCount}</span>
        </div>
      </div>

      {/* Interactive Search & Selections */}
      <div className="search-and-bulk">
        <div className="search-wrapper">
          <label htmlFor={searchInputId} style={{ display: "none" }}>Search party or invoice</label>
          <input
            id={searchInputId}
            type="search"
            value={query}
            placeholder="Search party code, name, salesperson or invoice number..."
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>

        {canDispatch && (
          <div className="bulk-selection-notice">
            <input
              type="checkbox"
              id="master-select-all"
              checked={isAllSelected}
              onChange={handleSelectAllToggle}
            />
            <label htmlFor="master-select-all" style={{ cursor: "pointer", fontWeight: 500 }}>
              {isAllSelected ? "Deselect All Filtered" : "Select All Filtered"} ({selectedIds.size} selected)
            </label>
          </div>
        )}
      </div>

      {/* Grouped Party List */}
      <div className="party-group-list">
        {filteredGroups.length === 0 ? (
          <div className="glass-panel" style={{ textAlign: "center", padding: "3rem" }}>
            <p className="muted-copy">No active dues records found matching &quot;{query}&quot;.</p>
          </div>
        ) : (
          filteredGroups.map((group) => {
            const sendableInGroup = group.invoices.filter(inv => findMatchingMasterContact(inv, masterContacts));
            const hasSendable = sendableInGroup.length > 0;
            const groupChecked = hasSendable && sendableInGroup.every(inv => selectedIds.has(inv.id));
            const isExpanded = expandedGroups[group.key];

            return (
              <div className="party-card" key={group.key}>
                {/* Header Row */}
                <div className="party-header" onClick={() => toggleGroup(group.key)}>
                  
                  {canDispatch && hasSendable && (
                    <div className="party-checkbox-wrap" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={groupChecked}
                        onChange={() => handleGroupSelectToggle(group.invoices)}
                      />
                    </div>
                  )}

                  <div className="party-title-section">
                    <h3>{group.companyName}</h3>
                    <div className="party-meta">
                      <span className="badge neutral">Code: {group.dealerCode}</span>
                      <span className="badge neutral">{group.invoices.length} {group.invoices.length === 1 ? "invoice" : "invoices"}</span>
                      {group.overdueCount > 0 ? (
                        <span className="badge overdue">{group.overdueCount} overdue</span>
                      ) : (
                        <span className="badge current">All current</span>
                      )}
                      <span>Salesperson: {group.salespersonName}</span>
                    </div>
                  </div>

                  <div className="party-financials">
                    {group.totalOpening > 0 && (
                      <div className="financial-item">
                        <span className="fin-label">Opening</span>
                        <span className="fin-val">{formatCurrency(group.totalOpening, group.currency)}</span>
                      </div>
                    )}
                    {group.totalPending > 0 && (
                      <div className="financial-item">
                        <span className="fin-label">Pending</span>
                        <span className="fin-val pending">{formatCurrency(group.totalPending, group.currency)}</span>
                      </div>
                    )}
                    {group.totalAdvance > 0 && (
                      <div className="financial-item">
                        <span className="fin-label">Advance</span>
                        <span className="fin-val advance">-{formatCurrency(group.totalAdvance, group.currency)}</span>
                      </div>
                    )}
                  </div>

                  <button
                    type="button"
                    className={`expand-toggle-btn ${isExpanded ? "expanded" : ""}`}
                    aria-label={isExpanded ? "Collapse group" : "Expand group"}
                  >
                    ▼
                  </button>
                </div>

                {/* Collapsible Panel */}
                {isExpanded && (
                  <div className="party-details-panel">
                    <div className="table-wrap" style={{ boxShadow: "none", border: "none", background: "transparent" }}>
                      <table className="invoice-details-table">
                        <thead>
                          <tr>
                            {canDispatch && <th style={{ width: "40px" }}>Select</th>}
                            <th>Date</th>
                            <th>Reference No.</th>
                            <th>Due on</th>
                            <th>Age</th>
                            <th>Overdue by</th>
                            <th>Opening</th>
                            <th>Pending</th>
                            <th>Advance</th>
                            <th>Contact</th>
                          </tr>
                        </thead>
                        <tbody>
                          {group.invoices.map((inv) => {
                            const isSendable = findMatchingMasterContact(inv, masterContacts);
                            const isSelected = selectedIds.has(inv.id);

                            return (
                              <tr key={inv.id}>
                                {canDispatch && (
                                  <td>
                                    {isSendable ? (
                                      <>
                                        <input
                                          type="checkbox"
                                          name="dueIds"
                                          value={inv.id}
                                          checked={isSelected}
                                          onChange={() => handleInvoiceSelectToggle(inv.id)}
                                        />
                                      </>
                                    ) : (
                                      <input type="checkbox" disabled />
                                    )}
                                  </td>
                                )}
                                <td>{formatDate(inv.billDate || inv.invoiceDate)}</td>
                                <td>{inv.invoiceNumber || inv.reference || "N/A"}</td>
                                <td>{formatDate(inv.dueDate)}</td>
                                <td>{formatElapsedDaysTag(inv.billDate || inv.invoiceDate)}</td>
                                <td>
                                  {inv.overdueDays > 0 ? (
                                    <span style={{ color: "var(--danger)", fontWeight: 500 }}>
                                      {inv.overdueDays} days
                                    </span>
                                  ) : (
                                    <span style={{ color: "var(--success)", fontWeight: 500 }}>Current</span>
                                  )}
                                </td>
                                <td>{formatCurrency(inv.openingAmount, inv.currency)}</td>
                                <td>
                                  {inv.amount >= 0 ? (
                                    formatCurrency(inv.amount, inv.currency)
                                  ) : (
                                    "-"
                                  )}
                                </td>
                                <td>
                                  {inv.amount < 0 ? (
                                    <span style={{ color: "var(--success)", fontWeight: 500 }}>
                                      {formatCurrency(Math.abs(inv.amount), inv.currency)}
                                    </span>
                                  ) : (
                                    "-"
                                  )}
                                </td>
                                <td>
                                  {isSendable ? (
                                    <span className="status-badge matched">Matched</span>
                                  ) : (
                                    <span className="status-badge missing" title="No matching master contact info">Missing</span>
                                  )}
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
