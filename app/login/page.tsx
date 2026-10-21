"use client";

import Link from "next/link";
import { PasswordInput } from "@/components/password-input";
import { useState, useEffect, Suspense } from "react";
import { useSearchParams } from "next/navigation";

const COMPANIES = [
  { code: "ARB", label: "ARB Bearings" },
  { code: "LUB", label: "ARB Lubricants" }
] as const;

function StatusBannerInner() {
  const params = useSearchParams();
  const error = params.get("error") || "";
  const message = params.get("message") || "";

  if (!error && !message) return null;

  return (
    <p className={`status-banner ${error ? "status-error" : "status-success"}`}>
      {decodeURIComponent(error || message)}
    </p>
  );
}

export default function LoginPage() {
  const [activeCompany, setActiveCompany] = useState<"ARB" | "LUB">("ARB");

  return (
    <main className="auth-shell">
      <section className="auth-layout">
        <aside className="auth-showcase">
          <Link href="/" className="brand-lockup">
            <span className="brand-mark" />
            <span className="brand-text">
              <span className="brand-title">Auto Payment Reminder</span>
              <span className="brand-subtitle">Finance workflow platform</span>
            </span>
          </Link>

          <div className="auth-showcase-content">
            <p className="eyebrow">Welcome back</p>
            <h1>Step into a cleaner reminder control room.</h1>
            <p>
              Review dues, manage templates, and send with confidence from the same workspace your
              team already knows.
            </p>

            <div className="auth-stat-grid">
              <div className="auth-stat-card">
                <strong>1</strong>
                <span>dashboard for dues, rules, and dispatch</span>
              </div>
              <div className="auth-stat-card">
                <strong>3</strong>
                <span>channels supported across reminders</span>
              </div>
            </div>

            <div className="auth-bullet-list">
              <span>Upload master contacts and dues without changing your team workflow.</span>
              <span>Generate reminders from day-based rules before going live.</span>
              <span>Check templates and provider settings before sending live reminders.</span>
            </div>
          </div>
        </aside>

        <section className="auth-panel">
          <p className="eyebrow">Login</p>
          <h2>Access your reminder dashboard</h2>
          <p className="hero-copy">
            Select your company workspace, then sign in with your credentials.
          </p>

          {/* Company Workspace Tabs */}
          <div className="company-tabs" role="tablist" aria-label="Company workspace">
            {COMPANIES.map((c) => (
              <button
                key={c.code}
                type="button"
                role="tab"
                aria-selected={activeCompany === c.code}
                className={`company-tab${activeCompany === c.code ? " is-active" : ""}`}
                onClick={() => setActiveCompany(c.code)}
              >
                <span className="company-tab-dot" />
                {c.label}
              </button>
            ))}
          </div>

          <Suspense>
            <StatusBannerInner />
          </Suspense>

          <form action="/api/auth/login" method="post" className="form-stack">
            {/* Hidden field carries the selected company to the server */}
            <input type="hidden" name="company" value={activeCompany} />

            <label className="field">
              <span>Email</span>
              <input name="email" type="email" placeholder="you@company.com" required />
            </label>

            <label className="field">
              <span>Password</span>
              <PasswordInput name="password" required />
            </label>

            <button className="button full-width" type="submit">
              Login to {COMPANIES.find((c) => c.code === activeCompany)?.label}
            </button>
          </form>

          <p className="muted-copy">
            New here? <Link href="/signup">Create an account</Link>.
          </p>
        </section>
      </section>
    </main>
  );
}
