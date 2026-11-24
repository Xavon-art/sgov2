"use client";

import { createContext, useContext } from "react";
import type { PageTour } from "@/lib/tours";

export type TourApi = {
  activeTour: PageTour | null;
  stepIndex: number;
  start: (tour?: PageTour | null) => void;
  next: () => void;
  back: () => void;
  stop: (saveDismissal?: boolean) => void;
};

export const TourContext = createContext<TourApi | null>(null);

export function useTours(): TourApi {
  const value = useContext(TourContext);
  if (!value) throw new Error("useTours must be used inside TourProvider.");
  return value;
}
