import React, { useRef, useEffect, useState } from 'react';
import ForceGraph3D from '3d-force-graph';
import { kgGetEntityTimeSeries } from '../lib/api';
import { TimeInterval } from '../lib/services/timeseries';
import { scaleLinear } from 'd3-scale';
import { format } from 'date-fns';
import SpriteText from 'three-spritetext';
import * as THREE from 'three';

interface KnowledgeGraphViewer3DProps {
  data: {
    nodes: Array<{
      id: string;
      name: string;
      type: string;
      value?: number;
      timestamp?: string;
      color?: string;
      group?: string;
    }>;
    links: Array<{
      source: string;
      target: string;
      type: string;
      value?: number;
      timestamp?: string;
    }>;
  };
  timeRange?: {
    start: string;
    end: string;
    current: string;
  };
  valueField?: string;
  colorBy?: 'type' | 'group' | 'value';
  sizeBy?: 'none' | 'value' | 'connections';
  onNodeClick?: (node: any) => void;
  onLinkClick?: (link: any) => void;
}

const KnowledgeGraphViewer3D: React.FC<KnowledgeGraphViewer3DProps> = ({
  data,
  timeRange,
  valueField = 'value',
  colorBy = 'type',
  sizeBy = 'value',
  onNodeClick,
  onLinkClick
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const graphRef = useRef<any>(null);
  const [currentTime, setCurrentTime] = useState<string>(timeRange?.current || new Date().toISOString());
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [playSpeed, setPlaySpeed] = useState<number>(1);
  const [filteredData, setFilteredData] = useState(data);
  const [highlightNodes, setHighlightNodes] = useState(new Set());
  const [highlightLinks, setHighlightLinks] = useState(new Set());
  const [selectedNode, setSelectedNode] = useState<any>(null);
  
  // Color scale for values
  const valueColorScale = scaleLinear<string>()
    .domain([0, 50, 100])
    .range(['#0000FF', '#00FF00', '#FF0000']);
  
  // Node color mapping
  const typeColors: Record<string, string> = {
    Entity: '#5D8AA8',
    Person: '#E32636',
    Organization: '#FFBF00',
    Location: '#9966CC',
    Event: '#F19CBB',
    Product: '#7B3F00',
    Concept: '#008000',
    TimeSeries: '#4B0082'
  };
  
  // Filter data based on current time
  useEffect(() => {
    if (!timeRange) {
      setFilteredData(data);
      return;
    }
    
    const currentDate = new Date(currentTime);
    
    // Filter nodes and links based on timestamp
    const filteredNodes = data.nodes.filter(node => {
      if (!node.timestamp) return true;
      const nodeDate = new Date(node.timestamp);
      return nodeDate <= currentDate;
    });
    
    const filteredLinks = data.links.filter(link => {
      if (!link.timestamp) return true;
      const linkDate = new Date(link.timestamp);
      return linkDate <= currentDate;
    });
    
    setFilteredData({
      nodes: filteredNodes,
      links: filteredLinks
    });
  }, [data, currentTime, timeRange]);
  
  // Initialize 3D force graph
  useEffect(() => {
    if (!containerRef.current) return;
    
    const Graph = ForceGraph3D()(containerRef.current)
      .graphData(filteredData)
      .nodeId('id')
      .nodeLabel(node => `${node.name} (${node.type})${node.value ? ` - ${node.value}` : ''}`)
      .nodeColor(node => {
        if (highlightNodes.has(node)) return '#FFFF00';
        if (selectedNode === node) return '#FF00FF';
        
        if (colorBy === 'type') return typeColors[node.type] || '#CCCCCC';
        if (colorBy === 'group') return node.color || '#CCCCCC';
        if (colorBy === 'value' && node.value !== undefined) {
          return valueColorScale(node.value);
        }
        return '#CCCCCC';
      })
      .nodeVal(node => {
        if (sizeBy === 'none') return 1;
        if (sizeBy === 'value' && node.value !== undefined) {
          return Math.max(1, Math.sqrt(node.value) / 2);
        }
        if (sizeBy === 'connections') {
          // Count connected links
          const connectedLinks = filteredData.links.filter(
            link => link.source === node.id || link.target === node.id
          );
          return Math.max(1, Math.sqrt(connectedLinks.length));
        }
        return 1;
      })
      .nodeThreeObject(node => {
        // Custom node rendering with labels
        const obj = new THREE.Mesh(
          new THREE.SphereGeometry(1),
          new THREE.MeshLambertMaterial({
            color: node.color || typeColors[node.type] || '#CCCCCC',
            transparent: true,
            opacity: 0.8
          })
        );
        
        // Add text sprite
        const sprite = new SpriteText(node.name);
        sprite.color = 'white';
        sprite.textHeight = 2;
        sprite.position.y = 2;
        obj.add(sprite);
        
        return obj;
      })
      .linkLabel(link => `${link.type}${link.value ? ` - ${link.value}` : ''}`)
      .linkColor(link => highlightLinks.has(link) ? '#FFFF00' : '#FFFFFF')
      .linkWidth(link => highlightLinks.has(link) ? 2 : 1)
      .linkDirectionalParticles(3)
      .linkDirectionalParticleWidth(link => highlightLinks.has(link) ? 2 : 0)
      .onNodeClick((node, event) => {
        setSelectedNode(selectedNode === node ? null : node);
        if (onNodeClick) onNodeClick(node);
        
        // Highlight connected nodes and links
        const connectedLinks = filteredData.links.filter(
          link => link.source === node.id || link.target === node.id
        );
        
        const connectedNodes = new Set();
        connectedLinks.forEach(link => {
          connectedNodes.add(link.source);
          connectedNodes.add(link.target);
        });
        
        setHighlightLinks(new Set(connectedLinks));
        setHighlightNodes(connectedNodes);
      })
      .onLinkClick((link, event) => {
        if (onLinkClick) onLinkClick(link);
        
        // Highlight connected nodes
        setHighlightLinks(new Set([link]));
        setHighlightNodes(new Set([link.source, link.target]));
      })
      .onBackgroundClick(() => {
        setSelectedNode(null);
        setHighlightNodes(new Set());
        setHighlightLinks(new Set());
      });
    
    // Enable camera controls
    Graph.controls().enableDamping = true;
    Graph.controls().dampingFactor = 0.25;
    Graph.controls().rotateSpeed = 0.5;
    
    // Save reference
    graphRef.current = Graph;
    
    // Cleanup
    return () => {
      if (containerRef.current) {
        containerRef.current.innerHTML = '';
      }
    };
  }, [filteredData, highlightNodes, highlightLinks, selectedNode, colorBy, sizeBy, onNodeClick, onLinkClick]);
  
  // Time playback effect
  useEffect(() => {
    if (!isPlaying || !timeRange) return;
    
    const startDate = new Date(timeRange.start).getTime();
    const endDate = new Date(timeRange.end).getTime();
    const currentDate = new Date(currentTime).getTime();
    
    const interval = setInterval(() => {
      const nextDate = currentDate + 86400000 * playSpeed; // Add days based on speed
      
      if (nextDate > endDate) {
        setIsPlaying(false);
        return;
      }
      
      setCurrentTime(new Date(nextDate).toISOString());
    }, 1000); // Update every second
    
    return () => clearInterval(interval);
  }, [isPlaying, currentTime, timeRange, playSpeed]);
  
  // Load time series data for selected node
  useEffect(() => {
    if (!selectedNode) return;
    
    const fetchTimeSeriesData = async () => {
      try {
        const result = await kgGetEntityTimeSeries(selectedNode.id);
        if (result.ok && result.series) {
          console.log('Time series data for node:', result.series);
          // You could display this data in a chart or sidebar
        }
      } catch (error) {
        console.error('Error fetching time series data:', error);
      }
    };
    
    fetchTimeSeriesData();
  }, [selectedNode]);
  
  // Format date for display
  const formatDate = (dateString: string) => {
    return format(new Date(dateString), 'MMM d, yyyy');
  };
  
  return (
    <div className="knowledge-graph-viewer-3d">
      <div className="controls">
        {timeRange && (
          <div className="time-controls">
            <button 
              onClick={() => setIsPlaying(!isPlaying)}
              className={`play-button ${isPlaying ? 'playing' : ''}`}
            >
              {isPlaying ? '⏸️ Pause' : '▶️ Play'}
            </button>
            
            <input
              type="range"
              min={new Date(timeRange.start).getTime()}
              max={new Date(timeRange.end).getTime()}
              value={new Date(currentTime).getTime()}
              onChange={(e) => setCurrentTime(new Date(parseInt(e.target.value)).toISOString())}
              className="time-slider"
            />
            
            <div className="time-display">
              {formatDate(currentTime)}
            </div>
            
            <div className="speed-control">
              <label>Speed:</label>
              <select 
                value={playSpeed}
                onChange={(e) => setPlaySpeed(Number(e.target.value))}
              >
                <option value={0.25}>0.25x</option>
                <option value={0.5}>0.5x</option>
                <option value={1}>1x</option>
                <option value={2}>2x</option>
                <option value={5}>5x</option>
                <option value={10}>10x</option>
              </select>
            </div>
          </div>
        )}
        
        <div className="view-controls">
          <label>Color by:</label>
          <select 
            value={colorBy}
            onChange={(e) => {
              const value = e.target.value as 'type' | 'group' | 'value';
              // You would need to implement a way to update this prop
            }}
          >
            <option value="type">Type</option>
            <option value="group">Group</option>
            <option value="value">Value</option>
          </select>
          
          <label>Size by:</label>
          <select 
            value={sizeBy}
            onChange={(e) => {
              const value = e.target.value as 'none' | 'value' | 'connections';
              // You would need to implement a way to update this prop
            }}
          >
            <option value="none">Uniform</option>
            <option value="value">Value</option>
            <option value="connections">Connections</option>
          </select>
        </div>
      </div>
      
      {selectedNode && (
        <div className="node-details">
          <h3>{selectedNode.name}</h3>
          <p>Type: {selectedNode.type}</p>
          {selectedNode.value !== undefined && (
            <p>{valueField}: {selectedNode.value}</p>
          )}
          {selectedNode.timestamp && (
            <p>Date: {formatDate(selectedNode.timestamp)}</p>
          )}
          <button onClick={() => setSelectedNode(null)}>Close</button>
        </div>
      )}
      
      <div ref={containerRef} className="graph-container" />
    </div>
  );
};

export default KnowledgeGraphViewer3D;
