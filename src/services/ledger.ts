import { LedgerEntry, ProviderId } from '../types';

const LEDGER_STORAGE_KEY = 'qin_token_ledger_v2';

export function getLedgerEntries(): LedgerEntry[] {
  try {
    const raw = localStorage.getItem(LEDGER_STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

export function saveLedgerEntries(entries: LedgerEntry[]): void {
  try {
    localStorage.setItem(LEDGER_STORAGE_KEY, JSON.stringify(entries.slice(0, 1000)));
  } catch (e) {
    console.error('Failed to save token ledger:', e);
  }
}

export function addLedgerRecord(record: Omit<LedgerEntry, 'id' | 'timestamp'>): LedgerEntry {
  const entries = getLedgerEntries();
  const newEntry: LedgerEntry = {
    ...record,
    id: 'tx_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    timestamp: new Date().toISOString(),
  };

  const updated = [newEntry, ...entries];
  saveLedgerEntries(updated);
  return newEntry;
}

export function calculateCost(
  _providerId: ProviderId,
  _modelId: string,
  promptTokens: number,
  completionTokens: number,
  inputCostPer1m = 1.0,
  outputCostPer1m = 3.0
): number {
  const cost = (promptTokens / 1000000) * inputCostPer1m + (completionTokens / 1000000) * outputCostPer1m;
  return Math.round(cost * 100000) / 100000;
}

export function clearLedger(): void {
  localStorage.removeItem(LEDGER_STORAGE_KEY);
}

export function exportLedgerCsv(entries: LedgerEntry[]): string {
  const headers = ['ID', 'Timestamp', 'Provider', 'Model', 'Prompt Tokens', 'Completion Tokens', 'Total Tokens', 'Cost (USD)', 'Latency (ms)', 'Status', 'Prompt Snippet'];
  const rows = entries.map(e => [
    e.id,
    e.timestamp,
    e.providerId,
    `"${e.modelId}"`,
    e.promptTokens,
    e.completionTokens,
    e.totalTokens,
    e.costUsd.toFixed(5),
    e.latencyMs,
    e.status,
    `"${(e.promptSnippet || '').replace(/"/g, '""')}"`,
  ]);

  return [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
}
