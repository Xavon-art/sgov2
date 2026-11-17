export type TourPlacement = "top" | "right" | "bottom" | "left";
export type TourRole = "usg" | "lsg" | "public";
export type TourStep = {
  target: string;
  title: string;
  body: string;
  placement?: TourPlacement;
  advanceOnClick?: boolean;
};
export type PageTour = {
  id: string;
  version: string;
  route: string;
  label: string;
  roles?: TourRole[];
  autoStart?: boolean;
  steps: TourStep[];
};
