// @vitest-environment jsdom
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import FrontendCrashBoundary from "./FrontendCrashBoundary";
import { clearFrontendCrash } from "../../lib/frontendCrashDiagnostics";

function ThrowingChild(): React.ReactNode {
  throw new Error("boundary_test_crash");
}

describe("FrontendCrashBoundary", () => {
  afterEach(() => {
    cleanup();
    clearFrontendCrash();
    vi.clearAllMocks();
    vi.resetModules();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("catches child throw and renders diagnostic panel", () => {
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    render(
      <FrontendCrashBoundary scopeLabel="UnitTestBoundary">
        <ThrowingChild />
      </FrontendCrashBoundary>,
    );

    expect(screen.getByRole("heading", { name: /LiquidAIty caught a frontend crash/i })).toBeTruthy();
    expect(
      screen.getByText(/UnitTestBoundary:\s*boundary_test_crash/i),
    ).toBeTruthy();
    expect(
      screen.getByText(/copy the crash text below into Codex/i),
    ).toBeTruthy();
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toContain(
      "boundary_test_crash",
    );

    consoleErrorSpy.mockRestore();
  });
});
