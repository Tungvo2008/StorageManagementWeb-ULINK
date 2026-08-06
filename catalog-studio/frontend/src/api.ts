import type { Category, Product, ProductDraft } from "./types";

const configuredApiBase = import.meta.env.VITE_API_BASE_URL?.trim();
export const API_BASE = (
  configuredApiBase || (import.meta.env.DEV ? "http://localhost:8001" : window.location.origin)
).replace(/\/$/, "");

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, init);
  if (!response.ok) {
    const data = await response.json().catch(() => ({ detail: response.statusText }));
    throw new Error(data.detail || "Request failed");
  }
  if (response.status === 204) return undefined as T;
  return response.json();
}

export const api = {
  products: () => request<Product[]>("/api/products"),
  categories: () => request<Category[]>("/api/categories"),
  createProduct: (payload: ProductDraft) =>
    request<Product>("/api/products", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }),
  updateProduct: (id: number, payload: Partial<ProductDraft>) =>
    request<Product>(`/api/products/${id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }),
  deleteProduct: (id: number) => request<void>(`/api/products/${id}`, { method: "DELETE" }),
  createCategory: (name: string) =>
    request<Category>("/api/categories", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, sort_order: 0 }) }),
  updateCategory: (id: number, name: string, sortOrder: number) =>
    request<Category>(`/api/categories/${id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, sort_order: sortOrder }) }),
  deleteCategory: (id: number) => request<void>(`/api/categories/${id}`, { method: "DELETE" }),
  uploadImage: async (id: number, file: File) => {
    const body = new FormData();
    body.append("file", file);
    return request<Product>(`/api/products/${id}/image`, { method: "POST", body });
  },
};

export function imageUrl(value: string | null): string {
  if (!value) return "";
  return value.startsWith("http") ? value : `${API_BASE}${value}`;
}
