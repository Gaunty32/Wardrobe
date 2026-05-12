const TOKEN_KEY = "sbs_staff_token";

export function getStaffToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setStaffToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearStaffToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

export function isStaffAuthenticated(): boolean {
  const token = getStaffToken();
  if (!token) return false;
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return false;
    const payload = JSON.parse(atob(parts[1]));
    return (
      payload.role === "staff" &&
      typeof payload.exp === "number" &&
      payload.exp > Date.now() / 1000
    );
  } catch {
    return false;
  }
}
