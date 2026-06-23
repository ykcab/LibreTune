import { describe, expect, it } from 'vitest';
import { resolveEmbeddedPanelKind } from '../resolveEmbeddedPanelKind';

describe('resolveEmbeddedPanelKind heuristics', () => {
  it('exports a function', () => {
    expect(typeof resolveEmbeddedPanelKind).toBe('function');
  });
});
