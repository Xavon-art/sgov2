export const peso = (n: number) =>
  new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
    maximumFractionDigits: 0,
  }).format(n);

export const day = (iso: string) =>
  new Date(iso).toLocaleDateString("en-PH", { month: "short", day: "numeric" });

export const stamp = (iso: string) =>
  new Date(iso).toLocaleString("en-PH", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

export const todayKey = () => new Date().toISOString().slice(0, 10);

export const dateKey = (isoOrKey: string) => isoOrKey.slice(0, 10);