// The two supported supplier layouts: header names, required columns and size headers.
export type LayoutId = "northstar" | "harbor";

export type Field =
  | "itemCode"
  | "description"
  | "size"
  | "quantity"
  | "unitCost"
  | "retailPrice"
  | "category"
  | "supplierTotal";

export type LayoutSpec = {
  id: LayoutId;
  label: string;
  columns: Partial<Record<Field, string>>;
  required: Field[];
  sizeHeaders?: string[];
};

export const NORTHSTAR: LayoutSpec = {
  id: "northstar",
  label: "Northstar (one item and size per row)",
  columns: {
    itemCode: "Item Code",
    description: "Description",
    size: "Size",
    quantity: "Units Available",
    unitCost: "Cost USD",
    retailPrice: "Retail USD",
    category: "Category",
  },
  required: ["itemCode", "description", "size", "quantity", "unitCost"],
};

export const HARBOR: LayoutSpec = {
  id: "harbor",
  label: "Harbor (sizes across columns)",
  columns: {
    itemCode: "Style",
    description: "Product",
    unitCost: "Unit Cost USD",
    retailPrice: "Retail USD",
    supplierTotal: "Total Units",
  },
  required: ["itemCode", "description", "unitCost"],
  sizeHeaders: ["XXS", "XS", "S", "M", "L", "XL", "XXL", "2XL", "3XL"],
};

export const LAYOUTS: LayoutSpec[] = [NORTHSTAR, HARBOR];

export const HEADER_SEARCH_ROWS = 30;
