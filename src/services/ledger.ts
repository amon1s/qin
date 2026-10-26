/**
 * Token ledger: cost accounting for dispatched completions.
 *
 * Cost is resolved from the price the provider actually published for the
 * model. When no price is known the row is still recorded, but marked
 * `estimate` so the UI can say so instead of presenting a made-up number as
 * fact. Local providers (Ollama) are priced at zero and marked `local`.
 */

import { LedgerEntry, PriceSource, ProviderConfig } from '../types';
import { readKey, writeKey, removeKey } from './storage';

const MAX_ENTRIES = 1000;

/** Used only when a provider publishes no pricing at all. */
export const ESTIMATE_INPUT_PER_1M = 1.0;
export const ESTIMATE_OUTPUT_PER_1M = 3.0;

export interface ModelPrice {
  inputPer1m: number;
  outputPer1m: number;
  source: PriceSource;
}

/**
 * Resolve the price for a model.
 *
 * The previous implementation accepted provider and model ids but ignored
 * them, always billing the hardcoded 1.0/3.0 defaults — so the ledger disagreed
 * with the prices the discovery panel was already displaying.
 */
export function resolvePrice(
  provider: ProviderConfig | undefined,
  modelId: string
): ModelPrice {
  if (provider && (provider.presetKey === 'ollama' || provider.authType === 'none')) {
    return { inputPer1m: 0, outputPer1m: 0, source: 'local' };
  }

  const model = provider?.models.find(candidate => candidate.id === modelId);
  const input = model?.inputCostPer1m;
  const output = model?.outputCostPer1m;

  if (typeof input === 'number' && typeof output === 'number') {
    return { inputPer1m: input, outputPer1m: output, source: 'provider' };
  }

  return {
    inputPer1m: typeof input === 'number' ? input : ESTIMATE_INPUT_PER_1M,
    outputPer1m: typeof output === 'number' ? output : ESTIMATE_OUTPUT_PER_1M,
    source: 'estimate',
  };
}

export function calculateCost(
  promptTokens: number,
  completionTokens: number,
  price: Pick<ModelPrice, 'inputPer1m' | 'outputPer1m'>
): number {
  const cost =
    (promptTokens / 1_000_000) * price.inputPer1m + (completionTokens / 1_000_000) * price.outputPer1m;
  // Sub-cent precision; the UI renders five decimals.
  return Math.round(cost * 100_000) / 100_000;
}

/** Normalise rows written by older builds (no priceSource, old statuses). */
function normalize(entry: Partial<LedgerEntry> & { id: string }): LedgerEntry {
  return {
    id: entry.id,
    timestamp: entry.timestamp ?? new Date().toISOString(),
    providerId: entry.providerId ?? 'unknown',
    modelId: entry.modelId ?? 'unknown',
    promptTokens: entry.promptTokens ?? 0,
    completionTokens: entry.completionTokens ?? 0,
    totalTokens:
      entry.totalTokens ?? (entry.promptTokens ?? 0) + (entry.completionTokens ?? 0),
    costUsd: entry.costUsd ?? 0,
    priceSource: entry.priceSource ?? 'estimate',
    latencyMs: entry.latencyMs ?? 0,
    status: entry.status ?? 'success',
    promptSnippet: entry.promptSnippet ?? '',
    responseSnippet: entry.responseSnippet,
    errorMessage: entry.errorMessage,
    tokensEstimated: entry.tokensEstimated,
  };
}

export function getLedgerEntries(): LedgerEntry[] {
  const stored = readKey<Array<Partial<LedgerEntry> & { id: string }>>('ledger');
  if (!Array.isArray(stored)) return [];
  return stored.filter(item => item && typeof item.id === 'string').map(normalize);
}

export function saveLedgerEntries(entries: LedgerEntry[]): void {
  writeKey('ledger', entries.slice(0, MAX_ENTRIES));
}

export function addLedgerRecord(
  record: Omit<LedgerEntry, 'id' | 'timestamp'>
): LedgerEntry {
  const entries = getLedgerEntries();
  const entry: LedgerEntry = {
    ...record,
    id: 'tx_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    timestamp: new Date().toISOString(),
  };

  saveLedgerEntries([entry, ...entries]);
  return entry;
}

export function clearLedger(): void {
  removeKey('ledger');
}

function csvCell(value: string | number): string {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function exportLedgerCsv(entries: LedgerEntry[]): string {
  const headers = [
    'ID',
    'Timestamp',
    'Provider',
    'Model',
    'Prompt Tokens',
    'Completion Tokens',
    'Total Tokens',
    'Cost (USD)',
    'Price Source',
    'Latency (ms)',
    'Status',
    'Prompt Snippet',
    'Error',
  ];

  const rows = entries.map(entry => [
    entry.id,
    entry.timestamp,
    entry.providerId,
    csvCell(entry.modelId),
    entry.promptTokens,
    entry.completionTokens,
    entry.totalTokens,
    entry.costUsd.toFixed(5),
    entry.priceSource,
    entry.latencyMs,
    entry.status,
    csvCell(entry.promptSnippet || ''),
    csvCell(entry.errorMessage || ''),
  ]);

  return [headers.join(','), ...rows.map(row => row.join(','))].join('\n');
}

/** Ledger totals, split by price confidence so "estimated" is visible. */
export function summarizeLedger(entries: LedgerEntry[]): {
  totalTokens: number;
  totalCostUsd: number;
  measuredCostUsd: number;
  estimatedCostUsd: number;
  averageLatencyMs: number;
  successRate: number;
  count: number;
} {
  let totalTokens = 0;
  let totalCostUsd = 0;
  let measuredCostUsd = 0;
  let estimatedCostUsd = 0;
  let totalLatency = 0;
  let successes = 0;

  for (const entry of entries) {
    totalTokens += entry.totalTokens;
    totalCostUsd += entry.costUsd;
    totalLatency += entry.latencyMs;
    if (entry.priceSource === 'estimate') estimatedCostUsd += entry.costUsd;
    else measuredCostUsd += entry.costUsd;
    if (entry.status === 'success') successes += 1;
  }

  return {
    totalTokens,
    totalCostUsd,
    measuredCostUsd,
    estimatedCostUsd,
    averageLatencyMs: entries.length > 0 ? Math.round(totalLatency / entries.length) : 0,
    successRate: entries.length > 0 ? Math.round((successes / entries.length) * 100) : 100,
    count: entries.length,
  };
}
