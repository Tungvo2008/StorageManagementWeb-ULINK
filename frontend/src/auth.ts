export const TOKEN_KEY = "smw_token";
export const USERNAME_KEY = "smw_username";

type JwtPayload = {
  exp?: unknown;
  username?: unknown;
};

function getStoredToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

function parseTokenPayload(token: string): JwtPayload | null {
  const parts = token.split(".");
  if (parts.length < 2) return null;

  try {
    const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "=");
    return JSON.parse(window.atob(padded)) as JwtPayload;
  } catch {
    return null;
  }
}

export function getToken(): string | null {
  return getStoredToken();
}

export function isTokenExpired(token: string | null): boolean {
  if (!token) return true;
  const payload = parseTokenPayload(token);
  if (!payload) return true;

  const exp = payload.exp;
  if (typeof exp !== "number" && typeof exp !== "string") return true;

  const expSeconds = Number(exp);
  if (!Number.isFinite(expSeconds)) return true;

  return Date.now() >= expSeconds * 1000;
}

export function getValidToken(): string | null {
  const token = getStoredToken();
  if (!token) return null;
  if (isTokenExpired(token)) {
    clearToken();
    return null;
  }
  return token;
}

export function hasValidToken(): boolean {
  return Boolean(getValidToken());
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function getCurrentUsername(): string {
  const stored = localStorage.getItem(USERNAME_KEY);
  if (stored && stored.trim()) return stored.trim();

  const token = getValidToken();
  if (!token) return "";

  const payload = parseTokenPayload(token);
  return typeof payload?.username === "string" ? payload.username.trim() : "";
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

export function redirectToLogin(nextPath?: string): void {
  const currentPath = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  const safeNextPath = nextPath && nextPath.startsWith("/") ? nextPath : currentPath;
  const isLoginPage = window.location.pathname === "/login";
  const search = !isLoginPage && safeNextPath ? `?next=${encodeURIComponent(safeNextPath)}` : "";

  window.location.replace(`/login${search}`);
}

export function logout(options?: { redirectToLogin?: boolean; nextPath?: string }): void {
  clearToken();
  if (options?.redirectToLogin) {
    redirectToLogin(options.nextPath);
  }
}
