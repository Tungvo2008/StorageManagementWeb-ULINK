import { useEffect, useMemo, useState } from "react";
import { apiJson, apiUpload, assetUrl } from "../api/client";
import type { Category, Product } from "../types";

type ImageFilter = "all" | "with-image" | "missing-image";
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

export default function ProductImagesPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [query, setQuery] = useState("");
  const [categoryId, setCategoryId] = useState<number | "all">("all");
  const [imageFilter, setImageFilter] = useState<ImageFilter>("all");
  const [busyId, setBusyId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  async function load() {
    setError(null);
    try {
      const [productData, categoryData] = await Promise.all([
        apiJson<Product[]>("/api/v1/products"),
        apiJson<Category[]>("/api/v1/categories"),
      ]);
      setProducts(productData);
      setCategories(categoryData);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const categoryNameById = useMemo(() => new Map(categories.map((item) => [item.id, item.name])), [categories]);

  const filtered = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return products.filter((product) => {
      if (categoryId !== "all" && product.category_id !== categoryId) return false;
      if (imageFilter === "with-image" && !product.image_url) return false;
      if (imageFilter === "missing-image" && product.image_url) return false;
      if (!normalizedQuery) return true;
      return `${product.sku} ${product.name} ${categoryNameById.get(product.category_id ?? -1) ?? ""}`
        .toLowerCase()
        .includes(normalizedQuery);
    });
  }, [products, query, categoryId, imageFilter, categoryNameById]);

  async function onUpload(product: Product, file: File) {
    setError(null);
    setInfo(null);
    if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
      setError("Chỉ hỗ trợ ảnh PNG, JPG, WEBP hoặc GIF.");
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setError("Ảnh quá lớn. Vui lòng chọn ảnh tối đa 10 MB.");
      return;
    }

    setBusyId(product.id);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const updated = await apiUpload<Product>(`/api/v1/products/${product.id}/image`, formData);
      setProducts((current) => current.map((item) => (item.id === updated.id ? updated : item)));
      setInfo(`Đã cập nhật ảnh cho ${updated.sku}.`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  async function onRemove(product: Product) {
    setBusyId(product.id);
    setError(null);
    setInfo(null);
    try {
      const updated = await apiJson<Product>(`/api/v1/products/${product.id}/image`, { method: "DELETE" });
      setProducts((current) => current.map((item) => (item.id === updated.id ? updated : item)));
      setInfo(`Đã xoá ảnh của ${updated.sku}.`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="card">
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <h2 style={{ margin: 0 }}>Product Images</h2>
          <div className="muted" style={{ marginTop: 6 }}>
            Upload ảnh sản phẩm vào hệ thống để dùng ổn định trên POS, invoice và catalogue sau này.
          </div>
        </div>
        <button className="btn" type="button" onClick={() => void load()}>
          Refresh
        </button>
      </div>

      {error ? <div className="error" style={{ marginTop: 12 }}>{error}</div> : null}
      {info ? <div className="muted" style={{ marginTop: 12 }}>{info}</div> : null}

      <div className="tableTools" style={{ marginTop: 16, justifyContent: "flex-start" }}>
        <input
          className="input"
          style={{ minWidth: 260 }}
          placeholder="Search SKU / name / category..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select
          className="input"
          value={categoryId}
          onChange={(e) => setCategoryId(e.target.value === "all" ? "all" : Number(e.target.value))}
          style={{ minWidth: 220 }}
        >
          <option value="all">All categories</option>
          {categories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </select>
        <select
          className="input"
          value={imageFilter}
          onChange={(e) => setImageFilter(e.target.value as ImageFilter)}
          style={{ minWidth: 180 }}
        >
          <option value="all">All products</option>
          <option value="with-image">Có ảnh</option>
          <option value="missing-image">Chưa có ảnh</option>
        </select>
        <div className="pill">{filtered.length} sản phẩm</div>
      </div>

      <div className="imageManagerGrid" style={{ marginTop: 18 }}>
        {filtered.map((product) => {
          const imageSrc = assetUrl(product.image_url);
          const categoryName = product.category_id ? categoryNameById.get(product.category_id) ?? "" : "No category";
          const busy = busyId === product.id;
          return (
            <div className="imageManagerCard" key={product.id}>
              <div className="imageManagerPreview">
                {product.image_url ? (
                  // eslint-disable-next-line jsx-a11y/alt-text
                  <img
                    src={imageSrc}
                    onError={(e) => {
                      e.currentTarget.style.display = "none";
                    }}
                  />
                ) : null}
                <div className="imageManagerFallback">{(product.name || product.sku || "?").slice(0, 1).toUpperCase()}</div>
              </div>
              <div className="imageManagerMeta">
                <div className="imageManagerSku">{product.sku}</div>
                <div className="imageManagerName">{product.name}</div>
                <div className="muted">{categoryName}</div>
              </div>
              <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                <label className="btn" style={{ cursor: busy ? "not-allowed" : "pointer", opacity: busy ? 0.6 : 1 }}>
                  {product.image_url ? "Replace image" : "Upload image"}
                  <input
                    type="file"
                    accept="image/*"
                    style={{ display: "none" }}
                    disabled={busy}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      e.target.value = "";
                      if (file) void onUpload(product, file);
                    }}
                  />
                </label>
                <button className="btn" type="button" disabled={!product.image_url || busy} onClick={() => void onRemove(product)}>
                  Remove
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {!filtered.length ? (
        <div className="muted" style={{ marginTop: 16 }}>
          Không có sản phẩm phù hợp với bộ lọc hiện tại.
        </div>
      ) : null}
    </div>
  );
}
