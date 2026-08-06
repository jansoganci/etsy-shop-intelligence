import { chartColors } from "../../dashboard/charts/chartTheme";

function cssVar(name: string) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function gaTrendSeriesColors() {
  return {
    activeUsers: cssVar("--color-ga-active-users"),
    sessions: cssVar("--color-ga-sessions"),
    pageViews: cssVar("--color-ga-page-views"),
  };
}

type DailyTrendPoint = {
  date: string;
  activeUsers: number;
  sessions: number;
  screenPageViews: number;
};

function formatAxisDate(dateInput: string): string {
  const date = new Date(`${dateInput}T00:00:00Z`);

  if (Number.isNaN(date.getTime())) {
    return dateInput;
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(date);
}

export function trafficTrendChart(points: DailyTrendPoint[]) {
  const colors = chartColors();
  const seriesColors = gaTrendSeriesColors();

  return {
    animation: false,
    tooltip: { trigger: "axis" },
    legend: {
      top: 0,
      textStyle: { color: colors.text },
    },
    grid: { left: 16, right: 16, top: 42, bottom: 28, containLabel: true },
    xAxis: {
      type: "category",
      data: points.map((point) => formatAxisDate(point.date)),
      axisLine: { lineStyle: { color: colors.axis } },
      axisLabel: { color: colors.text },
      boundaryGap: false,
    },
    yAxis: {
      type: "value",
      axisLine: { show: false },
      splitLine: { lineStyle: { color: colors.grid } },
      axisLabel: {
        color: colors.text,
        formatter: (value: number) => `${Math.round(value)}`,
      },
    },
    series: [
      {
        name: "Active Users",
        type: "line",
        smooth: true,
        symbol: "none",
        data: points.map((point) => point.activeUsers),
        lineStyle: { color: seriesColors.activeUsers, width: 3 },
        itemStyle: { color: seriesColors.activeUsers },
      },
      {
        name: "Sessions",
        type: "line",
        smooth: true,
        symbol: "none",
        data: points.map((point) => point.sessions),
        lineStyle: { color: seriesColors.sessions, width: 3 },
        itemStyle: { color: seriesColors.sessions },
      },
      {
        name: "Page Views",
        type: "line",
        smooth: true,
        symbol: "none",
        data: points.map((point) => point.screenPageViews),
        lineStyle: { color: seriesColors.pageViews, width: 3 },
        itemStyle: { color: seriesColors.pageViews },
      },
    ],
  };
}
