function cssVar(name: string) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

export function chartColors() {
  return {
    accent: cssVar("--color-accent"),
    accentStrong: cssVar("--color-accent-strong"),
    secondary: cssVar("--color-secondary"),
    warning: cssVar("--color-warning"),
    positive: cssVar("--color-positive"),
    grid: cssVar("--color-chart-grid"),
    axis: cssVar("--color-chart-axis"),
    text: cssVar("--color-text-secondary"),
    surface: cssVar("--color-surface"),
    chart1: cssVar("--color-chart-1"),
    chart2: cssVar("--color-chart-2"),
    chart3: cssVar("--color-chart-3"),
    chart4: cssVar("--color-chart-4"),
    chart5: cssVar("--color-chart-5"),
  };
}
