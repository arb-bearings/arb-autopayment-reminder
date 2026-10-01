"use client";

import { useState, useRef } from "react";

interface SendQueueButtonProps {
  form?: string;
  confirmationMessage?: string;
  children: string;
  className?: string;
}

/**
 * SendQueueButton — replaces the ProtectedSubmitButton for "Send generated queue".
 * Shows a full-screen progress overlay with a real-time progress bar while the
 * server is processing, then redirects when done.
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
  const [total, setTotal] = useState(0);
  const [statusLabel, setStatusLabel] = useState("Preparing…");
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  function clearProgressInterval() {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }

  async function doSend(password: string) {
    if (confirmationMessage && !window.confirm(confirmationMessage)) return;

    // Collect selected logIds from the form
    const formEl = form ? document.getElementById(form) as HTMLFormElement : null;
    const formData = formEl ? new FormData(formEl) : new FormData();

    // Always include the password
    formData.set("operationPassword", password);

    setSending(true);
    setProgress(5);
    setStatusLabel("Connecting to server…");

    // Animate progress smoothly while waiting
    let fakeProgress = 5;
    intervalRef.current = setInterval(() => {
      fakeProgress = Math.min(fakeProgress + Math.random() * 3, 88);
      setProgress(fakeProgress);
    }, 400);

    try {
      // Send X-Queue-Fetch header so the API returns JSON instead of a redirect
      const response = await fetch("/api/reminders/send", {
        method: "POST",
        headers: { "X-Queue-Fetch": "1" },
        body: formData
      });

      clearProgressInterval();

      if (response.ok) {
        const data = await response.json() as { count: number; redirectUrl: string };
        const count = data.count ?? 0;
        if (count > 0) {
          setTotal(count);
          setSent(count);
          setStatusLabel(`✓ Sent ${count} reminder${count === 1 ? "" : "s"}`);
        } else {
          setStatusLabel("✓ Done! Redirecting…");
        }
        setProgress(100);
        setTimeout(() => {
          window.location.href = data.redirectUrl || "/dashboard/dues";
        }, 1200);
      } else {
        // API returned an error — try to read the message
        let errMsg = "Send failed. Please try again.";
        try {
          const errData = await response.json() as { error?: string; message?: string };
          errMsg = errData.error || errData.message || errMsg;
        } catch { /* ignore */ }
        setProgress(100);
        setStatusLabel(`Error: ${errMsg}`);
        setTimeout(() => { setSending(false); setProgress(0); }, 3000);
      }
    } catch {
      clearProgressInterval();
      setProgress(100);
      setStatusLabel("Network error — check your connection.");
      setTimeout(() => { setSending(false); setProgress(0); }, 3000);
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
