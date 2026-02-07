/**
 * In-memory confirmation token store for dry-run confirmation flow.
 *
 * When dry-run mode is enabled, destructive operations return a preview
 * plus a confirmation token. The caller can then re-invoke the same tool
 * with the token to actually execute the operation. Tokens are single-use,
 * time-limited, and validated against the original query + params hashes.
 */

import { createHash, randomUUID } from 'crypto';

// ---------------------------------------------------------------------------
// Canonical JSON serialization (key-order independent)
// ---------------------------------------------------------------------------

/**
 * Recursively sort object keys and stringify.
 * This ensures that `{a:1, b:2}` and `{b:2, a:1}` produce the same hash.
 */
export function canonicalStringify(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map(sortKeys);
  if (typeof value === 'object') {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      sorted[key] = sortKeys((value as Record<string, unknown>)[key]);
    }
    return sorted;
  }
  return value;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PendingOperation {
  token: string;
  operationType: string;
  target: string;
  queryHash: string;
  paramsHash: string;
  createdAt: number;
  used: boolean;
}

export interface ValidationResult {
  valid: boolean;
  reason?: string;
}

// ---------------------------------------------------------------------------
// ConfirmationStore
// ---------------------------------------------------------------------------

export class ConfirmationStore {
  private pending = new Map<string, PendingOperation>();

  static readonly DEFAULT_TTL_MS = 5 * 60 * 1000; // 5 minutes
  static readonly MAX_PENDING = 100;

  private ttlMs: number;

  constructor(ttlSeconds?: number) {
    const envTtl = process.env.DRY_RUN_TTL_SECONDS;
    if (ttlSeconds !== undefined) {
      this.ttlMs = ttlSeconds * 1000;
    } else if (envTtl) {
      this.ttlMs = parseInt(envTtl, 10) * 1000;
    } else {
      this.ttlMs = ConfirmationStore.DEFAULT_TTL_MS;
    }
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /**
   * Create a pending operation and return its confirmation token.
   */
  create(
    operationType: string,
    target: string,
    query: string,
    params: unknown
  ): string {
    this.cleanup();

    const token = randomUUID();
    const entry: PendingOperation = {
      token,
      operationType,
      target,
      queryHash: this.hashString(query),
      paramsHash: this.hashString(canonicalStringify(params)),
      createdAt: Date.now(),
      used: false,
    };

    this.pending.set(token, entry);
    return token;
  }

  /**
   * Validate a confirmation token against the supplied query and params.
   * On success the token is consumed (single-use). On failure a reason is returned.
   */
  validate(token: string, query: string, params: unknown): ValidationResult {
    const entry = this.pending.get(token);

    if (!entry) {
      return { valid: false, reason: 'Token not found or already expired.' };
    }

    if (entry.used) {
      this.pending.delete(token);
      return { valid: false, reason: 'Token has already been used.' };
    }

    if (Date.now() - entry.createdAt > this.ttlMs) {
      this.pending.delete(token);
      return { valid: false, reason: 'Token has expired.' };
    }

    const queryHash = this.hashString(query);
    if (queryHash !== entry.queryHash) {
      this.pending.delete(token);
      return { valid: false, reason: 'Query does not match the original preview.' };
    }

    const paramsHash = this.hashString(canonicalStringify(params));
    if (paramsHash !== entry.paramsHash) {
      this.pending.delete(token);
      return { valid: false, reason: 'Parameters do not match the original preview.' };
    }

    // Success — mark used and remove
    entry.used = true;
    this.pending.delete(token);
    return { valid: true };
  }

  // -----------------------------------------------------------------------
  // Internal helpers
  // -----------------------------------------------------------------------

  private cleanup(): void {
    const now = Date.now();

    // Remove expired entries
    for (const [key, entry] of this.pending) {
      if (now - entry.createdAt > this.ttlMs) {
        this.pending.delete(key);
      }
    }

    // Enforce MAX_PENDING cap — evict oldest first
    if (this.pending.size > ConfirmationStore.MAX_PENDING) {
      const sorted = [...this.pending.entries()].sort(
        (a, b) => a[1].createdAt - b[1].createdAt
      );
      const excess = sorted.length - ConfirmationStore.MAX_PENDING;
      for (let i = 0; i < excess; i++) {
        this.pending.delete(sorted[i][0]);
      }
    }
  }

  private hashString(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }
}

// ---------------------------------------------------------------------------
// Singleton export
// ---------------------------------------------------------------------------

export const confirmationStore = new ConfirmationStore();
