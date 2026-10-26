import { describe, expect, it } from 'vitest';
import {
  buildChatUrl,
  buildModelsUrl,
  joinUrl,
  parseModelsPayload,
  parseParameterCount,
  perTokenToPerMillion,
} from './providers';
import { ProviderConfig } from '../types';

function provider(overrides: Partial<ProviderConfig>): ProviderConfig {
  return {
    id: 'test',
    name: 'Test',
    companyName: 'Test',
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

describe('joinUrl', () => {
  it('collapses the seam between base and path', () => {
    expect(joinUrl('https://api.example.com/v1/', '/models')).toBe(
      'https://api.example.com/v1/models'
    );
    expect(joinUrl('https://api.example.com/v1', 'models')).toBe(
      'https://api.example.com/v1/models'
    );
  });
});

describe('buildModelsUrl', () => {
  it('does not duplicate /v1 on an OpenAI-compatible custom endpoint', () => {
    // Regression: the old build produced /v1/v1/models here, a guaranteed 404.
    expect(
      buildModelsUrl(provider({ baseUrl: 'https://api.nous.ai/v1', modelsEndpoint: '/models' }))
    ).toBe('https://api.nous.ai/v1/models');
  });

  it('adds /v1 when the base has no version segment', () => {
    expect(
      buildModelsUrl(provider({ baseUrl: 'https://api.example.com', modelsEndpoint: '/models' }))
    ).toBe('https://api.example.com/v1/models');
  });

  it('trusts an explicitly versioned models path', () => {
    expect(
      buildModelsUrl(provider({ baseUrl: 'https://api.example.com', modelsEndpoint: '/v2/models' }))
    ).toBe('https://api.example.com/v2/models');
  });

  it('keeps a non-/v1 base path intact (groq-style)', () => {
    expect(
      buildModelsUrl(provider({ baseUrl: 'https://api.groq.com/openai/v1', modelsEndpoint: '/models' }))
    ).toBe('https://api.groq.com/openai/v1/models');
  });

  it('uses the Ollama tags endpoint', () => {
    expect(
      buildModelsUrl(
        provider({ presetKey: 'ollama', baseUrl: 'http://localhost:11434', modelsEndpoint: '/api/tags' })
      )
    ).toBe('http://localhost:11434/api/tags');
  });
});

describe('buildChatUrl', () => {
  it('appends /chat/completions to a versioned base', () => {
    expect(buildChatUrl(provider({ baseUrl: 'https://api.openai.com/v1' }))).toBe(
      'https://api.openai.com/v1/chat/completions'
    );
  });

  it('adds /v1 when the base has no version segment', () => {
    expect(buildChatUrl(provider({ baseUrl: 'https://api.example.com' }))).toBe(
      'https://api.example.com/v1/chat/completions'
    );
  });

  it('does not re-append when the base is already the full path', () => {
    expect(buildChatUrl(provider({ baseUrl: 'https://api.example.com/v1/chat/completions' }))).toBe(
      'https://api.example.com/v1/chat/completions'
    );
  });

  it('honours an explicit chat path relative to the base URL', () => {
    expect(
      buildChatUrl(provider({ baseUrl: 'https://api.example.com/v1', chatEndpoint: '/complete' }))
    ).toBe('https://api.example.com/v1/complete');
  });

  it('uses provider-specific paths for anthropic and ollama', () => {
    expect(buildChatUrl(provider({ presetKey: 'anthropic', baseUrl: 'https://api.anthropic.com/v1' }))).toBe(
      'https://api.anthropic.com/v1/messages'
    );
    expect(buildChatUrl(provider({ presetKey: 'ollama', baseUrl: 'http://localhost:11434' }))).toBe(
      'http://localhost:11434/api/generate'
    );
  });
});

describe('parseParameterCount', () => {
  it('applies the unit multiplier instead of parseInt truncation', () => {
    // Regression: parseInt('7B') === 7, which was stored as a 7-token context window.
    expect(parseParameterCount('7B')).toBe(7_000_000_000);
    expect(parseParameterCount('1.5b')).toBe(1_500_000_000);
    expect(parseParameterCount('350M')).toBe(350_000_000);
    expect(parseParameterCount('70b')).toBe(70_000_000_000);
  });

  it('handles unitless and junk input', () => {
    expect(parseParameterCount('8192')).toBe(8192);
    expect(parseParameterCount('')).toBeUndefined();
    expect(parseParameterCount(null)).toBeUndefined();
    expect(parseParameterCount('unknown')).toBeUndefined();
    expect(parseParameterCount('0B')).toBeUndefined();
  });
});

describe('perTokenToPerMillion', () => {
  it('converts OpenRouter per-token strings to per-1M USD', () => {
    expect(perTokenToPerMillion('0.000003')).toBeCloseTo(3, 6);
    expect(perTokenToPerMillion('0')).toBe(0);
  });

  it('returns undefined rather than inventing a price', () => {
    expect(perTokenToPerMillion(undefined)).toBeUndefined();
    expect(perTokenToPerMillion('')).toBeUndefined();
    expect(perTokenToPerMillion('n/a')).toBeUndefined();
    expect(perTokenToPerMillion('-1')).toBeUndefined();
  });
});

describe('parseModelsPayload', () => {
  it('parses an OpenAI-style list and keeps published pricing', () => {
    const models = parseModelsPayload(provider({}), {
      data: [
        { id: 'gpt-4o', context_length: 128000, pricing: { prompt: '0.0000025', completion: '0.00001' } },
      ],
    });

    expect(models).toHaveLength(1);
    expect(models[0].id).toBe('gpt-4o');
    expect(models[0].contextWindow).toBe(128000);
    expect(models[0].inputCostPer1m).toBeCloseTo(2.5, 6);
    expect(models[0].outputCostPer1m).toBeCloseTo(10, 6);
  });

  it('leaves pricing undefined when the provider publishes none', () => {
    // Regression: the old build filled in 0.50 / 1.50 and presented it as fact.
    const models = parseModelsPayload(provider({}), { data: [{ id: 'mystery-model' }] });
    expect(models[0].inputCostPer1m).toBeUndefined();
    expect(models[0].outputCostPer1m).toBeUndefined();
    expect(models[0].contextWindow).toBeUndefined();
  });

  it('reads Ollama parameter size without mistaking it for a context window', () => {
    const models = parseModelsPayload(
      provider({ presetKey: 'ollama', baseUrl: 'http://localhost:11434' }),
      {
        models: [
          { name: 'llama3.2:3b', details: { parameter_size: '3B', quantization_level: 'Q4_K_M' } },
        ],
      }
    );

    expect(models[0].id).toBe('llama3.2:3b');
    expect(models[0].parameterCount).toBe(3_000_000_000);
    expect(models[0].contextWindow).toBeUndefined();
  });

  it('deduplicates repeated ids and tolerates string entries', () => {
    const models = parseModelsPayload(provider({}), { data: ['a', 'b', { id: 'a' }] });
    expect(models.map(model => model.id)).toEqual(['a', 'b']);
  });

  it('returns an empty list for junk payloads', () => {
    expect(parseModelsPayload(provider({}), null)).toEqual([]);
    expect(parseModelsPayload(provider({}), { unexpected: true })).toEqual([]);
  });
});
