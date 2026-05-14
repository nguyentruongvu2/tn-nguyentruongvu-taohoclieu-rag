/**
 * storageService.ts — Single Source of Truth policy for client-side storage.
 *
 * ┌─────────────────────────────────────────────────────────────────────┐
 * │ STATE SYNC POLICY (Quy tắc đồng bộ dữ liệu)                        │
 * │                                                                     │
 * │  SOURCE OF TRUTH: Backend DB (PostgreSQL / SQLite)                  │
 * │                                                                     │
 * │  localStorage role: "Write-Ahead Cache"                             │
 * │    - Stores transient UI state (pending navigation data)            │
 * │    - Stores short-lived drafts (slide/quiz data in-flight)          │
 * │    - NEVER stores authoritative business data long-term             │
 * │                                                                     │
 * │  Conflict resolution rule:                                          │
 * │    When online: DB always wins. localStorage is evicted.            │
 * │    When offline: localStorage is served, marked as "draft".         │
 * │    On reconnect: local draft is flushed to DB, then cleared.        │
 * └─────────────────────────────────────────────────────────────────────┘
 *
 * WHY THIS MODULE EXISTS:
 *   Before this file, components wrote to localStorage and also called API
 *   save endpoints — with no defined precedence. This caused silent divergence
 *   when the network lagged.  This module:
 *     1. Centralizes ALL localStorage keys in one enum (prevents typos / collisions)
 *     2. Exposes a typed API so components never call `localStorage.*` directly
 *     3. Enforces the Write-Ahead Cache contract through explicit TTLs
 */

// ── Storage keys registry (single place to add/remove keys) ──────────────────

export const STORAGE_KEYS = {
  // Auth
  AUTH_TOKEN: "rag.auth.access_token",
  AUTH_USER: "rag.auth.user",

  // Navigation pass-through (ephemeral — cleared once consumed)
  QUIZ_PENDING: "rag.quiz.pending",
  SLIDE_PENDING: "rag.slides.pending",

  // Write-Ahead Cache drafts (TTL enforced)
  SLIDE_DRAFT: "rag.slides.draft",

  // Legacy UI state (dashboard/generate forms)
  DASHBOARD_ACTIVE_TAB: "rag_dashboard_state_activeTab",
  DASHBOARD_CHAT_HISTORY: "rag_dashboard_state_chatHistory",
  DASHBOARD_CONVERSATION_ID: "rag_dashboard_state_conversationId",
  GENERATE_DOCS: "rag_generate_form_state_docs",
  GENERATE_PROMPT: "rag_generate_form_state_prompt",
  GENERATE_LEVEL: "rag_generate_form_state_level",
  GENERATE_FORMAT: "rag_generate_form_state_format",
  GENERATE_LENGTH: "rag_generate_form_state_length",
  GENERATE_RESULT: "rag_generate_form_state_result",
} as const;

export type StorageKey = (typeof STORAGE_KEYS)[keyof typeof STORAGE_KEYS];

// ── TTL-aware wrapper types ───────────────────────────────────────────────────

interface CachedEntry<T> {
  data: T;
  /** Unix timestamp (ms) when this entry was written */
  writtenAt: number;
  /** TTL in milliseconds. 0 = no expiry. */
  ttlMs: number;
  /** Marks entry as locally-modified and not yet persisted to DB */
  isDraft?: boolean;
}

// ── Low-level helpers ─────────────────────────────────────────────────────────

const canUseStorage = () => typeof window !== "undefined";

