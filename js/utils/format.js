export const formatCurrency = (value) => `€${Math.abs(value).toFixed(2)}`;

export const formatSigned = (value) =>
  value >= 0 ? `+€${value.toFixed(2)}` : `−€${Math.abs(value).toFixed(2)}`;

export const formatNet = (value) =>
  value < 0 ? `−€${Math.abs(value).toFixed(2)}` : `€${value.toFixed(2)}`;

export const formatDate = (isoDate) => {
  const parsed = new Date(`${isoDate}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return isoDate;
  return parsed.toLocaleString("en-US", { month: "short", day: "numeric" });
};

export const formatCreditUsage = (used, limit) => {
  if (used <= 0) {
    return `${formatCurrency(limit)}`;
  }
  return `<span class="used-of">${formatCurrency(used)}</span> <span class="used-of">used of</span> ${formatCurrency(limit)}`;
};
