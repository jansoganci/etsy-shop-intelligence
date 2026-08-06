import { useEffect, useRef } from "react";
import * as echarts from "echarts";
import { ChartCard } from "../../../components/ui";
import "../dashboard.css";

type ChartPanelProps = {
  title: string;
  subtitle: string;
  option: echarts.EChartsCoreOption;
  tabs?: Array<{ id: string; label: string }>;
  activeTabId?: string;
  onTabChange?: (tabId: string) => void;
};

export function ChartPanel({
  title,
  subtitle,
  option,
  tabs,
  activeTabId,
  onTabChange,
}: ChartPanelProps) {
  const chartRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!chartRef.current) {
      return undefined;
    }

    const chart = echarts.init(chartRef.current, undefined, { renderer: "canvas" });
    chart.setOption(option);

    const resizeObserver = new ResizeObserver(() => chart.resize());
    resizeObserver.observe(chartRef.current);

    return () => {
      resizeObserver.disconnect();
      chart.dispose();
    };
  }, [option]);

  return (
    <ChartCard
      title={title}
      subtitle={subtitle}
      tabs={tabs}
      activeTabId={activeTabId}
      onTabChange={onTabChange}
    >
      <div ref={chartRef} className="chart-panel" />
    </ChartCard>
  );
}
