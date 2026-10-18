import CatalogPanel from "./CatalogPanel";
import { useEffect, useMemo, useState } from "react";
import { apiJson, apiUpload, assetUrl } from "../api/client";

type ShowcaseItem = {
  id: number; code: string; name: string; category: string; category_slug: string;
  description: string; highlights: string[]; specifications: Record<string, string>;
  image_url: string | null; images: string[]; min_order_quantity: number;
  lead_time: string; brand: string; badges: string[]; sort_order: number;
  is_active: boolean; updated_at: string;
};
type Form = Omit<ShowcaseItem, "id" | "category_slug" | "updated_at" | "highlights" | "specifications" | "images" | "badges"> & {
  highlightsText: string; specificationsText: string; imagesText: string; badgesText: string;
};
const empty: Form = {
  code: "", name: "", category: "", description: "", image_url: null,
  highlightsText: "", specificationsText: "", imagesText: "", badgesText: "CUSTOM IMPORT",
  min_order_quantity: 1, lead_time: "Order on demand / contact for lead time",
  brand: "ULINK", sort_order: 0, is_active: false,
};
const lines = (text: string) => text.split("\n").map(x => x.trim()).filter(Boolean);
function toForm(x: ShowcaseItem): Form {
  return { code: x.code, name: x.name, category: x.category,
    description: x.description || "", image_url: x.image_url,
    highlightsText: x.highlights.join("\n"),
    specificationsText: Object.entries(x.specifications).map(([k, v]) => `${k}: ${v}`).join("\n"),
    imagesText: x.images.map(v => typeof v === "string" ? v : "").filter(Boolean).join("\n"),
    badgesText: x.badges.join("\n"), min_order_quantity: x.min_order_quantity,
    lead_time: x.lead_time, brand: x.brand, sort_order: x.sort_order, is_active: x.is_active };
}
function payload(form: Form) {
  const specifications: Record<string, string> = {};
  for (const row of lines(form.specificationsText)) {
    const pos = row.indexOf(":");
    if (pos < 1) throw new Error(`Thông số cần dạng “Tên: Giá trị”: ${row}`);
    specifications[row.slice(0, pos).trim()] = row.slice(pos + 1).trim();
  }
  return { code: form.code.trim(), name: form.name.trim(), category: form.category.trim(),
    description: form.description.trim(), image_url: form.image_url?.trim() || null,
    highlights: lines(form.highlightsText), specifications, images: lines(form.imagesText),
    badges: lines(form.badgesText), min_order_quantity: Number(form.min_order_quantity),
    lead_time: form.lead_time.trim(), brand: form.brand.trim(), sort_order: Number(form.sort_order),
    is_active: form.is_active };
}
const field: React.CSSProperties = { width: "100%", padding: "9px 11px", border: "1px solid #cbd5e1", borderRadius: 8, background: "white", boxSizing: "border-box" };
const label: React.CSSProperties = { display: "grid", gap: 5, fontSize: 13, fontWeight: 600, color: "#334155" };
const button: React.CSSProperties = { border: "1px solid #cbd5e1", borderRadius: 8, padding: "8px 12px", background: "white", cursor: "pointer" };

