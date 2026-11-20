"use client";

import { useEffect, useState } from "react";

type AiStatus = { configured: boolean; vision: boolean };

let statusPromise: Promise<AiStatus> | null = null;

function loadAiStatus(): Promise<AiStatus> {
  if (!statusPromise) {
    statusPromise = fetch("/api/ai/status", { cache: "no-store" })
      .then(async (response) => {
        const json = (await response.json()) as {
          configured?: unknown;
          vision?: unknown;
        };
        return {
          configured: json.configured === true,
          vision: json.vision === true,
        };
      })
      .catch(() => ({ configured: false, vision: false }));
  }
  return statusPromise;
}

export function useAiStatus(): AiStatus & { loading: boolean } {
  const [state, setState] = useState<AiStatus & { loading: boolean }>({
    configured: false,
    vision: false,
    loading: true,
  });

  useEffect(() => {
    let active = true;
    void loadAiStatus().then((status) => {
      if (active) setState({ ...status, loading: false });
    });
    return () => {
      active = false;
    };
  }, []);

  return state;
}
