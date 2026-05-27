export const CATEGORY_OPTIONS = [
  'Small Cake Items',
  'Pastries Items',
  'Non-Veg Savouries Items',
  'Veg Savouries Items',
] as const;

export type Category = (typeof CATEGORY_OPTIONS)[number];

export type Item = {
  id: string;
  name: string;
  category: Category;
  price: number | null;
  createdAt: string;
  updatedAt: string;
};

export type ItemWithQuantity = Item & {
  quantity: number;
};

export type ItemInput = {
  name: string;
  category: Category;
  price: number | null;
};

export type ReportItem = {
  itemId: string | null;
  itemName: string;
  category: Category;
  price: number | null;
  quantity: number;
};

export type DailyReport = {
  reportDate: string;
  totalQuantity: number;
  lineCount: number;
  items: ReportItem[];
};

export type HistorySummary = {
  reportDate: string;
  totalQuantity: number;
  lineCount: number;
};

export type BackupPayload = {
  version: number;
  exportedAt: string;
  items: Array<
    Item & {
      deletedAt: string | null;
    }
  >;
  dailyCounts: Array<{
    date: string;
    itemId: string;
    quantity: number;
    updatedAt: string;
  }>;
  dailyReports: Array<{
    reportDate: string;
    totalQuantity: number;
    lineCount: number;
    createdAt: string;
  }>;
  dailyReportItems: Array<{
    id: string;
    reportDate: string;
    itemId: string | null;
    itemName: string;
    category: Category;
    price: number | null;
    quantity: number;
  }>;
  meta: Array<{
    key: string;
    value: string;
  }>;
};
