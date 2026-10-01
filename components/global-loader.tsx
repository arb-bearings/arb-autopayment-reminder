"use client";

import { useEffect } from "react";

/**
 * GlobalLoader — attaches to every <form> on the page.
 * When a form is submitted it shows a full-screen blur overlay instantly,
 * keeping it visible until Next.js navigation completes (router redirect / page reload).
 */
export function GlobalLoader() {
  useEffect(() => {
    let overlay: HTMLDivElement | null = null;

    function showLoader(label?: string) {
      if (overlay) return;
      overlay = document.createElement("div");
      overlay.className = "global-loader-overlay";
      overlay.innerHTML = `
        <div class="global-loader-card">
          <div class="global-loader-spinner" aria-hidden="true"></div>
          <span class="global-loader-label">${label || "Processing…"}</span>
        </div>
      `;
      document.body.appendChild(overlay);
      // slight delay for transition
      requestAnimationFrame(() => overlay?.classList.add("is-visible"));
    }

    function getLabel(form: HTMLFormElement): string {
      const action = form.action || "";
      if (action.includes("/api/auth/login")) return "Signing you in…";
      if (action.includes("/api/auth/signup")) return "Creating your account…";
      if (action.includes("/api/dues/upload") || action.includes("/api/master/upload")) return "Uploading sheet…";
      if (action.includes("/api/reminders/generate")) return "Generating reminders…";
      if (action.includes("/api/reminders/send")) return "Sending reminders…";
      if (action.includes("/api/dues/delete") || action.includes("/api/master/delete")) return "Deleting records…";
      if (action.includes("/api/dues/refresh")) return "Refreshing database…";
      return "Processing…";
    }

    function handleSubmit(e: Event) {
      const form = e.currentTarget as HTMLFormElement;
      // Don't show loader for logout
      if (form.action?.includes("/api/auth/logout")) return;
      showLoader(getLabel(form));
    }

    function attachToForms() {
      document.querySelectorAll<HTMLFormElement>("form").forEach((form) => {
        if (form.dataset.loaderAttached) return;
        form.dataset.loaderAttached = "1";
        form.addEventListener("submit", handleSubmit);
      });
    }

    // Attach on mount and whenever DOM changes (Next.js soft navigation adds/removes forms)
    attachToForms();
    const observer = new MutationObserver(attachToForms);
    observer.observe(document.body, { childList: true, subtree: true });

    // Hide overlay on page transitions / back navigation
    function hideLoader() {
      if (!overlay) return;
      overlay.classList.remove("is-visible");
      setTimeout(() => {
        overlay?.remove();
        overlay = null;
      }, 300);
    }

    // Next.js fires popstate + re-renders on navigation
    window.addEventListener("popstate", hideLoader);
    // Also hide if page becomes visible again (tab switch back = navigation done)
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) hideLoader();
    });

    return () => {
      observer.disconnect();
      window.removeEventListener("popstate", hideLoader);
    };
  }, []);

  return null;
}
