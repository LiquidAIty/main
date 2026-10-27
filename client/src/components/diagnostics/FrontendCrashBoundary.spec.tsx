// @vitest-environment jsdom

/**
 * Graph + less = more: less code that does the same work as more code is more useful.
 * Entity names the feature; Relationship explains why this file belongs and what it contributes.
 * Use codebase-memory-mcp cli to search tags, trace structure both ways, check coverage, then read source.
 * Change the smallest existing path; remove what it replaces, never duplicate, and update tags when meaning changes.
 * Entity: Crash Diagnostics
 * Relationship: This file verifies the root crash boundary converts child render failures into a copyable diagnostic panel without losing the captured error.
 */

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
    window.history.replaceState({}, "", "/");
    vi.clearAllMocks();
    vi.resetModules();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("catches child throw and renders diagnostic panel", () => {
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    render(
      <FrontendCrashBoundary scopeLabel="UnitTestBoundary">
        <ThrowingChild />
      </FrontendCrashBoundary>,
    );

    expect(screen.getByRole("heading", { name: /A frontend error occurred/i })).toBeTruthy();
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

  it("keeps query credentials and fragments out of the copyable report", () => {
    window.history.replaceState(
      {},
      "",
      "/agentbuilder?projectId=project-one&access_token=secret-value#oauth-callback",
    );
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    render(
      <FrontendCrashBoundary>
        <ThrowingChild />
      </FrontendCrashBoundary>,
    );

    const report = (screen.getByRole("textbox") as HTMLTextAreaElement).value;
    expect(report).toContain("route: /agentbuilder");
    expect(report).toContain("projectId: project-one");
    expect(report).not.toContain("access_token");
    expect(report).not.toContain("secret-value");
    expect(report).not.toContain("oauth-callback");

    consoleErrorSpy.mockRestore();
  });
});
