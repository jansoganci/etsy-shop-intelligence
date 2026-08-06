export type DateRange = {
  from: string;
  to: string;
  month: string;
  dayCount: number;
  isPartial: boolean;
};

export type DailyOrderPoint = {
  date: string;
  orderCount: number;
  grossSales: number | null;
};

export type StabilityMetrics = {
  dayCount: number;
  activeDays: number;
  zeroSalesDays: number;
  activeDayRate: number;
  dailyAverage: number;
  targetBandDays: number;
  targetBandRate: number;
  longestZeroSalesStreak: number;
  averageTargetMet: boolean;
  coverageTargetMet: boolean;
};

const DAY_MS = 86_400_000;

function parseDate(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function monthFromDate(date: Date): string {
  return toIsoDate(date).slice(0, 7);
}

function monthStart(month: string): Date {
  return parseDate(`${month}-01`);
}

function shiftMonth(month: string, offset: number): string {
  const date = monthStart(month);
  date.setUTCMonth(date.getUTCMonth() + offset);
  return monthFromDate(date);
}

function endOfMonth(month: string): Date {
  const date = monthStart(month);
  date.setUTCMonth(date.getUTCMonth() + 1);
  date.setUTCDate(0);
  return date;
}

function inclusiveDayCount(from: string, to: string): number {
  return Math.max(0, Math.floor((parseDate(to).getTime() - parseDate(from).getTime()) / DAY_MS) + 1);
}

function clampDay(month: string, day: number): number {
  return Math.min(day, endOfMonth(month).getUTCDate());
}

export function resolveDefaultMonth(maxDataDate: string, now = new Date()): string {
  const dataMonth = maxDataDate.slice(0, 7);
  const currentMonth = monthFromDate(now);
  return dataMonth >= currentMonth ? shiftMonth(currentMonth, -1) : dataMonth;
}

export function buildPeriodRanges(
  selectedMonth: string,
  maxDataDate: string,
  now = new Date(),
): {
  current: DateRange;
  previous: DateRange;
  previousYear: DateRange;
} {
  const currentMonth = monthFromDate(now);
  const selectedEnd = endOfMonth(selectedMonth);
  const maxDataMonth = maxDataDate.slice(0, 7);
  const isPartial = selectedMonth >= currentMonth && selectedMonth === maxDataMonth;
  const currentTo = isPartial ? maxDataDate : toIsoDate(selectedEnd);
  const currentFrom = `${selectedMonth}-01`;
  const lastDay = parseDate(currentTo).getUTCDate();
  const previousMonth = shiftMonth(selectedMonth, -1);
  const previousYearMonth = shiftMonth(selectedMonth, -12);
  const previousTo = isPartial
    ? `${previousMonth}-${String(clampDay(previousMonth, lastDay)).padStart(2, "0")}`
    : toIsoDate(endOfMonth(previousMonth));
  const previousYearTo = isPartial
    ? `${previousYearMonth}-${String(clampDay(previousYearMonth, lastDay)).padStart(2, "0")}`
    : toIsoDate(endOfMonth(previousYearMonth));

  return {
    current: {
      from: currentFrom,
      to: currentTo,
      month: selectedMonth,
      dayCount: inclusiveDayCount(currentFrom, currentTo),
      isPartial,
    },
    previous: {
      from: `${previousMonth}-01`,
      to: previousTo,
      month: previousMonth,
      dayCount: inclusiveDayCount(`${previousMonth}-01`, previousTo),
      isPartial: false,
    },
    previousYear: {
      from: `${previousYearMonth}-01`,
      to: previousYearTo,
      month: previousYearMonth,
      dayCount: inclusiveDayCount(`${previousYearMonth}-01`, previousYearTo),
      isPartial: false,
    },
  };
}

export function fillDailySeries(range: DateRange, rows: DailyOrderPoint[]): DailyOrderPoint[] {
  const byDate = new Map(rows.map((row) => [row.date, row]));
  const output: DailyOrderPoint[] = [];
  const cursor = parseDate(range.from);
  const end = parseDate(range.to);

  while (cursor <= end) {
    const date = toIsoDate(cursor);
    output.push(byDate.get(date) ?? { date, orderCount: 0, grossSales: 0 });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return output;
}

export function calculateStability(points: DailyOrderPoint[]): StabilityMetrics {
  const dayCount = points.length;
  const totalOrders = points.reduce((total, point) => total + point.orderCount, 0);
  const activeDays = points.filter((point) => point.orderCount > 0).length;
  const targetBandDays = points.filter((point) => point.orderCount >= 3 && point.orderCount <= 5).length;
  let longestZeroSalesStreak = 0;
  let currentZeroSalesStreak = 0;

  for (const point of points) {
    if (point.orderCount === 0) {
      currentZeroSalesStreak += 1;
      longestZeroSalesStreak = Math.max(longestZeroSalesStreak, currentZeroSalesStreak);
    } else {
      currentZeroSalesStreak = 0;
    }
  }

  const dailyAverage = dayCount > 0 ? totalOrders / dayCount : 0;
  const activeDayRate = dayCount > 0 ? activeDays / dayCount : 0;
  const targetBandRate = dayCount > 0 ? targetBandDays / dayCount : 0;

  return {
    dayCount,
    activeDays,
    zeroSalesDays: dayCount - activeDays,
    activeDayRate,
    dailyAverage,
    targetBandDays,
    targetBandRate,
    longestZeroSalesStreak,
    averageTargetMet: dailyAverage >= 3,
    coverageTargetMet: activeDayRate >= 0.8,
  };
}

export function ratioChange(current: number, previous: number): number | null {
  if (previous === 0) {
    return null;
  }

  return (current - previous) / previous;
}

export function classifyShopStatus(
  monthChange: number | null,
  yearChange: number | null,
): "declining" | "slowing" | "stable" | "recovering" | "growing" | "insufficient_data" {
  if (monthChange === null && yearChange === null) {
    return "insufficient_data";
  }

  if ((monthChange ?? 0) <= -0.15 && (yearChange === null || yearChange <= -0.1)) {
    return "declining";
  }

  if ((monthChange ?? 0) <= -0.1) {
    return "slowing";
  }

  if ((monthChange ?? 0) >= 0.15 && (yearChange === null || yearChange >= 0)) {
    return "growing";
  }

  if ((monthChange ?? 0) >= 0.1) {
    return "recovering";
  }

  return "stable";
}
