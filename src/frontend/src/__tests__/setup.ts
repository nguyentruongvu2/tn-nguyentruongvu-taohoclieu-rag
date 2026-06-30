/**
 * Vitest global test setup.
 * Mocks localStorage with a simple in-memory implementation
 * so storageService tests run cleanly in jsdom.
 */

import { beforeEach } from "vitest";

// In-memory localStorage mock
const _store: Record<string, string> = {};

const localStorageMock: Storage = {
  getItem: (key) => _store[key] ?? null,
  setItem: (key, value) => { _store[key] = String(value); },
  removeItem: (key) => { delete _store[key]; },
  clear: () => { Object.keys(_store).forEach((k) => delete _store[k]); },
  key: (index) => Object.keys(_store)[index] ?? null,
  get length() { return Object.keys(_store).length; },
};

Object.defineProperty(globalThis, "localStorage", {
  value: localStorageMock,
  writable: true,
});

// Reset between every test
beforeEach(() => {
  localStorageMock.clear();
});
