export function sum(values: number[]) {
  return values.reduce((total, value) => total + value, 0);
}

export function average(values: number[]) {
  if (values.length === 0) {
    return 0;
  }

  return sum(values) / values.length;
}

export function roundToTwo(value: number) {
  return Math.round(value * 100) / 100;
}
