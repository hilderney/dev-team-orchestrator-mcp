/**
 * Pipeline metrics + trace id (P2-2 / P2-5).
 */
import { randomUUID } from "node:crypto";

export type StageTiming = { stage: string; ms: number; ok: boolean };

export type PipelineMetrics = {
  traceId: string;
  timings: StageTiming[];
  retries: Record<string, number>;
  errorClass: string | null;
  noFileSections: number;
  toolCallMalformed: number;
  /** LLM empty / OUT=0 responses rejected */
  llmEmpty: number;
  /** Specs that would have been [x] without required files */
  specsMarkedWithoutFiles: number;
  deliveryVerifyFails: number;
  batchSize: number;
  startedAt: string;
};

let active: PipelineMetrics | null = null;

export function createMetrics(traceId?: string): PipelineMetrics {
  active = {
    traceId: traceId || randomUUID(),
    timings: [],
    retries: {},
    errorClass: null,
    noFileSections: 0,
    toolCallMalformed: 0,
    llmEmpty: 0,
    specsMarkedWithoutFiles: 0,
    deliveryVerifyFails: 0,
    batchSize: 1,
    startedAt: new Date().toISOString(),
  };
  return active;
}

export function getMetrics(): PipelineMetrics {
  if (!active) return createMetrics();
  return active;
}

export function clearMetrics(): void {
  active = null;
}

export function recordStageTiming(
  stage: string,
  ms: number,
  ok: boolean
): void {
  getMetrics().timings.push({ stage, ms, ok });
}

export function recordRetry(kind: string): void {
  const m = getMetrics();
  m.retries[kind] = (m.retries[kind] ?? 0) + 1;
}

export function recordNoFileSections(): void {
  getMetrics().noFileSections += 1;
}

export function recordToolCallMalformed(): void {
  getMetrics().toolCallMalformed += 1;
}

export function recordLlmEmpty(): void {
  getMetrics().llmEmpty += 1;
}

export function recordSpecsMarkedWithoutFiles(n = 1): void {
  getMetrics().specsMarkedWithoutFiles += n;
}

export function recordDeliveryVerifyFail(): void {
  getMetrics().deliveryVerifyFails += 1;
}

export function setErrorClass(cls: string | null): void {
  getMetrics().errorClass = cls;
}

export function setBatchSize(n: number): void {
  getMetrics().batchSize = n;
}

export function metricsSnapshot(): Record<string, unknown> {
  const m = getMetrics();
  return {
    traceId: m.traceId,
    timings: m.timings,
    retries: m.retries,
    errorClass: m.errorClass,
    noFileSections: m.noFileSections,
    toolCallMalformed: m.toolCallMalformed,
    llmEmpty: m.llmEmpty,
    specsMarkedWithoutFiles: m.specsMarkedWithoutFiles,
    deliveryVerifyFails: m.deliveryVerifyFails,
    batchSize: m.batchSize,
    startedAt: m.startedAt,
  };
}
