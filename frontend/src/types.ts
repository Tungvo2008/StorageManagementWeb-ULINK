export type Product = {
  id: number;
  category_id: number | null;
  sku: string;
  name: string;
  description: string | null;
  image_url: string | null;
  brand: string | null;
  catalog_short_name: string | null;
  unit_size: string | null;
  catalog_case_pack: number | null;
  country_of_origin: string | null;
  upc: string | null;
  catalog_badges: string | null;
  catalog_enabled: boolean;
  catalog_sort_order: number;
  is_sold_on_amazon: boolean;
  amazon_sku: string | null;
  base_uom: string;
  uom: string;
  uom_multiplier: number;
  cost_price: string;
  unit_price: string;
  currency: string;
  quantity_on_hand: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type AmazonWebProduct = {
  id: number;
  sku: string;
  name: string;
  image_url: string | null;
  quantity_on_hand: number;
  is_sold_on_amazon: boolean;
  amazon_sku: string | null;
};

export type AmazonMapping = {
  id: number;
  amazon_sku: string;
  product_id: number | null;
  product_sku: string | null;
  product_name: string | null;
  quantity_on_hand: number | null;
  asin: string | null;
  fnsku: string | null;
  title: string | null;
  unit_weight_lb: number | null;
};

export type AmazonCapacity = {
  id: number;
  mapping_id: number;
  amazon_sku: string;
  units_capacity: number;
};

export type AmazonBoxType = {
  id: number;
  name: string;
  length_in: number;
  width_in: number;
  height_in: number;
  empty_weight_lb: number;
  max_weight_lb: number | null;
  is_active: boolean;
  capacities: AmazonCapacity[];
};

export type AmazonShipmentConfig = {
  products: AmazonWebProduct[];
  mappings: AmazonMapping[];
  box_types: AmazonBoxType[];
};

export type AmazonImportedItem = {
  amazon_sku: string;
  title: string;
  asin: string | null;
  fnsku: string | null;
  requested_quantity: number;
  mapping: AmazonMapping | null;
};

export type AmazonImportedBox = {
  number: number;
  name: string | null;
  weight_lb: number | null;
  length_in: number | null;
  width_in: number | null;
  height_in: number | null;
};

export type AmazonCsvImport = {
  pack_group_number: string;
  workflow_name: string;
  declared_sku_count: number;
  declared_unit_count: number;
  existing_box_count: number;
  items: AmazonImportedItem[];
  boxes: AmazonImportedBox[];
  warnings: string[];
};

export type AmazonPlanItem = {
  amazon_sku: string;
  title: string | null;
  requested_quantity: number;
  available_quantity: number;
  per_box_quantity: number;
  adjusted_quantity: number;
  quantity_delta: number;
  unit_weight_lb: number | null;
  capacity_units: number;
  capacity_fraction: number;
};

export type AmazonFeasibleBox = {
  id: number;
  name: string;
  length_in: number;
  width_in: number;
  height_in: number;
  empty_weight_lb: number;
  max_weight_lb: number | null;
  capacity_utilization: number;
  estimated_weight_lb: number | null;
};

export type AmazonOptimizePlan = {
  key: string;
  strategy: string;
  box_count: number;
  selected_box_type_id: number;
  selected_box_type_name: string;
  requested_unit_count: number;
  adjusted_unit_count: number;
  absolute_quantity_change: number;
  units_per_box: number;
  capacity_utilization: number;
  estimated_weight_lb: number | null;
  items: AmazonPlanItem[];
  feasible_box_types: AmazonFeasibleBox[];
  warnings: string[];
};

export type AmazonOptimizeResponse = {
  plans: AmazonOptimizePlan[];
  warnings: string[];
};

export type Category = {
  id: number;
  name: string;
  description: string | null;
  catalog_sort_order: number;
  created_at: string;
  updated_at: string;
};

export type Customer = {
  id: number;
  name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  city: string | null;
  zip_code: string | null;
  created_at: string;
  updated_at: string;
};

export type UserAccount = {
  id: number;
  username: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type SaleOrderLine = {
  id: number;
  product_id: number;
  sku: string;
  product_name: string;
  quantity: number;
  unit_price: string;
  discount_amount: string;
  line_total: string;
};

export type SaleOrder = {
  id: number;
  customer_id: number | null;
  status: "DRAFT" | "CONFIRMED" | "CANCELLED";
  currency: string;
  tax_rate: string;
  subtotal_amount: string;
  order_discount_amount: string;
  discount_amount: string;
  shipping_amount: string;
  tax_amount: string;
  total_amount: string;
  created_at: string;
  updated_at: string;
  lines: SaleOrderLine[];
};

export type InvoiceLine = {
  id: number;
  line_type: "PRODUCT" | "FREE";
  product_id: number | null;
  sku: string;
  product_name: string;
  uom: string;
  quantity: number;
  unit_price: string;
  discount_amount: string;
  line_total: string;
};

export type InvoicePayment = {
  id: number;
  invoice_id: number;
  paid_at: string;
  amount: string;
  method: string | null;
  note: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type Invoice = {
  id: number;
  sale_order_id: number | null;
  merged_into_invoice_id: number | null;
  invoice_number: string;
  customer_name: string | null;
  client_name_snapshot?: string | null;
  tele_snapshot?: string | null;
  address_snapshot?: string | null;
  city_snapshot?: string | null;
  zip_code_snapshot?: string | null;
  note?: string | null;
  issued_at: string;
  due_at: string | null;
  status: "DRAFT" | "ISSUED" | "PAID" | "VOID";
  payment_status: "UNPAID" | "PARTIAL" | "PAID" | "VOID";
  currency: string;
  tax_rate: string;
  subtotal_amount: string;
  order_discount_amount: string;
  discount_amount: string;
  shipping_amount: string;
  tax_amount: string;
  total_amount: string;
  amount_paid: string;
  balance_due: string;
  created_at: string;
  updated_at: string;
  lines: InvoiceLine[];
  payments: InvoicePayment[];
};

export type StockMovement = {
  id: number;
  product_id: number;
  receipt_id: number | null;
  issue_id: number | null;
  sale_order_id: number | null;
  movement_type: "IN" | "OUT" | "ADJUST";
  quantity_delta: number;
  note: string | null;
  created_at: string;
};

export type InventoryReceiptLine = {
  id: number;
  product_id: number;
  sku: string;
  product_name: string;
  uom: string;
  uom_multiplier: number;
  quantity: number;
  unit_cost: string;
  currency: string;
  line_total: string;
  note: string | null;
};

export type InventoryReceipt = {
  id: number;
  receipt_number: string | null;
  received_at: string;
  received_by: string | null;
  note: string | null;
  created_at: string;
  updated_at: string;
  lines: InventoryReceiptLine[];
};

export type InventoryReceiptSummary = {
  product_id: number;
  sku: string;
  product_name: string;
  category_id: number | null;
  category_name: string | null;
  base_uom: string;
  uom: string;
  uom_multiplier: number;
  currency: string;
  quantity_on_hand: number;
  receipt_count: number;
  line_count: number;
  total_received_base_qty: number;
  total_received_sale_qty: string;
  total_received_amount: string;
  last_received_at: string | null;
};

export type InventoryIssueLine = {
  id: number;
  product_id: number;
  sku: string;
  product_name: string;
  uom: string;
  uom_multiplier: number;
  quantity: number;
  note: string | null;
};

export type InventoryIssue = {
  id: number;
  issue_number: string | null;
  issued_at: string;
  issued_by: string | null;
  issued_to: string | null;
  purpose: string;
  note: string | null;
  sale_order_id: number | null;
  created_at: string;
  updated_at: string;
  lines: InventoryIssueLine[];
};
