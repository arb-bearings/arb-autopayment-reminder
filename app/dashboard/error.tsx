"use client";

import Link from "next/link";

export default function DashboardError({
  error,
  reset
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="auth-shell">
      <section className="auth-panel error-panel">
        <p className="eyebrow">Workspace unavailable</p>
        <h1>We could not load the dashboard.</h1>
        <p className="hero-copy">
          {error?.message ||
            "Check the database environment variables and MongoDB network access, then try loading the workspace again."}
        </p>
        <div className="hero-actions">
          <button className="button" type="button" onClick={() => reset()}>
            Try Again
          </button>
          <Link className="button button-secondary" href="/login">
            Back to Login
          </Link>
        </div>
      </section>
    </main>
  );
}
