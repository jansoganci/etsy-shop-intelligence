import type { IntelligenceOverviewResponse } from "../../../data/types/intelligence";
import { chartColors } from "./chartTheme";

export function salesComparisonChart(overview: IntelligenceOverviewResponse) {
  const colors = chartColors();
  const dayCount = Math.max(
    overview.dailyTrend.current.length,
    overview.dailyTrend.previous.length,
    overview.dailyTrend.previousYear.length,
  );
  const days = Array.from({ length: dayCount }, (_, index) => String(index + 1));

  return {
    animation: false,
    tooltip: {
      trigger: "axis",
      valueFormatter: (value: number) => `${value} orders`,
    },
    legend: {
      top: 0,
      right: 0,
      textStyle: { color: colors.text },
    },
    grid: { left: 16, right: 16, top: 44, bottom: 24, containLabel: true },
    xAxis: {
      type: "category",
      data: days,
      boundaryGap: false,
      axisLine: { lineStyle: { color: colors.axis } },
      axisLabel: { color: colors.text },
    },
    yAxis: {
      type: "value",
      minInterval: 1,
      axisLine: { show: false },
      splitLine: { lineStyle: { color: colors.grid } },
      axisLabel: { color: colors.text },
    },
    series: [
      {
        name: overview.ranges.current.month,
        type: "line",
        smooth: 0.2,
        symbol: "circle",
        symbolSize: 5,
        data: overview.dailyTrend.current.map((point) => point.orderCount),
        lineStyle: { color: colors.accent, width: 3 },
        itemStyle: { color: colors.accent },
        areaStyle: { color: `${colors.accent}14` },
      },
      {
        name: overview.ranges.previous.month,
        type: "line",
        smooth: 0.2,
        symbol: "none",
        data: overview.dailyTrend.previous.map((point) => point.orderCount),
        lineStyle: { color: colors.text, width: 1.5, type: "dashed" },
      },
      {
        name: overview.ranges.previousYear.month,
        type: "line",
        smooth: 0.2,
        symbol: "none",
        data: overview.dailyTrend.previousYear.map((point) => point.orderCount),
        lineStyle: { color: colors.axis, width: 1.5 },
      },
    ],
  };
}
