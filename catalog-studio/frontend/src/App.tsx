import { useEffect, useMemo, useRef, useState } from "react";
import { API_BASE, api, imageUrl } from "./api";
import type { Category, Product, ProductDraft } from "./types";

const emptyProduct: ProductDraft = {
  sku: "",
  name: "",
  brand: "",
  category_id: null,
  image_url: null,
  unit_size: "",
  case_pack: null,
  country_of_origin: "",
  upc: "",
  wholesale_price: "0",
  currency: "USD",
  stock_qty: 0,
  badges: "",
  catalog_enabled: true,
  is_active: true,
  sort_order: 0,
};

function App() {
  const [tab, setTab] = useState<"catalog" | "products">("catalog");
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [search, setSearch] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [availability, setAvailability] = useState("all");
  const [title, setTitle] = useState("Wholesale Product Catalog");
  const [version, setVersion] = useState(new Date().toLocaleString("en-US", { month: "long", year: "numeric" }));
  const [showPrice, setShowPrice] = useState(false);
  const [showOrigin, setShowOrigin] = useState(false);
  const [showUpc, setShowUpc] = useState(false);
  const [showAvailability, setShowAvailability] = useState(false);
  const [editing, setEditing] = useState<Product | null | "new">(null);
  const [categoryManager, setCategoryManager] = useState(false);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const importRef = useRef<HTMLInputElement>(null);

  async function load() {
    try {
      const [productData, categoryData] = await Promise.all([api.products(), api.categories()]);
      setProducts(productData);
      setCategories(categoryData);
      setSelected((current) => current.size ? current : new Set(productData.filter((item) => item.catalog_enabled && item.is_active).map((item) => item.id)));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Cannot load data");
    }
  }

  useEffect(() => { void load(); }, []);

  const filtered = useMemo(() => products.filter((product) => {
    const needle = search.trim().toLowerCase();
    return (!needle || `${product.sku} ${product.name} ${product.brand}`.toLowerCase().includes(needle))
      && (!categoryId || product.category_id === Number(categoryId))
      && (availability === "all" || (availability === "in_stock") === (product.stock_qty > 0));
  }), [products, search, categoryId, availability]);

  const catalogProducts = useMemo(() => products.filter((product) => selected.has(product.id)), [products, selected]);
  const grouped = useMemo(() => {
    const output = new Map<string, Product[]>();
    catalogProducts.forEach((product) => {
      const items = output.get(product.category_name) || [];
      items.push(product);
      output.set(product.category_name, items);
    });
    return [...output.entries()];
  }, [catalogProducts]);

  function toggle(id: number) {
    setSelected((current) => {
      const next = new Set(current);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function catalogUrl(disposition: "inline" | "attachment") {
    const params = new URLSearchParams({
      skus: catalogProducts.map((item) => item.sku).join(","),
      title,
      version,
      show_price: String(showPrice),
      show_country_of_origin: String(showOrigin),
      show_upc: String(showUpc),
      show_availability: String(showAvailability),
      disposition,
    });
    return `${API_BASE}/api/catalog/pdf?${params}`;
  }

  async function downloadPdf() {
    if (!catalogProducts.length) return setMessage("Choose at least one product.");
    setBusy(true);
    try {
      const response = await fetch(catalogUrl("attachment"));
      if (!response.ok) throw new Error((await response.json()).detail || "PDF export failed");
      const url = URL.createObjectURL(await response.blob());
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "ULINK Product Catalog.pdf";
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "PDF export failed");
    } finally { setBusy(false); }
  }

  async function importExcel(file?: File) {
    if (!file) return;
    const form = new FormData();
    form.append("file", file);
    setBusy(true);
    try {
      const response = await fetch(`${API_BASE}/api/products-import`, { method: "POST", body: form });
      const result = await response.json();
      if (!response.ok) throw new Error(result.detail || "Import failed");
      setMessage(`Imported: ${result.created} new, ${result.updated} updated${result.errors.length ? `, ${result.errors.length} errors` : ""}.`);
      await load();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Import failed"); }
    finally { setBusy(false); if (importRef.current) importRef.current.value = ""; }
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand"><span className="brand-mark">U</span><div><strong>ULINK LLC</strong><small>Catalog Studio</small></div></div>
        <nav>
          <button className={tab === "catalog" ? "active" : ""} onClick={() => setTab("catalog")}>Build catalog</button>
          <button className={tab === "products" ? "active" : ""} onClick={() => setTab("products")}>Products</button>
        </nav>
        <span className="version">v1.0.0</span>
      </header>

      <main>
        {message && <div className="notice"><span>{message}</span><button onClick={() => setMessage("")}>×</button></div>}
        {tab === "catalog" ? (
          <CatalogBuilder
            products={filtered} selected={selected} grouped={grouped} categories={categories}
            search={search} setSearch={setSearch} categoryId={categoryId} setCategoryId={setCategoryId}
            availability={availability} setAvailability={setAvailability} toggle={toggle}
            selectVisible={() => setSelected((current) => new Set([...current, ...filtered.map((item) => item.id)]))}
            clear={() => setSelected(new Set())} title={title} setTitle={setTitle} version={version} setVersion={setVersion}
            showPrice={showPrice} setShowPrice={setShowPrice} showOrigin={showOrigin} setShowOrigin={setShowOrigin}
            showUpc={showUpc} setShowUpc={setShowUpc} showAvailability={showAvailability} setShowAvailability={setShowAvailability}
            preview={() => catalogProducts.length ? window.open(catalogUrl("inline"), "_blank") : setMessage("Choose at least one product.")}
            download={downloadPdf} busy={busy}
          />
        ) : (
          <ProductManager
            products={filtered} categories={categories} search={search} setSearch={setSearch}
            categoryId={categoryId} setCategoryId={setCategoryId} availability={availability} setAvailability={setAvailability}
            edit={setEditing} importRef={importRef} importExcel={importExcel} reload={load} setMessage={setMessage}
            manageCategories={() => setCategoryManager(true)}
          />
        )}
      </main>
      {editing && <ProductModal product={editing === "new" ? null : editing} categories={categories} close={() => setEditing(null)} saved={async () => { setEditing(null); await load(); }} />}
      {categoryManager && <CategoryModal categories={categories} close={() => setCategoryManager(false)} changed={load} />}
    </div>
  );
}

type BuilderProps = {
  products: Product[]; selected: Set<number>; grouped: [string, Product[]][]; categories: Category[];
  search: string; setSearch: (value: string) => void; categoryId: string; setCategoryId: (value: string) => void;
  availability: string; setAvailability: (value: string) => void; toggle: (id: number) => void;
  selectVisible: () => void; clear: () => void; title: string; setTitle: (value: string) => void;
  version: string; setVersion: (value: string) => void; showPrice: boolean; setShowPrice: (value: boolean) => void;
  showOrigin: boolean; setShowOrigin: (value: boolean) => void; showUpc: boolean; setShowUpc: (value: boolean) => void;
  showAvailability: boolean; setShowAvailability: (value: boolean) => void; preview: () => void; download: () => void; busy: boolean;
};

function CatalogBuilder(props: BuilderProps) {
  return <>
    <section className="hero">
      <div><span className="eyebrow">CATALOG WORKSPACE</span><h1>Build a wholesale catalog in minutes.</h1><p>Choose products visually, control the details, then export a compact print-ready PDF.</p></div>
      <div className="hero-actions"><button className="secondary" onClick={props.preview}>Preview PDF</button><button className="primary" disabled={props.busy} onClick={props.download}>{props.busy ? "Building…" : "Download PDF"}</button></div>
    </section>
    <div className="builder-grid">
      <aside className="control-panel">
        <div className="section-title"><div><span>01</span><h2>Catalog setup</h2></div></div>
        <label>Catalog title<input value={props.title} onChange={(event) => props.setTitle(event.target.value)} /></label>
        <label>Edition / version<input value={props.version} onChange={(event) => props.setVersion(event.target.value)} /></label>
        <div className="option-list">
          <Check label="Show wholesale price" value={props.showPrice} set={props.setShowPrice} />
          <Check label="Show country of origin" value={props.showOrigin} set={props.setShowOrigin} />
          <Check label="Show UPC" value={props.showUpc} set={props.setShowUpc} />
          <Check label="Show availability" value={props.showAvailability} set={props.setShowAvailability} />
        </div>
        <div className="selection-stat"><strong>{props.selected.size}</strong><span>products selected</span><small>{Math.max(1, Math.ceil(props.selected.size / 12))} PDF page(s)</small></div>
      </aside>
      <section className="picker-panel">
        <div className="section-title"><div><span>02</span><h2>Choose products</h2></div><div className="mini-actions"><button onClick={props.selectVisible}>Select visible</button><button onClick={props.clear}>Clear</button></div></div>
        <div className="filters">
          <input placeholder="Search product, SKU, or brand…" value={props.search} onChange={(event) => props.setSearch(event.target.value)} />
          <select value={props.categoryId} onChange={(event) => props.setCategoryId(event.target.value)}><option value="">All categories</option>{props.categories.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
          <select value={props.availability} onChange={(event) => props.setAvailability(event.target.value)}><option value="all">Any availability</option><option value="in_stock">In stock</option><option value="out_of_stock">Out of stock</option></select>
        </div>
        <div className="product-picker">
          {props.products.map((product) => <button key={product.id} className={`pick-card ${props.selected.has(product.id) ? "selected" : ""}`} onClick={() => props.toggle(product.id)}>
            <ProductImage product={product} />
            <span className="pick-check">{props.selected.has(product.id) ? "✓" : "+"}</span>
            <div><small>{product.brand || "ULINK"}</small><strong>{product.name}</strong><span>{product.unit_size || "Size not set"} · Case {product.case_pack || "—"}</span></div>
          </button>)}
          {!props.products.length && <div className="empty">No products match these filters.</div>}
        </div>
      </section>
    </div>
    <CatalogPreview grouped={props.grouped} title={props.title} version={props.version} showPrice={props.showPrice} />
  </>;
}

function CatalogPreview({ grouped, title, version, showPrice }: { grouped: [string, Product[]][]; title: string; version: string; showPrice: boolean }) {
  const first = grouped[0];
  return <section className="preview-section">
    <div className="section-title"><div><span>03</span><h2>Live layout preview</h2></div><small>US Letter · 4 columns × 3 rows</small></div>
    <div className="paper-wrap"><div className="paper">
      <div className="paper-head"><div className="paper-logo">ULINK <small>LLC</small></div><div><strong>{title.toUpperCase()}</strong><b>{first?.[0] || "Category"}</b><span>{version}</span></div></div>
      <div className="paper-grid">{(first?.[1] || []).slice(0, 12).map((product) => <div className="paper-card" key={product.id}><ProductImage product={product} /><small>{product.brand || "ULINK"}</small><strong>{product.name}</strong><span><b>Size:</b> {product.unit_size || "—"}</span><span><b>Case Pack:</b> {product.case_pack || "—"}</span>{showPrice && <span><b>Price:</b> ${Number(product.wholesale_price).toFixed(2)}</span>}</div>)}</div>
      <div className="paper-foot"><span>www.ulinkllc.com</span><span>info@ulinkllc.com</span><span>Page 1 of {Math.max(1, Math.ceil(grouped.reduce((sum, [, items]) => sum + items.length, 0) / 12))}</span></div>
    </div></div>
  </section>;
}

type ManagerProps = {
  products: Product[]; categories: Category[]; search: string; setSearch: (value: string) => void;
  categoryId: string; setCategoryId: (value: string) => void; availability: string; setAvailability: (value: string) => void;
  edit: (value: Product | "new") => void; importRef: React.RefObject<HTMLInputElement>; importExcel: (file?: File) => void;
  reload: () => Promise<void>; setMessage: (value: string) => void;
  manageCategories: () => void;
};

function ProductManager(props: ManagerProps) {
  async function upload(product: Product, file?: File) {
    if (!file) return;
    try { await api.uploadImage(product.id, file); props.setMessage(`Image saved for ${product.name}.`); await props.reload(); }
    catch (error) { props.setMessage(error instanceof Error ? error.message : "Upload failed"); }
  }
  async function remove(product: Product) {
    if (!confirm(`Delete ${product.name}?`)) return;
    try { await api.deleteProduct(product.id); await props.reload(); }
    catch (error) { props.setMessage(error instanceof Error ? error.message : "Delete failed"); }
  }
  return <>
    <section className="page-heading"><div><span className="eyebrow">PRODUCT LIBRARY</span><h1>Products & images</h1><p>One clean source for every catalog you publish.</p></div><div className="hero-actions">
      <a className="button secondary" href={`${API_BASE}/api/products-template.xlsx`}>Excel template</a>
      <button className="secondary" onClick={() => props.importRef.current?.click()}>Import Excel</button>
      <input ref={props.importRef} hidden type="file" accept=".xlsx" onChange={(event) => props.importExcel(event.target.files?.[0])} />
      <button className="secondary" onClick={props.manageCategories}>Categories</button>
      <button className="primary" onClick={() => props.edit("new")}>+ Product</button>
    </div></section>
    <section className="library">
      <div className="filters"><input placeholder="Search product, SKU, or brand…" value={props.search} onChange={(event) => props.setSearch(event.target.value)} /><select value={props.categoryId} onChange={(event) => props.setCategoryId(event.target.value)}><option value="">All categories</option>{props.categories.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><select value={props.availability} onChange={(event) => props.setAvailability(event.target.value)}><option value="all">Any availability</option><option value="in_stock">In stock</option><option value="out_of_stock">Out of stock</option></select></div>
      <div className="library-grid">{props.products.map((product) => <article className="library-card" key={product.id}>
        <div className="library-image"><ProductImage product={product} /><label className="image-upload">Replace image<input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => upload(product, event.target.files?.[0])} /></label></div>
        <div className="library-body"><div className="tag-row"><span>{product.category_name}</span><i className={product.catalog_enabled ? "live" : "off"}>{product.catalog_enabled ? "Catalog" : "Hidden"}</i></div><h3>{product.name}</h3><p>{product.brand || "ULINK"} · {product.sku}</p><dl><div><dt>Size</dt><dd>{product.unit_size || "—"}</dd></div><div><dt>Case</dt><dd>{product.case_pack || "—"}</dd></div><div><dt>Price</dt><dd>${Number(product.wholesale_price).toFixed(2)}</dd></div></dl><div className="card-actions"><button onClick={() => props.edit(product)}>Edit</button><button className="danger" onClick={() => remove(product)}>Delete</button></div></div>
      </article>)}</div>
    </section>
  </>;
}

function CategoryModal({ categories, close, changed }: { categories: Category[]; close: () => void; changed: () => Promise<void> }) {
  const [newName, setNewName] = useState("");
  const [error, setError] = useState("");
  async function add() {
    if (!newName.trim()) return;
    try { await api.createCategory(newName.trim()); setNewName(""); await changed(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Cannot create category"); }
  }
  async function rename(category: Category) {
    const name = prompt("Category name", category.name);
    if (!name?.trim()) return;
    try { await api.updateCategory(category.id, name.trim(), category.sort_order); await changed(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Cannot update category"); }
  }
  async function remove(category: Category) {
    if (!confirm(`Delete ${category.name}? Products will become Uncategorized.`)) return;
    try { await api.deleteCategory(category.id); await changed(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Cannot delete category"); }
  }
  return <div className="modal-backdrop" onMouseDown={close}><div className="modal category-modal" onMouseDown={(event) => event.stopPropagation()}>
    <div className="modal-head"><div><span className="eyebrow">ORGANIZE PRODUCTS</span><h2>Categories</h2></div><button onClick={close}>×</button></div>
    {error && <p className="form-error">{error}</p>}
    <div className="category-add"><input placeholder="New category name" value={newName} onChange={(event) => setNewName(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void add(); }} /><button className="primary" onClick={add}>Add</button></div>
    <div className="category-list">{categories.map((category) => <div key={category.id}><span>{category.name}</span><small>Order {category.sort_order}</small><button onClick={() => rename(category)}>Rename</button><button className="danger" onClick={() => remove(category)}>Delete</button></div>)}{!categories.length && <p className="empty">No categories yet.</p>}</div>
  </div></div>;
}

function ProductModal({ product, categories, close, saved }: { product: Product | null; categories: Category[]; close: () => void; saved: () => void }) {
  const [form, setForm] = useState<ProductDraft>(product ? { ...product } : { ...emptyProduct });
  const [error, setError] = useState("");
  const update = (key: keyof ProductDraft, value: ProductDraft[keyof ProductDraft]) => setForm((current) => ({ ...current, [key]: value }));
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    try { product ? await api.updateProduct(product.id, form) : await api.createProduct(form); await saved(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Save failed"); }
  }
  return <div className="modal-backdrop" onMouseDown={close}><form className="modal" onMouseDown={(event) => event.stopPropagation()} onSubmit={submit}>
    <div className="modal-head"><div><span className="eyebrow">PRODUCT DETAILS</span><h2>{product ? "Edit product" : "Add product"}</h2></div><button type="button" onClick={close}>×</button></div>
    {error && <p className="form-error">{error}</p>}
    <div className="form-grid">
      <label className="wide">Product name<input required value={form.name} onChange={(e) => update("name", e.target.value)} /></label>
      <label>SKU <small>auto if blank</small><input value={form.sku} onChange={(e) => update("sku", e.target.value)} /></label>
      <label>Brand<input value={form.brand} onChange={(e) => update("brand", e.target.value)} /></label>
      <label>Category<select value={form.category_id || ""} onChange={(e) => update("category_id", e.target.value ? Number(e.target.value) : null)}><option value="">Uncategorized</option>{categories.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>
      <label>Unit size<input value={form.unit_size} onChange={(e) => update("unit_size", e.target.value)} placeholder="5 oz (142 g)" /></label>
      <label>Case pack<input type="number" min="1" value={form.case_pack || ""} onChange={(e) => update("case_pack", e.target.value ? Number(e.target.value) : null)} /></label>
      <label>Wholesale price<input type="number" min="0" step="0.01" value={form.wholesale_price} onChange={(e) => update("wholesale_price", e.target.value)} /></label>
      <label>Currency<input value={form.currency} onChange={(e) => update("currency", e.target.value.toUpperCase())} /></label>
      <label>Country of origin<input value={form.country_of_origin} onChange={(e) => update("country_of_origin", e.target.value)} /></label>
      <label>UPC<input value={form.upc} onChange={(e) => update("upc", e.target.value)} /></label>
      <label>Stock quantity<input type="number" value={form.stock_qty} onChange={(e) => update("stock_qty", Number(e.target.value))} /></label>
      <label>Badge<input value={form.badges} onChange={(e) => update("badges", e.target.value)} placeholder="New, Bestseller" /></label>
    </div>
    <div className="check-row"><Check label="Show in catalog" value={form.catalog_enabled} set={(value) => update("catalog_enabled", value)} /><Check label="Active product" value={form.is_active} set={(value) => update("is_active", value)} /></div>
    <div className="modal-actions"><button type="button" className="secondary" onClick={close}>Cancel</button><button className="primary">Save product</button></div>
  </form></div>;
}

function ProductImage({ product }: { product: Product }) {
  return product.image_url ? <img src={imageUrl(product.image_url)} alt={product.name} /> : <div className="placeholder">{product.name.trim().charAt(0).toUpperCase() || "U"}</div>;
}

function Check({ label, value, set }: { label: string; value: boolean; set: (value: boolean) => void }) {
  return <label className="check"><input type="checkbox" checked={value} onChange={(event) => set(event.target.checked)} /><span>{label}</span></label>;
}

export default App;
