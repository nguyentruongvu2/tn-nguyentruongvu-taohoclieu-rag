/**
 * Unit tests for constants/messages.ts
 *
 * Verifies:
 *   - All string fields in MSG are non-empty
 *   - Dynamic message functions return non-empty strings
 *   - No field returns undefined
 */

import { describe, it, expect } from "vitest";
import { MSG } from "../constants/messages";

describe("MSG.common", () => {
  it("back is non-empty", () => expect(MSG.common.back.length).toBeGreaterThan(0));
  it("retry is non-empty", () => expect(MSG.common.retry.length).toBeGreaterThan(0));
  it("loading is non-empty", () => expect(MSG.common.loading.length).toBeGreaterThan(0));
});

describe("MSG.api", () => {
  it("sessionExpired is non-empty", () =>
    expect(MSG.api.sessionExpired.length).toBeGreaterThan(0));

  it("serverError returns string with status code", () => {
    const msg = MSG.api.serverError(500);
    expect(typeof msg).toBe("string");
    expect(msg).toContain("500");
  });

  it("noResponse is non-empty", () =>
    expect(MSG.api.noResponse.length).toBeGreaterThan(0));

  it("requestError includes error message", () => {
    const msg = MSG.api.requestError("timeout");
    expect(msg).toContain("timeout");
  });
});

describe("MSG.quiz", () => {
  it("loadingQuestions is non-empty", () =>
    expect(MSG.quiz.loadingQuestions.length).toBeGreaterThan(0));

  it("notFound is non-empty", () =>
    expect(MSG.quiz.notFound.length).toBeGreaterThan(0));

  it("answered includes done and total", () => {
    const msg = MSG.quiz.answered(3, 10);
    expect(msg).toContain("3");
    expect(msg).toContain("10");
  });

  it("unanswered includes count", () => {
    const msg = MSG.quiz.unanswered(5);
    expect(msg).toContain("5");
  });

  it("allAnswered includes total", () => {
    const msg = MSG.quiz.allAnswered(8);
    expect(msg).toContain("8");
  });

  it("seed includes seed number", () => {
    const msg = MSG.quiz.seed(42);
    expect(msg).toContain("42");
  });
});

describe("MSG.slide", () => {
  it("generating includes slide count", () => {
    const msg = MSG.slide.generating(10);
    expect(msg).toContain("10");
  });

  it("draftRestored includes age and count", () => {
    const msg = MSG.slide.draftRestored("5 phút trước", 7);
    expect(msg).toContain("5 phút trước");
    expect(msg).toContain("7");
  });

  it("notFound is non-empty", () =>
    expect(MSG.slide.notFound.length).toBeGreaterThan(0));
});

describe("MSG.auth", () => {
  it("loginFailed is non-empty", () =>
    expect(MSG.auth.loginFailed.length).toBeGreaterThan(0));

  it("registerFailed is non-empty", () =>
    expect(MSG.auth.registerFailed.length).toBeGreaterThan(0));
});
