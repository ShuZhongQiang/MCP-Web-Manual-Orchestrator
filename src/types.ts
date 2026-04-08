import type { Locator } from "playwright";

export type StepRecord = {
  step: number;
  desc: string;
  image?: string;
  notes?: string[];
  evidence?: Array<{
    label: string;
    image?: string;
  }>;
  missingFields?: string[];
  filledFields?: string[];
  selfHealRounds?: number;
  action?: string;
  module?: string;
  moduleDescription?: string;
  status?: "SUCCESS" | "FAILED" | "WARNING";
  errorCode?: string;
  retryCount?: number;
  latencyMs?: number;
  pageUrlBefore?: string;
  pageUrlAfter?: string;
  createdAt?: string;
  captureOnly?: boolean;
};

export type ManualModule = {
  title: string;
  description?: string;
  steps?: number[];
};

export type ManualDocument = {
  title: string;
  summary: string;
  modules: Array<{
    title: string;
    description: string;
    steps: number[];
  }>;
  steps: StepRecord[];
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
