import { useEffect, useMemo, useState } from "react";

import { assetUrl, downloadJsonFile } from "../api/client";
import type { AmazonWebProduct } from "../types";


type Props = {
  products: AmazonWebProduct[];
  onSelectionChange?: (items: AmazonManifestSelection[]) => void;
};

export type AmazonManifestSelection = {
  product_id: number;
  quantity: number | null;
};

export default function AmazonManifestBuilder({ products, onSelectionChange }: Props) {
  const [query, setQuery] = useState("");
  const [selectedProductIds, setSelectedProductIds] = useState<number[]>([]);
  const [quantities, setQuantities] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const amazonProducts = useMemo(
    () => products
      .filter((product) => product.is_sold_on_amazon && product.amazon_sku)
      .sort((left, right) => (left.amazon_sku ?? "").localeCompare(right.amazon_sku ?? "")),
    [products],
  );
  const filteredProducts = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    if (!normalized) return amazonProducts;
    return amazonProducts.filter((product) => (
      product.sku.toLocaleLowerCase().includes(normalized)
      || product.name.toLocaleLowerCase().includes(normalized)
      || (product.amazon_sku ?? "").toLocaleLowerCase().includes(normalized)
    ));
  }, [amazonProducts, query]);

  const selectedSet = useMemo(() => new Set(selectedProductIds), [selectedProductIds]);
  const selectedItems = useMemo<AmazonManifestSelection[]>(() => selectedProductIds.map((productId) => {
    const quantity = Number(quantities[productId]);
    return {
      product_id: productId,
      quantity: Number.isInteger(quantity) && quantity > 0 ? quantity : null,
    };
  }), [quantities, selectedProductIds]);
  const totalUnits = selectedProductIds.reduce(
    (sum, productId) => sum + Math.max(0, Number(quantities[productId] || 0)),
    0,
  );

  useEffect(() => {
    onSelectionChange?.(selectedItems);
  }, [onSelectionChange, selectedItems]);

  function setSelected(productId: number, selected: boolean): void {
    setSelectedProductIds((current) => (
      selected
        ? current.includes(productId) ? current : [...current, productId]
        : current.filter((value) => value !== productId)
    ));
    if (selected) {
      setQuantities((current) => ({ ...current, [productId]: current[productId] || "1" }));
    }
  }

  function addAllVisible(): void {
    setSelectedProductIds((current) => Array.from(new Set([
      ...current,
      ...filteredProducts.map((product) => product.id),
    ])));
    setQuantities((current) => {
      const next = { ...current };
      for (const product of filteredProducts) next[product.id] = next[product.id] || "1";
      return next;
    });
  }

  async function downloadManifest(): Promise<void> {
    setError("");
    setNotice("");
    const items = selectedProductIds.map((productId) => ({
      product_id: productId,
      quantity: Number(quantities[productId]),
    }));
    if (!items.length) {
      setError("Chọn ít nhất một Amazon SKU.");
      return;
    }
    if (items.some((item) => !Number.isInteger(item.quantity) || item.quantity < 1)) {
      setError("Quantity của mọi SKU phải là số nguyên lớn hơn 0.");
      return;
    }
    setBusy(true);
    try {
      await downloadJsonFile(
        "/api/v1/amazon-shipments/manifest/export",
        { items },
        "amazon-create-workflow-manifest.xlsx",
      );
      setNotice(`Đã tạo manifest với ${items.length} SKU / ${totalUnits} units.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Không tạo được Amazon manifest.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card amazonSection amazonManifestBuilder">
      <div className="amazonSectionHeader">
        <div>
          <span className="amazonStep">1</span>
          <h2>Create workflow SKU file</h2>
        </div>
        <span className="muted">Dùng trực tiếp ManifestFileUpload_Template_MPL.xlsx đã lưu trong app.</span>
      </div>

      {error ? <div className="amazonInlineWarning">{error}</div> : null}
      {notice ? <div className="amazonManifestSuccess">{notice}</div> : null}

      <div className="amazonManifestToolbar">
        <input
          className="input"
          type="search"
          placeholder="Search Amazon SKU, web SKU or product name…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <button className="btn" type="button" onClick={addAllVisible} disabled={!filteredProducts.length}>
          Add all visible
        </button>
        <button
          className="btn"
          type="button"
          onClick={() => setSelectedProductIds([])}
          disabled={!selectedProductIds.length}
        >
          Clear
        </button>
      </div>

      <div className="amazonStats amazonManifestStats">
        <div><strong>{amazonProducts.length}</strong><span>Amazon products</span></div>
        <div><strong>{selectedProductIds.length}</strong><span>Selected SKUs</span></div>
        <div><strong>{totalUnits}</strong><span>Total units</span></div>
      </div>

      {amazonProducts.length ? (
        <div className="amazonTableScroller amazonManifestTableScroller">
          <table className="amazonManifestTable">
            <thead>
              <tr>
                <th>Add</th>
                <th>Image</th>
                <th>Amazon Merchant SKU</th>
                <th>Web SKU</th>
                <th>Product</th>
                <th className="right">On hand</th>
                <th className="right">Quantity</th>
              </tr>
            </thead>
            <tbody>
              {filteredProducts.map((product) => {
                const selected = selectedSet.has(product.id);
                return (
                  <tr key={product.id} className={selected ? "amazonManifestSelected" : ""}>
                    <td>
                      <input
                        type="checkbox"
                        aria-label={`Select ${product.amazon_sku}`}
                        checked={selected}
                        onChange={(event) => setSelected(product.id, event.target.checked)}
                      />
                    </td>
                    <td>
                      <div className="amazonManifestThumb" title={product.name}>
                        <span>{(product.name || product.sku || "?").slice(0, 1).toUpperCase()}</span>
                        {product.image_url ? (
                          <img
                            src={assetUrl(product.image_url)}
                            alt=""
                            onError={(event) => {
                              event.currentTarget.style.display = "none";
                            }}
                          />
                        ) : null}
                      </div>
                    </td>
                    <td><strong>{product.amazon_sku}</strong></td>
                    <td>{product.sku}</td>
                    <td>{product.name}</td>
                    <td className="right">{product.quantity_on_hand}</td>
                    <td className="right">
                      <input
                        className="input amazonNumberInput"
                        aria-label={`Quantity for ${product.amazon_sku}`}
                        type="number"
                        min={1}
                        step={1}
                        disabled={!selected}
                        value={quantities[product.id] ?? ""}
                        onChange={(event) => setQuantities((current) => ({
                          ...current,
                          [product.id]: event.target.value,
                        }))}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!filteredProducts.length ? <div className="muted amazonManifestEmpty">No matching Amazon products.</div> : null}
        </div>
      ) : (
        <div className="amazonManifestEmptyState">
          Chưa có product nào bật “Sold on Amazon” và có Amazon Merchant SKU. Hãy cập nhật ở trang Products trước.
        </div>
      )}

      <div className="amazonExportBar amazonManifestExportBar">
        <div>
          <strong>Amazon Create workflow manifest</strong>
          <span>App sẽ điền Merchant SKU và Quantity vào sheet template, bắt đầu từ hàng 9.</span>
        </div>
        <button
          className="btn primary"
          type="button"
          disabled={busy || !selectedProductIds.length}
          onClick={() => void downloadManifest()}
        >
          {busy ? "Creating…" : "Download filled manifest"}
        </button>
      </div>
    </section>
  );
}
