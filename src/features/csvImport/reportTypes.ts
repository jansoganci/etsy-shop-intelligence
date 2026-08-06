import type { CsvReportType } from "../../data/models/records";

export type CsvReportOption = {
  value: CsvReportType;
  label: string;
  description: string;
  enabled: boolean;
};

export const CSV_REPORT_OPTIONS: CsvReportOption[] = [
  {
    value: "direct_checkout_payments",
    label: "Etsy Direct Checkout Payments",
    description: "Payment-level revenue, fee, refund, and settlement records.",
    enabled: true,
  },
  {
    value: "sold_order_items",
    label: "Etsy Sold Order Items",
    description: "Item-level listing and product performance rows.",
    enabled: true,
  },
  {
    value: "sold_orders",
    label: "Etsy Sold Orders",
    description: "Order-level customer and shipment rows.",
    enabled: true,
  },
];
