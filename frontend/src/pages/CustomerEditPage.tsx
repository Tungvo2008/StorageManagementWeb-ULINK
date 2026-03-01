import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { apiJson } from "../api/client";
import type { Customer } from "../types";

type CustomerUpdate = {
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  city?: string | null;
  zip_code?: string | null;
};

export default function CustomerEditPage() {
  const { id } = useParams();
  const customerId = Number(id);
  const navigate = useNavigate();

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [form, setForm] = useState<CustomerUpdate>({});

  async function load() {
    if (!Number.isFinite(customerId)) return;
    setLoading(true);
    setError(null);
    try {
      const c = await apiJson<Customer>(`/api/v1/customers/${customerId}`);
      setCustomer(c);
      setForm({
        name: c.name,
        email: c.email,
        phone: c.phone,
        address: c.address,
        city: c.city,
        zip_code: c.zip_code,
      });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerId]);

  async function onSave(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!Number.isFinite(customerId)) return;
    try {
      await apiJson<Customer>(`/api/v1/customers/${customerId}`, {
        method: "PATCH",
        body: JSON.stringify(form),
      });
      navigate("/customers");
    } catch (err) {
      setError((err as Error).message);
    }
  }

  if (!Number.isFinite(customerId)) {
    return <div className="error">Invalid customer id.</div>;
  }

  return (
    <div className="card" style={{ maxWidth: 900, margin: "0 auto" }}>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h2 style={{ margin: 0 }}>Edit customer #{customerId}</h2>
        <div className="row" style={{ justifyContent: "flex-end" }}>
          <button className="btn" type="button" onClick={() => navigate("/customers")}>
            Back
          </button>
        </div>
      </div>
      {error && <div className="error" style={{ marginTop: 12 }}>{error}</div>}
      {loading && <div className="muted" style={{ marginTop: 12 }}>Loading...</div>}

      {customer && (
        <form onSubmit={onSave} className="row" style={{ marginTop: 12, alignItems: "stretch" }}>
          <div className="field" style={{ flex: 1, minWidth: 260 }}>
            <label>Name</label>
            <input
              className="input"
              value={form.name ?? ""}
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
            <button className="btn primary" type="submit">
              Save
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

