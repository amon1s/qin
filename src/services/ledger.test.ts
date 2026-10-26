import { describe, expect, it } from 'vitest';
import { calculateCost, resolvePrice, summarizeLedger } from './ledger';
import { LedgerEntry, ProviderConfig } from '../types';

function provider(overrides: Partial<ProviderConfig> = {}): ProviderConfig {
  return {
    id: 'p1',
    name: 'Provider One',
    companyName: 'Example',
    instanceName: 'Primary',
    baseUrl: 'https://api.example.com/v1',
    modelsEndpoint: '/models',
    authType: 'bearer',
    apiKey: 'sk-test',
    status: 'active',
    models: [],
    ...overrides,
  };
}

describe('resolvePrice', () => {
  it('uses the price the provider published for that model', () => {
    // Regression: calculateCost ignored its provider/model arguments entirely
    // and always billed the hardcoded 1.0 / 3.0 defaults.
    const configured = provider({
      models: [{ id: 'gpt-4o', name: 'gpt-4o', providerId: 'p1', inputCostPer1m: 2.5, outputCostPer1m: 10 }],
    });

    const price = resolvePrice(configured, 'gpt-4o');
    expect(price.source).toBe('provider');
    expect(price.inputPer1m).toBe(2.5);
    expect(price.outputPer1m).toBe(10);
  });

  it('marks unknown pricing as an estimate instead of pretending it is measured', () => {
    const price = resolvePrice(provider({ models: [{ id: 'mystery', name: 'mystery', providerId: 'p1' }] }), 'mystery');
    expect(price.source).toBe('estimate');
  });

  it('prices local models at zero and labels them local', () => {
    const local = provider({ presetKey: 'ollama', authType: 'none', apiKey: '' });
    expect(resolvePrice(local, 'llama3.2:3b')).toEqual({
      inputPer1m: 0,
      outputPer1m: 0,
      source: 'local',
    });
  });

  it('does not crash on an unknown provider or model', () => {
    expect(resolvePrice(undefined, 'nope').source).toBe('estimate');
  });
});

describe('calculateCost', () => {
  it('computes per-million pricing', () => {
    const cost = calculateCost(1_000_000, 1_000_000, { inputPer1m: 2.5, outputPer1m: 10 });
    expect(cost).toBeCloseTo(12.5, 5);
  });

  it('returns zero for local models', () => {
    expect(calculateCost(5000, 5000, { inputPer1m: 0, outputPer1m: 0 })).toBe(0);
  });

  it('rounds to five decimals', () => {
    const cost = calculateCost(1, 1, { inputPer1m: 1, outputPer1m: 3 });
    expect(cost).toBe(0);
  });
});

function entry(overrides: Partial<LedgerEntry> = {}): LedgerEntry {
  return {
    id: 'tx_1',
    timestamp: new Date().toISOString(),
    providerId: 'p1',
    modelId: 'm1',
    promptTokens: 10,
    completionTokens: 10,
    totalTokens: 20,
    costUsd: 0.001,
    priceSource: 'provider',
    latencyMs: 100,
    status: 'success',
    promptSnippet: 'hi',
    ...overrides,
  };
}

describe('summarizeLedger', () => {
  it('separates measured cost from estimated cost', () => {
    const summary = summarizeLedger([
      entry({ id: 'a', costUsd: 0.01, priceSource: 'provider' }),
      entry({ id: 'b', costUsd: 0.02, priceSource: 'estimate' }),
      entry({ id: 'c', costUsd: 0.03, priceSource: 'local' }),
    ]);

    expect(summary.totalCostUsd).toBeCloseTo(0.06, 6);
    expect(summary.measuredCostUsd).toBeCloseTo(0.04, 6);
    expect(summary.estimatedCostUsd).toBeCloseTo(0.02, 6);
    expect(summary.count).toBe(3);
  });

  it('reports latency and success rate', () => {
    const summary = summarizeLedger([
      entry({ id: 'a', latencyMs: 100 }),
      entry({ id: 'b', latencyMs: 300, status: 'timeout' }),
    ]);
    expect(summary.averageLatencyMs).toBe(200);
    expect(summary.successRate).toBe(50);
  });

  it('handles an empty ledger without dividing by zero', () => {
    const summary = summarizeLedger([]);
    expect(summary.count).toBe(0);
    expect(summary.averageLatencyMs).toBe(0);
    expect(summary.successRate).toBe(100);
  });
});
