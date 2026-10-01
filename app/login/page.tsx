import Link from "next/link";
import { PasswordInput } from "@/components/password-input";

export default function LoginPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
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
            Use the same workspace to keep invoices, contacts, rules, and queue activity in sync.
          </p>

          <StatusBanner searchParams={searchParams} />

          <form action="/api/auth/login" method="post" className="form-stack">
            <label className="field">
              <span>Email</span>
              <input name="email" type="email" placeholder="you@company.com" required />
            </label>

            <label className="field">
              <span>Password</span>
              <PasswordInput name="password" required />
            </label>

            <button className="button full-width" type="submit">
              Login
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

async function StatusBanner({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const error = typeof params.error === "string" ? params.error : "";
  const message = typeof params.message === "string" ? params.message : "";

  if (!error && !message) {
    return null;
  }

  return (
    <p className={`status-banner ${error ? "status-error" : "status-success"}`}>
      {decodeURIComponent(error || message)}
    </p>
  );
}
