import React, { useEffect, useRef } from "react";
import * as d3 from "d3";

// Theme colors
const C = {
  bg: "#0B0C0E",
  panel: "#121317",
  border: "#2A2F36",
  text: "#E9EEF5",
  muted: "#9AA3B2",
  primary: "#6EFAFB",   // turquoise
  accent:  "#E2725B",   // terra cotta
  neutral: "#6E7E85",   // gray
};

export interface KnowledgeGraphNode {
  id: string;
  label?: string;
  kind?: string;
  score?: number;
}

export interface KnowledgeGraphLink {
  source: string;
  target: string;
  weight?: number;
  relation?: string;
}

export interface KnowledgeGraphViewProps {
  nodes: KnowledgeGraphNode[];
  links: KnowledgeGraphLink[];
  height?: number;
  onSelectNode?: (id: string | null) => void;
  selectedId?: string | null;
}

export function KnowledgeGraphView({ nodes, links, height = 420, onSelectNode, selectedId }: KnowledgeGraphViewProps) {
  const ref = useRef<SVGSVGElement>(null);
  const ttRef = useRef<HTMLDivElement>(null);
  
  useEffect(() => {
    if (!ref.current) return;
    const svg = d3.select(ref.current);
    svg.selectAll('*').remove();
    
    const width = ref.current.clientWidth || 720;
    const h = height;
    const root = svg.attr('width', width).attr('height', h);

    const defs = root.append('defs');
    defs.append('marker')
      .attr('id', 'arrow')
      .attr('viewBox', '0 -5 10 10')
      .attr('refX', 14)
      .attr('refY', 0)
      .attr('markerWidth', 6)
      .attr('markerHeight', 6)
      .attr('orient', 'auto')
      .append('path')
      .attr('d', 'M0,-5L10,0L0,5')
      .attr('fill', '#7a808c');

    const g = root.append('g');
    const color = d3.scaleOrdinal<string>()
      .domain(['org', 'product', 'person', 'place', 'concept', 'other'])
      .range([C.primary, C.accent, '#59a14f', '#edc949', '#af7aa1', '#bab0ab']);

    // Create a copy of nodes and links to avoid modifying props
    const N = nodes.map(d => ({ ...d }));
    const L = links.map(d => ({ ...d }));
    
    // Type for d3 simulation nodes with x,y coordinates
    interface SimulationNode extends KnowledgeGraphNode {
      x?: number;
      y?: number;
      fx?: number | null;
      fy?: number | null;
    }
    
    // Type for d3 simulation links with source/target as objects
    interface SimulationLink extends KnowledgeGraphLink {
      source: SimulationNode | string;
      target: SimulationNode | string;
    }

    const sim = d3.forceSimulation<SimulationNode>(N)
      .force('link', d3.forceLink<SimulationNode, SimulationLink>(L).id(d => d.id).distance(d => 120 - ((d.weight || 0) * 40)).strength(0.7))
      .force('charge', d3.forceManyBody().strength(-260))
      .force('center', d3.forceCenter(width / 2, h / 2))
      .force('collision', d3.forceCollide().radius(d => 20 + (d.score || 0) * 10));

    const link = g.append('g')
      .attr('stroke', '#7a808c')
      .attr('stroke-opacity', 0.6)
      .selectAll('line')
      .data(L)
      .join('line')
      .attr('stroke-width', d => 1 + (d.weight || 0.2) * 2)
      .attr('marker-end', 'url(#arrow)');

    const node = g.append('g')
      .selectAll('g')
      .data(N)
      .join('g')
      .call(d3.drag<SVGGElement, SimulationNode>()
        .on('start', (ev: any, d) => {
          if (!ev.active) sim.alphaTarget(0.3).restart();
          d.fx = d.x;
          d.fy = d.y;
        })
        .on('drag', (ev: any, d) => {
          d.fx = ev.x;
          d.fy = ev.y;
        })
        .on('end', (ev: any, d) => {
          if (!ev.active) sim.alphaTarget(0);
          d.fx = null;
          d.fy = null;
        })
      );

    const circles = node.append('circle')
      .attr('r', d => 10 + (d.score || 0.2) * 12)
      .attr('fill', d => color(d.kind || 'other'))
      .attr('stroke', d => d.id === selectedId ? '#fff' : '#222')
      .attr('stroke-width', d => d.id === selectedId ? 2.5 : 0.8)
      .on('click', (_: any, d: SimulationNode) => onSelectNode && onSelectNode(d.id === selectedId ? null : d.id));

    node.append('text')
      .text(d => d.label || d.id)
      .attr('x', 14)
      .attr('y', 4)
      .attr('font-size', 11)
      .attr('fill', '#ddd')
      .attr('paint-order', 'stroke')
      .attr('stroke', '#111')
      .attr('stroke-width', 2);

    // Hover interactions: fade unrelated nodes/links and show tooltip
    circles.on('mouseenter', function(event: any, d: SimulationNode) {
      node.style('opacity', n => {
        return (n.id === d.id || 
          L.some(l => (typeof l.source === 'object' ? l.source.id : l.source) === n.id && (typeof l.target === 'object' ? l.target.id : l.target) === d.id) || 
          L.some(l => (typeof l.target === 'object' ? l.target.id : l.target) === n.id && (typeof l.source === 'object' ? l.source.id : l.source) === d.id)) ? 1 : 0.12;
      });
      
      link.style('opacity', l => {
        const sourceId = typeof l.source === 'object' ? l.source.id : l.source;
        const targetId = typeof l.target === 'object' ? l.target.id : l.target;
        return (sourceId === d.id || targetId === d.id) ? 1 : 0.06;
      });
      
      const tt = d3.select(ttRef.current);
      tt.style('opacity', 1)
        .html(`<div style="font-size:12px"><b>${d.label || d.id}</b></div><div style="opacity:.8;font-size:11px">${d.kind || 'entity'}</div>`);
    })
    .on('mousemove', function(event: any) {
      d3.select(ttRef.current)
        .style('left', (event.clientX + 12) + 'px')
        .style('top', (event.clientY + 12) + 'px');
    })
    .on('mouseleave', function() {
      node.style('opacity', 1);
      link.style('opacity', 0.6);
      d3.select(ttRef.current).style('opacity', 0);
    });

    sim.on('tick', () => {
      link
        .attr('x1', d => (typeof d.source === 'object' ? d.source.x || 0 : 0))
        .attr('y1', d => (typeof d.source === 'object' ? d.source.y || 0 : 0))
        .attr('x2', d => (typeof d.target === 'object' ? d.target.x || 0 : 0))
        .attr('y2', d => (typeof d.target === 'object' ? d.target.y || 0 : 0));
      
      node.attr('transform', d => `translate(${d.x || 0},${d.y || 0})`);
    });

    // cleanup
    return () => { sim.stop(); };
  }, [nodes, links, height, selectedId, onSelectNode]);

  return (
    <div style={{ position: 'relative' }}>
      <svg ref={ref} className="w-full" />
      <div 
        ref={ttRef} 
        className="fixed pointer-events-none bg-black text-white text-xs px-3 py-2 rounded-md shadow-xl" 
        style={{ opacity: 0, maxWidth: 260 }}
      />
    </div>
  );
}
