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
    window.location.href = import.meta.env.BASE_URL + "login";
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
