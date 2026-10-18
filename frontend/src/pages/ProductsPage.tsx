import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { Link } from "react-router-dom";
import { apiJson, apiUpload, assetUrl, downloadFile } from "../api/client";
import type { Category, Product, StockMovement } from "../types";
import Modal from "../components/Modal";
import type { SortState } from "../utils/table";
import { compareValues, matchesQuery, toggleSort } from "../utils/table";

type ProductCreate = {
  sku: string;
  name: string;
  description?: string | null;
  image_url?: string | null;
  category_id?: number | null;
  brand?: string | null;
  catalog_short_name?: string | null;
  unit_size?: string | null;
  catalog_case_pack?: number | null;
  hs_code?: string | null;
  carton_net_weight_kg?: number | null;
  carton_gross_weight_kg?: number | null;
  carton_length_cm?: number | null;
  carton_width_cm?: number | null;
  carton_height_cm?: number | null;
  cartons_per_20ft?: number | null;
  cartons_per_40ft?: number | null;
  country_of_origin?: string | null;
  upc?: string | null;
  catalog_badges?: string | null;
  catalog_enabled?: boolean;
  catalog_sort_order?: number;
  is_sold_on_amazon: boolean;
  amazon_sku?: string | null;
  business_unit?: string;
  base_uom?: string | null;
  uom?: string | null;
  uom_multiplier?: number | null;
  cost_price?: string | null;
  unit_price?: string | null;
  currency?: string | null;
  quantity_on_hand?: number | string | null;
  is_active: boolean;
};

type ProductUpdate = {
  use_sale_uom?: boolean;
  category_id?: number | null;
  sku?: string | null;
  name?: string | null;
  description?: string | null;
  image_url?: string | null;
  brand?: string | null;
  catalog_short_name?: string | null;
  unit_size?: string | null;
  catalog_case_pack?: number | null;
  hs_code?: string | null;
  carton_net_weight_kg?: number | null;
  carton_gross_weight_kg?: number | null;
  carton_length_cm?: number | null;
  carton_width_cm?: number | null;
  carton_height_cm?: number | null;
  cartons_per_20ft?: number | null;
  cartons_per_40ft?: number | null;
  country_of_origin?: string | null;
  upc?: string | null;
  catalog_badges?: string | null;
  catalog_enabled?: boolean | null;
  catalog_sort_order?: number | null;
  is_sold_on_amazon?: boolean | null;
  amazon_sku?: string | null;
  business_unit?: string | null;
  base_uom?: string | null;
  cost_price?: string | null;
  unit_price?: string | null;
  currency?: string | null;
  uom?: string | null;
  uom_multiplier?: number | null;
  is_active?: boolean | null;
};

type StockFilterType = "ALL" | "IN_STOCK" | "LOW_STOCK" | "OUT_OF_STOCK" | "INACTIVE";

function usesSeparateSaleUom(productLike: {
  base_uom?: string | null;
  uom?: string | null;
  uom_multiplier?: number | null;
}): boolean {
  return (productLike.uom_multiplier ?? 1) > 1 || (productLike.uom ?? "").trim() !== (productLike.base_uom ?? "").trim();
}

type QuoteField = "catalog_case_pack" | "hs_code" | "country_of_origin" | "carton_net_weight_kg" | "carton_gross_weight_kg" | "carton_length_cm" | "carton_width_cm" | "carton_height_cm" | "cartons_per_20ft" | "cartons_per_40ft";
type QuoteValues = Partial<Record<QuoteField, number | string | null>>;
const quoteNumberFields: {key: Exclude<QuoteField, "hs_code" | "country_of_origin">; label: string; step: string}[] = [
  {key: "catalog_case_pack", label: "Số đơn vị / thùng", step: "1"},
  {key: "carton_net_weight_kg", label: "Trọng lượng tịnh / thùng (kg)", step: "0.001"},
  {key: "carton_gross_weight_kg", label: "Trọng lượng cả bì / thùng (kg)", step: "0.001"},
  {key: "carton_length_cm", label: "Dài thùng (cm)", step: "0.01"},
  {key: "carton_width_cm", label: "Rộng thùng (cm)", step: "0.01"},
  {key: "carton_height_cm", label: "Cao thùng (cm)", step: "0.01"},
  {key: "cartons_per_20ft", label: "Thùng / container 20 ft", step: "1"},
  {key: "cartons_per_40ft", label: "Thùng / container 40 ft", step: "1"},
];
function QuoteLogisticsFields({value, onChange}: {value: QuoteValues; onChange: (key: QuoteField, next: number | string | null) => void}) {
  const l = Number(value.carton_length_cm), w = Number(value.carton_width_cm), h = Number(value.carton_height_cm);
  const cbm = l > 0 && w > 0 && h > 0 ? (l * w * h / 1_000_000).toFixed(6) : null;
  return <div style={{background: "#f8fafc", padding: 12, borderRadius: 8, border: "1px solid #e2e8f0"}}>
    <strong style={{display: "block", marginBottom: 8, fontSize: 13, color: "#334155"}}>Quy cách xuất hàng & thông số báo giá</strong>
    <p style={{fontSize: 12, color: "#64748b", margin: "0 0 10px"}}>Thông số theo một thùng. CBM được tính tự động từ kích thước thùng; để trống nếu chưa xác nhận.</p>
    <div style={{display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10}}>
      <label style={{fontSize: 12}}>HS code<input value={value.hs_code ?? ""} maxLength={32} onChange={e => onChange("hs_code", e.target.value || null)} style={{width: "100%", padding: "7px 10px", boxSizing: "border-box"}} /></label>
      <label style={{fontSize: 12}}>Xuất xứ<input value={value.country_of_origin ?? ""} maxLength={128} onChange={e => onChange("country_of_origin", e.target.value || null)} style={{width: "100%", padding: "7px 10px", boxSizing: "border-box"}} /></label>
      {quoteNumberFields.map(field => <label key={field.key} style={{fontSize: 12}}>{field.label}<input type="number" min={field.step === "1" ? "1" : "0.001"} step={field.step} value={value[field.key] ?? ""} onChange={e => onChange(field.key, e.target.value === "" ? null : Number(e.target.value))} style={{width: "100%", padding: "7px 10px", boxSizing: "border-box"}} /></label>)}
    </div>
    <div style={{marginTop: 10, fontSize: 12, color: "#475569"}}>CBM / thùng: <strong>{cbm ?? "Chưa đủ kích thước"}</strong></div>
  </div>;
}

