import type { StableId } from './types.js';

/**
 * Lightweight FNV-1a hash used across the compiler for stable identifiers.
 */
export function stableHash(input: string): StableId {
  let hash = 2166136261 >>> 0;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}
