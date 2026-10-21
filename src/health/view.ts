import type { HealthKind } from "../api";

export const FIELD_LABEL: Record<HealthKind, string> = {
  weight_g: "Weight",
  sleep_min: "Sleep",
  steps: "Steps",
  resting_hr: "Resting HR",
};

export const UNITS: Record<HealthKind, string> = {
  weight_g: "kg",
  sleep_min: "h:m",
  steps: "steps",
  resting_hr: "bpm",
};

export function formatValue(kind: HealthKind, value: number | null): string {
  if (value === null || value === undefined) return "—";
  switch (kind) {
    case "weight_g":
      return (value / 1000).toFixed(1);
    case "sleep_min": {
      const h = Math.floor(value / 60);
      const m = Math.round(value % 60);
      return `${h}h ${m < 10 ? `0${m}` : m}m`;
    }
    case "steps":
      return Math.round(value).toLocaleString("en-US");
    case "resting_hr":
      return String(Math.round(value));
  }
}

/** Value shown inside the editable Today field: sleep stays "7:30", not "7h 30m". */
export function formatInput(kind: HealthKind, value: number | null | undefined): string {
  if (value === null || value === undefined) return "";
  switch (kind) {
    case "weight_g":
      return (value / 1000).toFixed(1);
    case "sleep_min": {
      const h = Math.floor(value / 60);
      const m = Math.round(value % 60);
      return `${h}:${m < 10 ? `0${m}` : m}`;
    }
    case "steps":
      return Math.round(value).toLocaleString("en-US");
    case "resting_hr":
      return String(Math.round(value));
  }
}

export function parseValue(kind: HealthKind, text: string): number | null {
  const trimmed = text.trim();
  if (!trimmed || trimmed === "—" || trimmed === "-") return null;

  switch (kind) {
    case "weight_g": {
      const num = parseFloat(trimmed.replace(",", "."));
      if (Number.isNaN(num) || num <= 0) return null;
      return Math.round(num * 1000);
    }
    case "sleep_min": {
      // accepts formats: "7:30", "7h 30m", "7h30", "7h", "450" (raw minutes)
      const colonMatch = trimmed.match(/^(\d{1,2}):(\d{1,2})$/);
      if (colonMatch) {
        const h = parseInt(colonMatch[1], 10);
        const m = parseInt(colonMatch[2], 10);
        const total = h * 60 + m;
        return total > 0 ? total : null;
      }
      const hmMatch = trimmed.match(/^(?:(\d+)\s*h(?:ours?)?)?\s*(?:(\d+)\s*m(?:in(?:utes?)?)?)?$/i);
      if (hmMatch && (hmMatch[1] || hmMatch[2])) {
        const h = hmMatch[1] ? parseInt(hmMatch[1], 10) : 0;
        const m = hmMatch[2] ? parseInt(hmMatch[2], 10) : 0;
        const total = h * 60 + m;
        return total > 0 ? total : null;
      }
      const rawNum = parseInt(trimmed, 10);
      if (!Number.isNaN(rawNum) && rawNum > 0) return rawNum;
      return null;
    }
    case "steps": {
      const cleaned = trimmed.replace(/,/g, "").replace(/\s/g, "");
      const num = parseInt(cleaned, 10);
      if (Number.isNaN(num) || num < 0) return null;
      return num;
    }
    case "resting_hr": {
      const num = parseInt(trimmed, 10);
      if (Number.isNaN(num) || num <= 0) return null;
      return num;
    }
  }
}

export function formatDelta(kind: HealthKind, delta: number | null): string {
  if (delta === null || delta === undefined) return "—";
  const sign = delta > 0 ? "+" : delta < 0 ? "−" : "";
  const abs = Math.abs(delta);

  switch (kind) {
    case "weight_g": {
      const kg = (abs / 1000).toFixed(1);
      return `${sign}${kg} kg`;
    }
    case "sleep_min":
      return `${sign}${Math.round(abs)} min`;
    case "steps":
      return `${sign}${Math.round(abs).toLocaleString("en-US")}`;
    case "resting_hr":
      return `${sign}${Math.round(abs)} bpm`;
  }
}

export function deltaColor(kind: HealthKind, delta: number | null): string {
  if (delta === null || delta === undefined || delta === 0) return "text-muted";
  switch (kind) {
    case "weight_g":
      // Weight change is neutral/informational
      return "text-muted";
    case "sleep_min":
    case "steps":
      // More sleep / more steps is positive
      return delta > 0 ? "text-accent" : "text-danger";
    case "resting_hr":
      // Lower resting HR is generally better
      return delta < 0 ? "text-accent" : "text-muted";
  }
}

export function buildPolylines(
  points: (number | null)[],
  width: number,
  height: number,
  padding = 3,
): string[] {
  if (points.length < 2) return [];

  const nonNulls = points.filter((p): p is number => p !== null);
  if (nonNulls.length === 0) return [];

  const min = Math.min(...nonNulls);
  const max = Math.max(...nonNulls);
  const span = max - min || 1;
  const n = points.length;

  const polylines: string[] = [];
  let currentSegment: string[] = [];

  for (let i = 0; i < n; i++) {
    const v = points[i];
    if (v === null) {
      if (currentSegment.length > 0) {
        polylines.push(currentSegment.join(" "));
        currentSegment = [];
      }
      continue;
    }

    const x = ((i / (n - 1)) * width).toFixed(2);
    const y = (height - padding - ((v - min) / span) * (height - padding * 2)).toFixed(2);
    currentSegment.push(`${x},${y}`);
  }

  if (currentSegment.length > 0) {
    polylines.push(currentSegment.join(" "));
  }

  return polylines;
}

export function lastPoint(
  points: (number | null)[],
  width: number,
  height: number,
  padding = 3,
): { x: number; y: number } | null {
  if (points.length === 0) return null;
  const nonNulls = points.filter((p): p is number => p !== null);
  if (nonNulls.length === 0) return null;

  const min = Math.min(...nonNulls);
  const max = Math.max(...nonNulls);
  const span = max - min || 1;
  const n = points.length;

  for (let i = n - 1; i >= 0; i--) {
    const v = points[i];
    if (v !== null) {
      const x = Number(((i / (n - 1)) * width).toFixed(2));
      const y = Number((height - padding - ((v - min) / span) * (height - padding * 2)).toFixed(2));
      return { x, y };
    }
  }

  return null;
}
