import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { apiJson, apiUpload, downloadJsonFile } from "../api/client";
import AmazonBoxProfileManager from "../components/AmazonBoxProfileManager";
import AmazonFbaInventoryView from "../components/AmazonFbaInventoryView";
import AmazonShipmentsHubView from "../components/AmazonShipmentsHubView";
import AmazonFbmOrdersView from "../components/AmazonFbmOrdersView";
import AmazonManifestBuilder, { type AmazonManifestSelection } from "../components/AmazonManifestBuilder";
import type {
  AmazonCsvImport,
  AmazonFbaDispatchRequest,
  AmazonFbaDispatchResponse,
  AmazonImportedItem,
  AmazonMapping,
  AmazonOptimizePlan,
  AmazonOptimizeResponse,
  AmazonShipmentConfig,
  InventoryIssue,
} from "../types";



type MappingDraft = {
  productId: string;
  unitWeightLb: string;
};

type BoxAssignment = {
  boxTypeId: number;
  name: string;
  weightLb: string;
  lengthIn: string;
  widthIn: string;
  heightIn: string;
};

function decimalText(value: number | null): string {
  if (value == null) return "";
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(4)));
}

function fileBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Không đọc được Amazon XLSX."));
    reader.onload = () => {
      const result = String(reader.result ?? "");
      const separator = result.indexOf(",");
      if (separator < 0) {
        reject(new Error("Amazon XLSX không hợp lệ."));
        return;
      }
      resolve(result.slice(separator + 1));
    };
    reader.readAsDataURL(file);
  });
}

