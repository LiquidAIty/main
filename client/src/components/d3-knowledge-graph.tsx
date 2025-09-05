import React, { useEffect, useRef } from 'react';
import * as d3 from 'd3';

interface KnowledgeNode {
  id: string;
  type: 'fact' | 'concept' | 'relation' | 'source';
  content: string;
  confidence: number;
  connections: string[];
  verified: boolean;
  phi4Checked: boolean;
}

interface KnowledgeGraphProps {
  nodes: KnowledgeNode[];
  width?: number;
  height?: number;
  onNodeClick?: (node: KnowledgeNode) => void;
}

export default function D3KnowledgeGraph({ 
  nodes, 
  width = 800, 
  height = 600, 
  onNodeClick 
}: KnowledgeGraphProps) {
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    if (!nodes.length || !svgRef.current) return;

    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();

    // Create graph data
    const graphNodes = nodes.map(node => ({
      ...node,
      x: Math.random() * width,
      y: Math.random() * height
    }));

    const links = nodes.flatMap(node =>
      node.connections.map(targetId => ({
        source: node.id,
        target: targetId
      }))
    ).filter(link => 
      graphNodes.find(n => n.id === link.target)
    );

    // Create force simulation
    const simulation = d3.forceSimulation(graphNodes as any)
      .force("link", d3.forceLink(links).id((d: any) => d.id))
      .force("charge", d3.forceManyBody().strength(-300))
      .force("center", d3.forceCenter(width / 2, height / 2));

    // Create links
    const link = svg.append("g")
      .selectAll("line")
      .data(links)
      .enter().append("line")
      .attr("stroke", "#999")
      .attr("stroke-opacity", 0.6)
      .attr("stroke-width", 2);

    // Create nodes
    const node = svg.append("g")
      .selectAll("circle")
      .data(graphNodes)
      .enter().append("circle")
      .attr("r", (d: any) => 5 + d.confidence * 15)
      .attr("fill", (d: any) => {
        const colors = {
          fact: '#3b82f6',
          concept: '#10b981',
          relation: '#f59e0b',
          source: '#ef4444'
        };
        return colors[d.type] || '#6b7280';
      })
      .attr("stroke", (d: any) => d.verified ? '#22c55e' : '#ef4444')
      .attr("stroke-width", 2)
      .style("cursor", "pointer")
      .on("click", (event, d) => onNodeClick?.(d as KnowledgeNode));

    // Add labels
    const label = svg.append("g")
      .selectAll("text")
      .data(graphNodes)
      .enter().append("text")
      .text((d: any) => d.content.substring(0, 20) + "...")
      .attr("font-size", "10px")
      .attr("fill", "#333")
      .attr("text-anchor", "middle");

    // Update positions on simulation tick
    simulation.on("tick", () => {
      link
        .attr("x1", (d: any) => d.source.x)
        .attr("y1", (d: any) => d.source.y)
        .attr("x2", (d: any) => d.target.x)
        .attr("y2", (d: any) => d.target.y);

      node
        .attr("cx", (d: any) => d.x)
        .attr("cy", (d: any) => d.y);

      label
        .attr("x", (d: any) => d.x)
        .attr("y", (d: any) => d.y + 25);
    });

    // Add drag behavior
    const drag = d3.drag()
      .on("start", (event, d: any) => {
        if (!event.active) simulation.alphaTarget(0.3).restart();
        d.fx = d.x;
        d.fy = d.y;
      })
      .on("drag", (event, d: any) => {
        d.fx = event.x;
        d.fy = event.y;
      })
      .on("end", (event, d: any) => {
        if (!event.active) simulation.alphaTarget(0);
        d.fx = null;
        d.fy = null;
      });

    node.call(drag as any);

    return () => {
      simulation.stop();
    };
  }, [nodes, width, height, onNodeClick]);

  return (
    <div className="knowledge-graph-container">
      <svg
        ref={svgRef}
        width={width}
        height={height}
        className="border rounded-lg bg-white"
      />
      <div className="mt-4 flex space-x-4 text-sm">
        <div className="flex items-center">
          <div className="w-4 h-4 bg-blue-500 rounded-full mr-2"></div>
          <span>Facts</span>
        </div>
        <div className="flex items-center">
          <div className="w-4 h-4 bg-green-500 rounded-full mr-2"></div>
          <span>Concepts</span>
        </div>
        <div className="flex items-center">
          <div className="w-4 h-4 bg-yellow-500 rounded-full mr-2"></div>
          <span>Relations</span>
        </div>
        <div className="flex items-center">
          <div className="w-4 h-4 bg-red-500 rounded-full mr-2"></div>
          <span>Sources</span>
        </div>
      </div>
    </div>
  );
}
