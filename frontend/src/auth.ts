export const TOKEN_KEY = "smw_token";
export const USERNAME_KEY = "smw_username";

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function getCurrentUsername(): string {
  const stored = localStorage.getItem(USERNAME_KEY);
  if (stored && stored.trim()) return stored.trim();

  const token = getToken();
  if (!token) return "";
  const parts = token.split(".");
  if (parts.length < 2) return "";

  try {
    const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "=");
    const payload = JSON.parse(window.atob(padded)) as { username?: unknown };
    return typeof payload.username === "string" ? payload.username.trim() : "";
  } catch {
    return "";
  }
}

export function setCurrentUsername(username: string): void {
  const trimmed = username.trim();
  if (!trimmed) {
    localStorage.removeItem(USERNAME_KEY);
    return;
  }
  localStorage.setItem(USERNAME_KEY, trimmed);
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USERNAME_KEY);
}
