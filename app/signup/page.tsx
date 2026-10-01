import Link from "next/link";
import { PasswordInput } from "@/components/password-input";

export default function SignupPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
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
            After signup you land directly in the dashboard with starter rules and editable
            templates ready to refine. The first account becomes admin automatically; later
            signups join as normal users.
          </p>

          <StatusBanner searchParams={searchParams} />

          <form action="/api/auth/signup" method="post" className="form-stack">
            <label className="field">
              <span>Name</span>
              <input name="name" type="text" placeholder="Aman Kumar" required />
            </label>

            <label className="field">
              <span>Business email</span>
              <input name="email" type="email" placeholder="you@company.com" required />
            </label>

            <label className="field">
              <span>Company name</span>
              <input name="companyName" type="text" placeholder="Northwind Finance" required />
            </label>

            <label className="field">
              <span>Password</span>
              <PasswordInput name="password" minLength={8} required />
            </label>

            <button className="button full-width" type="submit">
              Create account
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

async function StatusBanner({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const error = typeof params.error === "string" ? params.error : "";

  if (!error) {
    return null;
  }

  return <p className="status-banner status-error">{decodeURIComponent(error)}</p>;
}