/** Read a raw string from localStorage. Returns null if unavailable. */
export function readRaw(key: string): string | null {
  if (!canUseStorage()) return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** Write a raw string to localStorage. Returns false if quota exceeded. */
export function writeRaw(key: string, value: string): boolean {
  if (!canUseStorage()) return false;
  try {
    window.localStorage.setItem(key, value);
    return true;
  } catch {
    // QuotaExceededError — silently skip
    return false;
  }
}

/** Remove a key from localStorage. */
export function removeKey(key: string): void {
  if (!canUseStorage()) return;
  try {
    window.localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

// ── Typed, TTL-aware API ──────────────────────────────────────────────────────

/**
 * Write a typed object with optional TTL.
 *
 * @param key     STORAGE_KEYS entry or any string (prefer STORAGE_KEYS)
 * @param data    The value to store
 * @param ttlMs   Expiry in ms. Default 0 = no expiry (session-lived).
 * @param isDraft True when data is not yet persisted to DB.
 */
export function writeCache<T>(
  key: string,
  data: T,
  ttlMs = 0,
  isDraft = false,
): void {
  const entry: CachedEntry<T> = {
    data,
    writtenAt: Date.now(),
    ttlMs,
    isDraft,
  };
  writeRaw(key, JSON.stringify(entry));
}

/**
 * Read a typed object.  Returns null if:
 *   - key absent
 *   - JSON parse fails
 *   - TTL expired (entry is auto-evicted)
 */
export function readCache<T>(key: string): T | null {
  const raw = readRaw(key);
  if (!raw) return null;
  try {
    const entry = JSON.parse(raw) as CachedEntry<T>;
    if (
      entry.ttlMs > 0 &&
      Date.now() - entry.writtenAt > entry.ttlMs
    ) {
      // Expired — evict
      removeKey(key);
      return null;
    }
    return entry.data;
  } catch {
    return null;
  }
}

/**
 * Read a typed object, returning true when the data is a local draft
 * (written with isDraft=true) and not yet confirmed by DB.
 */
export function readCacheWithMeta<T>(
  key: string,
): { data: T; isDraft: boolean } | null {
  const raw = readRaw(key);
  if (!raw) return null;
  try {
    const entry = JSON.parse(raw) as CachedEntry<T>;
    if (
      entry.ttlMs > 0 &&
      Date.now() - entry.writtenAt > entry.ttlMs
    ) {
      removeKey(key);
      return null;
    }
    return { data: entry.data, isDraft: entry.isDraft ?? false };
  } catch {
    return null;
  }
}

// ── Navigation pass-through helpers ──────────────────────────────────────────
// These keys carry state from one route to another (e.g. editor → slides).
// They are consumed exactly ONCE and immediately removed.

/**
 * Write "pending" state for a navigation-triggered page.
 * Data is automatically consumed on read.
 */
export function writePending<T>(key: string, data: T): void {
  writeRaw(key, JSON.stringify(data));
}

/**
 * Consume "pending" state — reads AND removes in one atomic operation.
 * Returns null if absent or parse fails.
 */
export function consumePending<T>(key: string): T | null {
  const raw = readRaw(key);
  if (!raw) return null;
  removeKey(key); // consume immediately
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

// ── Draft lifecycle helpers ───────────────────────────────────────────────────

/**
 * Mark a cached entry as "synced" (isDraft → false) after DB confirms save.
 * Call this in the .then() of your API save call.
 */
export function markSynced<T>(key: string): void {
  const raw = readRaw(key);
  if (!raw) return;
  try {
    const entry = JSON.parse(raw) as CachedEntry<T>;
    entry.isDraft = false;
    writeRaw(key, JSON.stringify(entry));
  } catch {
    /* ignore */
  }
}

/**
 * Evict a draft after confirmed DB persistence.
 * Prefer this over markSynced when you don't need local caching after save.
 */
export function evictAfterSync(key: string): void {
  removeKey(key);
}

// ── Bulk operations ───────────────────────────────────────────────────────────

/** Remove all keys matching a prefix (e.g. legacy UI state cleanup). */
export function removeByPrefix(prefix: string): void {
  if (!canUseStorage()) return;
  const toDelete: string[] = [];
  for (let i = 0; i < window.localStorage.length; i++) {
    const k = window.localStorage.key(i);
    if (k && k.startsWith(prefix)) toDelete.push(k);
  }
  toDelete.forEach(removeKey);
}

/** Remove all known STORAGE_KEYS entries (full logout cleanup). */
export function clearAll(): void {
  Object.values(STORAGE_KEYS).forEach(removeKey);
}
