"use client";

import Link from "next/link";
import { PasswordInput } from "@/components/password-input";
import { useState, Suspense } from "react";
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

export default function SignupPage() {
  const [activeCompany, setActiveCompany] = useState<"ARB" | "LUB">("ARB");

  return (
    <main className="auth-shell">
      <section className="auth-layout">
        <aside className="auth-showcase auth-showcase-alt">
          <Link href="/" className="brand-lockup">
            <span className="brand-mark" />
            <span className="brand-text">
              <span className="brand-title">Auto Payment Reminder</span>
              <span className="brand-subtitle">Finance workflow platform</span>
            </span>
          </Link>

          <div className="auth-showcase-content">
            <p className="eyebrow">Create account</p>
            <h1>Set up a reminder workspace your team can actually use every day.</h1>
            <p>
              Start with your existing files, keep your contact sheet intact, and unlock a more
              structured follow-up flow for collections.
            </p>

            <div className="auth-bullet-list">
              <span>Starter reminder rules are created for you automatically.</span>
              <span>Email, WhatsApp, and SMS templates stay editable after setup.</span>
              <span>Dispatch settings stay editable before your first live send.</span>
            </div>
          </div>
        </aside>

        <section className="auth-panel">
          <p className="eyebrow">Signup</p>
          <h2>Launch your reminder workspace</h2>
          <p className="hero-copy">
            Select your company workspace to create your account in the isolated database.
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

          <form action="/api/auth/signup" method="post" className="form-stack">
            <input type="hidden" name="company" value={activeCompany} />

            <label className="field">
              <span>Full Name</span>
              <input name="name" type="text" placeholder="Aman Kumar" required />
            </label>

            <label className="field">
              <span>Business email</span>
              <input name="email" type="email" placeholder="you@company.com" required />
            </label>

            <label className="field">
              <span>Password</span>
              <PasswordInput name="password" minLength={8} required />
            </label>

            <button className="button full-width" type="submit">
              Create account in {COMPANIES.find((c) => c.code === activeCompany)?.label}
            </button>
          </form>

          <p className="muted-copy">
            Already have an account? <Link href="/login">Login here</Link>.
          </p>
        </section>
      </section>
    </main>
  );
}
