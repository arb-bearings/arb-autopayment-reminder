"use client";

import { ChannelLabel } from "@/components/channel-label";
import { useEffect, useState, useTransition } from "react";
import type { Route } from "next";
import { usePathname, useRouter } from "next/navigation";
import type { ReactNode } from "react";

const adminSections: Array<{
  href: Route;
  label: string;
  superAdminOnly?: boolean;
}> = [
  { href: "/dashboard/settings", label: "Overview" },
  { href: "/dashboard/settings/users", label: "Users", superAdminOnly: true },
  { href: "/dashboard/settings/passwords", label: "Passwords", superAdminOnly: true },
  { href: "/dashboard/settings/database", label: "Database" },
  { href: "/dashboard/settings/reminders", label: "Reminders" },
  { href: "/dashboard/settings/templates", label: "Templates" },
  { href: "/dashboard/settings/salespersons", label: "Salespersons" },
  { href: "/dashboard/settings/email", label: "Email" },
  { href: "/dashboard/settings/reports", label: "Reports" },
  { href: "/dashboard/settings/logs", label: "Logs" }
];

export function DashboardClientShell({
  children,
  title,
  description,
  companyName,
  userName,
  isAdmin,
  userRole,
  canSendManualReminders
}: {
  children: ReactNode;
  title: string;
  description: string;
  companyName: string;
  userName: string;
  isAdmin: boolean;
  userRole: "super_admin" | "admin" | "user";
  canSendManualReminders: boolean;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [pendingHref, setPendingHref] = useState<string | null>(null);
  const canUseDues = isAdmin || canSendManualReminders || userRole === "user";
  const isSettingsRoute = pathname.startsWith("/dashboard/settings");
  const visibleAdminSections = adminSections.filter(
    (item) => !item.superAdminOnly || userRole === "super_admin"
  );
  const navItems: Array<{ href: Route; label: string }> = [
    { href: "/dashboard", label: "Dashboard" },
    ...(isAdmin
      ? ([{ href: "/dashboard/master", label: "Master Database" }] satisfies Array<{
          href: Route;
          label: string;
        }>)
      : []),
    ...(canUseDues
      ? ([
          { href: "/dashboard/dues", label: "Dues & Dispatch" },
          { href: "/dashboard/reminder-logs" as unknown as Route, label: "Reminder Logs" }
        ] satisfies Array<{
          href: Route;
          label: string;
        }>)
      : []),
    ...(isAdmin
      ? ([
          { href: "/dashboard/settings", label: "Admin Panel" }
        ] satisfies Array<{ href: Route; label: string }>)
      : [])
  ];

  useEffect(() => {
    navItems.forEach((item) => {
      router.prefetch(item.href);
    });
    visibleAdminSections.forEach((item) => {
      router.prefetch(item.href);
    });
  }, [isAdmin, router, userRole]);

  useEffect(() => {
    setPendingHref(null);
  }, [pathname]);

  function handleNavigate(href: Route) {
    if (href === pathname || isPending) {
      return;
    }

    setPendingHref(href);
    startTransition(() => {
      router.push(href);
    });
  }

  return (
    <div className="dashboard-grid">
      <aside className="sidebar glass-panel dashboard-sidebar">
        <div className="sidebar-top">
          <div className="sidebar-brand">
            <span className="brand-mark sidebar-brand-mark" />
            <div className="sidebar-brand-copy">
              <p className="eyebrow">Auto Payment Reminder</p>
              <h2 className="sidebar-title">{companyName}</h2>
              <p className="muted-copy">Signed in as {userName}</p>
            </div>
          </div>

          <nav className="nav-list" aria-label="Dashboard sections">
            {navItems.map((item) => {
              const isActive = pathname === item.href;
              const isTargetPending = pendingHref === item.href;

              return (
                <button
                  key={item.href}
                  type="button"
                  className={`nav-link ${isActive ? "is-active" : ""} ${
                    isTargetPending ? "is-pending" : ""
                  }`}
                  onClick={() => handleNavigate(item.href)}
                  onMouseEnter={() => router.prefetch(item.href)}
                  aria-current={isActive ? "page" : undefined}
                >
                  <span>{item.label}</span>
                  {isTargetPending ? <span className="nav-link-pulse" aria-hidden="true" /> : null}
                </button>
              );
            })}
          </nav>
        </div>

        <form action="/api/auth/logout" method="post">
          <button className="button button-secondary full-width" type="submit">
            Logout
          </button>
        </form>
      </aside>

      <main className="dashboard-main">
        <section className="hero-panel dashboard-hero-panel">
          <div className="dashboard-hero-copy">
            <p className="eyebrow">Workspace</p>
            <h1>{title}</h1>
            <p className="hero-copy">{description}</p>
          </div>

          <div className="hero-badge-cluster" aria-hidden="true">
            <ChannelLabel channel="email" />
            <ChannelLabel channel="whatsapp" />
            <ChannelLabel channel="sms" />
          </div>
        </section>

        <div className={`dashboard-content-shell ${isPending ? "is-loading" : ""}`}>
          {isSettingsRoute && isAdmin ? (
            <div className="admin-tabs-shell">
              <nav className="admin-tabs-nav glass-panel" aria-label="Admin settings">
                {visibleAdminSections.map((item) => {
                  const isActive =
                    pathname === item.href ||
                    (item.href !== "/dashboard/settings" && pathname.startsWith(item.href));
                  const isTargetPending = pendingHref === item.href;

                  return (
                    <button
                      key={item.href}
                      type="button"
                      className={`admin-tab-link ${isActive ? "is-active" : ""} ${
                        isTargetPending ? "is-pending" : ""
                      }`}
                      onClick={() => handleNavigate(item.href)}
                      onMouseEnter={() => router.prefetch(item.href)}
                      aria-current={isActive ? "page" : undefined}
                    >
                      <span>{item.label}</span>
                      {isTargetPending ? <span className="nav-link-pulse" aria-hidden="true" /> : null}
                    </button>
                  );
                })}
              </nav>
              <div className="admin-tabs-content">{children}</div>
            </div>
          ) : (
            children
          )}

          {isPending ? (
            <div className="route-loading-overlay" aria-live="polite" aria-busy="true">
              <div className="route-loading-strip">
                <span className="route-loading-dot" />
                <span>Loading workspace</span>
              </div>
            </div>
          ) : null}
        </div>
      </main>
    </div>
  );
}