export default function AmazonShipmentPage() {
  const [config, setConfig] = useState<AmazonShipmentConfig | null>(null);
  const [imported, setImported] = useState<AmazonCsvImport | null>(null);
  const [sourceCsv, setSourceCsv] = useState("");
  const [sourceFilename, setSourceFilename] = useState("");
  const [manifestSelections, setManifestSelections] = useState<AmazonManifestSelection[]>([]);
  const [packingTemplateFile, setPackingTemplateFile] = useState<File | null>(null);
  const [mappingDrafts, setMappingDrafts] = useState<Record<string, MappingDraft>>({});
  const [requestedQuantities, setRequestedQuantities] = useState<Record<string, string>>({});
  const [availableQuantities, setAvailableQuantities] = useState<Record<string, string>>({});
  const [selectedBoxTypeIds, setSelectedBoxTypeIds] = useState<number[]>([]);
  const [boxManagerOpen, setBoxManagerOpen] = useState(false);
  const [minBoxes, setMinBoxes] = useState("5");
  const [maxBoxes, setMaxBoxes] = useState("20");
  const [plans, setPlans] = useState<AmazonOptimizePlan[]>([]);
  const [selectedPlanKey, setSelectedPlanKey] = useState("");
  const [boxAssignments, setBoxAssignments] = useState<BoxAssignment[]>([]);
  const [dispatchModalOpen, setDispatchModalOpen] = useState(false);
  const [dispatchShipmentId, setDispatchShipmentId] = useState("");
  const [dispatchIssuedBy, setDispatchIssuedBy] = useState("");
  const [dispatchNote, setDispatchNote] = useState("");
  const [dispatchIgnoreStock, setDispatchIgnoreStock] = useState(false);
  const [fbaHistoryOpen, setFbaHistoryOpen] = useState(false);
  const [fbaHistory, setFbaHistory] = useState<InventoryIssue[]>([]);
  const [fbaHistoryLoading, setFbaHistoryLoading] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [activeTab, setActiveTab] = useState<"inventory" | "optimizer" | "history" | "fbm">("inventory");
  const [manifestBuilderKey, setManifestBuilderKey] = useState(0);
  const [directDispatchItems, setDirectDispatchItems] = useState<{
    sku: string;
    amazonSku: string;
    productName: string;
    quantity: number;
    boxCount?: number;
  }[] | null>(null);
  const initializedBoxSelection = useRef(false);

  const handleOpenOptimizerWithSkus = useCallback((skus: { amazonSku: string; quantity: number }[]) => {
    if (!config) return;
    const productMap = new Map(config.products.map((p) => [p.amazon_sku, p.id]));
    const selectedIds: number[] = [];
    const quantitiesMap: Record<number, string> = {};

    for (const item of skus) {
      const pid = productMap.get(item.amazonSku);
      if (pid != null) {
        selectedIds.push(pid);
        if (item.quantity > 0) {
          quantitiesMap[pid] = String(item.quantity);
        }
      }
    }

    try {
      localStorage.setItem("amazon_manifest_builder_selected_ids_v1", JSON.stringify(selectedIds));
      localStorage.setItem("amazon_manifest_builder_quantities_v1", JSON.stringify(quantitiesMap));
    } catch {
      // ignore storage errors
    }

    setManifestBuilderKey((k) => k + 1);
    setActiveTab("optimizer");
  }, [config]);

  const handleOpenDirectDispatch = useCallback((items: {
    sku: string;
    amazonSku: string;
    productName: string;
    quantity: number;
    boxCount?: number;
  }[]) => {
    setDirectDispatchItems(items);
    setDispatchModalOpen(true);
  }, []);

  async function openFbaHistory(): Promise<void> {
    setFbaHistoryOpen(true);
    setFbaHistoryLoading(true);
    try {
      const list = await apiJson<InventoryIssue[]>("/api/v1/amazon-shipments/fba-history");
      setFbaHistory(list);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Không tải được lịch sử FBA.");
    } finally {
      setFbaHistoryLoading(false);
    }
  }


  async function loadConfig(): Promise<AmazonShipmentConfig> {
    const next = await apiJson<AmazonShipmentConfig>("/api/v1/amazon-shipments/config");
    setConfig(next);
    if (!initializedBoxSelection.current) {
      setSelectedBoxTypeIds(
        next.box_types.filter((boxType) => boxType.is_active).map((boxType) => boxType.id),
      );
      initializedBoxSelection.current = true;
    }
    setImported((current) => {
      if (!current) return current;
      const mappingBySku = new Map(next.mappings.map((mapping) => [mapping.amazon_sku, mapping]));
      return {
        ...current,
        items: current.items.map((item) => ({
          ...item,
          mapping: mappingBySku.get(item.amazon_sku) ?? null,
        })),
      };
    });
    return next;
  }

  useEffect(() => {
    void loadConfig().catch((cause: unknown) => {
      setError(cause instanceof Error ? cause.message : "Không tải được Amazon shipment configuration.");
    });
  }, []);

  const selectedPlan = useMemo(
    () => plans.find((plan) => plan.key === selectedPlanKey) ?? null,
    [plans, selectedPlanKey],
  );

  const directItems = useMemo<AmazonImportedItem[]>(() => {
    if (!config) return [];
    const productById = new Map(config.products.map((product) => [product.id, product]));
    const mappingBySku = new Map(config.mappings.map((mapping) => [mapping.amazon_sku, mapping]));
    return manifestSelections.flatMap((selection) => {
      const product = productById.get(selection.product_id);
      if (!product?.amazon_sku) return [];
      return [{
        amazon_sku: product.amazon_sku,
        title: product.name,
        asin: null,
        fnsku: null,
        requested_quantity: selection.quantity ?? 0,
        mapping: mappingBySku.get(product.amazon_sku) ?? null,
      }];
    });
  }, [config, manifestSelections]);

  const usingManifestList = directItems.length > 0;
  const workingItems = usingManifestList ? directItems : imported?.items ?? [];
  const workingSource: "manifest" | "csv" | null = usingManifestList
    ? "manifest"
    : imported
      ? "csv"
      : null;

  const handleManifestSelectionChange = useCallback((items: AmazonManifestSelection[]) => {
    setManifestSelections(items);
  }, []);

  useEffect(() => {
    if (!config || !directItems.length) return;
    const productByAmazonSku = new Map(
      config.products
        .filter((product) => product.amazon_sku)
        .map((product) => [product.amazon_sku as string, product]),
    );
    setMappingDrafts((current) => {
      const next = { ...current };
      for (const item of directItems) {
        const product = productByAmazonSku.get(item.amazon_sku);
        next[item.amazon_sku] = {
          productId: product ? String(product.id) : "",
          unitWeightLb: decimalText(item.mapping?.unit_weight_lb ?? null),
        };
      }
      return next;
    });
    setAvailableQuantities((current) => {
      const next = { ...current };
      for (const item of directItems) {
        const product = productByAmazonSku.get(item.amazon_sku);
        if (!(item.amazon_sku in next)) {
          next[item.amazon_sku] = String(
            Math.max(item.requested_quantity, product?.quantity_on_hand ?? 0),
          );
        }
      }
      return next;
    });
    setPlans([]);
    setSelectedPlanKey("");
    setBoxAssignments([]);
  }, [config, directItems]);

  async function importCsv(file: File): Promise<void> {
    setBusy("import");
    setError("");
    setNotice("");
    setPlans([]);
    setSelectedPlanKey("");
    try {
      const csvText = await file.text();
      const formData = new FormData();
      formData.append("file", file);
      const result = await apiUpload<AmazonCsvImport>(
        "/api/v1/amazon-shipments/import",
        formData,
      );
      setImported(result);
      setSourceCsv(csvText);
      setSourceFilename(file.name);
      const nextMappings: Record<string, MappingDraft> = {};
      const nextRequested: Record<string, string> = {};
      const nextAvailable: Record<string, string> = {};
      for (const item of result.items) {
        nextMappings[item.amazon_sku] = {
          productId: item.mapping?.product_id ? String(item.mapping.product_id) : "",
          unitWeightLb: decimalText(item.mapping?.unit_weight_lb ?? null),
        };
        nextRequested[item.amazon_sku] = String(item.requested_quantity);
        nextAvailable[item.amazon_sku] = String(
          Math.max(item.requested_quantity, item.mapping?.quantity_on_hand ?? 0),
        );
      }
      setMappingDrafts(nextMappings);
      setRequestedQuantities(nextRequested);
      setAvailableQuantities(nextAvailable);
      setNotice(`Đã đọc ${result.declared_sku_count} Amazon SKU / ${result.declared_unit_count} units.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Không đọc được Amazon CSV.");
    } finally {
      setBusy("");
    }
  }

  async function saveMapping(amazonSku: string): Promise<void> {
    const item = workingItems.find((candidate) => candidate.amazon_sku === amazonSku);
    const draft = mappingDrafts[amazonSku];
    if (!item || !draft?.productId) {
      setError("Hãy chọn sản phẩm trên web trước khi lưu mapping.");
      return;
    }
    setBusy(`mapping:${amazonSku}`);
    setError("");
    try {
      await apiJson<AmazonMapping>("/api/v1/amazon-shipments/mappings", {
        method: "POST",
        body: JSON.stringify({
          amazon_sku: amazonSku,
          product_id: Number(draft.productId),
          asin: item.asin,
          fnsku: item.fnsku,
          title: item.title,
          unit_weight_lb: draft.unitWeightLb ? Number(draft.unitWeightLb) : null,
        }),
      });
      await loadConfig();
      setNotice(`Đã lưu mapping cho ${amazonSku}.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Không lưu được mapping.");
    } finally {
      setBusy("");
    }
  }

  function initializeAssignments(plan: AmazonOptimizePlan): void {
    const defaultBox =
      plan.feasible_box_types.find((box) => box.id === plan.selected_box_type_id)
      ?? plan.feasible_box_types[0];
    if (!defaultBox) {
      setBoxAssignments([]);
      return;
    }
    const packGroup = workingSource === "csv" ? imported?.pack_group_number || "1" : "1";
    setBoxAssignments(
      Array.from({ length: plan.box_count }, (_, index) => ({
        boxTypeId: defaultBox.id,
        name: `P${packGroup} - B${index + 1}`,
        weightLb: defaultBox.estimated_weight_lb == null
          ? ""
          : defaultBox.estimated_weight_lb.toFixed(2),
        lengthIn: decimalText(defaultBox.length_in),
        widthIn: decimalText(defaultBox.width_in),
        heightIn: decimalText(defaultBox.height_in),
      })),
    );
  }

  function choosePlan(plan: AmazonOptimizePlan): void {
    setSelectedPlanKey(plan.key);
    initializeAssignments(plan);
  }

  async function optimize(): Promise<void> {
    if (!workingItems.length) {
      setError("Hãy chọn SKU và nhập quantity ở bảng Create workflow trước.");
      return;
    }
    if (!selectedBoxTypeIds.length) {
      setError("Hãy chọn ít nhất một loại thùng.");
      return;
    }
    setBusy("optimize");
    setError("");
    setNotice("");
    try {
      const items = workingItems.map((item) => {
        const requested = workingSource === "csv"
          ? Number(requestedQuantities[item.amazon_sku])
          : item.requested_quantity;
        const available = Number(
          availableQuantities[item.amazon_sku]
          ?? Math.max(requested, item.mapping?.quantity_on_hand ?? 0),
        );
        return {
          amazon_sku: item.amazon_sku,
          requested_quantity: requested,
          available_quantity: available,
        };
      });
      if (items.some((item) => (
        !Number.isInteger(item.requested_quantity)
        || item.requested_quantity < 1
        || !Number.isInteger(item.available_quantity)
        || item.available_quantity < item.requested_quantity
      ))) {
        setError("Requested/available quantity phải là số nguyên và available không được nhỏ hơn requested.");
        return;
      }
      const result = await apiJson<AmazonOptimizeResponse>(
        "/api/v1/amazon-shipments/optimize",
        {
          method: "POST",
          body: JSON.stringify({
            items,
            box_type_ids: selectedBoxTypeIds,
            min_box_count: Number(minBoxes),
            max_box_count: Number(maxBoxes),
          }),
        },
      );
      setPlans(result.plans);
      if (result.plans.length) {
        choosePlan(result.plans[0]);
        setNotice(`Đã tìm được ${result.plans.length} phương án Amazon-optimized.`);
      } else {
        setSelectedPlanKey("");
        setBoxAssignments([]);
        setError(result.warnings.join(" ") || "Không tìm thấy phương án phù hợp.");
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Optimizer không chạy được.");
    } finally {
      setBusy("");
    }
  }

  function changeAssignmentBoxType(index: number, boxTypeId: number): void {
    if (!selectedPlan) return;
    const boxType = selectedPlan.feasible_box_types.find((box) => box.id === boxTypeId);
    if (!boxType) return;
    setBoxAssignments((current) => current.map((assignment, assignmentIndex) => (
      assignmentIndex === index
        ? {
          ...assignment,
          boxTypeId,
          weightLb: boxType.estimated_weight_lb == null ? "" : boxType.estimated_weight_lb.toFixed(2),
          lengthIn: decimalText(boxType.length_in),
          widthIn: decimalText(boxType.width_in),
          heightIn: decimalText(boxType.height_in),
        }
        : assignment
    )));
  }

  function updateAssignment(index: number, patch: Partial<BoxAssignment>): void {
    setBoxAssignments((current) => current.map((assignment, assignmentIndex) => (
      assignmentIndex === index ? { ...assignment, ...patch } : assignment
    )));
  }

  async function exportCsv(): Promise<void> {
    if (!selectedPlan || !sourceCsv || workingSource !== "csv") return;
    if (boxAssignments.some((box) => (
      !Number(box.weightLb)
      || !Number(box.lengthIn)
      || !Number(box.widthIn)
      || !Number(box.heightIn)
    ))) {
      setError("Hãy nhập weight và dimensions hợp lệ cho mọi box trước khi export.");
      return;
    }
    setBusy("export");
    setError("");
    try {
      await downloadJsonFile(
        "/api/v1/amazon-shipments/export",
        {
          source_csv: sourceCsv,
          items: selectedPlan.items.map((item) => ({
            amazon_sku: item.amazon_sku,
            per_box_quantity: item.per_box_quantity,
          })),
          boxes: boxAssignments.map((box) => ({
            name: box.name,
            weight_lb: Number(box.weightLb),
            length_in: Number(box.lengthIn),
            width_in: Number(box.widthIn),
            height_in: Number(box.heightIn),
          })),
        },
        "amazon-optimized-box-packing.csv",
      );
      setNotice("Đã xuất Amazon CSV. Hãy bảo đảm quantity trong workflow Amazon khớp phương án đã chọn.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Không xuất được CSV.");
    } finally {
      setBusy("");
    }
  }

  async function exportAdjustedManifest(): Promise<void> {
    if (!selectedPlan || !config) return;
    const productByAmazonSku = new Map(
      config.products
        .filter((product) => product.amazon_sku)
        .map((product) => [product.amazon_sku as string, product]),
    );
    const items = selectedPlan.items.map((item) => ({
      product_id: productByAmazonSku.get(item.amazon_sku)?.id ?? 0,
      quantity: item.adjusted_quantity,
    }));
    if (items.some((item) => !item.product_id)) {
      setError("Có Amazon SKU chưa liên kết với product trên web nên chưa thể tạo workflow file.");
      return;
    }
    setBusy("adjusted-manifest");
    setError("");
    try {
      await downloadJsonFile(
        "/api/v1/amazon-shipments/manifest/export",
        { items },
        "amazon-create-workflow-optimized.xlsx",
      );
      setNotice("Đã tạo Create Workflow file theo quantity của phương án đang chọn.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Không tạo được optimized workflow file.");
    } finally {
      setBusy("");
    }
  }

  async function exportPackingXlsx(): Promise<void> {
    if (!selectedPlan) return;
    if (!packingTemplateFile) {
      setError("Hãy chọn file Box Packing Information .xlsx Amazon trả về sau khi tạo workflow.");
      return;
    }
    if (!packingTemplateFile.name.toLocaleLowerCase().endsWith(".xlsx")) {
      setError("File Box Packing Information phải là định dạng .xlsx.");
      return;
    }
    if (boxAssignments.some((box) => (
      !box.name.trim()
      || !Number(box.weightLb)
      || !Number(box.lengthIn)
      || !Number(box.widthIn)
      || !Number(box.heightIn)
    ))) {
      setError("Hãy nhập name, weight và dimensions hợp lệ cho mọi box trước khi điền XLSX.");
      return;
    }
    setBusy("pack-xlsx");
    setError("");
    try {
      await downloadJsonFile(
        "/api/v1/amazon-shipments/packing-template/export",
        {
          source_xlsx_base64: await fileBase64(packingTemplateFile),
          items: selectedPlan.items.map((item) => ({
            amazon_sku: item.amazon_sku,
            per_box_quantity: item.per_box_quantity,
          })),
          boxes: boxAssignments.map((box) => ({
            name: box.name,
            weight_lb: Number(box.weightLb),
            length_in: Number(box.lengthIn),
            width_in: Number(box.widthIn),
            height_in: Number(box.heightIn),
          })),
        },
        "amazon-box-packing-information-filled.xlsx",
      );
      setNotice("Đã điền Box Packing Information XLSX theo phương án đang chọn.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Không điền được Amazon XLSX.");
    } finally {
      setBusy("");
    }
  }

  async function handleConfirmDispatch(): Promise<void> {
    if (!selectedPlan && !directDispatchItems?.length) return;
    setBusy("dispatch");
    setError("");
    try {
      const lines = directDispatchItems?.length
        ? directDispatchItems.map((item) => ({
            amazon_sku: item.amazonSku,
            quantity: item.quantity,
            box_count: item.boxCount ?? null,
          }))
        : selectedPlan?.items.map((item) => ({
            amazon_sku: item.amazon_sku,
            quantity: item.adjusted_quantity,
            box_count: selectedPlan.box_count,
          })) ?? [];

      const payload: AmazonFbaDispatchRequest = {
        shipment_id: dispatchShipmentId.trim() || null,
        issued_by: dispatchIssuedBy.trim() || null,
        note: dispatchNote.trim() || null,
        ignore_stock: dispatchIgnoreStock,
        lines,
      };
      const res = await apiJson<AmazonFbaDispatchResponse>(
        "/api/v1/amazon-shipments/fba-dispatch",
        {
          method: "POST",
          body: JSON.stringify(payload),
        },
      );
      await loadConfig();
      setDispatchModalOpen(false);
      setDirectDispatchItems(null);
      setNotice(
        `Đã xuất kho FBA thành công! Phiếu xuất kho #${res.issue_number} (${res.total_units} units). Tồn kho đã được cập nhật.`,
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Không thể xuất kho FBA.");
    } finally {
      setBusy("");
    }
  }

  return (

    <div className="amazonShipmentPage">
      <div className="card amazonHero">
        <div>
          <div className="amazonEyebrow">FBA inbound planning</div>
          <h1>Amazon Shipment Optimizer</h1>
          <p className="muted">
            Chọn SKU một lần, tạo workflow file, tối ưu tối thiểu 5 carton giống hệt nhau và cuối
            cùng điền Box Packing Information XLSX Amazon trả về.
          </p>
          <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
            <button className="btn" type="button" onClick={() => setBoxManagerOpen(true)}>
              ⚙️ Quản lý thùng mẫu ({config?.box_types.length ?? 0})
            </button>
            <button className="btn" type="button" onClick={() => void openFbaHistory()}>
              📋 Lịch sử xuất kho FBA
            </button>
          </div>
        </div>
        <div className="amazonRuleCard">
          <strong>Identical content</strong>
          <span>Mỗi box dùng chung một content vector; box dimensions và cân nặng vẫn sửa riêng.</span>
        </div>
      </div>

      {error ? <div className="card amazonMessage error">{error}</div> : null}
      {notice ? <div className="card amazonMessage amazonSuccess">{notice}</div> : null}

      {/* Navigation Tabs */}
      <div
        style={{
          display: "flex",
          gap: "8px",
          borderBottom: "2px solid var(--border-color, #e2e8f0)",
          marginBottom: "1.5rem",
        }}
      >
        <button
          type="button"
          className="btn"
          style={{
            borderRadius: "8px 8px 0 0",
            borderBottom: activeTab === "inventory" ? "3px solid #2563eb" : "none",
            backgroundColor: activeTab === "inventory" ? "var(--bg-card, #ffffff)" : "transparent",
            color: activeTab === "inventory" ? "#2563eb" : "var(--text-muted, #64748b)",
            fontWeight: activeTab === "inventory" ? "700" : "500",
            fontSize: "1rem",
            padding: "0.6rem 1.25rem",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: "0.5rem",
          }}
          onClick={() => setActiveTab("inventory")}
        >
          📦 Tồn kho FBA & Gợi ý lấy hàng
        </button>
        <button
          type="button"
          className="btn"
          style={{
            borderRadius: "8px 8px 0 0",
            borderBottom: activeTab === "optimizer" ? "3px solid #2563eb" : "none",
            backgroundColor: activeTab === "optimizer" ? "var(--bg-card, #ffffff)" : "transparent",
            color: activeTab === "optimizer" ? "#2563eb" : "var(--text-muted, #64748b)",
            fontWeight: activeTab === "optimizer" ? "700" : "500",
            fontSize: "1rem",
            padding: "0.6rem 1.25rem",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: "0.5rem",
          }}
          onClick={() => setActiveTab("optimizer")}
        >
          🚚 Lập Kế Hoạch & Đóng Thùng (Optimizer)
        </button>
        <button
          type="button"
          className="btn"
          style={{
            borderRadius: "8px 8px 0 0",
            borderBottom: activeTab === "history" ? "3px solid #2563eb" : "none",
            backgroundColor: activeTab === "history" ? "var(--bg-card, #ffffff)" : "transparent",
            color: activeTab === "history" ? "#2563eb" : "var(--text-muted, #64748b)",
            fontWeight: activeTab === "history" ? "700" : "500",
            fontSize: "1rem",
            padding: "0.6rem 1.25rem",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: "0.5rem",
          }}
          onClick={() => setActiveTab("history")}
        >
          📜 Lịch Sử &amp; Thống Kê Shipment FBA
        </button>
        <button
          type="button"
          className="btn"
          style={{
            borderRadius: "8px 8px 0 0",
            borderBottom: activeTab === "fbm" ? "3px solid #2563eb" : "none",
            backgroundColor: activeTab === "fbm" ? "var(--bg-card, #ffffff)" : "transparent",
            color: activeTab === "fbm" ? "#2563eb" : "var(--text-muted, #64748b)",
            fontWeight: activeTab === "fbm" ? "700" : "500",
            fontSize: "1rem",
            padding: "0.6rem 1.25rem",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: "0.5rem",
          }}
          onClick={() => setActiveTab("fbm")}
        >
          📬 Đơn Hàng FBM (63)
        </button>
      </div>

      {activeTab === "inventory" ? (
        <AmazonFbaInventoryView
          onOpenOptimizerWithSkus={handleOpenOptimizerWithSkus}
          onOpenHistory={() => void openFbaHistory()}
          onOpenDispatchModal={handleOpenDirectDispatch}
        />
      ) : activeTab === "history" ? (
        <AmazonShipmentsHubView onOpenHistory={() => void openFbaHistory()} />
      ) : activeTab === "fbm" ? (
        <AmazonFbmOrdersView onOpenHistory={() => void openFbaHistory()} />
      ) : (
        <>
          {config ? (
            <AmazonManifestBuilder
              key={manifestBuilderKey}
              products={config.products}
              onSelectionChange={handleManifestSelectionChange}
            />
          ) : null}

      <details className="card amazonSection amazonOptionalImport">
        <summary>Optional: import legacy Pack individual units CSV</summary>
        <p className="muted">
          Không cần cho workflow mới. Chỉ dùng nếu bạn đã có file CSV cũ muốn đưa vào optimizer.
        </p>
        <div className="row">
          <input
            className="input"
            type="file"
            accept=".csv,text/csv"
            disabled={busy === "import"}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void importCsv(file);
            }}
          />
          {sourceFilename ? <span className="muted">{sourceFilename}</span> : null}
        </div>
        {imported ? (
          <div className="amazonStats">
            <div><strong>{imported.declared_sku_count}</strong><span>Amazon SKUs</span></div>
            <div><strong>{imported.declared_unit_count}</strong><span>Requested units</span></div>
            <div><strong>{imported.existing_box_count}</strong><span>Boxes in source</span></div>
            <div><strong>{imported.pack_group_number || "—"}</strong><span>Pack group</span></div>
          </div>
        ) : null}
      </details>

      {config ? (
        <>
          <section className="card amazonSection">
            <div className="amazonSectionHeader">
              <div>
                <span className="amazonStep">2</span>
                <h2>Shipment SKU list</h2>
              </div>
              <span className="muted">Mapping và unit weight được lưu cho lần sau.</span>
            </div>
            <div className="amazonTableScroller">
              <table className="amazonSkuTable">
                <thead>
                  <tr>
                    <th>Amazon SKU</th>
                    <th className="right">Requested</th>
                    <th className="right">Available</th>
                    <th>Web product</th>
                    <th className="right">Unit weight (lb)</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {workingItems.map((item) => {
                    const draft = mappingDrafts[item.amazon_sku] ?? { productId: "", unitWeightLb: "" };
                    return (
                      <tr key={item.amazon_sku}>
                        <td>
                          <strong>{item.amazon_sku}</strong>
                          <small className="amazonCellNote">{item.title}</small>
                        </td>
                        <td className="right">
                          {workingSource === "csv" ? (
                            <input
                              className="input amazonNumberInput"
                              type="number"
                              min={1}
                              value={requestedQuantities[item.amazon_sku] ?? item.requested_quantity}
                              onChange={(event) => setRequestedQuantities((current) => ({
                                ...current,
                                [item.amazon_sku]: event.target.value,
                              }))}
                            />
                          ) : <strong>{item.requested_quantity || "—"}</strong>}
                        </td>
                        <td className="right">
                          <input
                            className="input amazonNumberInput"
                            type="number"
                            min={1}
                            value={availableQuantities[item.amazon_sku] ?? item.requested_quantity}
                            onChange={(event) => setAvailableQuantities((current) => ({
                              ...current,
                              [item.amazon_sku]: event.target.value,
                            }))}
                          />
                        </td>
                        <td>
                          <select
                            className="select amazonProductSelect"
                            value={draft.productId}
                            onChange={(event) => setMappingDrafts((current) => ({
                              ...current,
                              [item.amazon_sku]: { ...draft, productId: event.target.value },
                            }))}
                          >
                            <option value="">Select web product…</option>
                            {config.products.map((product) => (
                              <option key={product.id} value={product.id}>
                                {product.sku} — {product.name} ({product.quantity_on_hand})
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="right">
                          <input
                            className="input amazonWeightInput"
                            type="number"
                            min={0}
                            step="0.01"
                            placeholder="Optional"
                            value={draft.unitWeightLb}
                            onChange={(event) => setMappingDrafts((current) => ({
                              ...current,
                              [item.amazon_sku]: { ...draft, unitWeightLb: event.target.value },
                            }))}
                          />
                        </td>
                        <td>
                          <div className="row" style={{ gap: 7 }}>
                            <span className={item.mapping ? "amazonStatus good" : "amazonStatus"}>
                              {item.mapping ? "Mapped" : "Missing"}
                            </span>
                            <button
                              className="btn"
                              type="button"
                              disabled={busy === `mapping:${item.amazon_sku}`}
                              onClick={() => void saveMapping(item.amazon_sku)}
                            >
                              Save
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {!workingItems.length ? (
                    <tr>
                      <td className="muted" colSpan={6}>
                        Chọn SKU và quantity ở bảng Create workflow phía trên; list sẽ tự hiện tại đây.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </section>

          <section className="card amazonSection">
            <div className="amazonSectionHeader">
              <div>
                <span className="amazonStep">3</span>
                <h2>Select box profiles</h2>
              </div>
              <button className="btn" type="button" onClick={() => setBoxManagerOpen(true)}>
                Manage box profiles
              </button>
            </div>
            <p className="muted amazonBoxSelectionHelp">
              Chỉ tick những loại thùng optimizer được phép dùng. Tạo, sửa và nhập SKU capacity trong form quản lý riêng.
            </p>

            {config.box_types.length ? (
              <div className="amazonBoxTypeGrid">
                {config.box_types.filter((boxType) => boxType.is_active).map((boxType) => (
                  <label key={boxType.id} className={selectedBoxTypeIds.includes(boxType.id) ? "amazonBoxType selected" : "amazonBoxType"}>
                    <input
                      type="checkbox"
                      checked={selectedBoxTypeIds.includes(boxType.id)}
                      onChange={(event) => setSelectedBoxTypeIds((current) => (
                        event.target.checked
                          ? [...current, boxType.id]
                          : current.filter((id) => id !== boxType.id)
                      ))}
                    />
                    <span>
                      <strong>{boxType.name}</strong>
                      <small>{decimalText(boxType.length_in)} × {decimalText(boxType.width_in)} × {decimalText(boxType.height_in)} in</small>
                      <small>Tare {decimalText(boxType.empty_weight_lb)} lb · Max {decimalText(boxType.max_weight_lb) || "—"} lb</small>
                    </span>
                    <small className="amazonBoxCapacityCount">{boxType.capacities.length} SKU capacities</small>
                  </label>
                ))}
              </div>
            ) : (
              <div className="amazonBoxSelectionEmpty">
                <span>Chưa có box profile đang hoạt động.</span>
                <button className="btn primary" type="button" onClick={() => setBoxManagerOpen(true)}>Create first profile</button>
              </div>
            )}
          </section>

          <section className="card amazonSection">
            <div className="amazonSectionHeader">
              <div>
                <span className="amazonStep">4</span>
                <h2>Optimize identical cartons</h2>
              </div>
            </div>
            <div className="row">
              <div className="field"><label>Minimum boxes</label><input className="input amazonNumberInput" type="number" min={5} max={100} value={minBoxes} onChange={(event) => setMinBoxes(event.target.value)} /></div>
              <div className="field"><label>Maximum boxes</label><input className="input amazonNumberInput" type="number" min={5} max={100} value={maxBoxes} onChange={(event) => setMaxBoxes(event.target.value)} /></div>
              <button className="btn primary amazonOptimizeButton" type="button" disabled={busy === "optimize" || !workingItems.length} onClick={() => void optimize()}>
                {busy === "optimize" ? "Optimizing…" : "Find optimized plans"}
              </button>
            </div>
          </section>

          {plans.length ? (
            <section className="card amazonSection">
              <div className="amazonSectionHeader">
                <div>
                  <span className="amazonStep">5</span>
                  <h2>Choose a plan</h2>
                </div>
                <span className="muted">Phương án đầu tiên thay đổi list ít nhất.</span>
              </div>
              <div className="amazonPlanGrid">
                {plans.map((plan, index) => (
                  <button
                    key={plan.key}
                    type="button"
                    className={plan.key === selectedPlanKey ? "amazonPlanCard selected" : "amazonPlanCard"}
                    onClick={() => choosePlan(plan)}
                  >
                    <span>{index === 0 ? "Recommended" : plan.strategy}</span>
                    <strong>{plan.box_count} identical boxes</strong>
                    <small>{plan.units_per_box} units/box · {(plan.capacity_utilization * 100).toFixed(1)}% full</small>
                    <small>{plan.adjusted_unit_count} units · Δ {plan.absolute_quantity_change}</small>
                  </button>
                ))}
              </div>

              {selectedPlan ? (
                <div className="amazonPlanDetail">
                  <div className="amazonStats">
                    <div><strong>{selectedPlan.box_count}</strong><span>Identical boxes</span></div>
                    <div><strong>{selectedPlan.units_per_box}</strong><span>Units per box</span></div>
                    <div><strong>{selectedPlan.adjusted_unit_count}</strong><span>Adjusted total</span></div>
                    <div><strong>{(selectedPlan.capacity_utilization * 100).toFixed(1)}%</strong><span>Box fill</span></div>
                  </div>
                  {selectedPlan.warnings.map((warning) => <div className="amazonInlineWarning" key={warning}>{warning}</div>)}
                  <div className="amazonTableScroller">
                    <table>
                      <thead><tr><th>Amazon SKU</th><th className="right">Requested</th><th className="right">Per box</th><th className="right">Adjusted</th><th className="right">Δ</th><th className="right">Space</th></tr></thead>
                      <tbody>
                        {selectedPlan.items.map((item) => (
                          <tr key={item.amazon_sku}>
                            <td><strong>{item.amazon_sku}</strong></td>
                            <td className="right">{item.requested_quantity}</td>
                            <td className="right"><strong>{item.per_box_quantity}</strong></td>
                            <td className="right">{item.adjusted_quantity}</td>
                            <td className={item.quantity_delta ? "right amazonDelta" : "right"}>{item.quantity_delta > 0 ? `+${item.quantity_delta}` : item.quantity_delta}</td>
                            <td className="right">{(item.capacity_fraction * 100).toFixed(1)}%</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <h3>Final box details</h3>
                  <p className="muted">Content phía trên luôn giống nhau. Bạn có thể đổi box type hoặc nhập cân nặng thực tế riêng từng carton.</p>
                  <div className="amazonAssignmentGrid">
                    {boxAssignments.map((assignment, index) => (
                      <div className="amazonAssignmentCard" key={`${selectedPlan.key}-${index}`}>
                        <strong>Box {index + 1}</strong>
                        <select className="select" value={assignment.boxTypeId} onChange={(event) => changeAssignmentBoxType(index, Number(event.target.value))}>
                          {selectedPlan.feasible_box_types.map((box) => <option key={box.id} value={box.id}>{box.name} · {(box.capacity_utilization * 100).toFixed(1)}%</option>)}
                        </select>
                        <div className="field"><label>Box name</label><input className="input" value={assignment.name} onChange={(event) => updateAssignment(index, { name: event.target.value })} /></div>
                        <div className="field"><label>Actual weight (lb)</label><input className="input" type="number" min={0.01} step="0.01" value={assignment.weightLb} onChange={(event) => updateAssignment(index, { weightLb: event.target.value })} /></div>
                        <div className="amazonDimensionRow">
                          <input className="input" aria-label="Length" type="number" min={0.01} step="0.01" value={assignment.lengthIn} onChange={(event) => updateAssignment(index, { lengthIn: event.target.value })} />
                          <span>×</span>
                          <input className="input" aria-label="Width" type="number" min={0.01} step="0.01" value={assignment.widthIn} onChange={(event) => updateAssignment(index, { widthIn: event.target.value })} />
                          <span>×</span>
                          <input className="input" aria-label="Height" type="number" min={0.01} step="0.01" value={assignment.heightIn} onChange={(event) => updateAssignment(index, { heightIn: event.target.value })} />
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="amazonExportBar">
                    <div>
                      <strong>1. Create Workflow file theo phương án đã chọn</strong>
                      <span>
                        Nếu optimizer có chỉnh quantity, dùng file này để tạo hoặc cập nhật workflow trên Amazon.
                      </span>
                    </div>
                    <button
                      className="btn primary"
                      type="button"
                      disabled={busy === "adjusted-manifest"}
                      onClick={() => void exportAdjustedManifest()}
                    >
                      {busy === "adjusted-manifest" ? "Creating…" : "Download optimized workflow XLSX"}
                    </button>
                  </div>

                  <div className="amazonExportBar amazonPackingExport">
                    <div>
                      <strong>2. Điền Box Packing Information của Amazon</strong>
                      <span>
                        Chỉ upload file .xlsx Amazon trả về sau khi workflow đã có đúng SKU và quantity.
                        File này không cần để optimize.
                      </span>
                      <input
                        className="input"
                        type="file"
                        accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                        onChange={(event) => setPackingTemplateFile(event.target.files?.[0] ?? null)}
                      />
                      {packingTemplateFile ? <small>{packingTemplateFile.name}</small> : null}
                    </div>
                    <button
                      className="btn primary"
                      type="button"
                      disabled={busy === "pack-xlsx" || !packingTemplateFile}
                      onClick={() => void exportPackingXlsx()}
                    >
                      {busy === "pack-xlsx" ? "Filling…" : "Fill & download Amazon XLSX"}
                    </button>
                  </div>

                  <div className="amazonExportBar amazonDispatchBar">
                    <div>
                      <strong>3. Xác nhận xuất kho FBA thực tế</strong>
                      <span>Trừ số lượng tồn kho (on hand) ngay trên hệ thống ULINK Storage và tạo phiếu xuất kho FBA.</span>
                    </div>
                    <button
                      className="btn primary"
                      style={{ backgroundColor: "#16a34a", borderColor: "#16a34a", color: "#fff" }}
                      type="button"
                      onClick={() => setDispatchModalOpen(true)}
                    >
                      Xuất kho FBA
                    </button>
                  </div>

                  {workingSource === "csv" && sourceCsv ? (
                    <div className="amazonExportBar amazonLegacyExport">
                      <div>
                        <strong>Legacy CSV output</strong>
                        <span>Chỉ dành cho shipment đã import bằng Pack individual units CSV cũ.</span>
                      </div>
                      <button className="btn" type="button" disabled={busy === "export"} onClick={() => void exportCsv()}>
                        {busy === "export" ? "Exporting…" : "Download optimized CSV"}
                      </button>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </section>
          ) : null}
        </>
      ) : null}
        </>
      )}
      {dispatchModalOpen && (selectedPlan || directDispatchItems?.length) ? (
        <div className="amazonBoxManagerBackdrop" role="presentation" onMouseDown={() => setDispatchModalOpen(false)}>
          <section
            className="card amazonBoxManagerModal"
            role="dialog"
            aria-label="Xác nhận xuất kho FBA"
            onMouseDown={(event) => event.stopPropagation()}
            style={{ maxWidth: "700px" }}
          >
            <div className="amazonModalHeader">
              <div>
                <h2>Xác nhận xuất kho FBA thực tế</h2>
                <span className="muted">Hệ thống sẽ tạo phiếu xuất kho mục đích AMAZON_FBA và trừ tồn kho các SKU dưới đây:</span>
              </div>
              <button className="btn icon" type="button" onClick={() => setDispatchModalOpen(false)}>✕</button>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem", margin: "1rem 0" }}>
              <div>
                <label className="label">Mã Lô Hàng / Shipment ID (Amazon)</label>
                <input
                  className="input"
                  placeholder="vd: FBA18XYZ hoặc Lô Khăn Houston"
                  value={dispatchShipmentId}
                  onChange={(e) => setDispatchShipmentId(e.target.value)}
                />
              </div>
              <div>
                <label className="label">Người xuất / đóng hàng</label>
                <input
                  className="input"
                  placeholder="vd: Tùng Võ"
                  value={dispatchIssuedBy}
                  onChange={(e) => setDispatchIssuedBy(e.target.value)}
                />
              </div>
            </div>

            <div style={{ marginBottom: "1rem" }}>
              <label className="label">Ghi chú phiếu xuất</label>
              <input
                className="input"
                placeholder="vd: Gửi Dallas FBA, FedEx tracking 123..."
                value={dispatchNote}
                onChange={(e) => setDispatchNote(e.target.value)}
              />
            </div>

            <div style={{ marginBottom: "1rem" }}>
              <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={dispatchIgnoreStock}
                  onChange={(e) => setDispatchIgnoreStock(e.target.checked)}
                />
                <span style={{ fontSize: "0.9rem" }}>Cho phép xuất âm nếu tồn kho hiện tại không đủ (Ignore stock check)</span>
              </label>
            </div>

            <div className="amazonTableScroller" style={{ maxHeight: "250px", marginBottom: "1rem" }}>
              <table className="amazonManifestTable">
                <thead>
                  <tr>
                    <th>Amazon SKU</th>
                    <th>Sản phẩm</th>
                    <th className="right">Số lượng xuất</th>
                    <th className="right">Tồn hiện tại</th>
                    <th className="right">Tồn sau xuất</th>
                  </tr>
                </thead>
                <tbody>
                  {directDispatchItems?.length
                    ? directDispatchItems.map((item) => {
                        const product = config?.products.find((p) => p.amazon_sku === item.amazonSku);
                        const currentOnHand = product?.quantity_on_hand ?? 0;
                        const afterOnHand = currentOnHand - item.quantity;
                        return (
                          <tr key={item.amazonSku}>
                            <td><strong>{item.amazonSku}</strong></td>
                            <td>{product?.name ?? item.productName ?? "—"}</td>
                            <td className="right" style={{ color: "#2563eb", fontWeight: "bold" }}>
                              {item.quantity}
                            </td>
                            <td className="right">{currentOnHand}</td>
                            <td className="right" style={{ color: afterOnHand < 0 ? "#dc2626" : "#16a34a", fontWeight: "bold" }}>
                              {afterOnHand}
                            </td>
                          </tr>
                        );
                      })
                    : selectedPlan?.items.map((item) => {
                        const product = config?.products.find((p) => p.amazon_sku === item.amazon_sku);
                        const currentOnHand = product?.quantity_on_hand ?? 0;
                        const afterOnHand = currentOnHand - item.adjusted_quantity;
                        return (
                          <tr key={item.amazon_sku}>
                            <td><strong>{item.amazon_sku}</strong></td>
                            <td>{product?.name ?? item.title ?? "—"}</td>
                            <td className="right" style={{ color: "#2563eb", fontWeight: "bold" }}>
                              {item.adjusted_quantity}
                            </td>
                            <td className="right">{currentOnHand}</td>
                            <td className="right" style={{ color: afterOnHand < 0 ? "#dc2626" : "#16a34a", fontWeight: "bold" }}>
                              {afterOnHand}
                            </td>
                          </tr>
                        );
                      })}
                </tbody>
              </table>
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.75rem" }}>
              <button className="btn" type="button" onClick={() => setDispatchModalOpen(false)}>
                Hủy
              </button>
              <button
                className="btn primary"
                type="button"
                disabled={busy === "dispatch"}
                onClick={() => void handleConfirmDispatch()}
                style={{ backgroundColor: "#16a34a", borderColor: "#16a34a" }}
              >
                {busy === "dispatch" ? "Đang xuất kho..." : "Xác nhận & Trừ tồn kho"}
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {config ? (
        <AmazonBoxProfileManager
          open={boxManagerOpen}
          config={config}
          onClose={() => setBoxManagerOpen(false)}
          onReload={loadConfig}
          onSavedBox={(boxTypeId) => setSelectedBoxTypeIds((current) => (
            current.includes(boxTypeId) ? current : [...current, boxTypeId]
          ))}
        />
      ) : null}

      {fbaHistoryOpen ? (
        <div className="amazonBoxManagerBackdrop" role="presentation" onMouseDown={() => setFbaHistoryOpen(false)}>
          <section
            className="card amazonBoxManagerModal"
            role="dialog"
            aria-label="Lịch sử xuất kho FBA"
            onMouseDown={(event) => event.stopPropagation()}
            style={{ maxWidth: "850px", maxHeight: "85vh", overflowY: "auto" }}
          >
            <div className="amazonModalHeader">
              <div>
                <h2>Lịch sử xuất kho FBA</h2>
                <span className="muted">Danh sách các phiếu xuất kho đã gửi vào Amazon FBA.</span>
              </div>
              <button className="btn icon" type="button" onClick={() => setFbaHistoryOpen(false)}>✕</button>
            </div>

            {fbaHistoryLoading ? (
              <div style={{ padding: "2rem", textAlign: "center" }} className="muted">Đang tải dữ liệu...</div>
            ) : !fbaHistory.length ? (
              <div style={{ padding: "2rem", textAlign: "center" }} className="muted">Chưa có lịch sử xuất kho FBA nào.</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "1rem", marginTop: "1rem" }}>
                {fbaHistory.map((issue) => {
                  const totalQty = issue.lines.reduce((sum, l) => sum + l.quantity, 0);
                  const issueDate = new Date(issue.issued_at || issue.created_at).toLocaleString();
                  return (
                    <div key={issue.id} className="card" style={{ padding: "1rem", border: "1px solid var(--border-color, #e2e8f0)" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "0.5rem" }}>
                        <div>
                          <strong style={{ fontSize: "1.05rem" }}>#{issue.issue_number || `ISSUE-${issue.id}`}</strong>
                          <span className="amazonStatus good" style={{ marginLeft: "0.5rem", fontSize: "0.8rem" }}>{issue.purpose}</span>
                          <div className="muted" style={{ fontSize: "0.85rem", marginTop: "2px" }}>
                            {issue.issued_to ? <span>Gửi đến: <strong>{issue.issued_to}</strong> · </span> : null}
                            <span>Ngày: {issueDate}</span>
                            {issue.issued_by ? <span> · Người xuất: {issue.issued_by}</span> : null}
                          </div>
                        </div>
                        <div style={{ textAlign: "right" }}>
                          <span style={{ fontWeight: "bold", color: "#2563eb", fontSize: "1.1rem" }}>{totalQty}</span>
                          <span className="muted" style={{ fontSize: "0.85rem", marginLeft: "4px" }}>units</span>
                        </div>
                      </div>

                      {issue.note ? (
                        <div className="muted" style={{ fontSize: "0.85rem", marginBottom: "0.5rem", fontStyle: "italic" }}>
                          Ghi chú: {issue.note}
                        </div>
                      ) : null}

                      <div className="amazonTableScroller" style={{ maxHeight: "180px" }}>
                        <table className="amazonManifestTable" style={{ fontSize: "0.85rem" }}>
                          <thead>
                            <tr>
                              <th>SKU</th>
                              <th>Tên sản phẩm</th>
                              <th className="right">Số lượng</th>
                              <th>Chi tiết</th>
                            </tr>
                          </thead>
                          <tbody>
                            {issue.lines.map((line) => (
                              <tr key={line.id}>
                                <td><strong>{line.sku}</strong></td>
                                <td>{line.product_name}</td>
                                <td className="right" style={{ fontWeight: "bold" }}>{line.quantity} {line.uom || "unit"}</td>
                                <td className="muted">{line.note || "—"}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "1.5rem" }}>
              <button className="btn" type="button" onClick={() => setFbaHistoryOpen(false)}>
                Đóng
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
