import { useEffect, useState } from "react";
import { apiJson } from "../api/client";
import { getToken } from "../auth";
import LeadPipeline from "./LeadPipeline";

type Item = { sku: string; name: string; quantity: number };
type Inquiry = { id: number; reference: string; name: string; email: string; phone?: string; address?: string; company?: string; items: Item[]; message?: string; kind?: string; created_at: string };
type Quote = { id: number; reference: string; customer_name: string; customer_email: string; created_at: string; status: string };
type DraftLine = Item & { unit_price: string };

export default function QuotesPage() {
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [selected, setSelected] = useState<Inquiry | null>(null);
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [incoterm, setIncoterm] = useState("TBD");
  const [paymentTerms, setPaymentTerms] = useState("To be confirmed");
  const [deliveryTerms, setDeliveryTerms] = useState("To be confirmed");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  async function refresh() {
    setQuotes(await apiJson<Quote[]>("/api/v1/quotes"));
  }
  useEffect(() => { void refresh().catch(e => setError(String(e))); }, []);
  function choose(i: Inquiry) {
    setSelected(i);
    setIncoterm("TBD"); setPaymentTerms("To be confirmed"); setDeliveryTerms("To be confirmed"); setNotes("");
    setLines(i.items.map(x => ({ ...x, unit_price: "" })));
    setError(""); setSuccess("");
  }
  async function pdf(id: number, reference: string) {
    const res = await fetch(`/api/v1/quotes/${id}/pdf`, { headers: { Authorization: `Bearer ${getToken() || ""}` } });
    if (!res.ok) throw new Error(await res.text());
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement("a"); a.href = url; a.download = `${reference}.pdf`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }
  async function save() {
    if (!selected) return;
    setBusy(true); setError(""); setSuccess("");
    try {
      const q = await apiJson<Quote>("/api/v1/quotes", { method: "POST", body: JSON.stringify({
        inquiry_id: selected.id,
        lines: lines.map(x => ({ sku: x.sku, quantity: x.quantity, unit_price: x.unit_price.trim() ? x.unit_price : null })),
        currency: "USD", incoterm, payment_terms: paymentTerms, delivery_terms: deliveryTerms, notes,
      }) });
      await refresh();
      setSuccess(`Đã lưu ${q.reference}. File PDF chỉ là bản nháp.`);
      await pdf(q.id, q.reference);
    } catch (e) { setError(String(e)); }
    finally { setBusy(false); }
  }
  const input: React.CSSProperties = { border: "1px solid #cbd5e1", borderRadius: 7, padding: "8px 10px", width: "100%" };
  const card: React.CSSProperties = { background: "white", padding: 20, border: "1px solid #e2e8f0", borderRadius: 12, marginBottom: 18 };
  return <div style={{ maxWidth: 1100, margin: "20px auto", padding: "0 16px" }}>
    <h1>Báo giá ULINK</h1>
    <p>Tạo báo giá nháp từ yêu cầu trên web. Giá, vận chuyển, thuế và điều khoản phải được duyệt trước khi gửi khách.</p>
    {error && <div style={{ ...card, color: "#b91c1c" }}>{error}</div>}
    {success && <div style={{ ...card, color: "#166534" }}>{success}</div>}
    <section style={card}><LeadPipeline onChoose={choose}/></section>
    {selected && <section style={card}>
      <h2>{selected.kind === "consultation" ? "Yêu cầu tư vấn của " : "Tạo báo giá cho "}{selected.name}</h2>
      <p>{selected.company} · {selected.email} · {selected.phone} · {selected.address}</p>
      {selected.message && <div style={{ whiteSpace: "pre-wrap", padding: 16, background: "#f0fdf4", borderRadius: 8, marginBottom: 20 }}>{selected.message}</div>}
      {selected.kind === "consultation" && <p>Liên hệ làm rõ nhu cầu và xác nhận giá dịch vụ trước khi lập báo giá. Yêu cầu này chưa có sản phẩm wholesale.</p>}
      <div style={{ overflowX: "auto" }}><table style={{ width: "100%", borderCollapse: "collapse" }}><thead><tr><th style={{ textAlign: "left" }}>SKU / Tên hàng</th><th>Số lượng</th><th>Đơn giá USD</th></tr></thead><tbody>
        {lines.map((x, idx) => <tr key={x.sku}><td style={{ padding: 8 }}>{x.sku} — {x.name}</td><td style={{ width: 120 }}><input style={input} type="number" min="1" value={x.quantity} onChange={e => setLines(a => a.map((v, n) => n === idx ? { ...v, quantity: Number(e.target.value) } : v))} /></td><td style={{ width: 170 }}><input style={input} type="number" min="0" step="0.01" placeholder="TBD" value={x.unit_price} onChange={e => setLines(a => a.map((v, n) => n === idx ? { ...v, unit_price: e.target.value } : v))} /></td></tr>)}
      </tbody></table></div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12, marginTop: 16 }}>
        <label>Incoterm<input style={input} value={incoterm} onChange={e => setIncoterm(e.target.value)} /></label>
        <label>Thanh toán<input style={input} value={paymentTerms} onChange={e => setPaymentTerms(e.target.value)} /></label>
        <label>Giao hàng<input style={input} value={deliveryTerms} onChange={e => setDeliveryTerms(e.target.value)} /></label>
      </div>
      <label style={{ display: "block", marginTop: 12 }}>Ghi chú<textarea style={{ ...input, minHeight: 75 }} value={notes} onChange={e => setNotes(e.target.value)} /></label>
      <p style={{ color: "#b45309" }}>Thông số đóng kiện hiện là ước tính. File xuất ra có dấu DRAFT và không tự gửi khách.</p>
      <button disabled={busy || !lines.length} onClick={() => void save()} style={{ padding: "10px 20px", background: "#17365b", color: "white", border: 0, borderRadius: 8, cursor: "pointer" }}>{busy ? "Đang tạo..." : "Lưu & tải PDF nháp"}</button>
    </section>}
    <section style={card}><h2>Báo giá đã lưu</h2><div style={{ display: "grid", gap: 8 }}>{quotes.map(q => <div key={q.id} style={{ display: "flex", justifyContent: "space-between", gap: 10, borderBottom: "1px solid #e2e8f0", padding: 8 }}><span>{q.reference} · {q.customer_name} · {q.customer_email} · DRAFT</span><button onClick={() => void pdf(q.id, q.reference).catch(e => setError(String(e)))}>Tải PDF</button></div>)}</div></section>
  </div>;
}