export default function ShowcasePage() {
  const [items, setItems] = useState<ShowcaseItem[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [form, setForm] = useState<Form>(empty);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  async function refresh() { setItems(await apiJson<ShowcaseItem[]>("/api/v1/showcase")); }
  useEffect(() => { void refresh().catch(e => setError(String(e))); }, []);
  const filtered = useMemo(() => items.filter(x => `${x.code} ${x.name} ${x.category}`.toLowerCase().includes(query.toLowerCase())), [items, query]);
  function choose(x: ShowcaseItem) { setSelected(x.id); setForm(toForm(x)); setMessage(""); setError(""); }
  function createNew() { setSelected(null); setForm({ ...empty }); setMessage(""); setError(""); }
  function set<K extends keyof Form>(key: K, value: Form[K]) { setForm(old => ({ ...old, [key]: value })); }
  async function save() {
    setBusy(true); setError(""); setMessage("");
    try {
      const saved = await apiJson<ShowcaseItem>(selected ? `/api/v1/showcase/${selected}` : "/api/v1/showcase", {
        method: selected ? "PUT" : "POST", body: JSON.stringify(payload(form)),
      });
      await refresh(); setSelected(saved.id); setForm(toForm(saved));
      setMessage(saved.is_active ? "Đã lưu và hiển thị trên web Ulink." : "Đã lưu bản nháp, chưa hiển thị trên web.");
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }
  async function upload(file: File, gallery: boolean) {
    setBusy(true); setError("");
    try {
      const result = await apiUpload<{ url: string }>("/api/v1/showcase/images", (() => { const f = new FormData(); f.append("file", file); return f; })());
      if (gallery) set("imagesText", [form.imagesText.trim(), result.url].filter(Boolean).join("\n"));
      else set("image_url", result.url);
      setMessage("Đã tải ảnh lên. Bấm Lưu để gắn ảnh vào sản phẩm.");
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }
  async function toggle(x: ShowcaseItem) {
    setBusy(true); setError("");
    try {
      const saved = await apiJson<ShowcaseItem>(`/api/v1/showcase/${x.id}`, { method: "PUT", body: JSON.stringify({ ...payload(toForm(x)), is_active: !x.is_active }) });
      await refresh(); if (selected === x.id) setForm(toForm(saved));
      setMessage(saved.is_active ? `${x.code} đã lên web.` : `${x.code} đã ẩn khỏi web.`);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }
  return <main style={{ maxWidth: 1320, margin: "0 auto", padding: "20px 16px 44px" }}>
    <header style={{ marginBottom: 18 }}><h1 style={{ marginBottom: 6 }}>Sản phẩm Showcase</h1>
      <p style={{ margin: 0, color: "#64748b" }}>Hàng giới thiệu / đặt theo yêu cầu, tách khỏi tồn kho vật lý. Bật “Hiển thị trên web” khi nội dung đã sẵn sàng.</p></header>
    <CatalogPanel />
    {error && <p role="alert" style={{ padding: 12, background: "#fef2f2", color: "#b91c1c", borderRadius: 8 }}>{error}</p>}
    {message && <p role="status" style={{ padding: 12, background: "#f0fdf4", color: "#166534", borderRadius: 8 }}>{message}</p>}
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 340px), 1fr))", gap: 18, alignItems: "start" }}>
      <section style={{ background: "white", padding: 18, border: "1px solid #e2e8f0", borderRadius: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}><h2 style={{ margin: 0, fontSize: 18 }}>Danh sách ({items.length})</h2><button style={button} onClick={createNew}>+ Thêm mới</button></div>
        <input aria-label="Tìm sản phẩm" placeholder="Tìm SKU, tên, danh mục..." value={query} onChange={e => setQuery(e.target.value)} style={{ ...field, margin: "14px 0" }} />
        <div style={{ display: "grid", gap: 9 }}>{filtered.map(x => <div key={x.id} style={{ display: "flex", alignItems: "center", gap: 9, padding: 9, border: selected === x.id ? "2px solid #1d4ed8" : "1px solid #e2e8f0", borderRadius: 9 }}>
          {x.image_url ? <img src={assetUrl(x.image_url)} alt="" style={{ width: 52, height: 52, objectFit: "cover", borderRadius: 6 }} /> : <div style={{ width: 52, height: 52, background: "#f1f5f9", borderRadius: 6 }} />}
          <button onClick={() => choose(x)} style={{ border: 0, background: "none", textAlign: "left", cursor: "pointer", flex: 1, minWidth: 0 }}><strong style={{ display: "block" }}>{x.name}</strong><span style={{ color: "#64748b", fontSize: 12 }}>{x.code} · {x.category}</span></button>
          <button disabled={busy} onClick={() => void toggle(x)} title={x.is_active ? "Ẩn khỏi web" : "Đưa lên web"} style={{ ...button, fontSize: 12, color: x.is_active ? "#166534" : "#64748b" }}>{x.is_active ? "Đang hiện" : "Đã ẩn"}</button>
        </div>)}{filtered.length === 0 && <p style={{ color: "#64748b" }}>Không có sản phẩm phù hợp.</p>}</div>
      </section>
      <section style={{ background: "white", padding: 18, border: "1px solid #e2e8f0", borderRadius: 12 }}>
        <h2 style={{ marginTop: 0, fontSize: 18 }}>{selected ? "Chỉnh sửa sản phẩm" : "Sản phẩm mới"}</h2>
        <div style={{ display: "grid", gap: 13 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px,1fr))", gap: 12 }}><label style={label}>Mã sản phẩm<input style={field} maxLength={64} value={form.code} onChange={e => set("code", e.target.value)} placeholder="VD: EQ-OVEN-008" /></label><label style={label}>Danh mục<input style={field} value={form.category} onChange={e => set("category", e.target.value)} placeholder="VD: Thiết bị nhà hàng" /></label></div>
          <label style={label}>Tên sản phẩm<input style={field} value={form.name} onChange={e => set("name", e.target.value)} /></label>
          <label style={label}>Mô tả<textarea style={{ ...field, minHeight: 110 }} value={form.description} onChange={e => set("description", e.target.value)} /></label>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px,1fr))", gap: 12 }}><label style={label}>Thương hiệu<input style={field} value={form.brand} onChange={e => set("brand", e.target.value)} /></label><label style={label}>MOQ<input style={field} type="number" min="1" value={form.min_order_quantity} onChange={e => set("min_order_quantity", Number(e.target.value))} /></label><label style={label}>Thứ tự<input style={field} type="number" min="0" value={form.sort_order} onChange={e => set("sort_order", Number(e.target.value))} /></label></div>
          <label style={label}>Thời gian cung ứng<input style={field} value={form.lead_time} onChange={e => set("lead_time", e.target.value)} /></label>
          <label style={label}>Ảnh đại diện {form.image_url && <img src={assetUrl(form.image_url)} alt="Ảnh đại diện" style={{ width: 120, height: 90, objectFit: "cover", borderRadius: 8 }} />}<input style={field} value={form.image_url || ""} onChange={e => set("image_url", e.target.value)} placeholder="URL hoặc tải ảnh bên dưới" /><input aria-label="Tải ảnh đại diện" type="file" accept="image/*" disabled={busy} onChange={e => { const f = e.target.files?.[0]; if (f) void upload(f, false); e.target.value = ""; }} /></label>
          <label style={label}>Ảnh bổ sung, mỗi dòng một URL<textarea style={{ ...field, minHeight: 65 }} value={form.imagesText} onChange={e => set("imagesText", e.target.value)} /><input aria-label="Tải ảnh bổ sung" type="file" accept="image/*" disabled={busy} onChange={e => { const f = e.target.files?.[0]; if (f) void upload(f, true); e.target.value = ""; }} /></label>
          <label style={label}>Điểm nổi bật, mỗi dòng một ý<textarea style={{ ...field, minHeight: 80 }} value={form.highlightsText} onChange={e => set("highlightsText", e.target.value)} /></label>
          <label style={label}>Thông số, mỗi dòng “Tên: Giá trị”<textarea style={{ ...field, minHeight: 90 }} value={form.specificationsText} onChange={e => set("specificationsText", e.target.value)} /></label>
          <label style={label}>Nhãn, mỗi dòng một nhãn<textarea style={{ ...field, minHeight: 60 }} value={form.badgesText} onChange={e => set("badgesText", e.target.value)} /></label>
          <label style={{ ...label, display: "flex", alignItems: "center" }}><input type="checkbox" checked={form.is_active} onChange={e => set("is_active", e.target.checked)} /> Hiển thị trên web Ulink</label>
          <button disabled={busy} onClick={() => void save()} style={{ ...button, background: "#17365b", color: "white", fontWeight: 700, padding: "11px 16px" }}>{busy ? "Đang lưu..." : selected ? "Lưu thay đổi" : "Tạo sản phẩm"}</button>
        </div>
      </section>
    </div>
  </main>;
}
