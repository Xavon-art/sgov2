export type TourProgress = {
  completed: Record<string, string>;
  dismissed: Record<string, string>;
  sidebarCollapsed: boolean;
};

export const emptyTourProgress: TourProgress = {
  completed: {},
  dismissed: {},
  sidebarCollapsed: false,
};

type ProgressPayload = {
  ok?: unknown;
  completed?: unknown;
  dismissed?: unknown;
  sidebarCollapsed?: unknown;
};

function isMap(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeMap(value: unknown): Record<string, string> {
  const out: Record<string, string> = Object.create(null) as Record<string, string>;
  if (!isMap(value)) return out;
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === "string") out[key] = item;
  }
  return out;
}

const LOCAL_KEY = "sgov-tour-progress-v1";

function freshProgress(): TourProgress {
  return { ...emptyTourProgress, completed: {}, dismissed: {} };
}

function readLocalProgress(): TourProgress {
  if (typeof window === "undefined") return freshProgress();
  try {
    const raw = window.localStorage.getItem(LOCAL_KEY);
    if (!raw) return freshProgress();
    const parsed = JSON.parse(raw) as ProgressPayload;
    if (!isMap(parsed)) return freshProgress();
    return {
      completed: normalizeMap(parsed.completed),
      dismissed: normalizeMap(parsed.dismissed),
      sidebarCollapsed: typeof parsed.sidebarCollapsed === "boolean" ? parsed.sidebarCollapsed : false,
    };
  } catch {
    return freshProgress();
  }
}

function writeLocalProgress(progress: TourProgress): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LOCAL_KEY, JSON.stringify(progress));
  } catch {
    return;
  }
}

export async function loadTourProgress(): Promise<TourProgress> {
  try {
    const res = await fetch("/api/tours/progress");
    if (res.status === 401 || !res.ok) return readLocalProgress();
    const body = (await res.json().catch(() => null)) as ProgressPayload | null;
    if (!isMap(body) || body.ok !== true) return readLocalProgress();
    const local = readLocalProgress();
    const progress: TourProgress = {
      completed: { ...local.completed, ...normalizeMap(body.completed) },
      dismissed: { ...local.dismissed, ...normalizeMap(body.dismissed) },
      sidebarCollapsed: typeof body.sidebarCollapsed === "boolean" ? body.sidebarCollapsed : local.sidebarCollapsed,
    };
    writeLocalProgress(progress);
    return progress;
  } catch {
    return readLocalProgress();
  }
}

export async function saveTourProgress(patch: Partial<TourProgress>): Promise<boolean> {
  const current = readLocalProgress();
  const merged: TourProgress = {
    completed: { ...current.completed, ...normalizeMap(patch.completed) },
    dismissed: { ...current.dismissed, ...normalizeMap(patch.dismissed) },
    sidebarCollapsed:
      typeof patch.sidebarCollapsed === "boolean" ? patch.sidebarCollapsed : current.sidebarCollapsed,
  };
  writeLocalProgress(merged);

  try {
    const res = await fetch("/api/tours/progress", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        completed: merged.completed,
        dismissed: merged.dismissed,
        sidebarCollapsed: merged.sidebarCollapsed,
      }),
    });
    if (!res.ok) return true;
    const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    return isMap(body) && body.ok === true;
  } catch {
    return true;
  }
}
