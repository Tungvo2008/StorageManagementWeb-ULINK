import { getToken } from "../auth";

function resolveApiBaseUrl(): string {
  const raw = String(import.meta.env.VITE_API_BASE_URL ?? "").trim();
  if (!raw) {
    return import.meta.env.DEV ? "http://localhost:8000" : "";
  }
  try {
    const parsed = new URL(raw, window.location.origin);
    if (window.location.protocol === "https:" && parsed.protocol === "http:") {
      return "";
    }
    const pathname = parsed.pathname.replace(/\/+$/, "");
    return `${parsed.origin}${pathname === "/" ? "" : pathname}`;
  } catch {
    return import.meta.env.DEV ? "http://localhost:8000" : "";
  }
}

const API_BASE_URL = resolveApiBaseUrl();

function buildApiUrl(path: string): string {
  if (!API_BASE_URL) return path;
  return `${API_BASE_URL}${path}`;
}

function authHeaders(): Record<string, string> {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function parseJsonIfAny<T>(res: Response): Promise<T> {
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  if (!text.trim()) return undefined as T;
  return JSON.parse(text) as T;
}

export async function apiJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(buildApiUrl(path), {
    ...init,
    headers: {
      ...authHeaders(),
      ...(init?.headers ?? {}),
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || res.statusText);
  }

  return parseJsonIfAny<T>(res);
}

export async function apiUpload<T>(path: string, formData: FormData, init?: RequestInit): Promise<T> {
  const res = await fetch(buildApiUrl(path), {
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
    throw new Error(text || res.statusText);
  }

  return parseJsonIfAny<T>(res);
}

export function apiUrl(path: string): string {
  return buildApiUrl(path);
}

export async function downloadFile(path: string, filename: string): Promise<void> {
  const res = await fetch(buildApiUrl(path), { headers: { ...authHeaders() } });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || res.statusText);
  }

  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
