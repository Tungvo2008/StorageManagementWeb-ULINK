import { useEffect, useRef, useState } from "react";
import { apiJson, downloadFile } from "../api/client";

type Box = { id: number; box_code: string; weight_lbs?: string | number | null };
type Batch = { id: number; batch_code: string; boxes: Box[]; unassigned_bills: unknown[] };
type Measure = { weight_lbs: string; length_in: string; width_in: string; height_in: string };
type Job = { job_id: string; state: string; plan_sha256: string; box_count: number; quoted_total_usd?: string; verified_total_usd?: string; erp_tracking?: { state?: string }; transactions?: { box_id: number; tracking_number: string }[] };
const base = "/api/v1/zen-shipping";
const labels: Record<string, string> = { PREPARED: "Đang chuẩn bị lô", CREATE_SENT: "Đang đối soát lần tạo lô", CREATED: "Đang lấy giá", VALIDATED: "Đã có báo giá", PURCHASE_SENT: "Đang mua nhãn", PURCHASING: "Đang mua nhãn", PURCHASE_RETURNED: "Đang xác minh nhãn", TRANSACTIONS_VERIFIED: "Đang gộp PDF", ARTIFACTS_VERIFIED: "Đã có nhãn", PARTIAL: "Lô chưa hoàn tất — đối soát lô gốc" };
function message(error: unknown) {
 const text = error instanceof Error ? error.message : String(error);
 if (text.includes("UPS_GROUND_RATE_UNAVAILABLE")) return "Chưa lấy được giá UPS Ground cho đủ nhãn. Chưa thể mua; bấm Cập nhật kết quả lô để thử lấy lại báo giá.";
 if (text.includes("LEGACY_LABELS_REQUIRE")) return "Lô này có trước khi chuyển sang Shippo. Cần đối soát nhãn cũ trước khi mua lại.";
 if (text.includes("EXISTING_LABELS")) return "Thùng đã có tracking. Hãy lấy lại nhãn của lô gốc, không mua nhãn khác.";
 if (text.includes("SOURCE_CHANGED") || text.includes("BOX_WEIGHT_DIFFERS")) return "Dữ liệu thùng đã thay đổi sau báo giá. Cần đối soát lô hiện có trước khi mua.";
 return text;
}
export default function ShippoCargoLabels({ batch, onUpdated }: { batch: Batch; onUpdated: () => void }) {
 const measurements: Record<string, Measure> = Object.fromEntries(batch.boxes.map(b => [String(b.id), { weight_lbs: "8", length_in: "10", width_in: "8", height_in: "6" }]));
 const [job, setJob] = useState<Job | null>(null);
 const [budget, setBudget] = useState("");
 const [quoted, setQuoted] = useState(false);
 const [busy, setBusy] = useState(false);
 const [attempted, setAttempted] = useState(false);
 const [error, setError] = useState("");
 const alive = useRef(true);
 const ready = job?.state === "ARTIFACTS_VERIFIED" && job.erp_tracking?.state === "VERIFIED";
 useEffect(() => {
  alive.current = true;
  apiJson<Job>(`${base}/batches/${batch.id}/job`).then(async found => {
   const current = await apiJson<Job>(`${base}/jobs/${found.job_id}`);
   if (!alive.current) return;
   setJob(current);
   if (current.state === "VALIDATED") {
    const quote = await apiJson<{ quoted_total_usd: string }>(`${base}/jobs/${current.job_id}/quote`);
    if (alive.current) { setBudget(quote.quoted_total_usd);setQuoted(true); }
   }
  }).catch(e => { if (alive.current && !String(e).includes("404") && !String(e).includes("SHIPPING_JOB_NOT_FOUND")) setError(message(e)); });
  return () => { alive.current = false; };
 }, [batch.id]);
 async function update(id: string) {
  let current = await apiJson<Job>(`${base}/jobs/${id}`);
  if (["PURCHASE_RETURNED", "TRANSACTIONS_VERIFIED"].includes(current.state) || (current.state === "ARTIFACTS_VERIFIED" && current.erp_tracking?.state === "PENDING")) current = await apiJson<Job>(`${base}/jobs/${id}/verify`, { method: "POST" });
  if (alive.current) setJob(current);
  return current;
 }
 async function settle(current: Job) {
  for (let i = 0; i < 30 && alive.current; i++) {
   if (["VALIDATED", "ARTIFACTS_VERIFIED", "PARTIAL", "CREATE_SENT"].includes(current.state)) break;
   await new Promise(resolve => setTimeout(resolve, 1000));
   if (!alive.current) break;
   current = await update(current.job_id);
  }
  if (current.state === "VALIDATED") {
   const quote = await apiJson<{ quoted_total_usd: string }>(`${base}/jobs/${current.job_id}/quote`);
   if (alive.current) { setBudget(quote.quoted_total_usd);setQuoted(true); }
  }
  if (current.state === "ARTIFACTS_VERIFIED" && current.erp_tracking?.state === "VERIFIED") onUpdated();
 }
 async function act(action: () => Promise<void>) {
  setBusy(true);setError("");setQuoted(false);
  try { await action(); } catch (e) { if (alive.current) setError(message(e)); } finally { if (alive.current) setBusy(false); }
 }
 async function prepare() {
  if (batch.unassigned_bills.length) throw new Error("Còn bill chưa gán vào thùng. Hoàn tất gom thùng trước khi báo giá.");
  const values = Object.fromEntries(Object.entries(measurements).map(([id, m]) => [id, Object.fromEntries(Object.entries(m).map(([k, v]) => [k, Number(v)]))]));
  if (Object.values(values).some(m => Object.values(m).some(v => !Number.isFinite(v) || v <= 0))) throw new Error("Nhập cân nặng cả bì và kích thước hợp lệ cho từng thùng.");
  let current = await apiJson<Job>(`${base}/jobs`, { method: "POST", body: JSON.stringify({ batch_id: batch.id, expected_box_count: batch.boxes.length, measurements: values }) });
  setJob(current);
  if (current.state === "PREPARED") current = await apiJson<Job>(`${base}/jobs/${current.job_id}/create`, { method: "POST", body: "{}" });
  setJob(current);await settle(current);
 }
 async function purchase() {
  if (!job || job.state !== "VALIDATED" || attempted || !Number.isFinite(Number(budget)) || Number(budget) <= 0) return;
  setAttempted(true);
  const current = await apiJson<Job>(`${base}/jobs/${job.job_id}/purchase`, { method: "POST", body: JSON.stringify({ plan_sha256: job.plan_sha256, max_total_usd: Number(budget) }) });
  setJob(current);await settle(await update(current.job_id));
 }
 return <section className="card" style={{ marginTop: 16 }}>
  <h3>Nhãn Shippo — {batch.batch_code}</h3>
  <p>UPS Ground · PDF 4×6 · một lô gồm {batch.boxes.length} thùng. Quy cách mua nhãn cố định: mỗi thùng 10×8×6 inch, 8 lb. Cân nặng hàng trong ERP để tính tiền cargo được giữ nguyên.</p>
  <div style={{ overflowX: "auto" }}><table style={{ width: "100%" }}><thead><tr><th>Thùng</th><th>Cân nặng (lb)</th><th>Dài (in)</th><th>Rộng (in)</th><th>Cao (in)</th></tr></thead><tbody>{batch.boxes.map(b => <tr key={b.id}><td>{b.box_code}</td>{(["weight_lbs", "length_in", "width_in", "height_in"] as const).map(key => <td key={key}><span>{measurements[String(b.id)][key]}</span></td>)}</tr>)}</tbody></table></div>
  {error && <p role="alert" style={{ color: "#b91c1c", whiteSpace: "pre-wrap" }}>{error}</p>}
  <div className="row" style={{ gap: 10, marginTop: 14, flexWrap: "wrap" }}>
   {!job && <button className="btn primary" disabled={busy || !batch.boxes.length} onClick={() => void act(prepare)}>{busy ? "Đang lấy giá…" : "Lấy báo giá cả lô"}</button>}
   {job && <><strong role="status">{job.state === "VALIDATED" && !quoted ? "Chưa lấy được báo giá" : labels[job.state] ?? "Đang đối soát lô"}</strong><button className="btn" disabled={busy} onClick={() => void act(async () => { const current = await update(job.job_id); if (current.state === "PREPARED") { const created = await apiJson<Job>(`${base}/jobs/${current.job_id}/create`, { method: "POST", body: "{}" });setJob(created);await settle(created); } else await settle(current); })}>Cập nhật kết quả lô</button></>}
   {job?.state === "VALIDATED" && quoted && <><label>Hạn mức cả lô (USD) <input aria-label="Hạn mức cả lô (USD)" className="input" type="number" step="0.01" min="0.01" value={budget} disabled={busy || attempted} onChange={e => setBudget(e.target.value)} style={{ width: 100 }} /></label><button className="btn primary" disabled={busy || attempted || Number(budget) <= 0 || !Number.isFinite(Number(budget))} onClick={() => void act(purchase)}>Mua {job.box_count} nhãn — tối đa ${budget || "0"}</button></>}
   {ready && <button className="btn primary" disabled={busy} onClick={() => void act(() => downloadFile(`${base}/jobs/${job!.job_id}/label.pdf`, `shippo-${batch.batch_code}-labels.pdf`))}>Tải PDF nhãn gộp 4×6</button>}
  </div>
  {attempted && !ready && <p>Đã gửi yêu cầu mua cho lô này. Dùng “Cập nhật kết quả lô” để tiếp tục đối soát, không tạo lô khác.</p>}
  {job?.erp_tracking?.state === "CONFLICT" && <p role="alert" style={{ color: "#b91c1c" }}>Tracking hiện có không khớp lô nhãn. Cần đối soát; hệ thống không ghi đè hoặc mua lại.</p>}
  {!!job?.transactions?.length && <ul>{job.transactions.map(t => <li key={t.box_id}>{batch.boxes.find(b => b.id === t.box_id)?.box_code ?? t.box_id}: <strong>{t.tracking_number}</strong></li>)}</ul>}
 </section>;
}
