export function monthKey(dateInput: string) {
  const date = new Date(dateInput);
  if (Number.isNaN(date.getTime())) {
    return "Unknown";
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    year: "numeric",
  }).format(date);
}

export function dayKey(dateInput: string) {
  const date = new Date(dateInput);
  if (Number.isNaN(date.getTime())) {
    return "Unknown";
  }

  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const year = String(date.getFullYear()).slice(-2);

  return `${day}-${month}-${year}`;
}

export function formatDateTime(dateInput: string) {
  const date = new Date(dateInput);

  if (Number.isNaN(date.getTime())) {
    return "Unknown date";
  }

  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}
