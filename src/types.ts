import type { Locator } from "playwright";

export type StepRecord = {
  step: number;
  desc: string;
  image?: string;
  action?: string;
  status?: "SUCCESS" | "FAILED" | "WARNING";
  errorCode?: string;
  retryCount?: number;
  latencyMs?: number;
  pageUrlBefore?: string;
  pageUrlAfter?: string;
  createdAt?: string;
};

export type ElementRef = {
  id: string;
  locator: Locator;
};

export type ElementSnapshot = {
  tag: string;
  text: string;
  role: string;
  ariaLabel: string;
  placeholder: string;
  idAttr: string;
  nameAttr: string;
  className: string;
  typeAttr: string;
};

export type ElementCandidate = {
  element_id: string;
  strategy: string;
  score: number;
  snapshot: ElementSnapshot;
};
