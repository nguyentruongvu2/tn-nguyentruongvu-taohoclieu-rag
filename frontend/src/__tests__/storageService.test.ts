/**
 * Unit tests for storageService.ts
 *
 * Tests cover:
 *   - writeRaw / readRaw / removeKey
 *   - writeCache / readCache with and without TTL
 *   - readCacheWithMeta — isDraft flag
 *   - writePending / consumePending (one-shot navigation state)
 *   - markSynced / evictAfterSync
 *   - removeByPrefix / clearAll
 *   - STORAGE_KEYS registry completeness
 */

import { describe, it, expect } from "vitest";
import {
  STORAGE_KEYS,
  readRaw,
  writeRaw,
  removeKey,
  writeCache,
  readCache,
  readCacheWithMeta,
  writePending,
  consumePending,
  markSynced,
  evictAfterSync,
  removeByPrefix,
  clearAll,
} from "../services/storageService";

// ── readRaw / writeRaw / removeKey ────────────────────────────────────────────

describe("readRaw / writeRaw / removeKey", () => {
  it("returns null for absent key", () => {
    expect(readRaw("missing")).toBeNull();
  });

  it("writes and reads a raw string", () => {
    writeRaw("k1", "hello");
    expect(readRaw("k1")).toBe("hello");
  });

  it("removes a key", () => {
    writeRaw("k2", "value");
    removeKey("k2");
    expect(readRaw("k2")).toBeNull();
  });

  it("overwriting a key replaces value", () => {
    writeRaw("k3", "first");
    writeRaw("k3", "second");
    expect(readRaw("k3")).toBe("second");
  });
});

// ── writeCache / readCache ────────────────────────────────────────────────────

describe("writeCache / readCache", () => {
  it("stores and retrieves typed data", () => {
    writeCache("ck1", { foo: 42 });
    expect(readCache<{ foo: number }>("ck1")).toEqual({ foo: 42 });
  });

  it("returns null for absent cache key", () => {
    expect(readCache("nope")).toBeNull();
  });

  it("returns data before TTL expires", () => {
    writeCache("ttl1", "alive", 5000); // 5s TTL
    expect(readCache("ttl1")).toBe("alive");
  });

  it("returns null and evicts after TTL expires", () => {
    // Write with TTL already expired (write 10s in the past)
    const entry = {
      data: "expired",
      writtenAt: Date.now() - 20_000,
      ttlMs: 5_000,
      isDraft: false,
    };
    writeRaw("ttl2", JSON.stringify(entry));
    expect(readCache("ttl2")).toBeNull();
    // Entry should have been evicted
    expect(readRaw("ttl2")).toBeNull();
  });

  it("zero TTL means no expiry", () => {
    writeCache("ttl3", "permanent", 0);
    expect(readCache("ttl3")).toBe("permanent");
  });

  it("returns null on corrupted JSON", () => {
    writeRaw("bad", "not-json{{{");
    expect(readCache("bad")).toBeNull();
  });
});

// ── readCacheWithMeta ─────────────────────────────────────────────────────────

describe("readCacheWithMeta", () => {
  it("isDraft is false by default", () => {
    writeCache("meta1", { x: 1 });
    const result = readCacheWithMeta<{ x: number }>("meta1");
    expect(result?.isDraft).toBe(false);
  });

  it("isDraft is true when written as draft", () => {
    writeCache("meta2", { y: 2 }, 0, true);
    const result = readCacheWithMeta<{ y: number }>("meta2");
    expect(result?.isDraft).toBe(true);
    expect(result?.data).toEqual({ y: 2 });
  });

  it("returns null for absent key", () => {
    expect(readCacheWithMeta("gone")).toBeNull();
  });
});

// ── writePending / consumePending ─────────────────────────────────────────────

describe("writePending / consumePending", () => {
  it("stores and consumes data once", () => {
    writePending("pend1", { lessonContent: "hello" });
    const result = consumePending<{ lessonContent: string }>("pend1");
    expect(result?.lessonContent).toBe("hello");
  });

  it("returns null on second consume (one-shot)", () => {
    writePending("pend2", { a: 1 });
    consumePending("pend2"); // first read
    expect(consumePending("pend2")).toBeNull(); // second read → null
  });

  it("returns null if never written", () => {
    expect(consumePending("never")).toBeNull();
  });

  it("removes key from localStorage after consume", () => {
    writePending("pend3", { x: 99 });
    consumePending("pend3");
    expect(readRaw("pend3")).toBeNull();
  });
});

// ── markSynced / evictAfterSync ───────────────────────────────────────────────

describe("markSynced", () => {
  it("flips isDraft from true to false", () => {
    writeCache("sync1", { z: 5 }, 0, true);
    markSynced("sync1");
    const result = readCacheWithMeta<{ z: number }>("sync1");
    expect(result?.isDraft).toBe(false);
    expect(result?.data.z).toBe(5);
  });

  it("no-ops on absent key", () => {
    expect(() => markSynced("missing_sync")).not.toThrow();
  });
});

describe("evictAfterSync", () => {
  it("removes the key entirely", () => {
    writeCache("evict1", "data");
    evictAfterSync("evict1");
    expect(readRaw("evict1")).toBeNull();
  });
});

// ── removeByPrefix / clearAll ─────────────────────────────────────────────────

describe("removeByPrefix", () => {
  it("removes only keys with matching prefix", () => {
    writeRaw("pfx_a", "1");
    writeRaw("pfx_b", "2");
    writeRaw("other_c", "3");
    removeByPrefix("pfx_");
    expect(readRaw("pfx_a")).toBeNull();
    expect(readRaw("pfx_b")).toBeNull();
    expect(readRaw("other_c")).toBe("3");
  });
});

describe("clearAll", () => {
  it("removes all known STORAGE_KEYS", () => {
    // Write all keys
    Object.values(STORAGE_KEYS).forEach((k) => writeRaw(k, "test"));
    clearAll();
    Object.values(STORAGE_KEYS).forEach((k) => {
      expect(readRaw(k)).toBeNull();
    });
  });
});

// ── STORAGE_KEYS registry ─────────────────────────────────────────────────────

describe("STORAGE_KEYS registry", () => {
  it("all keys are non-empty strings", () => {
    Object.entries(STORAGE_KEYS).forEach(([, key]) => {
      expect(typeof key).toBe("string");
      expect(key.length).toBeGreaterThan(0);
    });
  });

  it("all keys are unique (no collisions)", () => {
    const values = Object.values(STORAGE_KEYS);
    const unique = new Set(values);
    expect(unique.size).toBe(values.length);
  });

  it("QUIZ_PENDING key exists", () => {
    expect(STORAGE_KEYS.QUIZ_PENDING).toBeDefined();
  });

  it("SLIDE_DRAFT key exists", () => {
    expect(STORAGE_KEYS.SLIDE_DRAFT).toBeDefined();
  });
});
