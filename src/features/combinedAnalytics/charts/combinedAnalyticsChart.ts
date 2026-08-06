import type { CombinedAnalyticsRow, QuadrantLabel } from "../../../data/types/combinedAnalytics";
import { chartColors } from "../../dashboard/charts/chartTheme";

function quadrantColor(colors: ReturnType<typeof chartColors>, quadrant: QuadrantLabel): string {
  switch (quadrant) {
    case "high_traffic_high_sales":
      return colors.positive;
    case "high_traffic_low_sales":
      return colors.warning;
    case "low_traffic_high_sales":
      return colors.accent;
    case "low_traffic_low_sales":
    default:
      return colors.axis;
  }
}

export function combinedAnalyticsChart(
  rows: CombinedAnalyticsRow[],
  medians: { trafficMedian: number; salesMedian: number },
) {
  const colors = chartColors();

  return {
    animation: false,
    tooltip: {
      trigger: "item",
      formatter: (params: { name: string; value: [number, number] }) =>
        `${params.name}<br/>Page views: ${params.value[0]}<br/>Orders: ${params.value[1]}`,
    },
    grid: { left: 16, right: 16, top: 24, bottom: 24, containLabel: true },
    xAxis: {
      type: "value",
      name: "Page views",
      nameLocation: "middle",
      nameGap: 28,
      axisLine: { lineStyle: { color: colors.axis } },
      splitLine: { lineStyle: { color: colors.grid } },
      axisLabel: { color: colors.text },
      nameTextStyle: { color: colors.text },
    },
    yAxis: {
      type: "value",
      name: "Orders",
      nameLocation: "middle",
      nameGap: 36,
      axisLine: { lineStyle: { color: colors.axis } },
      splitLine: { lineStyle: { color: colors.grid } },
      axisLabel: { color: colors.text },
      nameTextStyle: { color: colors.text },
    },
    series: [
      {
        type: "scatter",
        symbolSize: 12,
        data: rows.map((row) => ({
          name: row.listingTitle ?? row.listingId,
          value: [row.pageViews, row.orderCount],
          itemStyle: { color: quadrantColor(colors, row.quadrant) },
        })),
        markLine: {
          silent: true,
          symbol: "none",
          label: { show: false },
          lineStyle: { type: "dashed", color: colors.axis },
          data: [{ xAxis: medians.trafficMedian }, { yAxis: medians.salesMedian }],
        },
      },
    ],
  };
}
