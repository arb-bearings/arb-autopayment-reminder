"use client";

import { useState, useRef } from "react";

interface SendQueueButtonProps {
  form?: string;
  confirmationMessage?: string;
  children: string;
  className?: string;
}

const BATCH_SIZE = 10;

/**
 * SendQueueButton — replaces the ProtectedSubmitButton for "Send generated queue".
 * Sends reminders in small batches to avoid Vercel serverless timeout.
 * Shows a full-screen progress overlay with a real-time progress bar.
 */
export function SendQueueButton({
  form,
  confirmationMessage,
  children,
  className
}: SendQueueButtonProps) {
  const [showModal, setShowModal] = useState(false);
  const [modalPassword, setModalPassword] = useState("");
  const [sending, setSending] = useState(false);
  const [progress, setProgress] = useState(0);
  const [sent, setSent] = useState(0);
  const [failed, setFailed] = useState(0);
  const [total, setTotal] = useState(0);
  const [statusLabel, setStatusLabel] = useState("Preparing…");
  const abortRef = useRef(false);

  async function doSend(password: string) {
    if (confirmationMessage && !window.confirm(confirmationMessage)) return;

    // Collect selected logIds from the form
    const formEl = form ? document.getElementById(form) as HTMLFormElement : null;
    const formData = formEl ? new FormData(formEl) : new FormData();
    const allLogIds = formData.getAll("logIds").map((entry) => String(entry).trim()).filter(Boolean);

    if (allLogIds.length === 0) {
      alert("No reminders selected to send.");
      return;
    }

    setSending(true);
    setProgress(0);
    setSent(0);
    setFailed(0);
    setTotal(allLogIds.length);
    setStatusLabel("Starting batch dispatch…");
    abortRef.current = false;

    // Split logIds into batches
    const batches: string[][] = [];
    for (let i = 0; i < allLogIds.length; i += BATCH_SIZE) {
      batches.push(allLogIds.slice(i, i + BATCH_SIZE));
    }

    let totalSent = 0;
    let totalFailed = 0;
    const allErrors: string[] = [];
    let hadFatalError = false;

    for (let i = 0; i < batches.length; i++) {
      if (abortRef.current) break;

      const batch = batches[i];
      const isLastBatch = i === batches.length - 1;

      setStatusLabel(
        `Sending batch ${i + 1} of ${batches.length} (${batch.length} reminders)…`
      );

      try {
        const response = await fetch("/api/reminders/send-batch", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            logIds: batch,
            operationPassword: password,
            sendReports: isLastBatch
          })
        });

        if (response.ok) {
          const data = await response.json() as {
            sent: number;
            failed: number;
            errors: string[];
          };
          totalSent += data.sent;
          totalFailed += data.failed;
          if (data.errors?.length) {
            allErrors.push(...data.errors);
          }
        } else {
          // API error — try to read message
          let errMsg = "Batch failed";
          try {
            const errData = await response.json() as { error?: string };
            errMsg = errData.error || errMsg;
          } catch { /* ignore */ }

          // If it's an auth/permission error, stop immediately
          if (response.status === 403 || response.status === 401) {
            setStatusLabel(`Error: ${errMsg}`);
            hadFatalError = true;
            break;
          }

          // For other errors, count the batch as failed but continue
          totalFailed += batch.length;
          allErrors.push(errMsg);
        }
      } catch {
        // Network error — count batch as failed but try to continue
        totalFailed += batch.length;
        allErrors.push(`Network error on batch ${i + 1}`);
      }

      // Update progress
      const processed = totalSent + totalFailed;
      setSent(totalSent);
      setFailed(totalFailed);
      setProgress(Math.round((processed / allLogIds.length) * 100));
    }

    // Final state
    if (!hadFatalError) {
      setProgress(100);
      if (totalFailed > 0) {
        setStatusLabel(
          `✓ Done — ${totalSent} sent, ${totalFailed} failed. Redirecting…`
        );
      } else {
        setStatusLabel(`✓ All ${totalSent} reminders sent! Redirecting…`);
      }

      setTimeout(() => {
        const msg = encodeURIComponent(
          `Sent ${totalSent} reminder${totalSent === 1 ? "" : "s"}${
            totalFailed > 0 ? `, ${totalFailed} failed` : ""
          }.`
        );
        window.location.href = `/dashboard/dues?message=${msg}`;
      }, 2000);
    } else {
      // Fatal error — let user dismiss after 5 seconds
      setProgress(100);
      if (totalSent > 0) {
        setStatusLabel(
          `Stopped — ${totalSent} sent before error. ${statusLabel}`
        );
      }
      setTimeout(() => {
        setSending(false);
        setProgress(0);
      }, 5000);
    }
  }

  function handleClick() {
    // Check if dispatch password is needed
    const formEl = form ? document.getElementById(form) as HTMLFormElement : null;
    const existingPw = formEl?.querySelector<HTMLInputElement>('input[name="operationPassword"]')?.value || "";
    if (existingPw.trim()) {
      doSend(existingPw.trim());
    } else {
      setShowModal(true);
    }
  }

  return (
    <>
      <button type="button" className={className} onClick={handleClick}>
        {children}
      </button>

      {/* Password modal */}
      {showModal && !sending && (
        <>
          <div className="unsaved-backdrop-lock" onClick={() => setShowModal(false)} />
          <div className="unsaved-changes-dock" style={{ zIndex: 10000 }}>
            <div className="unsaved-changes-info">
              <span className="unsaved-icon">🔐</span>
              <div>
                <strong>Operation Password Required</strong>
                <p>Enter Admin / Dispatch Password to proceed: <strong>{children}</strong></p>
              </div>
            </div>
            <div className="unsaved-changes-actions">
              <input
                type="password"
                className="unsaved-password-input"
                placeholder="Enter password…"
                value={modalPassword}
                onChange={(e) => setModalPassword(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && modalPassword.trim()) {
                    setShowModal(false);
                    doSend(modalPassword.trim());
                  }
                }}
                autoFocus
              />
              <button type="button" className="button button-ghost" onClick={() => setShowModal(false)}>
                Cancel
              </button>
              <button
                type="button"
                className="button"
                disabled={!modalPassword.trim()}
                onClick={() => {
                  if (modalPassword.trim()) {
                    setShowModal(false);
                    doSend(modalPassword.trim());
                  }
                }}
              >
                {children}
              </button>
            </div>
          </div>
        </>
      )}

      {/* Send progress overlay */}
      {sending && (
        <div className="send-progress-overlay">
          <div className="send-progress-card">
            <div className="send-progress-icon" aria-hidden="true">
              {progress < 100 ? (
                <div className="send-progress-spinner" />
              ) : (
                <span>✓</span>
              )}
            </div>

            <h3 className="send-progress-title">Sending Reminders</h3>

            {total > 0 && (
              <p className="send-progress-count">
                <strong>{sent}</strong> of <strong>{total}</strong> reminders sent
                {failed > 0 && (
                  <span style={{ color: "var(--danger, #e53e3e)", marginLeft: 8 }}>
                    ({failed} failed)
                  </span>
                )}
              </p>
            )}

            <p className="send-progress-status">{statusLabel}</p>

            <div className="send-progress-bar-track" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}>
              <div
                className="send-progress-bar-fill"
                style={{ width: `${progress}%` }}
              />
            </div>

            <p className="send-progress-note">
              Please keep this window open while reminders are being sent.
            </p>
          </div>
        </div>
      )}
    </>
  );
}