export default function ProductsPage() {
  const [items, setItems] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [query, setQuery] = useState("");
  const [stockFilter, setStockFilter] = useState<StockFilterType>("ALL");
  const [businessUnitFilter, setBusinessUnitFilter] = useState<"ALL" | "TOWEL" | "SUPPLY" | "GROCERY">("ALL");
  const [categoryFilter, setCategoryFilter] = useState<number | "ALL">("ALL");

  // Sorting
  const [sort, setSort] = useState<SortState<"sku" | "name" | "unit_price" | "quantity_on_hand" | "is_active">>({
    key: "quantity_on_hand",
    dir: "desc",
  });

  // Quick Adjust Modal State
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [adjustProduct, setAdjustProduct] = useState<Product | null>(null);
  const [adjustTargetQty, setAdjustTargetQty] = useState<number>(0);
  const [adjustNote, setAdjustNote] = useState<string>("");
  const [adjustBusy, setAdjustBusy] = useState(false);
  const [adjustSuccessMsg, setAdjustSuccessMsg] = useState<string | null>(null);

  // History Quick View Modal State
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyProduct, setHistoryProduct] = useState<Product | null>(null);
  const [historyMovements, setHistoryMovements] = useState<StockMovement[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  // Add Product Modal State
  const [addOpen, setAddOpen] = useState(false);
  const [addForm, setAddForm] = useState<ProductCreate>({
    sku: "",
    name: "",
    description: "",
    image_url: "",
    category_id: null,
    brand: "",
    catalog_short_name: "",
    unit_size: "",
    catalog_case_pack: null,
    hs_code: "",
    carton_net_weight_kg: null,
    carton_gross_weight_kg: null,
    carton_length_cm: null,
    carton_width_cm: null,
    carton_height_cm: null,
    cartons_per_20ft: null,
    cartons_per_40ft: null,
    country_of_origin: "",
    upc: "",
    catalog_badges: "",
    catalog_enabled: true,
    catalog_sort_order: 0,
    is_sold_on_amazon: false,
    amazon_sku: "",
    business_unit: "TOWEL",
    base_uom: "Pc",
    uom: "Pc",
    uom_multiplier: 1,
    cost_price: "0",
    unit_price: "0",
    currency: "USD",
    quantity_on_hand: 0,
    is_active: true,
  });
  const [addBusy, setAddBusy] = useState(false);

  // Edit Product Modal State
  const [editOpen, setEditOpen] = useState(false);
  const [editId, setEditId] = useState<number | "">("");
  const [editForm, setEditForm] = useState<ProductUpdate>({});
  const [editBusy, setEditBusy] = useState(false);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imageUploading, setImageUploading] = useState(false);

  // Category Add State
  const [addCategoryOpen, setAddCategoryOpen] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState("");

  // Import / Export Info
  const [importBusy, setImportBusy] = useState(false);
  const [importInfo, setImportInfo] = useState<string | null>(null);

  // Category Lookup Map
  const categoryMap = useMemo(() => {
    const map = new Map<number, string>();
    for (const c of categories) {
      map.set(c.id, c.name);
    }
    return map;
  }, [categories]);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [prodData, catData] = await Promise.all([
        apiJson<Product[]>("/api/v1/products?limit=1000"),
        apiJson<Category[]>("/api/v1/categories?limit=200").catch(() => []),
      ]);
      setItems(prodData);
      setCategories(catData);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  // Compute Statistics for Top Badges
  const stats = useMemo(() => {
    let total = items.length;
    let inStock = 0;
    let lowStock = 0;
    let outOfStock = 0;
    let inactive = 0;

    for (const p of items) {
      if (!p.is_active) {
        inactive++;
        continue;
      }
      const q = p.quantity_on_hand ?? 0;
      if (q > 10) inStock++;
      else if (q > 0 && q <= 10) lowStock++;
      else outOfStock++;
    }

    return { total, inStock, lowStock, outOfStock, inactive };
  }, [items]);

  // Filter Products
  const filteredProducts = useMemo(() => {
    return items.filter((p) => {
      // 1. Business Unit Filter
      if (businessUnitFilter !== "ALL") {
        const bu = (p.business_unit || "TOWEL").toUpperCase();
        if (bu !== businessUnitFilter) return false;
      }

      // 2. Category Filter
      if (categoryFilter !== "ALL" && p.category_id !== categoryFilter) {
        return false;
      }

      // 3. Stock Status Tab Filter
      const q = p.quantity_on_hand ?? 0;
      if (stockFilter === "IN_STOCK") {
        if (!p.is_active || q <= 10) return false;
      } else if (stockFilter === "LOW_STOCK") {
        if (!p.is_active || q <= 0 || q > 10) return false;
      } else if (stockFilter === "OUT_OF_STOCK") {
        if (!p.is_active || q > 0) return false;
      } else if (stockFilter === "INACTIVE") {
        if (p.is_active) return false;
      }

      // 4. Search Query Filter
      if (query.trim()) {
        const catName = p.category_id ? categoryMap.get(p.category_id) || "" : "";
        const match = matchesQuery(
          query,
          p.sku,
          p.name,
          p.upc || "",
          p.amazon_sku || "",
          catName,
          p.brand || "",
          p.business_unit || ""
        );
        if (!match) return false;
      }

      return true;
    });
  }, [items, businessUnitFilter, categoryFilter, stockFilter, query, categoryMap]);

  // Sort Products
  const sortedProducts = useMemo(() => {
    const list = [...filteredProducts];
    list.sort((a, b) => {
      let av: string | number = 0;
      let bv: string | number = 0;

      switch (sort.key) {
        case "sku":
          av = a.sku;
          bv = b.sku;
          break;
        case "name":
          av = a.name;
          bv = b.name;
          break;
        case "unit_price":
          av = Number(a.unit_price || 0);
          bv = Number(b.unit_price || 0);
          break;
        case "quantity_on_hand":
          av = a.quantity_on_hand ?? 0;
          bv = b.quantity_on_hand ?? 0;
          break;
        case "is_active":
          av = a.is_active ? 1 : 0;
          bv = b.is_active ? 1 : 0;
          break;
      }

      const res = compareValues(av, bv);
      return sort.dir === "asc" ? res : -res;
    });
    return list;
  }, [filteredProducts, sort]);

  // Quick Adjust Handlers
  function openQuickAdjust(p: Product) {
    setAdjustProduct(p);
    setAdjustTargetQty(p.quantity_on_hand ?? 0);
    setAdjustNote("");
    setAdjustSuccessMsg(null);
    setAdjustOpen(true);
  }

  async function submitQuickAdjust(e: FormEvent) {
    e.preventDefault();
    if (!adjustProduct) return;
    setAdjustBusy(true);
    setAdjustSuccessMsg(null);
    try {
      const updated = await apiJson<Product>(
        `/api/v1/inventory/products/${adjustProduct.id}/stock`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            quantity_on_hand: Number(adjustTargetQty),
            note: adjustNote || "Kiểm kê điều chỉnh tức thời tại giao diện Sản Phẩm & Tồn Kho",
          }),
        }
      );

      setItems((prev) =>
        prev.map((item) => (item.id === updated.id ? { ...item, ...updated } : item))
      );
      setAdjustSuccessMsg("✅ Cập nhật số lượng tồn thành công!");
      setTimeout(() => {
        setAdjustOpen(false);
      }, 700);
    } catch (err) {
      alert(`Lỗi: ${(err as Error).message}`);
    } finally {
      setAdjustBusy(false);
    }
  }

  // Quick Movement History
  async function openQuickHistory(p: Product) {
    setHistoryProduct(p);
    setHistoryOpen(true);
    setHistoryLoading(true);
    try {
      const movements = await apiJson<StockMovement[]>(
        `/api/v1/inventory/movements?product_id=${p.id}&limit=20`
      );
      setHistoryMovements(movements);
    } catch {
      setHistoryMovements([]);
    } finally {
      setHistoryLoading(false);
    }
  }

  // Open Edit Product
  function openEdit(p: Product) {
    setEditId(p.id);
    setImageFile(null);
    setEditForm({
      category_id: p.category_id,
      use_sale_uom: usesSeparateSaleUom(p),
      sku: p.sku,
      name: p.name,
      description: p.description ?? "",
      image_url: p.image_url ?? "",
      brand: p.brand,
      catalog_short_name: p.catalog_short_name,
      unit_size: p.unit_size,
      catalog_case_pack: p.catalog_case_pack,
      hs_code: p.hs_code,
      carton_net_weight_kg: p.carton_net_weight_kg,
      carton_gross_weight_kg: p.carton_gross_weight_kg,
      carton_length_cm: p.carton_length_cm,
      carton_width_cm: p.carton_width_cm,
      carton_height_cm: p.carton_height_cm,
      cartons_per_20ft: p.cartons_per_20ft,
      cartons_per_40ft: p.cartons_per_40ft,
      country_of_origin: p.country_of_origin,
      upc: p.upc,
      catalog_badges: p.catalog_badges,
      catalog_enabled: p.catalog_enabled,
      catalog_sort_order: p.catalog_sort_order,
      is_sold_on_amazon: p.is_sold_on_amazon,
      amazon_sku: p.amazon_sku,
      business_unit: p.business_unit || "TOWEL",
      base_uom: p.base_uom || "Pc",
      cost_price: p.cost_price ?? "0",
      unit_price: p.unit_price ?? "0",
      currency: p.currency || "USD",
      uom: p.uom || "Pc",
      uom_multiplier: p.uom_multiplier ?? 1,
      is_active: p.is_active,
    });
    setEditOpen(true);
  }

  // Save Edit Product
  async function submitEdit(e: FormEvent) {
    e.preventDefault();
    if (editId === "") return;
    setEditBusy(true);
    setError(null);
    try {
      const useSaleUom = editForm.use_sale_uom ?? usesSeparateSaleUom(editForm);
      const payload = {
        ...editForm,
        sku: editForm.sku?.trim() ?? null,
        name: editForm.name?.trim() ?? null,
        description: editForm.description !== undefined ? editForm.description?.trim() || null : undefined,
        image_url: editForm.image_url !== undefined ? editForm.image_url?.trim() || null : undefined,
        amazon_sku: editForm.is_sold_on_amazon ? editForm.amazon_sku?.trim() || null : null,
        business_unit: editForm.business_unit ? editForm.business_unit.trim().toUpperCase() : undefined,
        base_uom: editForm.base_uom?.trim() || "Pc",
        uom: useSaleUom ? editForm.uom?.trim() || editForm.base_uom?.trim() || "Pc" : editForm.base_uom?.trim() || "Pc",
        uom_multiplier: useSaleUom ? Math.max(Number(editForm.uom_multiplier ?? 1), 2) : 1,
        cost_price: editForm.cost_price !== undefined ? String(editForm.cost_price).trim() : undefined,
        unit_price: editForm.unit_price !== undefined ? String(editForm.unit_price).trim() : undefined,
      };

      const updated = await apiJson<Product>(`/api/v1/products/${editId}`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      });

      // Upload image if selected
      if (imageFile) {
        setImageUploading(true);
        const form = new FormData();
        form.append("file", imageFile);
        const res = await apiUpload<{ image_url: string }>(`/api/v1/products/${editId}/image`, form);
        updated.image_url = res.image_url;
      }

      setItems((prev) => prev.map((item) => (item.id === updated.id ? { ...item, ...updated } : item)));
      setEditOpen(false);
    } catch (err) {
      alert(`Lỗi cập nhật: ${(err as Error).message}`);
    } finally {
      setEditBusy(false);
      setImageUploading(false);
    }
  }

  // Create Product
  async function submitAdd(e: FormEvent) {
    e.preventDefault();
    setAddBusy(true);
    try {
      const created = await apiJson<Product>("/api/v1/products", {
        method: "POST",
        body: JSON.stringify(addForm),
      });
      setItems((prev) => [created, ...prev]);
      setAddOpen(false);
    } catch (err) {
      alert(`Lỗi tạo sản phẩm: ${(err as Error).message}`);
    } finally {
      setAddBusy(false);
    }
  }

  // Create Category
  async function submitAddCategory(e: FormEvent) {
    e.preventDefault();
    if (!newCategoryName.trim()) return;
    try {
      const created = await apiJson<Category>("/api/v1/categories", {
        method: "POST",
        body: JSON.stringify({ name: newCategoryName.trim() }),
      });
      setCategories((prev) => [...prev, created]);
      setNewCategoryName("");
      setAddCategoryOpen(false);
    } catch (err) {
      alert(`Lỗi tạo danh mục: ${(err as Error).message}`);
    }
  }

  // Import Excel
  async function onImportProducts(file: File) {
    setImportBusy(true);
    setImportInfo(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await apiUpload<{ created: number; updated: number }>("/api/v1/products/import", form);
      setImportInfo(`Đã nhập xong: ${res.created} mới, ${res.updated} cập nhật.`);
      await load();
    } catch (err) {
      alert(`Lỗi import: ${(err as Error).message}`);
    } finally {
      setImportBusy(false);
    }
  }

  return (
    <div style={{ maxWidth: 1440, margin: "0 auto", padding: "16px 20px" }}>
      {/* 1. Header Section: Title & Primary Actions */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 16,
          marginBottom: 20,
        }}
      >
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0, color: "#0f172a", letterSpacing: "-0.02em" }}>
            Sản Phẩm & Tồn Kho
          </h1>
          <p style={{ margin: "4px 0 0", color: "#64748b", fontSize: 14 }}>
            Quản lý tập trung toàn bộ danh mục mặt hàng, đơn giá và số lượng tồn kho vật lý tức thời.
          </p>
        </div>

        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <button
            type="button"
            className="btn"
            style={{ fontSize: 13, display: "flex", alignItems: "center", gap: 5 }}
            onClick={() => void downloadFile("/api/v1/products/export.xlsx", "products-export.xlsx")}
          >
            <span>📥</span> Xuất Excel
          </button>

          <label
            className="btn"
            style={{
              fontSize: 13,
              cursor: importBusy ? "not-allowed" : "pointer",
              opacity: importBusy ? 0.6 : 1,
              display: "flex",
              alignItems: "center",
              gap: 5,
            }}
          >
            <span>📤</span> Import Excel
            <input
              type="file"
              accept=".xlsx"
              style={{ display: "none" }}
              disabled={importBusy}
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file) void onImportProducts(file);
              }}
            />
          </label>

          <button
            type="button"
            className="btn"
            style={{ fontSize: 13, display: "flex", alignItems: "center", gap: 5 }}
            onClick={() => setAddCategoryOpen(true)}
          >
            <span>📁</span> + Danh Mục
          </button>

          <button
            type="button"
            style={{
              background: "#0f172a",
              color: "white",
              border: "1px solid #0f172a",
              borderRadius: 8,
              padding: "8px 16px",
              fontWeight: 600,
              fontSize: 13,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: 6,
              boxShadow: "0 1px 2px 0 rgba(0, 0, 0, 0.05)",
            }}
            onClick={() => setAddOpen(true)}
          >
            <span style={{ fontSize: 15, lineHeight: 1 }}>+</span> Thêm Sản Phẩm
          </button>
        </div>
      </div>

      {importInfo && (
        <div style={{ marginBottom: 14, padding: "10px 14px", background: "#f0fdf4", border: "1px solid #bbf7d0", color: "#166534", borderRadius: 8, fontSize: 13 }}>
          {importInfo}
        </div>
      )}

      {error && (
        <div style={{ marginBottom: 14, padding: "10px 14px", background: "#fef2f2", border: "1px solid #fecaca", color: "#991b1b", borderRadius: 8, fontSize: 13 }}>
          {error}
        </div>
      )}

      {/* 2. Main Shopify-Style Card Container */}
      <div
        style={{
          background: "white",
          borderRadius: 12,
          border: "1px solid #e2e8f0",
          boxShadow: "0 1px 3px 0 rgba(0, 0, 0, 0.05), 0 1px 2px -1px rgba(0, 0, 0, 0.05)",
          overflow: "hidden",
        }}
      >
        {/* Filter Tabs Bar (Shopify Style) */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 4,
            padding: "8px 16px",
            borderBottom: "1px solid #f1f5f9",
            overflowX: "auto",
            background: "#fafafa",
          }}
        >
          <button
            type="button"
            onClick={() => setStockFilter("ALL")}
            style={{
              padding: "6px 14px",
              borderRadius: 8,
              border: "none",
              fontSize: 13,
              fontWeight: stockFilter === "ALL" ? 600 : 500,
              cursor: "pointer",
              background: stockFilter === "ALL" ? "#0f172a" : "transparent",
              color: stockFilter === "ALL" ? "white" : "#64748b",
              display: "flex",
              alignItems: "center",
              gap: 6,
              transition: "all 0.15s ease",
            }}
          >
            Tất cả
            <span
              style={{
                fontSize: 11,
                padding: "2px 6px",
                borderRadius: 9999,
                background: stockFilter === "ALL" ? "rgba(255,255,255,0.2)" : "#e2e8f0",
                color: stockFilter === "ALL" ? "white" : "#475569",
              }}
            >
              {stats.total}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setStockFilter("IN_STOCK")}
            style={{
              padding: "6px 14px",
              borderRadius: 8,
              border: "none",
              fontSize: 13,
              fontWeight: stockFilter === "IN_STOCK" ? 600 : 500,
              cursor: "pointer",
              background: stockFilter === "IN_STOCK" ? "#0f172a" : "transparent",
              color: stockFilter === "IN_STOCK" ? "white" : "#64748b",
              display: "flex",
              alignItems: "center",
              gap: 6,
              transition: "all 0.15s ease",
            }}
          >
            Còn hàng
            <span
              style={{
                fontSize: 11,
                padding: "2px 6px",
                borderRadius: 9999,
                background: stockFilter === "IN_STOCK" ? "rgba(255,255,255,0.2)" : "#dcfce7",
                color: stockFilter === "IN_STOCK" ? "white" : "#166534",
              }}
            >
              {stats.inStock}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setStockFilter("LOW_STOCK")}
            style={{
              padding: "6px 14px",
              borderRadius: 8,
              border: "none",
              fontSize: 13,
              fontWeight: stockFilter === "LOW_STOCK" ? 600 : 500,
              cursor: "pointer",
              background: stockFilter === "LOW_STOCK" ? "#0f172a" : "transparent",
              color: stockFilter === "LOW_STOCK" ? "white" : "#64748b",
              display: "flex",
              alignItems: "center",
              gap: 6,
              transition: "all 0.15s ease",
            }}
          >
            Sắp hết hàng (≤10)
            <span
              style={{
                fontSize: 11,
                padding: "2px 6px",
                borderRadius: 9999,
                background: stockFilter === "LOW_STOCK" ? "rgba(255,255,255,0.2)" : "#fef3c7",
                color: stockFilter === "LOW_STOCK" ? "white" : "#92400e",
              }}
            >
              {stats.lowStock}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setStockFilter("OUT_OF_STOCK")}
            style={{
              padding: "6px 14px",
              borderRadius: 8,
              border: "none",
              fontSize: 13,
              fontWeight: stockFilter === "OUT_OF_STOCK" ? 600 : 500,
              cursor: "pointer",
              background: stockFilter === "OUT_OF_STOCK" ? "#0f172a" : "transparent",
              color: stockFilter === "OUT_OF_STOCK" ? "white" : "#64748b",
              display: "flex",
              alignItems: "center",
              gap: 6,
              transition: "all 0.15s ease",
            }}
          >
            Hết hàng (=0)
            <span
              style={{
                fontSize: 11,
                padding: "2px 6px",
                borderRadius: 9999,
                background: stockFilter === "OUT_OF_STOCK" ? "rgba(255,255,255,0.2)" : "#fee2e2",
                color: stockFilter === "OUT_OF_STOCK" ? "white" : "#991b1b",
              }}
            >
              {stats.outOfStock}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setStockFilter("INACTIVE")}
            style={{
              padding: "6px 14px",
              borderRadius: 8,
              border: "none",
              fontSize: 13,
              fontWeight: stockFilter === "INACTIVE" ? 600 : 500,
              cursor: "pointer",
              background: stockFilter === "INACTIVE" ? "#0f172a" : "transparent",
              color: stockFilter === "INACTIVE" ? "white" : "#64748b",
              display: "flex",
              alignItems: "center",
              gap: 6,
              transition: "all 0.15s ease",
            }}
          >
            Ngừng bán
            <span
              style={{
                fontSize: 11,
                padding: "2px 6px",
                borderRadius: 9999,
                background: stockFilter === "INACTIVE" ? "rgba(255,255,255,0.2)" : "#e2e8f0",
                color: stockFilter === "INACTIVE" ? "white" : "#475569",
              }}
            >
              {stats.inactive}
            </span>
          </button>
        </div>

        {/* Search & Select Filters Row */}
        <div
          style={{
            padding: "12px 16px",
            borderBottom: "1px solid #f1f5f9",
            display: "flex",
            gap: 12,
            alignItems: "center",
            flexWrap: "wrap",
            background: "white",
          }}
        >
          {/* Search Box */}
          <div style={{ position: "relative", flex: 1, minWidth: 260 }}>
            <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "#94a3b8", fontSize: 14 }}>
              🔍
            </span>
            <input
              type="text"
              placeholder="Tìm theo mã SKU, tên sản phẩm, barcode, Amazon SKU..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              style={{
                width: "100%",
                padding: "8px 12px 8px 34px",
                borderRadius: 8,
                border: "1px solid #cbd5e1",
                fontSize: 13,
                outline: "none",
                boxSizing: "border-box",
              }}
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                style={{
                  position: "absolute",
                  right: 10,
                  top: "50%",
                  transform: "translateY(-50%)",
                  background: "transparent",
                  border: "none",
                  cursor: "pointer",
                  color: "#94a3b8",
                  fontSize: 14,
                }}
              >
                ✕
              </button>
            )}
          </div>

          {/* Sector / Business Unit Filter */}
          <select
            value={businessUnitFilter}
            onChange={(e) => setBusinessUnitFilter(e.target.value as "ALL" | "TOWEL" | "SUPPLY" | "GROCERY")}
            style={{
              padding: "8px 12px",
              borderRadius: 8,
              border: "1px solid #cbd5e1",
              fontSize: 13,
              background: "white",
              color: "#334155",
            }}
          >
            <option value="ALL">🌐 Tất cả ngành hàng</option>
            <option value="TOWEL">🧺 Khăn (The Towels Haven)</option>
            <option value="SUPPLY">💅 Nail Supply</option>
            <option value="GROCERY">🍿 Bách Hóa / Ăn Vặt</option>
          </select>

          {/* Category Filter */}
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value === "ALL" ? "ALL" : Number(e.target.value))}
            style={{
              padding: "8px 12px",
              borderRadius: 8,
              border: "1px solid #cbd5e1",
              fontSize: 13,
              background: "white",
              color: "#334155",
            }}
          >
            <option value="ALL">📁 Tất cả danh mục</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>

          {/* Reset button if active */}
          {(query || businessUnitFilter !== "ALL" || categoryFilter !== "ALL" || stockFilter !== "ALL") && (
            <button
              type="button"
              onClick={() => {
                setQuery("");
                setBusinessUnitFilter("ALL");
                setCategoryFilter("ALL");
                setStockFilter("ALL");
              }}
              style={{
                background: "transparent",
                border: "none",
                color: "#64748b",
                fontSize: 13,
                cursor: "pointer",
                padding: "6px 10px",
                textDecoration: "underline",
              }}
            >
              Đặt lại bộ lọc
            </button>
          )}

          <div style={{ marginLeft: "auto", fontSize: 13, color: "#64748b", fontWeight: 500 }}>
            Hiển thị <strong>{sortedProducts.length}</strong> / {items.length} mặt hàng
          </div>
        </div>

        {/* Table Content */}
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left", fontSize: 13 }}>
            <thead>
              <tr style={{ background: "#f8fafc", borderBottom: "1px solid #e2e8f0", color: "#475569", fontWeight: 600 }}>
                <th style={{ padding: "12px 16px", minWidth: 280 }}>
                  <button
                    type="button"
                    onClick={() => setSort((s) => toggleSort(s, "name"))}
                    style={{ background: "none", border: "none", fontWeight: 600, color: "inherit", cursor: "pointer", padding: 0 }}
                  >
                    Sản phẩm {sort.key === "name" ? (sort.dir === "asc" ? "▲" : "▼") : ""}
                  </button>
                </th>
                <th style={{ padding: "12px 14px", width: 140 }}>
                  <button
                    type="button"
                    onClick={() => setSort((s) => toggleSort(s, "sku"))}
                    style={{ background: "none", border: "none", fontWeight: 600, color: "inherit", cursor: "pointer", padding: 0 }}
                  >
                    Mã SKU {sort.key === "sku" ? (sort.dir === "asc" ? "▲" : "▼") : ""}
                  </button>
                </th>
                <th style={{ padding: "12px 14px", width: 130 }}>
                  <button
                    type="button"
                    onClick={() => setSort((s) => toggleSort(s, "is_active"))}
                    style={{ background: "none", border: "none", fontWeight: 600, color: "inherit", cursor: "pointer", padding: 0 }}
                  >
                    Trạng thái {sort.key === "is_active" ? (sort.dir === "asc" ? "▲" : "▼") : ""}
                  </button>
                </th>
                <th style={{ padding: "12px 16px", width: 220, textAlign: "right" }}>
                  <button
                    type="button"
                    onClick={() => setSort((s) => toggleSort(s, "quantity_on_hand"))}
                    style={{ background: "none", border: "none", fontWeight: 600, color: "inherit", cursor: "pointer", padding: 0 }}
                  >
                    Tồn kho vật lý {sort.key === "quantity_on_hand" ? (sort.dir === "asc" ? "▲" : "▼") : ""}
                  </button>
                </th>
                <th style={{ padding: "12px 14px", minWidth: 160 }}>Danh mục</th>
                <th style={{ padding: "12px 14px", width: 110, textAlign: "right" }}>
                  <button
                    type="button"
                    onClick={() => setSort((s) => toggleSort(s, "unit_price"))}
                    style={{ background: "none", border: "none", fontWeight: 600, color: "inherit", cursor: "pointer", padding: 0 }}
                  >
                    Giá bán {sort.key === "unit_price" ? (sort.dir === "asc" ? "▲" : "▼") : ""}
                  </button>
                </th>
                <th style={{ padding: "12px 16px", width: 130, textAlign: "center" }}>Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={7} style={{ padding: 40, textAlign: "center", color: "#64748b" }}>
                    Đang tải dữ liệu sản phẩm & tồn kho...
                  </td>
                </tr>
              ) : sortedProducts.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ padding: 40, textAlign: "center", color: "#64748b" }}>
                    Không tìm thấy sản phẩm nào phù hợp với bộ lọc.
                  </td>
                </tr>
              ) : (
                sortedProducts.map((p) => {
                  const q = p.quantity_on_hand ?? 0;
                  const catName = p.category_id ? categoryMap.get(p.category_id) : null;
                  const hasUomMult = (p.uom_multiplier ?? 1) > 1;
                  const uomBoxes = hasUomMult ? (q / (p.uom_multiplier ?? 1)).toFixed(1) : null;

                  return (
                    <tr
                      key={p.id}
                      style={{
                        borderBottom: "1px solid #f1f5f9",
                        transition: "background 0.15s ease",
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = "#f8fafc")}
                      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                    >
                      {/* 1. Product Cell: Image + Name + Amazon info */}
                      <td style={{ padding: "10px 16px" }}>
                        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                          {/* Thumbnail */}
                          <div
                            style={{
                              width: 44,
                              height: 44,
                              borderRadius: 8,
                              background: "#f1f5f9",
                              border: "1px solid #e2e8f0",
                              overflow: "hidden",
                              flexShrink: 0,
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                            }}
                          >
                            {p.image_url ? (
                              <img
                                src={assetUrl(p.image_url)}
                                alt={p.name}
                                style={{ width: "100%", height: "100%", objectFit: "cover" }}
                                onError={(e) => {
                                  e.currentTarget.style.display = "none";
                                }}
                              />
                            ) : (
                              <span style={{ fontSize: 16, fontWeight: 700, color: "#94a3b8" }}>
                                {(p.name || p.sku || "?").slice(0, 1).toUpperCase()}
                              </span>
                            )}
                          </div>

                          {/* Titles */}
                          <div style={{ minWidth: 0 }}>
                            <div
                              onClick={() => openEdit(p)}
                              style={{
                                fontWeight: 600,
                                color: "#0f172a",
                                fontSize: 13,
                                cursor: "pointer",
                                lineHeight: 1.3,
                              }}
                              title="Bấm để sửa thông tin sản phẩm"
                            >
                              {p.name}
                            </div>
                            <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 2, flexWrap: "wrap" }}>
                              {p.unit_size && (
                                <span
                                  style={{
                                    fontSize: 11,
                                    padding: "1px 6px",
                                    borderRadius: 4,
                                    background: "#e0e7ff",
                                    color: "#3730a3",
                                    fontWeight: 700,
                                  }}
                                >
                                  ⚖️ {p.unit_size}
                                </span>
                              )}
                              {p.is_sold_on_amazon && (
                                <span
                                  style={{
                                    fontSize: 10,
                                    padding: "1px 5px",
                                    borderRadius: 4,
                                    background: "#ffedd5",
                                    color: "#9a3412",
                                    fontWeight: 600,
                                  }}
                                >
                                  Amazon FBA {p.amazon_sku ? `(${p.amazon_sku})` : ""}
                                </span>
                              )}
                              {p.upc && (
                                <span style={{ fontSize: 11, color: "#94a3b8", fontFamily: "monospace" }}>
                                  UPC: {p.upc}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      </td>

                      {/* 2. SKU Cell */}
                      <td style={{ padding: "10px 14px", fontFamily: "monospace", fontSize: 12, color: "#475569", fontWeight: 600 }}>
                        {p.sku}
                      </td>

                      {/* 3. Status Pill (Shopify Style) */}
                      <td style={{ padding: "10px 14px" }}>
                        {p.is_active ? (
                          <span
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 5,
                              padding: "3px 9px",
                              borderRadius: 9999,
                              fontSize: 12,
                              fontWeight: 600,
                              background: "#def7ec",
                              color: "#03543f",
                              border: "1px solid #bcf0da",
                            }}
                          >
                            <span style={{ fontSize: 8 }}>●</span> Đang bán
                          </span>
                        ) : (
                          <span
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 5,
                              padding: "3px 9px",
                              borderRadius: 9999,
                              fontSize: 12,
                              fontWeight: 500,
                              background: "#f3f4f6",
                              color: "#4b5563",
                              border: "1px solid #e5e7eb",
                            }}
                          >
                            <span style={{ fontSize: 8 }}>○</span> Ngừng bán
                          </span>
                        )}
                      </td>

                      {/* 4. Inventory Cell (Quantity + Quick Adjust Pencil) */}
                      <td style={{ padding: "10px 16px", textAlign: "right" }}>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 8 }}>
                          <div>
                            <div
                              style={{
                                fontWeight: 700,
                                fontSize: 14,
                                color: q > 10 ? "#16a34a" : q > 0 ? "#d97706" : "#dc2626",
                              }}
                            >
                              {q} {p.base_uom || "cái"}
                            </div>
                            {hasUomMult && uomBoxes && (
                              <div style={{ fontSize: 11, color: "#64748b" }}>
                                ≈ {uomBoxes} {p.uom || "thùng"} (x{p.uom_multiplier})
                              </div>
                            )}
                          </div>

                          {/* Quick Adjust Pencil Button */}
                          <button
                            type="button"
                            onClick={() => openQuickAdjust(p)}
                            title="Sửa nhanh số lượng tồn kho"
                            style={{
                              background: "#f1f5f9",
                              border: "1px solid #cbd5e1",
                              borderRadius: 6,
                              padding: "4px 7px",
                              cursor: "pointer",
                              fontSize: 12,
                              lineHeight: 1,
                              transition: "all 0.1s ease",
                            }}
                            onMouseEnter={(e) => (e.currentTarget.style.background = "#e2e8f0")}
                            onMouseLeave={(e) => (e.currentTarget.style.background = "#f1f5f9")}
                          >
                            ✏️
                          </button>
                        </div>
                      </td>

                      {/* 5. Category Cell */}
                      <td style={{ padding: "10px 14px" }}>
                        <div style={{ display: "flex", gap: 5, flexWrap: "wrap", alignItems: "center" }}>
                          <span
                            style={{
                              fontSize: 11,
                              fontWeight: 600,
                              padding: "2px 7px",
                              borderRadius: 4,
                              background:
                                (p.business_unit || "TOWEL") === "TOWEL"
                                  ? "#eff6ff"
                                  : (p.business_unit || "TOWEL") === "SUPPLY"
                                  ? "#faf5ff"
                                  : "#fffbeb",
                              color:
                                (p.business_unit || "TOWEL") === "TOWEL"
                                  ? "#1e40af"
                                  : (p.business_unit || "TOWEL") === "SUPPLY"
                                  ? "#7e22ce"
                                  : "#b45309",
                            }}
                          >
                            {(p.business_unit || "TOWEL") === "TOWEL"
                              ? "🧺 Khăn"
                              : (p.business_unit || "TOWEL") === "SUPPLY"
                              ? "💅 Supply"
                              : "🍿 Ăn vặt"}
                          </span>
                          {catName && (
                            <span style={{ fontSize: 12, color: "#475569" }}>
                              {catName}
                            </span>
                          )}
                        </div>
                      </td>

                      {/* 6. Price Cell */}
                      <td style={{ padding: "10px 14px", textAlign: "right", fontWeight: 700, color: "#0f172a" }}>
                        ${Number(p.unit_price || 0).toFixed(2)}
                      </td>

                      {/* 7. Action Buttons */}
                      <td style={{ padding: "10px 16px", textAlign: "center" }}>
                        <div style={{ display: "flex", gap: 6, justifyContent: "center" }}>
                          <button
                            type="button"
                            onClick={() => openEdit(p)}
                            style={{
                              padding: "5px 10px",
                              borderRadius: 6,
                              fontSize: 12,
                              fontWeight: 600,
                              cursor: "pointer",
                              background: "#f8fafc",
                              border: "1px solid #cbd5e1",
                              color: "#0f172a",
                            }}
                          >
                            Sửa SP
                          </button>
                          <button
                            type="button"
                            onClick={() => openQuickHistory(p)}
                            title="Xem lịch sử xuất/nhập gần nhất"
                            style={{
                              padding: "5px 8px",
                              borderRadius: 6,
                              fontSize: 12,
                              cursor: "pointer",
                              background: "transparent",
                              border: "1px solid transparent",
                              color: "#64748b",
                            }}
                          >
                            📜
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal 1: Quick Adjust Stock Modal */}
      <Modal open={adjustOpen} title="Điều chỉnh tồn kho kiểm kê" onClose={() => setAdjustOpen(false)}>
        {adjustSuccessMsg && (
          <div style={{ marginBottom: 12, padding: "8px 12px", background: "#f0fdf4", color: "#166534", borderRadius: 6, fontWeight: 600, fontSize: 13 }}>
            {adjustSuccessMsg}
          </div>
        )}
        <form onSubmit={submitQuickAdjust} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div>
            <div style={{ fontSize: 13, color: "#64748b" }}>Sản phẩm:</div>
            <div style={{ fontSize: 15, fontWeight: 700, color: "#0f172a" }}>
              {adjustProduct?.name} ({adjustProduct?.sku})
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div style={{ background: "#f8fafc", padding: 12, borderRadius: 8, border: "1px solid #e2e8f0" }}>
              <div style={{ fontSize: 12, color: "#64748b", marginBottom: 4 }}>Tồn kho hiện tại:</div>
              <div style={{ fontSize: 20, fontWeight: 700, color: "#334155" }}>
                {adjustProduct?.quantity_on_hand ?? 0} {adjustProduct?.base_uom || "cái"}
              </div>
            </div>

            <div style={{ background: "#f0fdf4", padding: 12, borderRadius: 8, border: "1px solid #bbf7d0" }}>
              <div style={{ fontSize: 12, color: "#166534", marginBottom: 4 }}>Số lượng thực tế mới:</div>
              <input
                type="number"
                value={adjustTargetQty}
                onChange={(e) => setAdjustTargetQty(Number(e.target.value))}
                required
                style={{
                  width: "100%",
                  fontSize: 18,
                  fontWeight: 700,
                  padding: "6px 10px",
                  borderRadius: 6,
                  border: "1px solid #86efac",
                  boxSizing: "border-box",
                }}
              />
            </div>
          </div>

          {/* Delta calculation */}
          {adjustProduct && (
            <div style={{ fontSize: 13, color: "#475569" }}>
              Chênh lệch biến động:{" "}
              <strong
                style={{
                  color:
                    adjustTargetQty - (adjustProduct.quantity_on_hand ?? 0) >= 0 ? "#16a34a" : "#dc2626",
                }}
              >
                {adjustTargetQty - (adjustProduct.quantity_on_hand ?? 0) >= 0 ? "+" : ""}
                {adjustTargetQty - (adjustProduct.quantity_on_hand ?? 0)} {adjustProduct.base_uom || "cái"}
              </strong>
            </div>
          )}

          <div>
            <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "#334155", marginBottom: 4 }}>
              Lý do điều chỉnh / Ghi chú kiểm kê:
            </label>
            <input
              type="text"
              value={adjustNote}
              onChange={(e) => setAdjustNote(e.target.value)}
              placeholder="VD: Kiểm đếm cuối tuần, hàng rách bao bì, hao hụt thực tế..."
              style={{
                width: "100%",
                padding: "8px 12px",
                borderRadius: 8,
                border: "1px solid #cbd5e1",
                fontSize: 13,
                boxSizing: "border-box",
              }}
            />
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 10 }}>
            <button
              type="button"
              className="btn"
              onClick={() => setAdjustOpen(false)}
              disabled={adjustBusy}
            >
              Hủy
            </button>
            <button
              type="submit"
              className="btn primary"
              disabled={adjustBusy}
              style={{ fontWeight: 600 }}
            >
              {adjustBusy ? "Đang lưu..." : "Xác Nhận Lưu Tồn Kho"}
            </button>
          </div>
        </form>
      </Modal>

      {/* Modal 2: Quick History Drawer */}
      <Modal open={historyOpen} title={`Lịch sử xuất nhập: ${historyProduct?.sku}`} onClose={() => setHistoryOpen(false)}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 12, color: "#0f172a" }}>
            {historyProduct?.name}
          </div>
          {historyLoading ? (
            <div style={{ padding: 20, textAlign: "center", color: "#64748b" }}>Đang tải lịch sử...</div>
          ) : historyMovements.length === 0 ? (
            <div style={{ padding: 20, textAlign: "center", color: "#64748b" }}>Chưa có biến động kho nào cho sản phẩm này.</div>
          ) : (
            <div style={{ maxHeight: 400, overflowY: "auto" }}>
              <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ background: "#f8fafc", borderBottom: "1px solid #e2e8f0" }}>
                    <th style={{ padding: "6px 8px" }}>Thời gian</th>
                    <th style={{ padding: "6px 8px" }}>Loại</th>
                    <th style={{ padding: "6px 8px", textAlign: "right" }}>Biến động</th>
                    <th style={{ padding: "6px 8px" }}>Chứng từ / Ghi chú</th>
                  </tr>
                </thead>
                <tbody>
                  {historyMovements.map((m) => (
                    <tr key={m.id} style={{ borderBottom: "1px solid #f1f5f9" }}>
                      <td style={{ padding: "6px 8px", color: "#64748b" }}>
                        {new Date(m.created_at).toLocaleDateString("vi-VN", { hour: "2-digit", minute: "2-digit" })}
                      </td>
                      <td style={{ padding: "6px 8px" }}>
                        <span
                          style={{
                            padding: "1px 6px",
                            borderRadius: 4,
                            fontSize: 10,
                            fontWeight: 600,
                            background: m.movement_type === "IN" ? "#dcfce7" : m.movement_type === "OUT" ? "#fee2e2" : "#fef3c7",
                            color: m.movement_type === "IN" ? "#166534" : m.movement_type === "OUT" ? "#991b1b" : "#92400e",
                          }}
                        >
                          {m.movement_type}
                        </span>
                      </td>
                      <td
                        style={{
                          padding: "6px 8px",
                          textAlign: "right",
                          fontWeight: 700,
                          color: (m.quantity_delta ?? 0) > 0 ? "#16a34a" : "#dc2626",
                        }}
                      >
                        {(m.quantity_delta ?? 0) > 0 ? `+${m.quantity_delta}` : m.quantity_delta}
                      </td>
                      <td style={{ padding: "6px 8px", color: "#64748b" }}>
                        {m.note || (m.receipt_id ? `Phiếu nhập #${m.receipt_id}` : m.issue_id ? `Phiếu xuất #${m.issue_id}` : m.invoice_id ? `Hóa đơn #${m.invoice_id}` : "—")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </Modal>

      {/* Modal 3: Edit Product Modal */}
      <Modal open={editOpen} title={`Sửa thông tin: ${editForm.sku || ""}`} onClose={() => setEditOpen(false)}>
        <form onSubmit={submitEdit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {/* Group 1: General Info */}
          <div style={{ background: "#f8fafc", padding: 12, borderRadius: 8, border: "1px solid #e2e8f0" }}>
            <strong style={{ display: "block", marginBottom: 8, fontSize: 13, color: "#334155" }}>
              1. Thông tin chung & Phân loại
            </strong>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <div>
                <label style={{ display: "block", fontSize: 12, color: "#64748b", marginBottom: 3 }}>Ngành hàng</label>
                <select
                  value={editForm.business_unit ?? "TOWEL"}
                  onChange={(e) => setEditForm((s) => ({ ...s, business_unit: e.target.value }))}
                  style={{ width: "100%", padding: "7px 10px", borderRadius: 6, border: "1px solid #cbd5e1", fontSize: 13 }}
                >
                  <option value="TOWEL">🧺 Khăn (The Towels Haven)</option>
                  <option value="SUPPLY">💅 Nail Supply</option>
                  <option value="GROCERY">🍿 Bách Hóa / Ăn Vặt</option>
                </select>
              </div>

              <div>
                <label style={{ display: "block", fontSize: 12, color: "#64748b", marginBottom: 3 }}>Danh mục</label>
                <select
                  value={editForm.category_id ?? ""}
                  onChange={(e) => setEditForm((s) => ({ ...s, category_id: e.target.value ? Number(e.target.value) : null }))}
                  style={{ width: "100%", padding: "7px 10px", borderRadius: 6, border: "1px solid #cbd5e1", fontSize: 13 }}
                >
                  <option value="">-- Không chọn --</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr 1fr", gap: 10, marginTop: 8 }}>
              <div>
                <label style={{ display: "block", fontSize: 12, color: "#64748b", marginBottom: 3 }}>Mã SKU *</label>
                <input
                  type="text"
                  value={editForm.sku ?? ""}
                  onChange={(e) => setEditForm((s) => ({ ...s, sku: e.target.value }))}
                  required
                  style={{ width: "100%", padding: "7px 10px", borderRadius: 6, border: "1px solid #cbd5e1", fontSize: 13, fontFamily: "monospace", boxSizing: "border-box" }}
                />
              </div>

              <div>
                <label style={{ display: "block", fontSize: 12, color: "#64748b", marginBottom: 3 }}>Tên sản phẩm *</label>
                <input
                  type="text"
                  value={editForm.name ?? ""}
                  onChange={(e) => setEditForm((s) => ({ ...s, name: e.target.value }))}
                  required
                  style={{ width: "100%", padding: "7px 10px", borderRadius: 6, border: "1px solid #cbd5e1", fontSize: 13, boxSizing: "border-box" }}
                />
              </div>

              <div>
                <label style={{ display: "block", fontSize: 12, color: "#64748b", marginBottom: 3 }}>Khối lượng tịnh (VD: 200g, 250g)</label>
                <input
                  type="text"
                  placeholder="VD: 200g, 250g..."
                  value={editForm.unit_size ?? ""}
                  onChange={(e) => setEditForm((s) => ({ ...s, unit_size: e.target.value || null }))}
                  style={{ width: "100%", padding: "7px 10px", borderRadius: 6, border: "1px solid #cbd5e1", fontSize: 13, boxSizing: "border-box" }}
                />
              </div>
            </div>

            <div style={{ marginTop: 8 }}>
              <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={Boolean(editForm.is_active)}
                  onChange={(e) => setEditForm((s) => ({ ...s, is_active: e.target.checked }))}
                />
                <strong>Đang hoạt động / Bán hàng (Active)</strong>
              </label>
            </div>
          </div>

          {/* Group 2: Pricing & Units */}
          <div style={{ background: "#f8fafc", padding: 12, borderRadius: 8, border: "1px solid #e2e8f0" }}>
            <strong style={{ display: "block", marginBottom: 8, fontSize: 13, color: "#334155" }}>
              2. Đơn vị tính & Giá cả
            </strong>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
              <div>
                <label style={{ display: "block", fontSize: 12, color: "#64748b", marginBottom: 3 }}>Giá bán ($)</label>
                <input
                  type="number"
                  step="0.01"
                  value={editForm.unit_price ?? "0"}
                  onChange={(e) => setEditForm((s) => ({ ...s, unit_price: e.target.value }))}
                  style={{ width: "100%", padding: "7px 10px", borderRadius: 6, border: "1px solid #cbd5e1", fontSize: 13, boxSizing: "border-box" }}
                />
              </div>

              <div>
                <label style={{ display: "block", fontSize: 12, color: "#64748b", marginBottom: 3 }}>Giá vốn ($)</label>
                <input
                  type="number"
                  step="0.01"
                  value={editForm.cost_price ?? "0"}
                  onChange={(e) => setEditForm((s) => ({ ...s, cost_price: e.target.value }))}
                  style={{ width: "100%", padding: "7px 10px", borderRadius: 6, border: "1px solid #cbd5e1", fontSize: 13, boxSizing: "border-box" }}
                />
              </div>

              <div>
                <label style={{ display: "block", fontSize: 12, color: "#64748b", marginBottom: 3 }}>Đơn vị cơ sở (Base)</label>
                <input
                  type="text"
                  value={editForm.base_uom ?? "Pc"}
                  onChange={(e) => setEditForm((s) => ({ ...s, base_uom: e.target.value }))}
                  placeholder="Pc, Cái, Hộp..."
                  style={{ width: "100%", padding: "7px 10px", borderRadius: 6, border: "1px solid #cbd5e1", fontSize: 13, boxSizing: "border-box" }}
                />
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 8 }}>
              <div>
                <label style={{ display: "block", fontSize: 12, color: "#64748b", marginBottom: 3 }}>Đơn vị bán lẻ (Bao/Thùng)</label>
                <input
                  type="text"
                  value={editForm.uom ?? "Pc"}
                  onChange={(e) => setEditForm((s) => ({ ...s, uom: e.target.value }))}
                  placeholder="Thùng, Dozen..."
                  style={{ width: "100%", padding: "7px 10px", borderRadius: 6, border: "1px solid #cbd5e1", fontSize: 13, boxSizing: "border-box" }}
                />
              </div>

              <div>
                <label style={{ display: "block", fontSize: 12, color: "#64748b", marginBottom: 3 }}>Quy đổi (Hệ số x Cái/Thùng)</label>
                <input
                  type="number"
                  min={1}
                  value={editForm.uom_multiplier ?? 1}
                  onChange={(e) => setEditForm((s) => ({ ...s, uom_multiplier: Number(e.target.value) }))}
                  style={{ width: "100%", padding: "7px 10px", borderRadius: 6, border: "1px solid #cbd5e1", fontSize: 13, boxSizing: "border-box" }}
                />
              </div>
            </div>
          </div>

          <QuoteLogisticsFields value={editForm} onChange={(field, next) => setEditForm(s => ({...s, [field]: next}))} />

          {/* Group 3: Image & Amazon */}
          <div style={{ background: "#f8fafc", padding: 12, borderRadius: 8, border: "1px solid #e2e8f0" }}>
            <strong style={{ display: "block", marginBottom: 8, fontSize: 13, color: "#334155" }}>
              3. Hình ảnh & Kênh bán
            </strong>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <div>
                <label style={{ display: "block", fontSize: 12, color: "#64748b", marginBottom: 3 }}>Tải ảnh mới từ máy</label>
                <input
                  type="file"
                  accept="image/*"
                  onChange={(e) => setImageFile(e.target.files?.[0] || null)}
                  style={{ fontSize: 12 }}
                />
              </div>

              <div>
                <label style={{ display: "block", fontSize: 12, color: "#64748b", marginBottom: 3 }}>Mã Barcode / UPC</label>
                <input
                  type="text"
                  value={editForm.upc ?? ""}
                  onChange={(e) => setEditForm((s) => ({ ...s, upc: e.target.value }))}
                  placeholder="12 số UPC"
                  style={{ width: "100%", padding: "7px 10px", borderRadius: 6, border: "1px solid #cbd5e1", fontSize: 13, boxSizing: "border-box" }}
                />
              </div>
            </div>

            <div style={{ marginTop: 8 }}>
              <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={Boolean(editForm.is_sold_on_amazon)}
                  onChange={(e) => setEditForm((s) => ({ ...s, is_sold_on_amazon: e.target.checked }))}
                />
                Có bán trên Amazon FBA
              </label>
              {editForm.is_sold_on_amazon && (
                <input
                  type="text"
                  placeholder="Nhập Amazon SKU..."
                  value={editForm.amazon_sku ?? ""}
                  onChange={(e) => setEditForm((s) => ({ ...s, amazon_sku: e.target.value }))}
                  style={{ width: "100%", marginTop: 6, padding: "7px 10px", borderRadius: 6, border: "1px solid #cbd5e1", fontSize: 13, boxSizing: "border-box" }}
                />
              )}
            </div>
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 10 }}>
            <button type="button" className="btn" onClick={() => setEditOpen(false)} disabled={editBusy || imageUploading}>
              Hủy
            </button>
            <button type="submit" className="btn primary" disabled={editBusy || imageUploading} style={{ fontWeight: 600 }}>
              {editBusy || imageUploading ? "Đang lưu..." : "Lưu Thay Đổi"}
            </button>
          </div>
        </form>
      </Modal>

      {/* Modal 4: Add Product Modal */}
      <Modal open={addOpen} title="Thêm Sản Phẩm Mới" onClose={() => setAddOpen(false)}>
        <form onSubmit={submitAdd} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div>
              <label style={{ display: "block", fontSize: 12, color: "#64748b", marginBottom: 3 }}>Ngành hàng</label>
              <select
                value={addForm.business_unit ?? "TOWEL"}
                onChange={(e) => setAddForm((s) => ({ ...s, business_unit: e.target.value }))}
                style={{ width: "100%", padding: "7px 10px", borderRadius: 6, border: "1px solid #cbd5e1", fontSize: 13 }}
              >
                <option value="TOWEL">🧺 Khăn (The Towels Haven)</option>
                <option value="SUPPLY">💅 Nail Supply</option>
                <option value="GROCERY">🍿 Bách Hóa / Ăn Vặt</option>
              </select>
            </div>

            <div>
              <label style={{ display: "block", fontSize: 12, color: "#64748b", marginBottom: 3 }}>Danh mục</label>
              <select
                value={addForm.category_id ?? ""}
                onChange={(e) => setAddForm((s) => ({ ...s, category_id: e.target.value ? Number(e.target.value) : null }))}
                style={{ width: "100%", padding: "7px 10px", borderRadius: 6, border: "1px solid #cbd5e1", fontSize: 13 }}
              >
                <option value="">-- Không chọn --</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr 1fr", gap: 10 }}>
            <div>
              <label style={{ display: "block", fontSize: 12, color: "#64748b", marginBottom: 3 }}>Mã SKU *</label>
              <input
                type="text"
                placeholder="VD: TOWEL-1628-WHT"
                value={addForm.sku}
                onChange={(e) => setAddForm((s) => ({ ...s, sku: e.target.value }))}
                required
                style={{ width: "100%", padding: "7px 10px", borderRadius: 6, border: "1px solid #cbd5e1", fontSize: 13, fontFamily: "monospace", boxSizing: "border-box" }}
              />
            </div>

            <div>
              <label style={{ display: "block", fontSize: 12, color: "#64748b", marginBottom: 3 }}>Tên sản phẩm *</label>
              <input
                type="text"
                placeholder="VD: Khăn mặt trắng 16x28 600GSM"
                value={addForm.name}
                onChange={(e) => setAddForm((s) => ({ ...s, name: e.target.value }))}
                required
                style={{ width: "100%", padding: "7px 10px", borderRadius: 6, border: "1px solid #cbd5e1", fontSize: 13, boxSizing: "border-box" }}
              />
            </div>

            <div>
              <label style={{ display: "block", fontSize: 12, color: "#64748b", marginBottom: 3 }}>Khối lượng tịnh (VD: 200g, 250g)</label>
              <input
                type="text"
                placeholder="VD: 200g, 250g..."
                value={addForm.unit_size ?? ""}
                onChange={(e) => setAddForm((s) => ({ ...s, unit_size: e.target.value || null }))}
                style={{ width: "100%", padding: "7px 10px", borderRadius: 6, border: "1px solid #cbd5e1", fontSize: 13, boxSizing: "border-box" }}
              />
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
            <div>
              <label style={{ display: "block", fontSize: 12, color: "#64748b", marginBottom: 3 }}>Tồn kho ban đầu</label>
              <input
                type="number"
                value={addForm.quantity_on_hand ?? 0}
                onChange={(e) => setAddForm((s) => ({ ...s, quantity_on_hand: Number(e.target.value) }))}
                style={{ width: "100%", padding: "7px 10px", borderRadius: 6, border: "1px solid #cbd5e1", fontSize: 13, boxSizing: "border-box" }}
              />
            </div>

            <div>
              <label style={{ display: "block", fontSize: 12, color: "#64748b", marginBottom: 3 }}>Giá bán ($)</label>
              <input
                type="number"
                step="0.01"
                value={addForm.unit_price ?? "0"}
                onChange={(e) => setAddForm((s) => ({ ...s, unit_price: e.target.value }))}
                style={{ width: "100%", padding: "7px 10px", borderRadius: 6, border: "1px solid #cbd5e1", fontSize: 13, boxSizing: "border-box" }}
              />
            </div>

            <div>
              <label style={{ display: "block", fontSize: 12, color: "#64748b", marginBottom: 3 }}>Đơn vị tính</label>
              <input
                type="text"
                value={addForm.base_uom ?? "Pc"}
                onChange={(e) => setAddForm((s) => ({ ...s, base_uom: e.target.value }))}
                placeholder="Pc, Cái..."
                style={{ width: "100%", padding: "7px 10px", borderRadius: 6, border: "1px solid #cbd5e1", fontSize: 13, boxSizing: "border-box" }}
              />
            </div>
          </div>

          <QuoteLogisticsFields value={addForm} onChange={(field, next) => setAddForm(s => ({...s, [field]: next}))} />

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 10 }}>
            <button type="button" className="btn" onClick={() => setAddOpen(false)} disabled={addBusy}>
              Hủy
            </button>
            <button type="submit" className="btn primary" disabled={addBusy} style={{ fontWeight: 600 }}>
              {addBusy ? "Đang tạo..." : "Tạo Sản Phẩm"}
            </button>
          </div>
        </form>
      </Modal>

      {/* Modal 5: Add Category */}
      <Modal open={addCategoryOpen} title="Thêm Danh Mục Mới" onClose={() => setAddCategoryOpen(false)}>
        <form onSubmit={submitAddCategory} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div>
            <label style={{ display: "block", fontSize: 13, color: "#475569", marginBottom: 4 }}>Tên danh mục *</label>
            <input
              type="text"
              value={newCategoryName}
              onChange={(e) => setNewCategoryName(e.target.value)}
              placeholder="VD: Khăn Tắm, Đồ Ăn Vặt, Hạt Điều..."
              required
              style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: "1px solid #cbd5e1", fontSize: 13, boxSizing: "border-box" }}
            />
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
            <button type="button" className="btn" onClick={() => setAddCategoryOpen(false)}>
              Hủy
            </button>
            <button type="submit" className="btn primary" style={{ fontWeight: 600 }}>
              Thêm Danh Mục
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
