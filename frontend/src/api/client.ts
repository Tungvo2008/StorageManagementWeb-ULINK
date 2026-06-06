import { clearToken, getToken } from "../auth";

function resolveApiBaseUrl(): string {
  const configured = (import.meta.env.VITE_API_BASE_URL ?? "").trim();
  if (!configured) {
    return import.meta.env.DEV ? "http://localhost:8000" : "";
  }

  if (typeof window !== "undefined") {
    const current = window.location;
    const configuredUrl = new URL(configured, current.origin);
    if (current.protocol === "https:" && configuredUrl.protocol === "http:") {
      return "";
    }
  }

  return configured;
}

const API_BASE_URL = resolveApiBaseUrl();

function authHeaders(): Record<string, string> {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function apiHref(path: string): string {
  return API_BASE_URL ? `${API_BASE_URL}${path}` : path;
}

function handleUnauthorized(): void {
  clearToken();
  if (typeof window !== "undefined" && window.location.pathname !== "/login") {
    window.location.href = "/login";
  }
}

async function parseJsonIfAny<T>(res: Response): Promise<T> {
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  if (!text.trim()) return undefined as T;
  return JSON.parse(text) as T;
}

export async function apiJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(apiHref(path), {
    ...init,
    headers: {
      ...authHeaders(),
      ...(init?.headers ?? {}),
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
    },
  });

  if (!res.ok) {
    const text = await res.text();
    if (res.status === 401) {
      handleUnauthorized();
    }
    throw new Error(text || res.statusText);
  }

  return parseJsonIfAny<T>(res);
}

export async function apiUpload<T>(path: string, formData: FormData, init?: RequestInit): Promise<T> {
  const res = await fetch(apiHref(path), {
    method: "POST",
    ...(init ?? {}),
    headers: {
      ...authHeaders(),
      ...(init?.headers ?? {}),
    },
    body: formData,
  });

  if (!res.ok) {
    const text = await res.text();
    if (res.status === 401) {
      handleUnauthorized();
    }
    throw new Error(text || res.statusText);
  }

  return parseJsonIfAny<T>(res);
}

export function apiUrl(path: string): string {
  return apiHref(path);
}

export async function downloadFile(path: string, filename: string): Promise<void> {
  const res = await fetch(apiHref(path), { headers: { ...authHeaders() } });
  if (!res.ok) {
    const text = await res.text();
    if (res.status === 401) {
      handleUnauthorized();
    }
    throw new Error(text || res.statusText);
  }

  const blob = await res.blob();
  const disposition = res.headers.get("content-disposition") ?? "";
  const matchedFilenameStar = disposition.match(/filename\*\s*=\s*UTF-8''([^;]+)/i);
  const matchedFilename = disposition.match(/filename\s*=\s*"?([^";]+)"?/i);
  const downloadedFilename = matchedFilenameStar?.[1]
    ? decodeURIComponent(matchedFilenameStar[1])
    : matchedFilename?.[1] ?? filename;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = downloadedFilename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
