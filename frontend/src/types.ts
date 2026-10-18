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
  hs_code: string | null;
  carton_net_weight_kg: number | null;
  carton_gross_weight_kg: number | null;
  carton_length_cm: number | null;
  carton_width_cm: number | null;
  carton_height_cm: number | null;
  cartons_per_20ft: number | null;
  cartons_per_40ft: number | null;
  country_of_origin: string | null;
  upc: string | null;
  catalog_badges: string | null;
  catalog_enabled: boolean;
  catalog_sort_order: number;
  is_sold_on_amazon: boolean;
  amazon_sku: string | null;
  business_unit: string;
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
  business_unit?: string;
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
  invoice_id?: number | null;
  invoice_line_id?: number | null;
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
  lot_number?: string | null;
  expiry_date?: string | null;
  carton_count?: number | null;
  pieces_per_carton?: number | null;
  allocated_cost?: string | number | null;
};

export type InventoryReceipt = {
  id: number;
  receipt_number: string | null;
  received_at: string;
  received_by: string | null;
  note: string | null;
  receipt_type?: "STANDARD" | "CONTAINER" | "GROCERY" | "BULK" | "REPACK" | string;
  supplier_name?: string | null;
  container_number?: string | null;
  container_cost?: string | number | null;
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

export type AmazonFbaDispatchLine = {
  amazon_sku?: string | null;
  sku?: string | null;
  product_id?: number | null;
  quantity: number;
  box_count?: number | null;
};

export type AmazonFbaDispatchRequest = {
  shipment_id?: string | null;
  issued_by?: string | null;
  note?: string | null;
  ignore_stock?: boolean;
  lines: AmazonFbaDispatchLine[];
};

export type AmazonFbaDispatchResponseItem = {
  product_id: number;
  sku: string;
  amazon_sku: string | null;
  product_name: string;
  quantity: number;
  box_count?: number | null;
  quantity_before: number;
  quantity_after: number;
};

export type AmazonFbaDispatchResponse = {
  issue_id: number;
  issue_number: string;
  issued_at: string;
  purpose: string;
  issued_to: string | null;
  total_units: number;
  note: string | null;
  lines: AmazonFbaDispatchResponseItem[];
};


export type CustomerPriceItem = {
  product_id: number;
  sku: string;
  product_name: string;
  product_image_url?: string | null;
  category_name?: string | null;
  default_price: number | string;
  custom_price?: number | string | null;
  effective_price: number | string;
  last_sold_at?: string | null;
  last_invoice_number?: string | null;
  notes?: string | null;
};

export type AmazonFbaItemStock = {
  sku: string;
  asin?: string | null;
  product_name?: string | null;
  condition?: string | null;
  total_quantity: number;
  fulfillable_quantity: number;
  inbound_quantity: number;
  reserved_quantity: number;
  ulink_product_id?: number | null;
  ulink_sku?: string | null;
  ulink_product_name?: string | null;
  ulink_stock: number;
  uom?: string;
  uom_multiplier?: number;
  ulink_stock_uom?: number;
  image_url?: string | null;
  status: 'OUT_OF_STOCK' | 'LOW_STOCK' | 'HEALTHY';
  is_mapped: boolean;
};

export type AmazonFbaInventorySummary = {
  total_items: number;
  total_fulfillable: number;
  total_inbound: number;
  total_reserved: number;
  low_stock_count: number;
  out_of_stock_count: number;
  healthy_count: number;
  items: AmazonFbaItemStock[];
  last_updated: string;
};

export type AmazonRestockSuggestionItem = {
  amazon_sku: string;
  asin?: string | null;
  ulink_product_id?: number | null;
  ulink_sku?: string | null;
  product_name: string;
  image_url?: string | null;
  current_fba_fulfillable: number;
  current_fba_inbound: number;
  ulink_available_stock: number;
  ulink_available_dozens?: number;
  uom?: string;
  uom_multiplier?: number;
  box_type_id?: number | null;
  box_name?: string | null;
  units_per_box: number;
  suggested_boxes: number;
  total_units_to_pick: number;
  total_pieces_to_pick?: number;
  ai_reasoning: string;
  can_fulfill: boolean;
};

export type AmazonRestockSuggestionResponse = {
  total_boxes: number;
  total_units: number;
  items: AmazonRestockSuggestionItem[];
  warnings: string[];
};

export type AmazonRestockSuggestRequest = {
  selected_skus?: string[] | null;
  min_boxes?: number;
  target_boxes_per_sku?: number;
};

export type AmazonShipmentProductTotal = {
  amazon_sku: string;
  ulink_sku?: string | null;
  product_name: string;
  total_shipped: number;
  fba_shipped?: number;
  fbm_shipped?: number;
  image_url?: string | null;
};

export type AmazonShipmentBatchItem = {
  amazon_sku: string;
  ulink_sku?: string | null;
  product_name: string;
  quantity: number;
};

export type AmazonShipmentBatch = {
  date: string;
  display_date: string;
  shipments_count: number;
  total_units: number;
  issue_number?: string | null;
  issue_id?: number | null;
  is_synced: boolean;
  items: AmazonShipmentBatchItem[];
};

export type AmazonShipmentsHubResponse = {
  total_units_all_time: number;
  total_shipments_all_time: number;
  total_batches_all_time: number;
  fba_units_total?: number;
  fbm_units_total?: number;
  fbm_orders_total?: number;
  combined_total_units?: number;
  product_totals: AmazonShipmentProductTotal[];
  batches: AmazonShipmentBatch[];
};

export type AmazonFbmItem = {
  sku: string;
  quantity: number;
  title?: string | null;
  price?: string | null;
  dozens: number;
  pieces: number;
  ulink_sku?: string | null;
  ulink_product_name?: string | null;
  product_id?: number | null;
};

export type AmazonFbmOrder = {
  order_id: string;
  purchase_date: string;
  order_status: string;
  recipient_name?: string | null;
  city?: string | null;
  state?: string | null;
  postal_code?: string | null;
  order_total?: string | null;
  currency: string;
  items: AmazonFbmItem[];
  issue_number?: string | null;
  issue_id?: number | null;
  is_synced: boolean;
};

export type AmazonFbmOrdersResponse = {
  total_orders: number;
  shipped_orders_count: number;
  unshipped_orders_count: number;
  total_packs: number;
  total_dozens: number;
  total_pieces: number;
  orders: AmazonFbmOrder[];
};
