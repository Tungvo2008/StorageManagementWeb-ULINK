import { useEffect, useMemo, useState } from "react";
import { apiJson, assetUrl, downloadFile, previewFile } from "../api/client";
import type { Category, Product } from "../types";

type AvailabilityFilter = "all" | "in_stock" | "out_of_stock";

type CatalogCompany = {
  title: string;
  version: string;
  company_name: string;
  logo_url: string;
  website: string;
  email: string;
  phone: string;
  brand_color: string;
};

type CatalogData = {
  catalog: CatalogCompany;
  product_count: number;
  page_count: number;
  missing_image_skus: string[];
};

type PreviewPage = {
  categoryName: string;
  products: Product[];
};

const PRODUCTS_PER_PAGE = 12;

function paginateByCategory(products: Product[], categories: Category[]): PreviewPage[] {
  const categoryById = new Map(categories.map((category) => [category.id, category]));
  const grouped = new Map<string, { sortOrder: number; products: Product[] }>();
  for (const product of products) {
    const category = product.category_id ? categoryById.get(product.category_id) : undefined;
    const categoryName = category?.name ?? "Uncategorized";
    if (!grouped.has(categoryName)) {
      grouped.set(categoryName, {
        sortOrder: category?.catalog_sort_order ?? 999999,
        products: [],
      });
    }
    grouped.get(categoryName)!.products.push(product);
  }

  const pages: PreviewPage[] = [];
  const orderedGroups = Array.from(grouped.entries()).sort(
    ([leftName, left], [rightName, right]) =>
      left.sortOrder - right.sortOrder || leftName.localeCompare(rightName),
  );
  for (const [categoryName, group] of orderedGroups) {
    const categoryProducts = group.products;
    categoryProducts.sort((left, right) => {
      const orderDiff = (left.catalog_sort_order ?? 0) - (right.catalog_sort_order ?? 0);
      if (orderDiff !== 0) return orderDiff;
      const brandDiff = (left.brand ?? "").localeCompare(right.brand ?? "");
      return brandDiff !== 0 ? brandDiff : left.sku.localeCompare(right.sku);
    });
    for (let index = 0; index < categoryProducts.length; index += PRODUCTS_PER_PAGE) {
      pages.push({
        categoryName,
        products: categoryProducts.slice(index, index + PRODUCTS_PER_PAGE),
      });
    }
  }
  return pages;
}

