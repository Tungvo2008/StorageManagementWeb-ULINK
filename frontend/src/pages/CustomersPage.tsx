import { useEffect, useMemo, useState } from "react";
import { apiJson } from "../api/client";
import type { Customer } from "../types";
import type { FormEvent } from "react";
import { Link } from "react-router-dom";
import Modal from "../components/Modal";
import type { SortState } from "../utils/table";
import { matchesQuery, sortBy, toggleSort } from "../utils/table";

type CustomerCreate = {
  name: string;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  city?: string | null;
  zip_code?: string | null;
};

export default function CustomersPage() {
  const [items, setItems] = useState<Customer[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortState<"id" | "name" | "email" | "phone" | "address" | "city" | "zip">>({
    key: "id",
    dir: "asc",
  });

  const [form, setForm] = useState<CustomerCreate>({ name: "" });
  const [addOpen, setAddOpen] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const data = await apiJson<Customer[]>("/api/v1/customers");
      setItems(data);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const displayed = useMemo(() => {
    const filtered = items.filter((c) =>
      matchesQuery(query, c.id, c.name, c.email, c.phone, c.address, c.city, c.zip_code),
    );
    const sorted = sortBy(
      filtered,
      (c) => {
        switch (sort.key) {
          case "id":
            return c.id;
          case "name":
            return c.name;
          case "email":
            return c.email ?? "";
          case "phone":
            return c.phone ?? "";
          case "address":
            return c.address ?? "";
          case "city":
            return c.city ?? "";
          case "zip":
            return c.zip_code ?? "";
          default:
            return c.id;
        }
      },
      sort.dir,
    );
    return sorted;
  }, [items, query, sort]);

  function mark(col: typeof sort.key): string {
    if (sort.key !== col) return "";
    return sort.dir === "asc" ? " ↑" : " ↓";
  }

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await apiJson<Customer>("/api/v1/customers", {
        method: "POST",
        body: JSON.stringify(form),
      });
      setForm({ name: "" });
      setAddOpen(false);
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <div className="row" style={{ alignItems: "flex-start" }}>
      <div className="card" style={{ flex: 1, minWidth: 340 }}>
        <div className="row" style={{ justifyContent: "space-between" }}>
          <h2 style={{ margin: 0 }}>Customers</h2>
          <div className="tableTools">
            <input
              className="input"
              style={{ minWidth: 260 }}
              placeholder="Search customer..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <button className="btn primary" type="button" onClick={() => setAddOpen(true)}>
              + Customer
            </button>
            <button className="btn" onClick={() => void load()} disabled={loading}>
              Refresh
            </button>
          </div>
        </div>
        {error && <div className="error">{error}</div>}
        <div style={{ marginTop: 12, overflowX: "auto" }}>
          <table>
            <thead>
              <tr>
                <th><button className="thSortBtn" type="button" onClick={() => setSort((s) => toggleSort(s, "id"))}>ID{mark("id")}</button></th>
                <th><button className="thSortBtn" type="button" onClick={() => setSort((s) => toggleSort(s, "name"))}>Name{mark("name")}</button></th>
                <th><button className="thSortBtn" type="button" onClick={() => setSort((s) => toggleSort(s, "email"))}>Email{mark("email")}</button></th>
                <th><button className="thSortBtn" type="button" onClick={() => setSort((s) => toggleSort(s, "phone"))}>Phone{mark("phone")}</button></th>
                <th><button className="thSortBtn" type="button" onClick={() => setSort((s) => toggleSort(s, "address"))}>Address{mark("address")}</button></th>
                <th><button className="thSortBtn" type="button" onClick={() => setSort((s) => toggleSort(s, "city"))}>City{mark("city")}</button></th>
                <th><button className="thSortBtn" type="button" onClick={() => setSort((s) => toggleSort(s, "zip"))}>ZIP{mark("zip")}</button></th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {displayed.map((c) => (
                <tr key={c.id}>
                  <td>{c.id}</td>
                  <td>{c.name}</td>
                  <td>{c.email ?? ""}</td>
                  <td>{c.phone ?? ""}</td>
                  <td>{c.address ?? ""}</td>
                  <td>{c.city ?? ""}</td>
                  <td>{c.zip_code ?? ""}</td>
                  <td className="right">
                    <Link className="btn" to={`/customers/${c.id}/edit`}>
                      Sửa
                    </Link>
                  </td>
                </tr>
              ))}
              {!loading && displayed.length === 0 && (
                <tr>
                  <td colSpan={8} className="muted">
                    No matching customers.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <Modal open={addOpen} title="Add customer" onClose={() => setAddOpen(false)}>
        {error && <div className="error">{error}</div>}
        <form onSubmit={onCreate} className="row" style={{ alignItems: "stretch" }}>
          <div className="field" style={{ flex: 1, minWidth: 260 }}>
            <label>Name</label>
            <input
              className="input"
              value={form.name}
              onChange={(e) => setForm((s) => ({ ...s, name: e.target.value }))}
              required
            />
          </div>
          <div className="field" style={{ flex: 1, minWidth: 240 }}>
            <label>Email</label>
            <input
              className="input"
              value={form.email ?? ""}
              onChange={(e) => setForm((s) => ({ ...s, email: e.target.value || null }))}
            />
          </div>
          <div className="field" style={{ width: 200 }}>
            <label>Phone</label>
            <input
              className="input"
              value={form.phone ?? ""}
              onChange={(e) => setForm((s) => ({ ...s, phone: e.target.value || null }))}
            />
          </div>
          <div className="field" style={{ flex: 1, minWidth: 380 }}>
            <label>Address</label>
            <input
              className="input"
              value={form.address ?? ""}
              onChange={(e) => setForm((s) => ({ ...s, address: e.target.value || null }))}
            />
          </div>
          <div className="field" style={{ width: 220 }}>
            <label>City</label>
            <input
              className="input"
              value={form.city ?? ""}
              onChange={(e) => setForm((s) => ({ ...s, city: e.target.value || null }))}
            />
          </div>
          <div className="field" style={{ width: 160 }}>
            <label>ZIP</label>
            <input
              className="input"
              value={form.zip_code ?? ""}
              onChange={(e) => setForm((s) => ({ ...s, zip_code: e.target.value || null }))}
            />
          </div>
          <div className="row" style={{ justifyContent: "flex-end", width: "100%" }}>
            <button className="btn primary" type="submit" disabled={loading}>
              Create
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
