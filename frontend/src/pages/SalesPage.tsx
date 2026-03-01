import { useEffect, useMemo, useState } from "react";
import { apiJson } from "../api/client";
import PosProductSearch from "../components/PosProductSearch";
import type { Category, Customer, InventoryIssue, Product, SaleOrder } from "../types";
import type { FormEvent } from "react";

type LineDraft = { product_id: number; quantity: number; discount_amount: string };

export default function SalesPage() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [created, setCreated] = useState<SaleOrder | null>(null);
  const [createdIssue, setCreatedIssue] = useState<InventoryIssue | null>(null);

  const [customerId, setCustomerId] = useState<number | "">("");
  const [taxRate, setTaxRate] = useState<string>("0");
  const [discountAmount, setDiscountAmount] = useState<string>("0"); // order-level discount
  const [shippingAmount, setShippingAmount] = useState<string>("0");
  const [outPurpose, setOutPurpose] = useState<string>("SALE"); // SALE|AMAZON_FBA|AMAZON_FBM|HOME|TEST|SAMPLE|GIFT|OTHER
  const [issuedTo, setIssuedTo] = useState<string>("");
  const [note, setNote] = useState<string>("");
  const [lines, setLines] = useState<LineDraft[]>([]);

  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const productMap = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);

  const totals = useMemo(() => {
    let subtotal = 0;
    let lineDiscounts = 0;
    for (const l of lines) {
      const p = productMap.get(l.product_id);
      if (!p) continue;
      const unit = Number(p.unit_price);
      const lineSub = unit * Number(l.quantity || 0);
      const disc = Math.max(0, Math.min(lineSub, Number(l.discount_amount || 0)));
      subtotal += lineSub;
      lineDiscounts += disc;
    }
    const orderDiscount = Math.max(0, Number(discountAmount || 0));
    const shipping = Math.max(0, Number(shippingAmount || 0));
    const totalDiscount = Math.max(0, orderDiscount + lineDiscounts);
    const net = Math.max(0, subtotal - totalDiscount);
    const tax = net * Math.max(0, Math.min(1, Number(taxRate || 0)));
    const total = net + tax + shipping;
    return { subtotal, lineDiscounts, orderDiscount, totalDiscount, shipping, tax, total, net };
  }, [lines, productMap, discountAmount, shippingAmount, taxRate]);

  useEffect(() => {
    void (async () => {
      try {
        const [c, p, cats] = await Promise.all([
          apiJson<Customer[]>("/api/v1/customers"),
          apiJson<Product[]>("/api/v1/products"),
          apiJson<Category[]>("/api/v1/categories"),
        ]);
        setCustomers(c);
        setProducts(p);
        setCategories(cats);
      } catch (e) {
        setError((e as Error).message);
      }
    })();
  }, []);

  function removeLine(idx: number) {
    setLines((s) => s.filter((_, i) => i !== idx));
  }

  function addProduct(p: Product) {
    setLines((s) => {
      const idx = s.findIndex((l) => l.product_id === p.id);
      if (idx >= 0) {
        return s.map((l, i) => (i === idx ? { ...l, quantity: l.quantity + 1 } : l));
      }
      return [...s, { product_id: p.id, quantity: 1, discount_amount: "0" }];
    });
  }

  const isSalePurpose = outPurpose === "SALE";

  async function onCreateSale(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setCreated(null);
    setCreatedIssue(null);
    setBusy(true);
    try {
      if (isSalePurpose) {
        const payload = {
          customer_id: customerId === "" ? null : customerId,
          status: "CONFIRMED",
          discount_amount: Number(discountAmount || 0),
          shipping_amount: Number(shippingAmount || 0),
          tax_rate: Number(taxRate),
          lines: lines.map((l) => ({
            product_id: l.product_id,
            quantity: l.quantity,
            discount_amount: Number(l.discount_amount || 0),
          })),
        };
        const sale = await apiJson<SaleOrder>("/api/v1/sales", {
          method: "POST",
          body: JSON.stringify(payload),
        });
        setCreated(sale);
      } else {
        const payload = {
          purpose: outPurpose,
          issued_to: issuedTo || null,
          note: note || null,
          lines: lines.map((l) => ({ product_id: l.product_id, quantity: l.quantity })),
        };
        const issue = await apiJson<InventoryIssue>("/api/v1/inventory/issues", {
          method: "POST",
          body: JSON.stringify(payload),
        });
        setCreatedIssue(issue);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="posSaleShell">
      <div className="card">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <h2 style={{ marginTop: 0, marginBottom: 0 }}>Create Issue</h2>
          <div className="muted">Chọn mục đích xuất, chọn SP, nhập thông tin cần thiết.</div>
        </div>
        {error && <div className="error">{error}</div>}
      <form onSubmit={onCreateSale}>
        <div className="row">
          <div className="field" style={{ width: 240 }}>
            <label>Xuất hàng cho</label>
            <select
              className="select"
              value={outPurpose}
              onChange={(e) => {
                const nextPurpose = e.target.value;
                setOutPurpose(nextPurpose);
                if (nextPurpose !== "SALE") {
                  setCustomerId("");
                }
                if (nextPurpose === "AMAZON_FBA") {
                  setIssuedTo("Amazon FBA");
                } else if (nextPurpose === "AMAZON_FBM") {
                  setIssuedTo("Amazon FBM");
                }
              }}
            >
              <option value="SALE">Bán hàng (Sale)</option>
              <option value="AMAZON_FBA">Amazon FBA</option>
              <option value="AMAZON_FBM">Amazon FBM</option>
              <option value="HOME">Mang về nhà</option>
              <option value="TEST">Test</option>
              <option value="SAMPLE">Làm mẫu</option>
              <option value="GIFT">Tặng/cho</option>
              <option value="OTHER">Khác</option>
            </select>
          </div>

          {isSalePurpose ? (
            <div className="field" style={{ flex: 1, minWidth: 260 }}>
              <label>Customer</label>
              <select
                className="select"
                value={customerId}
                onChange={(e) => setCustomerId(e.target.value ? Number(e.target.value) : "")}
              >
                <option value="">Walk-in</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                    </option>
                  ))}
                </select>
            </div>
          ) : null}

          {isSalePurpose ? (
            <>
              <div className="field" style={{ width: 160 }}>
                <label>Order discount</label>
                <input className="input" value={discountAmount} onChange={(e) => setDiscountAmount(e.target.value)} />
              </div>

              <div className="field" style={{ width: 160 }}>
                <label>Shipping</label>
                <input className="input" value={shippingAmount} onChange={(e) => setShippingAmount(e.target.value)} />
              </div>

              <div className="field" style={{ width: 140 }}>
                <label>Tax rate (0..1)</label>
                <input className="input" value={taxRate} onChange={(e) => setTaxRate(e.target.value)} />
              </div>
            </>
          ) : (
            <>
              <div className="field" style={{ flex: 1, minWidth: 260 }}>
                <label>Xuất cho (issued to)</label>
                <input className="input" value={issuedTo} onChange={(e) => setIssuedTo(e.target.value)} placeholder="Tên người nhận / nơi nhận..." />
              </div>
              <div className="field" style={{ flex: 1, minWidth: 260 }}>
                <label>Ghi chú</label>
                <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="..." />
              </div>
            </>
          )}
        </div>

        <div className="posSaleMain" style={{ marginTop: 12 }}>
          <div className="card">
            <div className="row" style={{ justifyContent: "space-between" }}>
              <h3 style={{ margin: 0 }}>Cart</h3>
              {isSalePurpose ? (
                <div className="muted">Currency: {products[0]?.currency ?? "USD"}</div>
              ) : (
                <div className="muted">Phiếu xuất kho: {outPurpose}</div>
              )}
            </div>

            {isSalePurpose ? (
              <div className="totalsBox" style={{ marginTop: 10 }}>
                <div className="totalsRow">
                  <span>Subtotal</span>
                  <b>{totals.subtotal.toFixed(2)}</b>
                </div>
                <div className="totalsRow">
                  <span>Line discounts</span>
                  <b>-{totals.lineDiscounts.toFixed(2)}</b>
                </div>
                <div className="totalsRow">
                  <span>Order discount</span>
                  <b>-{totals.orderDiscount.toFixed(2)}</b>
                </div>
                <div className="totalsRow">
                  <span>Tax</span>
                  <b>{totals.tax.toFixed(2)}</b>
                </div>
                <div className="totalsRow">
                  <span>Shipping</span>
                  <b>{totals.shipping.toFixed(2)}</b>
                </div>
                <div className="totalsRow totalsGrand">
                  <span>Total</span>
                  <b>{totals.total.toFixed(2)}</b>
                </div>
              </div>
            ) : null}

            <div style={{ marginTop: 12, overflowX: "auto" }}>
              <table className="saleCartTable">
                <thead>
                  <tr>
                    <th className="colNum">#</th>
                    <th className="colSku">SKU</th>
                    <th className="colProd">Product</th>
                    <th className="colUom">UOM</th>
                    <th className="right colUnit">
                      Unit
                    </th>
                    {isSalePurpose ? (
                      <th className="right colDisc">
                        Disc
                      </th>
                    ) : null}
                    <th className="right colQty">
                      Qty
                    </th>
                    <th className="right colTotal">
                      Total
                    </th>
                    <th className="colAction" />
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l, idx) => {
                    const p = productMap.get(l.product_id);
                    const unit = Number(p?.unit_price ?? 0);
                    const lineSub = unit * Number(l.quantity || 0);
                    const disc = isSalePurpose ? Math.max(0, Math.min(lineSub, Number(l.discount_amount || 0))) : 0;
                    const lineTotal = lineSub - disc;
                    return (
                      <tr key={l.product_id}>
                        <td className="colNum">{idx + 1}</td>
                        <td className="colSku">{p?.sku ?? l.product_id}</td>
                        <td className="colProd">
                          <div className="saleProdName">
                            {p?.name ?? <span className="muted">Unknown product (id={l.product_id})</span>}
                          </div>
                          {p ? (
                            <div className="muted" style={{ marginTop: 6 }}>
                              On hand: {(p.quantity_on_hand / Math.max(1, p.uom_multiplier)).toFixed(2)} {p.uom}
                            </div>
                          ) : null}
                        </td>
                        <td className="colUom">
                          {p?.uom ?? ""}
                          {p && p.uom_multiplier > 1 ? <span className="muted"> (x{p.uom_multiplier})</span> : null}
                        </td>
                        <td className="right colUnit">
                          {p ? (
                            <>
                              {p.unit_price} {p.currency}
                            </>
                          ) : (
                            ""
                          )}
                        </td>
                        {isSalePurpose ? (
                          <td className="right colDisc">
                            <input
                              className="input"
                              value={l.discount_amount}
                              onChange={(e) =>
                                setLines((s) =>
                                  s.map((x, i) => (i === idx ? { ...x, discount_amount: e.target.value } : x)),
                                )
                              }
                              style={{ width: "100%", textAlign: "right" }}
                              placeholder="0"
                            />
                          </td>
                        ) : null}
                        <td className="right colQty">
                          <input
                            className="input"
                            type="number"
                            min={1}
                            value={l.quantity}
                            onChange={(e) =>
                              setLines((s) =>
                                s.map((x, i) => (i === idx ? { ...x, quantity: Number(e.target.value) } : x)),
                                )
                              }
                              style={{ width: "100%", textAlign: "right" }}
                          />
                        </td>
                        <td className="right colTotal">{lineTotal.toFixed(2)}</td>
                        <td className="colAction">
                          <button className="btn" type="button" onClick={() => removeLine(idx)}>
                            Remove
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                  {lines.length === 0 && (
                    <tr>
                      <td colSpan={isSalePurpose ? 9 : 8} className="muted">
                        Chưa có sản phẩm nào. Hãy dùng ô search bên trái để Add vào cart.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="row" style={{ marginTop: 12 }}>
              <button className="btn primary" type="submit" disabled={busy || lines.length === 0}>
                {isSalePurpose ? "Create issue (SALE/CONFIRMED)" : "Create issue (OUT)"}
              </button>
              <div className="muted">
                {isSalePurpose
                  ? "Khi CONFIRMED, hệ thống sẽ trừ tồn kho và tạo stock movement."
                  : "Hệ thống sẽ trừ tồn kho và lưu phiếu xuất (Inventory Issue)."}
              </div>
            </div>
          </div>

          <div className="card">
            <div className="row" style={{ justifyContent: "space-between" }}>
              <h3 style={{ margin: 0 }}>Chọn sản phẩm</h3>
              <div className="muted">Enter để add SKU match nhanh.</div>
            </div>
            <div style={{ marginTop: 10 }}>
              <PosProductSearch products={products} categories={categories} onAdd={(p) => addProduct(p)} />
            </div>
          </div>
        </div>
      </form>
      </div>

      {created && (
        <div className="card">
          <h3 style={{ marginTop: 0 }}>Created</h3>
          <div className="row">
            <div>
              <div>
                <b>Issue ID (sale):</b> {created.id}
              </div>
              <div className="muted">
                Subtotal: {created.subtotal_amount} • Discount: {created.discount_amount} (order:{" "}
                {created.order_discount_amount}) • Tax: {created.tax_amount} • Shipping: {created.shipping_amount} • Total:{" "}
                {created.total_amount} {created.currency}
              </div>
            </div>
            <a className="btn" href="/invoices">
              Go to Invoices
            </a>
          </div>
          <div style={{ marginTop: 10, overflowX: "auto" }}>
            <table>
              <thead>
                <tr>
                  <th>SKU</th>
                  <th>Product</th>
                  <th className="right">Qty</th>
                  <th className="right">Unit</th>
                  <th className="right">Total</th>
                </tr>
              </thead>
              <tbody>
                {created.lines.map((l) => (
                  <tr key={l.id}>
                    <td>{l.sku}</td>
                    <td>{l.product_name}</td>
                    <td className="right">{l.quantity}</td>
                    <td className="right">{l.unit_price}</td>
                    <td className="right">{l.line_total}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <IssueInvoice saleId={created.id} />
        </div>
      )}

      {createdIssue && (
        <div className="card">
          <h3 style={{ marginTop: 0 }}>Created Issue</h3>
          <div className="muted">
            Issue ID: {createdIssue.id} • Purpose: {createdIssue.purpose} • Issued to: {createdIssue.issued_to ?? "—"}
          </div>
          <div style={{ marginTop: 10, overflowX: "auto" }}>
            <table>
              <thead>
                <tr>
                  <th>SKU</th>
                  <th>Product</th>
                  <th className="right">Qty</th>
                </tr>
              </thead>
              <tbody>
                {createdIssue.lines.map((l) => (
                  <tr key={l.id}>
                    <td>{l.sku}</td>
                    <td>{l.product_name}</td>
                    <td className="right">{l.quantity}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="muted" style={{ marginTop: 10 }}>
            Bạn có thể xem log ở tab Inventory.
          </div>
        </div>
      )}
    </div>
  );
}

function IssueInvoice({ saleId }: { saleId: number }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  async function onIssue() {
    setBusy(true);
    setError(null);
    setOk(null);
    try {
      const inv = await apiJson<{ id: number; invoice_number: string }>(`/api/v1/invoices/from-sale/${saleId}`, {
        method: "POST",
        body: JSON.stringify({ due_days: 0 }),
      });
      setOk(`Issued invoice ${inv.invoice_number} (id=${inv.id})`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ marginTop: 14 }} className="row">
      <button className="btn primary" type="button" onClick={() => void onIssue()} disabled={busy}>
        Issue invoice
      </button>
      {ok && <div>{ok}</div>}
      {error && <div className="error">{error}</div>}
    </div>
  );
}
