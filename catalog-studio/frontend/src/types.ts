export type Category = { id: number; name: string; sort_order: number };

export type Product = {
  id: number;
  sku: string;
  name: string;
  brand: string;
  category_id: number | null;
  category_name: string;
  image_url: string | null;
  unit_size: string;
  case_pack: number | null;
  country_of_origin: string;
  upc: string;
  wholesale_price: string;
  currency: string;
  stock_qty: number;
  badges: string;
  catalog_enabled: boolean;
  is_active: boolean;
  sort_order: number;
};

export type ProductDraft = Omit<Product, "id" | "category_name">;
