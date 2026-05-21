// @vitest-environment jsdom
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import FrontendCrashBoundary from "./FrontendCrashBoundary";
import { clearFrontendCrash } from "../../lib/frontendCrashDiagnostics";

vi.mock("@xyflow/react", async () => {
  const ReactModule = await import("react");
  return {
    Background: () => <div data-testid="mock-react-flow-background" />,
    Controls: () => <div data-testid="mock-react-flow-controls" />,
    MiniMap: () => <div data-testid="mock-react-flow-minimap" />,
    ReactFlow: ({ children, nodes, onNodeClick }: any) => (
      <div data-testid="mock-react-flow">
        {nodes.map((node: any) => (
          <button
            key={node.id}
            type="button"
            data-testid={`storyboard-node-${node.type}`}
            onClick={() => onNodeClick?.({}, node)}
          >
            {node.type}
          </button>
        ))}
        {children}
      </div>
    ),
    addEdge: (connection: any, edges: any[]) => [
      ...edges,
      { id: `${connection.source}-${connection.target}`, ...connection },
    ],
    useEdgesState: (initialEdges: any[]) => {
      const [edges, setEdges] = ReactModule.useState(initialEdges);
      return [edges, setEdges, vi.fn()];
    },
    useNodesState: (initialNodes: any[]) => {
      const [nodes, setNodes] = ReactModule.useState(initialNodes);
      return [nodes, setNodes, vi.fn()];
    },
  };
});

function ThrowingChild() {
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

  it("allows MediaStudioCanvas to render under boundary", async () => {
    vi.resetModules();
    const { default: MediaStudioCanvas } = await import(
      "../../features/media/MediaStudioCanvas"
    );

    render(
      <FrontendCrashBoundary scopeLabel="MediaStudioBoundary">
        <MediaStudioCanvas projectId={null} />
      </FrontendCrashBoundary>,
    );

    expect(screen.getByTestId("mock-react-flow")).toBeTruthy();
    expect(screen.getByTestId("video-storyboard-inspector")).toBeTruthy();
    expect(screen.queryByTestId("frontend-crash-panel")).toBeNull();
  });
});