export default function CatalogPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [company, setCompany] = useState<CatalogCompany | null>(null);
  const [title, setTitle] = useState("Wholesale Product Catalog");
  const [version, setVersion] = useState("");
  const [selectedCategoryIds, setSelectedCategoryIds] = useState<number[]>([]);
  const [brand, setBrand] = useState("");
  const [availability, setAvailability] = useState<AvailabilityFilter>("all");
  const [productSearch, setProductSearch] = useState("");
  const [selectedProductSkus, setSelectedProductSkus] = useState<string[]>([]);
  const [showPrice, setShowPrice] = useState(false);
  const [showCountry, setShowCountry] = useState(false);
  const [showUpc, setShowUpc] = useState(false);
  const [showBadges, setShowBadges] = useState(true);
  const [showAvailability, setShowAvailability] = useState(false);
  const [pageIndex, setPageIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      setError(null);
      try {
        const [productData, categoryData, catalogData] = await Promise.all([
          apiJson<Product[]>("/api/v1/products?limit=10000"),
          apiJson<Category[]>("/api/v1/categories?limit=1000"),
          apiJson<CatalogData>("/api/v1/catalog/data"),
        ]);
        setProducts(productData);
        setCategories(categoryData);
        setCompany(catalogData.catalog);
        setTitle(catalogData.catalog.title);
        setVersion(catalogData.catalog.version);
      } catch (err) {
        setError((err as Error).message);
      }
    }
    void load();
  }, []);

  const brands = useMemo(
    () =>
      Array.from(
        new Set(
          products
            .map((product) => (product.brand ?? "").trim())
            .filter(Boolean),
        ),
      ).sort((left, right) => left.localeCompare(right)),
    [products],
  );

  const categoryNameById = useMemo(
    () => new Map(categories.map((category) => [category.id, category.name])),
    [categories],
  );

  const eligibleProducts = useMemo(() => {
    const selectedCategories = new Set(selectedCategoryIds);
    return products.filter((product) => {
      if (!product.catalog_enabled || !product.is_active) return false;
      if (selectedCategories.size && (!product.category_id || !selectedCategories.has(product.category_id))) return false;
      if (brand && (product.brand ?? "") !== brand) return false;
      if (availability === "in_stock" && product.quantity_on_hand <= 0) return false;
      if (availability === "out_of_stock" && product.quantity_on_hand > 0) return false;
      return true;
    });
  }, [products, selectedCategoryIds, brand, availability]);

  useEffect(() => {
    const eligibleSkus = new Set(eligibleProducts.map((product) => product.sku));
    setSelectedProductSkus((current) => current.filter((sku) => eligibleSkus.has(sku)));
  }, [eligibleProducts]);

  const selectedSkuSet = useMemo(
    () => new Set(selectedProductSkus),
    [selectedProductSkus],
  );

  const filteredProducts = useMemo(
    () =>
      selectedSkuSet.size
        ? eligibleProducts.filter((product) => selectedSkuSet.has(product.sku))
        : eligibleProducts,
    [eligibleProducts, selectedSkuSet],
  );

  const productChoices = useMemo(() => {
    const query = productSearch.trim().toLocaleLowerCase();
    return eligibleProducts
      .filter((product) => {
        if (!query) return true;
        const categoryName = product.category_id
          ? categoryNameById.get(product.category_id) ?? ""
          : "Uncategorized";
        return [product.sku, product.name, product.brand ?? "", categoryName]
          .some((value) => value.toLocaleLowerCase().includes(query));
      })
      .sort((left, right) => {
        const leftCategory = left.category_id ? categoryNameById.get(left.category_id) ?? "" : "Uncategorized";
        const rightCategory = right.category_id ? categoryNameById.get(right.category_id) ?? "" : "Uncategorized";
        return leftCategory.localeCompare(rightCategory) || left.name.localeCompare(right.name);
      });
  }, [eligibleProducts, productSearch, categoryNameById]);

  const previewPages = useMemo(
    () => paginateByCategory(filteredProducts, categories),
    [filteredProducts, categories],
  );

  useEffect(() => {
    setPageIndex((current) => Math.min(current, Math.max(0, previewPages.length - 1)));
  }, [previewPages.length]);

  const missingImageSkus = useMemo(
    () => filteredProducts.filter((product) => !product.image_url).map((product) => product.sku),
    [filteredProducts],
  );

  function toggleCategory(categoryId: number) {
    setSelectedCategoryIds((current) =>
      current.includes(categoryId)
        ? current.filter((id) => id !== categoryId)
        : [...current, categoryId],
    );
    setPageIndex(0);
  }

  function toggleProduct(sku: string) {
    setSelectedProductSkus((current) =>
      current.includes(sku)
        ? current.filter((value) => value !== sku)
        : [...current, sku],
    );
    setPageIndex(0);
  }

  function selectShownProducts() {
    setSelectedProductSkus((current) =>
      Array.from(new Set([...current, ...productChoices.map((product) => product.sku)])),
    );
    setPageIndex(0);
  }

  function catalogPath(disposition: "inline" | "attachment") {
    const params = new URLSearchParams();
    if (selectedCategoryIds.length) params.set("category_ids", selectedCategoryIds.join(","));
    if (brand) params.set("brand", brand);
    if (availability !== "all") params.set("availability", availability);
    if (selectedProductSkus.length) params.set("skus", selectedProductSkus.join(","));
    if (title.trim()) params.set("title", title.trim());
    if (version.trim()) params.set("version", version.trim());
    params.set("show_price", String(showPrice));
    params.set("show_country_of_origin", String(showCountry));
    params.set("show_upc", String(showUpc));
    params.set("show_badges", String(showBadges));
    params.set("show_availability", String(showAvailability));
    params.set("disposition", disposition);
    return `/api/v1/catalog/pdf?${params.toString()}`;
  }

  const activePage = previewPages[pageIndex];
  const previewSlots = Array.from({ length: PRODUCTS_PER_PAGE }, (_, index) => activePage?.products[index] ?? null);

  return (
    <div className="catalogWorkspace">
      <section className="card catalogControls">
        <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <h2 style={{ margin: 0 }}>Product Catalog</h2>
            <div className="muted" style={{ marginTop: 6 }}>
              Standard Letter layout · 4 columns × 3 rows · 12 products per page.
            </div>
          </div>
          <div className="row">
            <button
              className="btn"
              type="button"
              disabled={!filteredProducts.length}
              onClick={() => void previewFile(catalogPath("inline")).catch((err) => setError((err as Error).message))}
            >
              Preview PDF
            </button>
            <button
              className="btn primary"
              type="button"
              disabled={!filteredProducts.length}
              onClick={() => void downloadFile(catalogPath("attachment"), "ULINK Product Catalog.pdf").catch((err) => setError((err as Error).message))}
            >
              Download PDF
            </button>
          </div>
        </div>

        {error ? <div className="error" style={{ marginTop: 12 }}>{error}</div> : null}

        <div className="catalogControlGrid">
          <div className="field">
            <label>Catalog title</label>
            <input className="input" value={title} onChange={(event) => setTitle(event.target.value)} />
          </div>
          <div className="field">
            <label>Version / updated date</label>
            <input className="input" value={version} onChange={(event) => setVersion(event.target.value)} />
          </div>
          <div className="field">
            <label>Brand</label>
            <select className="input" value={brand} onChange={(event) => setBrand(event.target.value)}>
              <option value="">All brands</option>
              {brands.map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
          </div>
          <div className="field">
            <label>Availability</label>
            <select className="input" value={availability} onChange={(event) => setAvailability(event.target.value as AvailabilityFilter)}>
              <option value="all">All stock statuses</option>
              <option value="in_stock">In stock only</option>
              <option value="out_of_stock">Out of stock only</option>
            </select>
          </div>
        </div>

        <div className="field" style={{ marginTop: 14 }}>
          <label>Categories</label>
          <div className="catalogCategoryChoices">
            {categories.map((category) => (
              <label className={selectedCategoryIds.includes(category.id) ? "selected" : ""} key={category.id}>
                <input
                  type="checkbox"
                  checked={selectedCategoryIds.includes(category.id)}
                  onChange={() => toggleCategory(category.id)}
                />
                {category.name}
              </label>
            ))}
          </div>
          <div className="muted">Không chọn category nào = xuất tất cả category.</div>
        </div>

        <div className="catalogProductPicker">
          <div className="catalogProductPickerHeader">
            <div>
              <strong>Chọn sản phẩm</strong>
              <div className="muted">
                {selectedProductSkus.length
                  ? `Đã chọn ${selectedProductSkus.length} sản phẩm.`
                  : `Chưa chọn riêng sản phẩm — sẽ xuất toàn bộ ${eligibleProducts.length} sản phẩm phù hợp.`}
              </div>
            </div>
            <div className="row">
              <button className="btn" type="button" disabled={!productChoices.length} onClick={selectShownProducts}>
                Chọn kết quả ({productChoices.length})
              </button>
              <button
                className="btn"
                type="button"
                disabled={!selectedProductSkus.length}
                onClick={() => {
                  setSelectedProductSkus([]);
                  setPageIndex(0);
                }}
              >
                Bỏ chọn
              </button>
            </div>
          </div>
          <input
            className="input"
            value={productSearch}
            onChange={(event) => setProductSearch(event.target.value)}
            placeholder="Tìm theo tên, SKU, brand hoặc category..."
          />
          <div className="catalogProductChoices">
            {productChoices.map((product) => {
              const selected = selectedSkuSet.has(product.sku);
              return (
                <label className={selected ? "selected" : ""} key={product.id}>
                  <input
                    type="checkbox"
                    checked={selected}
                    onChange={() => toggleProduct(product.sku)}
                  />
                  <span className="catalogProductChoiceImage">
                    {product.image_url ? (
                      <img src={assetUrl(product.image_url)} alt="" />
                    ) : (
                      <b>{product.name.trim().charAt(0).toUpperCase() || "?"}</b>
                    )}
                  </span>
                  <span className="catalogProductChoiceText">
                    <strong title={product.name}>{product.name}</strong>
                    <small>
                      {product.sku}
                      {" · "}
                      {product.category_id ? categoryNameById.get(product.category_id) ?? "Uncategorized" : "Uncategorized"}
                    </small>
                  </span>
                </label>
              );
            })}
            {!productChoices.length ? <div className="muted">Không tìm thấy sản phẩm phù hợp.</div> : null}
          </div>
        </div>

        <div className="catalogOptionRow">
          <label><input type="checkbox" checked={showPrice} onChange={(event) => setShowPrice(event.target.checked)} /> Show price</label>
          <label><input type="checkbox" checked={showBadges} onChange={(event) => setShowBadges(event.target.checked)} /> Show badges</label>
          <label><input type="checkbox" checked={showAvailability} onChange={(event) => setShowAvailability(event.target.checked)} /> Show availability</label>
          <label><input type="checkbox" checked={showCountry} onChange={(event) => setShowCountry(event.target.checked)} /> Show origin</label>
          <label><input type="checkbox" checked={showUpc} onChange={(event) => setShowUpc(event.target.checked)} /> Show UPC</label>
        </div>

        <div className="catalogStats">
          <div><strong>{filteredProducts.length}</strong><span>Products</span></div>
          <div><strong>{previewPages.length}</strong><span>Pages</span></div>
          <div className={missingImageSkus.length ? "warning" : ""}><strong>{missingImageSkus.length}</strong><span>Missing images</span></div>
        </div>
        {missingImageSkus.length ? (
          <div className="muted catalogWarningList">
            Missing image: {missingImageSkus.slice(0, 12).join(", ")}
            {missingImageSkus.length > 12 ? ` +${missingImageSkus.length - 12} more` : ""}
          </div>
        ) : null}
      </section>

      <section className="card catalogPreviewPanel">
        <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <strong>Layout preview</strong>
            <div className="muted">PDF server sẽ dùng cùng cấu trúc 4 × 3 và ảnh object-fit contain.</div>
          </div>
          <div className="row">
            <button className="btn" type="button" disabled={pageIndex <= 0} onClick={() => setPageIndex((value) => value - 1)}>←</button>
            <span className="pill">Page {previewPages.length ? pageIndex + 1 : 0} / {previewPages.length}</span>
            <button className="btn" type="button" disabled={pageIndex >= previewPages.length - 1} onClick={() => setPageIndex((value) => value + 1)}>→</button>
          </div>
        </div>

        <div className="catalogPreviewScroller">
          <div className="catalogLetterPage">
            <header className="catalogPreviewHeader">
              <img src="/logo.png" alt="ULINK LLC" />
              <div>
                <h1>{title || company?.title || "Wholesale Product Catalog"}</h1>
                <h2>{activePage?.categoryName || "No products selected"}</h2>
                <span>{version || company?.version}</span>
              </div>
            </header>
            <div className="catalogPreviewGrid">
              {previewSlots.map((product, index) => (
                <div className={`catalogPreviewCard ${product ? "" : "empty"}`} key={product?.id ?? `empty-${index}`}>
                  {product ? (
                    <>
                      <div className="catalogPreviewImage">
                        {product.image_url ? <img src={assetUrl(product.image_url)} alt="" /> : <span>Image unavailable</span>}
                        {showBadges && product.catalog_badges ? <b>{product.catalog_badges.split(",")[0]}</b> : null}
                      </div>
                      <div className="catalogPreviewBrand" title={product.brand ?? "ULINK"}>{product.brand || "ULINK"}</div>
                      <div className="catalogPreviewName" title={product.catalog_short_name || product.name}>{product.catalog_short_name || product.name}</div>
                      <dl>
                        {product.unit_size ? <><dt>Size:</dt><dd>{product.unit_size}</dd></> : null}
                        {(product.catalog_case_pack || product.uom_multiplier > 1) ? <><dt>Case Pack:</dt><dd>{product.catalog_case_pack || product.uom_multiplier}</dd></> : null}
                        {showPrice ? <><dt>Price:</dt><dd>${Number(product.unit_price).toFixed(2)}</dd></> : null}
                        {showCountry && product.country_of_origin ? <><dt>Origin:</dt><dd>{product.country_of_origin}</dd></> : null}
                        {showUpc && product.upc ? <><dt>UPC:</dt><dd>{product.upc}</dd></> : null}
                        {showAvailability ? <><dt>Availability:</dt><dd>{product.quantity_on_hand > 0 ? "In stock" : "Out of stock"}</dd></> : null}
                      </dl>
                    </>
                  ) : null}
                </div>
              ))}
            </div>
            <footer className="catalogPreviewFooter">
              <span>{company?.website}</span>
              <span>{company?.email}</span>
              <span>{company?.phone}</span>
              <strong>Page {previewPages.length ? pageIndex + 1 : 0} of {previewPages.length}</strong>
            </footer>
          </div>
        </div>
      </section>
    </div>
  );
}
