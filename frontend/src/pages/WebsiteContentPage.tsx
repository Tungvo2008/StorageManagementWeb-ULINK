import { useEffect, useMemo, useState } from "react";
import { apiJson, apiUpload, assetUrl } from "../api/client";

type Site = "ulink" | "towels";
type Locale = "vi" | "en";
type Translation = {
  title: string | null;
  summary: string | null;
  description: string | null;
  seo_title: string | null;
  seo_description: string | null;
};
type Media = { id: number; image_url: string; alt_text: string | null; sort_order: number; is_primary: boolean };
type Item = {
  kind: "product" | "showcase";
  item_id: number;
  sku: string;
  inventory_name: string;
  inventory_image_url: string | null;
  listing_id: number | null;
  is_published: boolean;
  category_id: number | null;
  sort_order: number;
  translations: Partial<Record<Locale, Translation>>;
  media: Media[];
};
type Category = {
  id: number;
  site: Site;
  slug: string;
  name_vi: string | null;
  name_en: string | null;
  description_vi: string | null;
  description_en: string | null;
  sort_order: number;
  is_active: boolean;
};
type PageBlock = {
  site: Site; page: string; block_key: string; locale: Locale;
  eyebrow: string | null; title: string | null; body: string | null;
  image_url: string | null; image_alt: string | null;
  cta_label: string | null; is_published: boolean;
};
const emptyPageBlock = { eyebrow: "", title: "", body: "", image_alt: "", cta_label: "", is_published: false };
const blockLabels: Record<Site, Record<string, string>> = {
  ulink: { hero: "Banner đầu trang", intro: "Giới thiệu", wholesale: "Giới thiệu danh mục", final: "Lời mời liên hệ" },
  towels: { hero: "Banner đầu trang", collection: "Bộ sưu tập", colors: "Chọn màu", final: "Lời mời mua hàng" },
};
const emptyTranslation: Translation = {
  title: "", summary: "", description: "", seo_title: "", seo_description: "",
};
const emptyCategory = {
  slug: "", name_vi: "", name_en: "", description_vi: "", description_en: "",
  sort_order: 0, is_active: true,
};

