import { describe, expect, it } from "vitest";

import type { GraphViewData } from "../../types/agentgraph";
import { toReactFlowGraph, toThinkGraphProjectionInput } from "./thinkGraphReactFlowAdapter";

describe("thinkGraphReactFlowAdapter", () => {
  it("maps ThinkGraph-style graph data to semantic projection input", () => {
    const input: GraphViewData = {
      kind: "thinkgraph",
      nodes: [
        { id: "n1", label: "Goal", type: "goal", summary: "Ship planner", confidence: 0.8 },
        { id: "n2", label: "Task", type: "task" },
      ],
      edges: [{ id: "e1", source: "n1", target: "n2", type: "depends_on", weight: 2 }],
    };
    const projection = toThinkGraphProjectionInput(input);

    expect(projection.entities).toHaveLength(2);
    expect(projection.relationships).toHaveLength(1);
    expect(projection.entities[0]).toMatchObject({
      id: "n1",
      label: "Goal",
      type: "goal",
      confidence: 0.8,
    });
  });

  it("builds React Flow nodes/edges with separate layout state", () => {
    const flow = toReactFlowGraph(
      {
        entities: [
          { id: "n1", label: "Goal", type: "goal" },
          { id: "n2", label: "Task", type: "task" },
        ],
        relationships: [{ id: "e1", sourceId: "n1", targetId: "n2", type: "depends_on", weight: 2 }],
      },
      {
        layoutState: {
          nodePositions: {
            n1: { x: 20, y: 30 },
          },
        },
      },
    );

    expect(flow.nodes).toHaveLength(2);
    expect(flow.edges).toHaveLength(1);
    expect(flow.nodes.find((node) => node.id === "n1")?.position).toEqual({ x: 20, y: 30 });
    expect(flow.edges[0]).toMatchObject({
      source: "n1",
      target: "n2",
      label: "depends_on",
    });
  });
});
