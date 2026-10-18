import { useEffect, useMemo, useState } from "react";
import { apiJson, apiUpload, assetUrl } from "../api/client";

type TowelContent = {
  is_published: boolean;
  title: string | null;
  summary: string | null;
  description: string | null;
  seo_title: string | null;
  seo_description: string | null;
};
type TowelMedia = {
  id: number;
  image_url: string;
  alt_text: string | null;
  sort_order: number;
  is_primary: boolean;
};
type TowelProduct = {
  product_id: number;
  sku: string;
  inventory_name: string;
  inventory_image_url: string | null;
  category_id: number | null;
  content: TowelContent;
  media: TowelMedia[];
};

const emptyContent: TowelContent = {
  is_published: false,
  title: null,
  summary: null,
  description: null,
  seo_title: null,
  seo_description: null,
};

export default function TowelWebPage() {
  const [products, setProducts] = useState<TowelProduct[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [draft, setDraft] = useState<TowelContent>(emptyContent);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const selected = products.find((product) => product.product_id === selectedId) ?? null;
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return products.filter((product) => !q || `${product.sku} ${product.inventory_name}`.toLowerCase().includes(q));
  }, [products, query]);

  async function load() {
    try {
      const rows = await apiJson<TowelProduct[]>("/api/v1/towel-web/products");
      setProducts(rows);
      if (selectedId !== null) setDraft(rows.find((row) => row.product_id === selectedId)?.content ?? emptyContent);
      setSelectedId((current) => current ?? rows.find((row) => row.content.is_published)?.product_id ?? rows[0]?.product_id ?? null);
      setError("");
    } catch (cause) {
      setError((cause as Error).message);
    }
  }

  useEffect(() => { void load(); }, []);
  useEffect(() => { setDraft(selected?.content ?? emptyContent); }, [selectedId]);

  function replaceProduct(updated: TowelProduct) {
    setProducts((current) => current.map((product) => product.product_id === updated.product_id ? updated : product));
  }

  async function run(action: () => Promise<TowelProduct>, message: string) {
    setBusy(true);
    setError("");
    setInfo("");
    try {
      replaceProduct(await action());
      setInfo(message);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function saveContent() {
    if (!selected) return;
    await run(
      () => apiJson<TowelProduct>(`/api/v1/towel-web/products/${selected.product_id}/content`, {
        method: "PUT", body: JSON.stringify(draft),
      }),
      `Đã lưu nội dung web cho ${selected.sku}.`,
    );
  }

  async function upload(file: File) {
    if (!selected) return;
    const form = new FormData();
    form.append("file", file);
    form.append("alt_text", selected.content.title || selected.inventory_name);
    await run(
      () => apiUpload<TowelProduct>(`/api/v1/towel-web/products/${selected.product_id}/media`, form),
      `Đã thêm ảnh web cho ${selected.sku}.`,
    );
  }

  async function updateMedia(media: TowelMedia, changes: Partial<TowelMedia>) {
    if (!selected) return;
    await run(
      () => apiJson<TowelProduct>(`/api/v1/towel-web/products/${selected.product_id}/media/${media.id}`, {
        method: "PATCH", body: JSON.stringify(changes),
      }),
      "Đã cập nhật ảnh.",
    );
  }

  async function moveMedia(index: number, delta: number) {
    if (!selected) return;
    const otherIndex = index + delta;
    if (otherIndex < 0 || otherIndex >= selected.media.length) return;
    const first = selected.media[index];
    const second = selected.media[otherIndex];
    const base = `/api/v1/towel-web/products/${selected.product_id}/media`;
    await run(async () => {
      await apiJson<TowelProduct>(`${base}/${first.id}`, {
        method: "PATCH", body: JSON.stringify({ sort_order: otherIndex }),
      });
      return apiJson<TowelProduct>(`${base}/${second.id}`, {
        method: "PATCH", body: JSON.stringify({ sort_order: index }),
      });
    }, "Đã đổi thứ tự ảnh.");
  }

  async function removeMedia(media: TowelMedia) {
    if (!selected || !window.confirm("Xóa ảnh này khỏi web khăn?")) return;
    await run(
      () => apiJson<TowelProduct>(`/api/v1/towel-web/products/${selected.product_id}/media/${media.id}`, {
        method: "DELETE",
      }),
      "Đã xóa ảnh web.",
    );
  }

  const fields: { key: Exclude<keyof TowelContent, "is_published">; label: string; hint: string; multiline?: boolean }[] = [
    { key: "title", label: "Tên trên web khăn", hint: "Để trống để dùng tên SKU trong ERP" },
    { key: "summary", label: "Mô tả ngắn", hint: "Đoạn giới thiệu cạnh ảnh sản phẩm" },
    { key: "description", label: "Mô tả sản phẩm", hint: "Nội dung chi tiết dành riêng cho web khăn", multiline: true },
    { key: "seo_title", label: "SEO title", hint: "Tiêu đề trang khi chia sẻ hoặc tìm kiếm" },
    { key: "seo_description", label: "SEO description", hint: "Mô tả ngắn cho công cụ tìm kiếm", multiline: true },
  ];

  return <div className="card">
    <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
      <div><h2 style={{ margin: 0 }}>The Towels Haven · Nội dung web</h2>
        <p className="muted">Ảnh và lời giới thiệu ở đây chỉ phục vụ web khăn. SKU, giá và tồn kho vẫn lấy từ ERP.</p>
      </div>
      <button type="button" className="btn" onClick={() => void load()}>Refresh</button>
    </div>
    {error && <div className="error">{error}</div>}
    {info && <div className="muted" style={{ color: "#167647" }}>{info}</div>}
    <div className="towel-web-layout">
      <aside style={{ display: "grid", gap: 6 }}>
        <input className="input" placeholder="Tìm SKU hoặc tên khăn" value={query} onChange={(event) => setQuery(event.target.value)} />
        <div className="muted">{filtered.length} SKU khăn</div>
        <div style={{ maxHeight: "70vh", overflow: "auto", display: "grid", gap: 5 }}>
          {filtered.map((product) => <button key={product.product_id} type="button" onClick={() => setSelectedId(product.product_id)}
            style={{ textAlign: "left", padding: 10, borderRadius: 8, cursor: "pointer", border: product.product_id === selectedId ? "2px solid #15935b" : "1px solid #ddd", background: product.product_id === selectedId ? "#edf9f1" : "white" }}>
            <strong>{product.sku}</strong><br/><span>{product.content.title || product.inventory_name}</span><br/>
            <small className="muted">{product.content.is_published ? "Đang hiển thị" : "Chưa đăng"} · {product.media.length} ảnh web</small>
          </button>)}
        </div>
      </aside>
      {selected && <div style={{ minWidth: 0 }}>
        <h3 style={{ marginTop: 0 }}>{selected.sku}</h3>
        <p className="muted">Tên ERP: {selected.inventory_name}</p>
        <h3>Ảnh dùng trên web khăn</h3>
        <p className="muted">Ảnh đánh dấu “Chính” sẽ hiển thị ở danh mục. Kéo thứ tự bằng hai nút lên/xuống; trang chi tiết dùng cùng thứ tự.</p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
          {selected.media.map((media, index) => <div key={media.id} style={{ width: 185, border: "1px solid #ddd", borderRadius: 10, padding: 10 }}>
            <img src={assetUrl(media.image_url)} alt={media.alt_text || selected.inventory_name} style={{ width: "100%", height: 135, objectFit: "contain", background: "#f5f3ee" }} />
            <div style={{ fontWeight: 700, margin: "6px 0" }}>#{index + 1} {media.is_primary ? "· Ảnh chính" : ""}</div>
            <input className="input" aria-label="Alt text" defaultValue={media.alt_text || ""} key={`${media.id}-${media.alt_text}`}
              onBlur={(event) => { if (event.target.value !== (media.alt_text || "")) void updateMedia(media, { alt_text: event.target.value }); }} />
            <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 8 }}>
              <button type="button" className="btn" disabled={busy || index === 0} onClick={() => void moveMedia(index, -1)}>↑</button>
              <button type="button" className="btn" disabled={busy || index === selected.media.length - 1} onClick={() => void moveMedia(index, 1)}>↓</button>
              {!media.is_primary && <button type="button" className="btn" disabled={busy} onClick={() => void updateMedia(media, { is_primary: true })}>Chính</button>}
              <button type="button" className="btn" disabled={busy} onClick={() => void removeMedia(media)}>Xóa</button>
            </div>
          </div>)}
          {!selected.media.length && selected.inventory_image_url && <div style={{ width: 185 }}>
            <img src={assetUrl(selected.inventory_image_url)} alt="Ảnh gốc ERP" style={{ width: "100%", height: 135, objectFit: "contain", background: "#f5f3ee" }} />
            <small className="muted">Ảnh ERP để tham khảo. Web khăn chưa dùng ảnh này.</small>
          </div>}
        </div>
        <label className="btn" style={{ display: "inline-block", marginTop: 14, cursor: busy ? "wait" : "pointer" }}>
          + Thêm ảnh web
          <input type="file" accept="image/png,image/jpeg,image/webp" multiple style={{ display: "none" }} disabled={busy}
            onChange={async (event) => {
              const files = Array.from(event.target.files || []);
              event.target.value = "";
              for (const file of files) await upload(file);
            }} />
        </label>
        <h3 style={{ marginTop: 28 }}>Thông tin hiển thị</h3>
        <div style={{ display: "grid", gap: 14, maxWidth: 720 }}>
          <label style={{ display: "flex", gap: 9, alignItems: "center" }}>
            <input type="checkbox" checked={draft.is_published} onChange={(event) => setDraft({ ...draft, is_published: event.target.checked })} />
            <strong>Đăng sản phẩm này trên web khăn</strong>
          </label>
          {fields.map((field) => <label key={field.key} style={{ display: "grid", gap: 4 }}>
            <strong>{field.label}</strong><small className="muted">{field.hint}</small>
            {field.multiline
              ? <textarea className="input" rows={field.key === "description" ? 6 : 3} value={draft[field.key] || ""} onChange={(event) => setDraft({ ...draft, [field.key]: event.target.value })} />
              : <input className="input" value={draft[field.key] || ""} onChange={(event) => setDraft({ ...draft, [field.key]: event.target.value })} />}
          </label>)}
          <button type="button" className="btn" disabled={busy} onClick={() => void saveContent()} style={{ justifySelf: "start" }}>Lưu nội dung web khăn</button>
        </div>
      </div>}
    </div>
  </div>;
}