export default function WebsiteContentPage() {
  const [site, setSite] = useState<Site>("ulink");
  const [locale, setLocale] = useState<Locale>("vi");
  const [items, setItems] = useState<Item[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [selectedKey, setSelectedKey] = useState("");
  const [draft, setDraft] = useState<Translation>(emptyTranslation);
  const [published, setPublished] = useState(false);
  const [categoryId, setCategoryId] = useState<number | null>(null);
  const [sortOrder, setSortOrder] = useState(0);
  const [query, setQuery] = useState("");
  const [onlyMissing, setOnlyMissing] = useState(false);
  const [categoryForm, setCategoryForm] = useState(emptyCategory);
  const [editingCategoryId, setEditingCategoryId] = useState<number | null>(null);
  const [pageRows, setPageRows] = useState<PageBlock[]>([]);
  const [pageLocale, setPageLocale] = useState<Locale>("vi");
  const [blockKey, setBlockKey] = useState("hero");
  const [pageDraft, setPageDraft] = useState(emptyPageBlock);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const keyOf = (item: Item) => `${item.kind}:${item.item_id}`;
  const selected = items.find((item) => keyOf(item) === selectedKey) ?? null;
  const missing = (item: Item) => {
    const main = site === "towels" ? "en" : "vi";
    return !item.translations[main]?.title || !item.category_id || !item.media.length ||
      (site === "ulink" && !item.translations.en?.title);
  };
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return items.filter((item) =>
      (!needle || `${item.sku} ${item.inventory_name} ${item.translations.vi?.title || ""} ${item.translations.en?.title || ""}`.toLowerCase().includes(needle)) &&
      (!onlyMissing || missing(item))
    );
  }, [items, query, onlyMissing, site]);

  async function load(currentSite: Site) {
    try {
      const [newItems, newCategories, newPageRows] = await Promise.all([
        apiJson<Item[]>(`/api/v1/website-content/${currentSite}/items`),
        apiJson<Category[]>(`/api/v1/website-content/${currentSite}/categories`),
        apiJson<PageBlock[]>(`/api/v1/website-content/${currentSite}/pages/home`),
      ]);
      setItems(newItems);
      setCategories(newCategories);
      setPageRows(newPageRows);
      setSelectedKey((previous) => newItems.some((item) => keyOf(item) === previous)
        ? previous : newItems.length ? keyOf(newItems[0]) : "");
      setError("");
    } catch (cause) {
      setError((cause as Error).message);
    }
  }

  useEffect(() => {
    setSelectedKey("");
    setLocale(site === "towels" ? "en" : "vi");
    setPageLocale(site === "towels" ? "en" : "vi");
    setBlockKey("hero");
    void load(site);
  }, [site]);
  useEffect(() => {
    setDraft(selected?.translations[locale] ?? emptyTranslation);
    setPublished(Boolean(selected?.is_published));
    setCategoryId(selected?.category_id ?? null);
    setSortOrder(selected?.sort_order ?? 0);
  }, [selectedKey, locale, selected?.listing_id, selected?.translations, selected?.is_published, selected?.category_id, selected?.sort_order]);
  const activeBlock = pageRows.find((row) => row.block_key === blockKey && row.locale === pageLocale);
  useEffect(() => {
    setPageDraft(activeBlock ? {
      eyebrow: activeBlock.eyebrow || "", title: activeBlock.title || "", body: activeBlock.body || "",
      image_alt: activeBlock.image_alt || "", cta_label: activeBlock.cta_label || "",
      is_published: activeBlock.is_published,
    } : emptyPageBlock);
  }, [site, blockKey, pageLocale, activeBlock]);

  function replaceItem(updated: Item) {
    setItems((current) => current.map((item) => keyOf(item) === keyOf(updated) ? updated : item));
  }

  async function run(action: () => Promise<Item>, message: string) {
    setBusy(true);
    setError("");
    setInfo("");
    try {
      replaceItem(await action());
      setInfo(message);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    if (!selected) return;
    await run(
      () => apiJson<Item>(`/api/v1/website-content/${site}/items/${selected.kind}/${selected.item_id}`, {
        method: "PUT",
        body: JSON.stringify({
          locale, is_published: published, category_id: categoryId,
          sort_order: sortOrder, ...draft,
        }),
      }),
      `Đã lưu ${selected.sku} trên ${site === "ulink" ? "Ulink" : "Towels Haven"}.`,
    );
  }

  async function upload(files: FileList | null) {
    if (!selected || !files) return;
    for (const file of Array.from(files)) {
      const form = new FormData();
      form.append("file", file);
      form.append("alt_text", draft.title || selected.inventory_name);
      await run(
        () => apiUpload<Item>(`/api/v1/website-content/${site}/items/${selected.kind}/${selected.item_id}/media`, form),
        `Đã thêm ảnh ${file.name}.`,
      );
    }
  }

  async function changeMedia(media: Media, changes: Partial<Media>) {
    if (!selected) return;
    await run(
      () => apiJson<Item>(`/api/v1/website-content/${site}/items/${selected.kind}/${selected.item_id}/media/${media.id}`, {
        method: "PATCH", body: JSON.stringify(changes),
      }),
      "Đã cập nhật ảnh.",
    );
  }

  async function removeMedia(media: Media) {
    if (!selected || !window.confirm("Xóa ảnh này khỏi website đang chọn?")) return;
    await run(
      () => apiJson<Item>(`/api/v1/website-content/${site}/items/${selected.kind}/${selected.item_id}/media/${media.id}`, {
        method: "DELETE",
      }),
      "Đã xóa ảnh khỏi website.",
    );
  }

  async function saveCategory() {
    setBusy(true);
    setError("");
    setInfo("");
    try {
      const path = editingCategoryId
        ? `/api/v1/website-content/${site}/categories/${editingCategoryId}`
        : `/api/v1/website-content/${site}/categories`;
      await apiJson(path, {
        method: editingCategoryId ? "PUT" : "POST",
        body: JSON.stringify(categoryForm),
      });
      const rows = await apiJson<Category[]>(`/api/v1/website-content/${site}/categories`);
      setCategories(rows);
      setEditingCategoryId(null);
      setCategoryForm(emptyCategory);
      setInfo("Đã lưu danh mục công khai.");
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function savePageBlock() {
    setBusy(true); setError(""); setInfo("");
    try {
      const updated = await apiJson<PageBlock>(`/api/v1/website-content/${site}/pages/home/${blockKey}/${pageLocale}`, {
        method: "PUT", body: JSON.stringify(pageDraft),
      });
      setPageRows((current) => [...current.filter((row) => !(row.block_key === blockKey && row.locale === pageLocale)), updated]);
      setInfo("Đã lưu khối nội dung trang chủ.");
    } catch (cause) { setError((cause as Error).message); }
    finally { setBusy(false); }
  }

  async function uploadPageImage(file: File | undefined) {
    if (!file) return;
    const form = new FormData(); form.append("file", file);
    setBusy(true); setError(""); setInfo("");
    try {
      await apiJson<PageBlock>(`/api/v1/website-content/${site}/pages/home/${blockKey}/${pageLocale}`, {
        method: "PUT", body: JSON.stringify(pageDraft),
      });
      const updated = await apiUpload<PageBlock>(`/api/v1/website-content/${site}/pages/home/${blockKey}/${pageLocale}/image`, form);
      setPageRows((current) => [...current.filter((row) => !(row.block_key === blockKey && row.locale === pageLocale)), updated]);
      setInfo("Đã tải ảnh lên khối nội dung.");
    } catch (cause) { setError((cause as Error).message); }
    finally { setBusy(false); }
  }

  const categorySlug = categories.find((category) => category.id === selected?.category_id)?.slug;
  const liveUrl = selected
    ? site === "ulink"
      ? `https://ulink-llc.com/wholesale/${encodeURIComponent(selected.sku)}`
      : categorySlug
        ? `https://thetowelshaven.com/towels/${categorySlug}?sku=${encodeURIComponent(selected.sku)}`
        : null
    : null;
  const fields: { key: keyof Translation; label: string; multiline?: boolean }[] = [
    { key: "title", label: "Tên hiển thị" },
    { key: "summary", label: "Mô tả ngắn", multiline: true },
    { key: "description", label: "Mô tả chi tiết", multiline: true },
    { key: "seo_title", label: "SEO title" },
    { key: "seo_description", label: "SEO description", multiline: true },
  ];

  return <div className="card">
    <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
      <div>
        <h2 style={{ margin: 0 }}>Nội dung website</h2>
        <p className="muted">Tên, danh mục và ảnh công khai được quản lý riêng cho từng web. SKU, giá và tồn kho vẫn thuộc ERP.</p>
      </div>
      <button className="btn" type="button" onClick={() => void load(site)}>Làm mới</button>
    </div>
    <div className="row" style={{ gap: 8, marginBottom: 18 }}>
      <button type="button" className="btn" onClick={() => setSite("ulink")} style={{ background: site === "ulink" ? "#d9f6e5" : undefined }}>Ulink</button>
      <button type="button" className="btn" onClick={() => setSite("towels")} style={{ background: site === "towels" ? "#d9f6e5" : undefined }}>Towels Haven</button>
    </div>
    {error && <div className="error" role="alert">{error}</div>}
    {info && <p style={{ color: "#167647" }}>{info}</p>}
    <div className="towel-web-layout">
      <aside style={{ display: "grid", gap: 9, alignContent: "start" }}>
        <input className="input" placeholder="Tìm mã hoặc tên trong ERP" value={query} onChange={(event) => setQuery(event.target.value)} />
        <label><input type="checkbox" checked={onlyMissing} onChange={(event) => setOnlyMissing(event.target.checked)} /> Chỉ mục thiếu nội dung</label>
        <small className="muted">{filtered.length} / {items.length} mục</small>
        <div style={{ maxHeight: "70vh", overflow: "auto", display: "grid", gap: 5 }}>
          {filtered.map((item) => <button key={keyOf(item)} type="button" onClick={() => setSelectedKey(keyOf(item))}
            style={{ textAlign: "left", padding: 10, borderRadius: 8, cursor: "pointer", border: keyOf(item) === selectedKey ? "2px solid #15935b" : "1px solid #ddd", background: keyOf(item) === selectedKey ? "#edf9f1" : "white" }}>
            <strong>{item.sku}</strong><br />
            <span>{item.translations[site === "towels" ? "en" : "vi"]?.title || item.inventory_name}</span><br />
            <small className="muted">{item.is_published ? "Đang đăng" : "Bản nháp"} · {missing(item) ? "Cần bổ sung" : "Đủ nội dung"}</small>
          </button>)}
        </div>
      </aside>
      <div style={{ minWidth: 0 }}>
        {selected ? <>
          <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
            <div><h3 style={{ margin: 0 }}>{selected.sku}</h3><small className="muted">Tên nội bộ: {selected.inventory_name}</small></div>
            {selected.is_published && liveUrl && <a className="btn" href={liveUrl} target="_blank" rel="noreferrer">Xem trên web ↗</a>}
          </div>
          <div className="row" style={{ gap: 8, marginTop: 20 }}>
            <button type="button" className="btn" onClick={() => setLocale("vi")} style={{ background: locale === "vi" ? "#d9f6e5" : undefined }}>Tiếng Việt</button>
            <button type="button" className="btn" onClick={() => setLocale("en")} style={{ background: locale === "en" ? "#d9f6e5" : undefined }}>English</button>
            {!selected.translations.en?.title && site === "ulink" && <small className="muted">Chưa có tiếng Anh; web tạm dùng nội dung tiếng Việt.</small>}
          </div>
          <div style={{ display: "grid", gap: 14, maxWidth: 760, marginTop: 18 }}>
            <label><input type="checkbox" checked={published} onChange={(event) => setPublished(event.target.checked)} /> <strong>Đăng sản phẩm trên web này</strong></label>
            <label style={{ display: "grid", gap: 5 }}><strong>Danh mục khách nhìn thấy</strong>
              <select className="input" value={categoryId ?? ""} onChange={(event) => setCategoryId(event.target.value ? Number(event.target.value) : null)}>
                <option value="">Chọn danh mục</option>
                {categories.filter((category) => category.is_active || category.id === categoryId).map((category) =>
                  <option value={category.id} key={category.id}>{locale === "en" ? category.name_en || category.name_vi : category.name_vi || category.name_en}</option>)}
              </select>
            </label>
            <label style={{ display: "grid", gap: 5 }}><strong>Thứ tự hiển thị</strong>
              <input className="input" type="number" value={sortOrder} onChange={(event) => setSortOrder(Number(event.target.value) || 0)} />
            </label>
            {fields.map((field) => <label key={field.key} style={{ display: "grid", gap: 5 }}>
              <strong>{field.label}</strong>
              {field.multiline
                ? <textarea className="input" rows={field.key === "description" ? 5 : 3} value={draft[field.key] || ""} onChange={(event) => setDraft({ ...draft, [field.key]: event.target.value })} />
                : <input className="input" value={draft[field.key] || ""} onChange={(event) => setDraft({ ...draft, [field.key]: event.target.value })} />}
            </label>)}
            <button type="button" className="btn" disabled={busy} onClick={() => void save()} style={{ justifySelf: "start" }}>Lưu nội dung {locale.toUpperCase()}</button>
          </div>
          <h3 style={{ marginTop: 28 }}>Ảnh dành riêng cho {site === "ulink" ? "Ulink" : "Towels Haven"}</h3>
          <p className="muted">Ảnh chính dùng trong danh mục. Thay đổi ở đây không sửa ảnh trong ERP.</p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
            {selected.media.map((media, index) => <div key={media.id} style={{ width: 185, border: "1px solid #ddd", borderRadius: 10, padding: 10 }}>
              <img src={assetUrl(media.image_url)} alt={media.alt_text || selected.inventory_name} style={{ width: "100%", height: 135, objectFit: "contain", background: "#f5f3ee" }} />
              <strong>#{index + 1} {media.is_primary ? "· Ảnh chính" : ""}</strong>
              <input className="input" aria-label="Mô tả ảnh" defaultValue={media.alt_text || ""} key={`${media.id}-${media.alt_text}`}
                onBlur={(event) => { if (event.target.value !== (media.alt_text || "")) void changeMedia(media, { alt_text: event.target.value }); }} />
              <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginTop: 7 }}>
                <label style={{ fontSize: 12 }}>Thứ tự <input type="number" min="0" style={{ width: 55 }} defaultValue={media.sort_order}
                  key={`${media.id}-${media.sort_order}`} onBlur={(event) => { const value = Number(event.target.value); if (value !== media.sort_order) void changeMedia(media, { sort_order: value }); }} /></label>
                {!media.is_primary && <button className="btn" type="button" disabled={busy} onClick={() => void changeMedia(media, { is_primary: true })}>Chính</button>}
                <button className="btn" type="button" disabled={busy} onClick={() => void removeMedia(media)}>Xóa</button>
              </div>
            </div>)}
            {!selected.media.length && <small className="muted">Chưa có ảnh riêng cho web này.</small>}
          </div>
          <label className="btn" style={{ display: "inline-block", marginTop: 12, cursor: "pointer" }}>+ Thêm ảnh
            <input type="file" accept="image/png,image/jpeg,image/webp" multiple hidden disabled={busy}
              onChange={(event) => { void upload(event.target.files); event.target.value = ""; }} />
          </label>
          <h3 style={{ marginTop: 28 }}>Xem trước nội dung</h3>
          <div style={{ border: "1px solid #ddd", borderRadius: 12, padding: 20, maxWidth: 760, background: "#fff" }}>
            {selected.media[0] && <img src={assetUrl(selected.media.find((media) => media.is_primary)?.image_url || selected.media[0].image_url)}
              alt="" style={{ maxWidth: 220, maxHeight: 180, objectFit: "contain" }} />}
            <h2>{draft.title || "Chưa nhập tên hiển thị"}</h2>
            <p>{draft.summary}</p><p>{draft.description}</p>
          </div>
        </> : <p>Chọn một sản phẩm để chỉnh nội dung.</p>}
      </div>
    </div>
    <section style={{ borderTop: "1px solid #e5e7eb", marginTop: 35, paddingTop: 25 }}>
      <h2>Danh mục công khai · {site === "ulink" ? "Ulink" : "Towels Haven"}</h2>
      <p className="muted">Tên ở đây dành cho khách. Danh mục kho trong ERP không đổi.</p>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
        {categories.map((category) => <button key={category.id} type="button" className="btn"
          onClick={() => { setEditingCategoryId(category.id); setCategoryForm({
            slug: category.slug, name_vi: category.name_vi || "", name_en: category.name_en || "",
            description_vi: category.description_vi || "", description_en: category.description_en || "",
            sort_order: category.sort_order, is_active: category.is_active,
          }); }}>
          {category.name_vi || category.name_en} {category.is_active ? "" : "(ẩn)"}
        </button>)}
        <button type="button" className="btn" onClick={() => { setEditingCategoryId(null); setCategoryForm(emptyCategory); }}>+ Danh mục</button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 12, maxWidth: 950 }}>
        <label>Slug (đường dẫn)<input className="input" value={categoryForm.slug} disabled={editingCategoryId !== null}
          onChange={(event) => setCategoryForm({ ...categoryForm, slug: event.target.value.toLowerCase() })} /></label>
        <label>Tên tiếng Việt<input className="input" value={categoryForm.name_vi}
          onChange={(event) => setCategoryForm({ ...categoryForm, name_vi: event.target.value })} /></label>
        <label>English name<input className="input" value={categoryForm.name_en}
          onChange={(event) => setCategoryForm({ ...categoryForm, name_en: event.target.value })} /></label>
        <label>Thứ tự<input className="input" type="number" value={categoryForm.sort_order}
          onChange={(event) => setCategoryForm({ ...categoryForm, sort_order: Number(event.target.value) || 0 })} /></label>
        <label>Mô tả tiếng Việt<textarea className="input" rows={2} value={categoryForm.description_vi}
          onChange={(event) => setCategoryForm({ ...categoryForm, description_vi: event.target.value })} /></label>
        <label>English description<textarea className="input" rows={2} value={categoryForm.description_en}
          onChange={(event) => setCategoryForm({ ...categoryForm, description_en: event.target.value })} /></label>
      </div>
      <label style={{ display: "block", marginTop: 12 }}><input type="checkbox" checked={categoryForm.is_active}
        onChange={(event) => setCategoryForm({ ...categoryForm, is_active: event.target.checked })} /> Hiển thị danh mục</label>
      <button type="button" className="btn" disabled={busy || !categoryForm.slug || !(categoryForm.name_vi || categoryForm.name_en)}
        onClick={() => void saveCategory()} style={{ marginTop: 12 }}>Lưu danh mục</button>
    </section>
    <section style={{ borderTop: "1px solid #e5e7eb", marginTop: 35, paddingTop: 25 }}>
      <h2>Nội dung trang chủ · {site === "ulink" ? "Ulink" : "Towels Haven"}</h2>
      <p className="muted">Chỉnh từng khối trong bố cục hiện tại. Nội dung chưa xuất bản sẽ chỉ nằm trong ERP.</p>
      <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
        {Object.entries(blockLabels[site]).map(([key, label]) => <button type="button" key={key} className="btn"
          onClick={() => setBlockKey(key)} style={{ background: blockKey === key ? "#d9f6e5" : undefined }}>{label}</button>)}
      </div>
      <div className="row" style={{ gap: 8, margin: "16px 0" }}>
        <button type="button" className="btn" onClick={() => setPageLocale("vi")} style={{ background: pageLocale === "vi" ? "#d9f6e5" : undefined }}>Tiếng Việt</button>
        <button type="button" className="btn" onClick={() => setPageLocale("en")} style={{ background: pageLocale === "en" ? "#d9f6e5" : undefined }}>English</button>
      </div>
      <div style={{ display: "grid", gap: 12, maxWidth: 760 }}>
        <label><input type="checkbox" checked={pageDraft.is_published}
          onChange={(event) => setPageDraft({ ...pageDraft, is_published: event.target.checked })} /> Xuất bản khối này</label>
        <label>Chữ nhỏ phía trên<input className="input" value={pageDraft.eyebrow}
          onChange={(event) => setPageDraft({ ...pageDraft, eyebrow: event.target.value })} /></label>
        <label>Tiêu đề<input className="input" value={pageDraft.title}
          onChange={(event) => setPageDraft({ ...pageDraft, title: event.target.value })} /></label>
        <label>Nội dung<textarea className="input" rows={4} value={pageDraft.body}
          onChange={(event) => setPageDraft({ ...pageDraft, body: event.target.value })} /></label>
        <label>Chữ trên nút<input className="input" value={pageDraft.cta_label}
          onChange={(event) => setPageDraft({ ...pageDraft, cta_label: event.target.value })} /></label>
        <label>Mô tả ảnh<input className="input" value={pageDraft.image_alt}
          onChange={(event) => setPageDraft({ ...pageDraft, image_alt: event.target.value })} /></label>
        {activeBlock?.image_url && <img src={assetUrl(activeBlock.image_url)} alt={activeBlock.image_alt || "Ảnh trang chủ"}
          style={{ width: "100%", maxWidth: 420, height: 220, objectFit: "cover", borderRadius: 10 }} />}
        <label className="btn" style={{ display: "inline-block", width: "fit-content", cursor: "pointer" }}>Tải ảnh mới
          <input type="file" accept="image/png,image/jpeg,image/webp" hidden disabled={busy}
            onChange={(event) => { void uploadPageImage(event.target.files?.[0]); event.target.value = ""; }} />
        </label>
        <button type="button" className="btn" disabled={busy} onClick={() => void savePageBlock()} style={{ justifySelf: "start" }}>Lưu khối nội dung</button>
      </div>
    </section>
  </div>;
}
