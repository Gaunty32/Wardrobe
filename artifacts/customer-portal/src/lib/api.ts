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
    throw new Error(`API Error: ${res.status} ${res.statusText}`);
  }

  return res.json();
}
