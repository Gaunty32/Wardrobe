import { z } from "zod";

export const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "").replace(/\/customer-portal$/, "") + "/api";

export async function apiFetch(path: string, opts?: RequestInit) {
  const token = localStorage.getItem("portal_token");
  const res = await fetch(API_BASE + path, {
    ...opts,
    headers: { 
      "Content-Type": "application/json", 
      ...(token ? { Authorization: "Bearer " + token } : {}), 
      ...(opts?.headers ?? {}) 
    },
  });

  if (res.status === 401) {
    localStorage.removeItem("portal_token");
    // Don't redirect if we're already on a public auth page — doing so would
    // navigate away from /accept-invite before the magic-link token is consumed,
    // causing an infinite email loop.
    const publicPages = ["accept-invite", "login", "select-business", "preview-login", "orders/new"];
    const onPublicPage = publicPages.some((p) => window.location.pathname.includes(p));
    if (!onPublicPage) {
      const returnTo = window.location.pathname + window.location.search;
      window.location.href = import.meta.env.BASE_URL + "login?returnTo=" + encodeURIComponent(returnTo);
    }
  }

  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`;
    try {
      const body = await res.json();
      if (body?.error) msg = body.error;
    } catch {}
    throw new Error(msg);
  }

  return res.json();
}
