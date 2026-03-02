export type Product = {
  id: number;
  category_id: number | null;
  sku: string;
  name: string;
  description: string | null;
  image_url: string | null;
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

export type Category = {
  id: number;
  name: string;
  description: string | null;
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
  product_id: number;
  sku: string;
  product_name: string;
  uom: string;
  quantity: number;
  unit_price: string;
  discount_amount: string;
  line_total: string;
};

export type Invoice = {
  id: number;
  sale_order_id: number;
  invoice_number: string;
  customer_name: string | null;
  issued_at: string;
  due_at: string | null;
  status: "ISSUED" | "PAID" | "VOID";
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
  lines: InvoiceLine[];
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
