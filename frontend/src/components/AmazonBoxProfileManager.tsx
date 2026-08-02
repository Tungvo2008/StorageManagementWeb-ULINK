import { useEffect, useMemo, useState } from "react";

import { apiJson } from "../api/client";
import type { AmazonBoxType, AmazonShipmentConfig } from "../types";


type Props = {
  open: boolean;
  config: AmazonShipmentConfig;
  onClose: () => void;
  onReload: () => Promise<AmazonShipmentConfig>;
  onSavedBox: (boxTypeId: number) => void;
};

type BoxForm = {
  name: string;
  lengthIn: string;
  widthIn: string;
  heightIn: string;
  emptyWeightLb: string;
  maxWeightLb: string;
  isActive: boolean;
};

const EMPTY_BOX_FORM: BoxForm = {
  name: "",
  lengthIn: "",
  widthIn: "",
  heightIn: "",
  emptyWeightLb: "0",
  maxWeightLb: "50",
  isActive: true,
};

function decimalText(value: number | null): string {
  if (value == null) return "";
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(4)));
}

function capacityKey(boxTypeId: number, amazonSku: string): string {
  return `${boxTypeId}::${amazonSku}`;
}

export default function AmazonBoxProfileManager({
  open,
  config,
  onClose,
  onReload,
  onSavedBox,
}: Props) {
  const [selectedBoxId, setSelectedBoxId] = useState<number | null>(null);
  const [editingBoxId, setEditingBoxId] = useState<number | null>(null);
  const [boxForm, setBoxForm] = useState<BoxForm>(EMPTY_BOX_FORM);
  const [capacityDrafts, setCapacityDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    if (!open) return;
    setSelectedBoxId((current) => (
      current && config.box_types.some((box) => box.id === current)
        ? current
        : config.box_types[0]?.id ?? null
    ));
  }, [config.box_types, open]);

  useEffect(() => {
    const next: Record<string, string> = {};
    for (const boxType of config.box_types) {
      for (const capacity of boxType.capacities) {
        next[capacityKey(boxType.id, capacity.amazon_sku)] = String(capacity.units_capacity);
      }
    }
    setCapacityDrafts(next);
  }, [config.box_types]);

  const selectedBox = useMemo(
    () => config.box_types.find((boxType) => boxType.id === selectedBoxId) ?? null,
    [config.box_types, selectedBoxId],
  );

  function startNewBox(): void {
    setEditingBoxId(null);
    setBoxForm(EMPTY_BOX_FORM);
    setError("");
    setNotice("");
  }

  function startEditBox(boxType: AmazonBoxType): void {
    setSelectedBoxId(boxType.id);
    setEditingBoxId(boxType.id);
    setBoxForm({
      name: boxType.name,
      lengthIn: decimalText(boxType.length_in),
      widthIn: decimalText(boxType.width_in),
      heightIn: decimalText(boxType.height_in),
      emptyWeightLb: decimalText(boxType.empty_weight_lb),
      maxWeightLb: decimalText(boxType.max_weight_lb),
      isActive: boxType.is_active,
    });
    setError("");
    setNotice("");
  }

  async function saveBoxType(): Promise<void> {
    const dimensions = [boxForm.lengthIn, boxForm.widthIn, boxForm.heightIn].map(Number);
    if (!boxForm.name.trim() || dimensions.some((value) => !Number.isFinite(value) || value <= 0)) {
      setError("Nhập tên và ba kích thước thùng lớn hơn 0.");
      return;
    }
    setBusy("box");
    setError("");
    setNotice("");
    try {
      const saved = await apiJson<AmazonBoxType>(
        editingBoxId
          ? `/api/v1/amazon-shipments/box-types/${editingBoxId}`
          : "/api/v1/amazon-shipments/box-types",
        {
          method: editingBoxId ? "PUT" : "POST",
          body: JSON.stringify({
            name: boxForm.name.trim(),
            length_in: dimensions[0],
            width_in: dimensions[1],
            height_in: dimensions[2],
            empty_weight_lb: Number(boxForm.emptyWeightLb || 0),
            max_weight_lb: boxForm.maxWeightLb ? Number(boxForm.maxWeightLb) : null,
            is_active: boxForm.isActive,
          }),
        },
      );
      await onReload();
      if (saved.is_active) onSavedBox(saved.id);
      setSelectedBoxId(saved.id);
      setEditingBoxId(null);
      setBoxForm(EMPTY_BOX_FORM);
      setNotice(`Đã lưu box profile ${saved.name}.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Không lưu được box profile.");
    } finally {
      setBusy("");
    }
  }

  async function saveCapacity(mappingId: number, amazonSku: string): Promise<void> {
    if (!selectedBox) return;
    const value = Number(capacityDrafts[capacityKey(selectedBox.id, amazonSku)]);
    if (!Number.isInteger(value) || value < 1) {
      setError("Units-per-box phải là số nguyên lớn hơn 0.");
      return;
    }
    setBusy(`capacity:${amazonSku}`);
    setError("");
    setNotice("");
    try {
      await apiJson("/api/v1/amazon-shipments/capacities", {
        method: "PUT",
        body: JSON.stringify({
          box_type_id: selectedBox.id,
          mapping_id: mappingId,
          units_capacity: value,
        }),
      });
      await onReload();
      setNotice(`Đã lưu sức chứa ${amazonSku} trong ${selectedBox.name}.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Không lưu được sức chứa.");
    } finally {
      setBusy("");
    }
  }

  if (!open) return null;

  return (
    <div className="amazonBoxManagerBackdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="card amazonBoxManagerModal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="amazon-box-manager-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="amazonBoxManagerHeader">
          <div>
            <div className="amazonEyebrow">Reusable carton settings</div>
            <h2 id="amazon-box-manager-title">Box Profile Manager</h2>
            <p className="muted">Tạo kích thước thùng và lưu sức chứa riêng của từng Amazon SKU.</p>
          </div>
          <button className="btn" type="button" onClick={onClose}>Close</button>
        </div>

        {error ? <div className="amazonInlineWarning">{error}</div> : null}
        {notice ? <div className="amazonManifestSuccess">{notice}</div> : null}

        <div className="amazonBoxManagerLayout">
          <aside className="amazonBoxManagerSidebar">
            <div className="amazonBoxManagerSidebarTitle">
              <strong>Saved profiles</strong>
              <button className="btn" type="button" onClick={startNewBox}>New</button>
            </div>
            {config.box_types.map((boxType) => (
              <button
                key={boxType.id}
                type="button"
                className={boxType.id === selectedBoxId ? "amazonBoxManagerProfile selected" : "amazonBoxManagerProfile"}
                onClick={() => setSelectedBoxId(boxType.id)}
              >
                <span>
                  <strong>{boxType.name}</strong>
                  <small>{decimalText(boxType.length_in)} × {decimalText(boxType.width_in)} × {decimalText(boxType.height_in)} in</small>
                  <small>{boxType.capacities.length} saved SKU capacities</small>
                </span>
                <span className={boxType.is_active ? "amazonStatus good" : "amazonStatus"}>
                  {boxType.is_active ? "Active" : "Off"}
                </span>
              </button>
            ))}
            {!config.box_types.length ? <p className="muted">Chưa có box profile nào.</p> : null}
          </aside>

          <div className="amazonBoxManagerContent">
            <section className="amazonBoxManagerFormCard">
              <div className="amazonBoxManagerFormTitle">
                <div>
                  <h3>{editingBoxId ? "Edit box profile" : "Create box profile"}</h3>
                  <span className="muted">Dimensions dùng inch, weight dùng lb.</span>
                </div>
                {selectedBox && editingBoxId !== selectedBox.id ? (
                  <button className="btn" type="button" onClick={() => startEditBox(selectedBox)}>Edit selected</button>
                ) : null}
              </div>
              <div className="amazonBoxManagerForm">
                <div className="field amazonWideField">
                  <label>Box name</label>
                  <input className="input" value={boxForm.name} onChange={(event) => setBoxForm((current) => ({ ...current, name: event.target.value }))} placeholder="16x28 - New" />
                </div>
                <div className="field"><label>Length (in)</label><input className="input" type="number" min={0.01} step="0.01" value={boxForm.lengthIn} onChange={(event) => setBoxForm((current) => ({ ...current, lengthIn: event.target.value }))} /></div>
                <div className="field"><label>Width (in)</label><input className="input" type="number" min={0.01} step="0.01" value={boxForm.widthIn} onChange={(event) => setBoxForm((current) => ({ ...current, widthIn: event.target.value }))} /></div>
                <div className="field"><label>Height (in)</label><input className="input" type="number" min={0.01} step="0.01" value={boxForm.heightIn} onChange={(event) => setBoxForm((current) => ({ ...current, heightIn: event.target.value }))} /></div>
                <div className="field"><label>Empty weight (lb)</label><input className="input" type="number" min={0} step="0.01" value={boxForm.emptyWeightLb} onChange={(event) => setBoxForm((current) => ({ ...current, emptyWeightLb: event.target.value }))} /></div>
                <div className="field"><label>Max weight (lb)</label><input className="input" type="number" min={0.01} step="0.01" value={boxForm.maxWeightLb} onChange={(event) => setBoxForm((current) => ({ ...current, maxWeightLb: event.target.value }))} /></div>
              </div>
              <div className="amazonBoxManagerFormActions">
                <label className="row"><input type="checkbox" checked={boxForm.isActive} onChange={(event) => setBoxForm((current) => ({ ...current, isActive: event.target.checked }))} /> Active profile</label>
                <div className="row">
                  {editingBoxId ? <button className="btn" type="button" onClick={startNewBox}>Cancel edit</button> : null}
                  <button className="btn primary" type="button" disabled={busy === "box"} onClick={() => void saveBoxType()}>
                    {busy === "box" ? "Saving…" : editingBoxId ? "Update profile" : "Add profile"}
                  </button>
                </div>
              </div>
            </section>

            <section className="amazonBoxManagerCapacityCard">
              <div className="amazonBoxManagerCapacityHeader">
                <div>
                  <h3>SKU capacity</h3>
                  <p className="muted">Số units tối đa khi thùng chỉ chứa riêng SKU đó.</p>
                </div>
                <select className="select" value={selectedBoxId ?? ""} onChange={(event) => setSelectedBoxId(Number(event.target.value))}>
                  <option value="" disabled>Select box profile…</option>
                  {config.box_types.map((boxType) => <option key={boxType.id} value={boxType.id}>{boxType.name}</option>)}
                </select>
              </div>
              {selectedBox ? (
                <div className="amazonCapacityGrid">
                  {config.mappings.map((mapping) => {
                    const key = capacityKey(selectedBox.id, mapping.amazon_sku);
                    return (
                      <div className="amazonCapacityRow" key={mapping.amazon_sku}>
                        <div><strong>{mapping.amazon_sku}</strong><small>{mapping.product_sku ?? mapping.product_name ?? "Unmapped"}</small></div>
                        <input
                          className="input amazonNumberInput"
                          type="number"
                          min={1}
                          placeholder="Units"
                          value={capacityDrafts[key] ?? ""}
                          onChange={(event) => setCapacityDrafts((current) => ({ ...current, [key]: event.target.value }))}
                        />
                        <button className="btn" type="button" disabled={busy === `capacity:${mapping.amazon_sku}`} onClick={() => void saveCapacity(mapping.id, mapping.amazon_sku)}>Save</button>
                      </div>
                    );
                  })}
                  {!config.mappings.length ? <p className="muted">Chưa có Amazon SKU mapping nào.</p> : null}
                </div>
              ) : <p className="muted">Tạo hoặc chọn một box profile để nhập capacity.</p>}
            </section>
          </div>
        </div>
      </section>
    </div>
  );
}
