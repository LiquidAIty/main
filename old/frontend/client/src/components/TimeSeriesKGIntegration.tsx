import React, { useState, useEffect } from 'react';
import KnowledgeGraphViewer3D from './KnowledgeGraphViewer3D';
import { Line } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  TimeScale
} from 'chart.js';
import 'chartjs-adapter-date-fns';
import { kgGetEntityTimeSeries, kgRunEvoModelSelection } from '../lib/api';
import { TrainingStrategy } from '../lib/models/model-orchestrator';
import { format } from 'date-fns';

// Register Chart.js components
ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  TimeScale
);

interface TimeSeriesKGIntegrationProps {
  initialEntityId?: string;
  startDate?: string;
  endDate?: string;
}

const TimeSeriesKGIntegration: React.FC<TimeSeriesKGIntegrationProps> = ({
  initialEntityId,
  startDate = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString(), // Default to 1 year ago
  endDate = new Date().toISOString() // Default to now
}) => {
  const [graphData, setGraphData] = useState<any>({
    nodes: [],
    links: []
  });
  const [selectedEntity, setSelectedEntity] = useState<string | null>(initialEntityId || null);
  const [timeSeriesData, setTimeSeriesData] = useState<any[]>([]);
  const [timeRange, setTimeRange] = useState({
    start: startDate,
    end: endDate,
    current: startDate
  });
  const [colorBy, setColorBy] = useState<'type' | 'group' | 'value'>('value');
  const [sizeBy, setSizeBy] = useState<'none' | 'value' | 'connections'>('value');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [forecastData, setForecastData] = useState<any>(null);
  
  // Load knowledge graph data
  useEffect(() => {
    const fetchKnowledgeGraphData = async () => {
      setIsLoading(true);
      try {
        // This would be replaced with your actual API call
        const response = await fetch('/api/kg/graph-data');
        const data = await response.json();
        
        // Process nodes to include time and value information
        const processedNodes = data.nodes.map((node: any) => {
          // Add dollar values or other numerical values to nodes
          if (node.properties && node.properties.value) {
            return {
              ...node,
              value: node.properties.value
            };
          }
          return node;
        });
        
        setGraphData({
          nodes: processedNodes,
          links: data.links
        });
      } catch (error) {
        console.error('Error fetching knowledge graph data:', error);
      } finally {
        setIsLoading(false);
      }
    };
    
    fetchKnowledgeGraphData();
  }, []);
  
  // Load time series data for selected entity
  useEffect(() => {
    if (!selectedEntity) return;
    
    const fetchTimeSeriesData = async () => {
      setIsLoading(true);
      try {
        const result = await kgGetEntityTimeSeries(selectedEntity);
        if (result.ok && result.series) {
          setTimeSeriesData(result.series);
          
          // Update time range based on available data
          if (result.series.length > 0) {
            const allDates = result.series.flatMap(series => 
              [series.startDate, series.endDate].filter(Boolean)
            );
            
            if (allDates.length > 0) {
              const minDate = new Date(Math.min(...allDates.map(d => new Date(d || '').getTime())));
              const maxDate = new Date(Math.max(...allDates.map(d => new Date(d || '').getTime())));
              
              setTimeRange({
                start: minDate.toISOString(),
                end: maxDate.toISOString(),
                current: minDate.toISOString()
              });
            }
          }
        }
      } catch (error) {
        console.error('Error fetching time series data:', error);
      } finally {
        setIsLoading(false);
      }
    };
    
    fetchTimeSeriesData();
  }, [selectedEntity]);
  
  // Handle node click in the graph
  const handleNodeClick = (node: any) => {
    setSelectedEntity(node.id);
  };
  
  // Run forecast for selected time series
  const runForecast = async (seriesId: string) => {
    setIsLoading(true);
    try {
      const result = await kgRunEvoModelSelection(
        seriesId,
        selectedEntity || '',
        {
          seriesId,
          searchSpace: {
            models: ['ARIMA', 'ESN', 'PROPHET', 'ENSEMBLE']
          },
          fidelity: 'medium'
        }
      );
      
      if (result.ok && result.result) {
        setForecastData(result.result);
      }
    } catch (error) {
      console.error('Error running forecast:', error);
    } finally {
      setIsLoading(false);
    }
  };
  
  // Prepare chart data for time series visualization
  const getChartData = (seriesId: string) => {
    // This would be replaced with actual data fetching
    // For now, we'll generate some mock data
    const series = timeSeriesData.find(s => s.seriesId === seriesId);
    if (!series) return null;
    
    const startTimestamp = new Date(series.startDate || timeRange.start).getTime();
    const endTimestamp = new Date(series.endDate || timeRange.end).getTime();
    const daySpan = (endTimestamp - startTimestamp) / (24 * 60 * 60 * 1000);
    
    // Generate daily data points
    const labels = [];
    const values = [];
    
    for (let i = 0; i <= daySpan; i++) {
      const date = new Date(startTimestamp + i * 24 * 60 * 60 * 1000);
      labels.push(date.toISOString());
      
      // Generate some realistic-looking data
      const baseValue = series.stats?.avg || 50;
      const variance = baseValue * 0.2; // 20% variance
      const trend = (i / daySpan) * baseValue * 0.5; // Upward trend
      const seasonality = Math.sin(i / 30 * Math.PI) * baseValue * 0.1; // Monthly seasonality
      
      const value = baseValue + trend + seasonality + (Math.random() - 0.5) * variance;
      values.push(Math.max(0, value));
    }
    
    return {
      labels,
      datasets: [
        {
          label: series.name,
          data: values,
          borderColor: 'rgb(75, 192, 192)',
          backgroundColor: 'rgba(75, 192, 192, 0.5)',
          tension: 0.1
        }
      ]
    };
  };
  
  // Chart options
  const chartOptions = {
    responsive: true,
    scales: {
      x: {
        type: 'time' as const,
        time: {
          unit: 'day' as const
        },
        title: {
          display: true,
          text: 'Date'
        }
      },
      y: {
        title: {
          display: true,
          text: 'Value'
        }
      }
    },
    plugins: {
      tooltip: {
        callbacks: {
          label: (context: any) => {
            const value = context.parsed.y;
            return `${context.dataset.label}: $${value.toFixed(2)}`;
          }
        }
      }
    }
  };
  
  return (
    <div className="time-series-kg-integration">
      <h1>Knowledge Graph with Time Series Data</h1>
      
      {isLoading && <div className="loading">Loading...</div>}
      
      <div className="visualization-container">
        <div className="graph-container">
          <KnowledgeGraphViewer3D
            data={graphData}
            timeRange={timeRange}
            valueField="Dollar Value"
            colorBy={colorBy}
            sizeBy={sizeBy}
            onNodeClick={handleNodeClick}
          />
        </div>
        
        {selectedEntity && timeSeriesData.length > 0 && (
          <div className="time-series-container">
            <h2>Time Series Data for Selected Entity</h2>
            
            {timeSeriesData.map(series => (
              <div key={series.seriesId} className="time-series-card">
                <h3>{series.name}</h3>
                <p>{series.description}</p>
                
                <div className="time-series-stats">
                  <div className="stat">
                    <span className="stat-label">Min:</span>
                    <span className="stat-value">${series.stats?.min?.toFixed(2) || 'N/A'}</span>
                  </div>
                  <div className="stat">
                    <span className="stat-label">Max:</span>
                    <span className="stat-value">${series.stats?.max?.toFixed(2) || 'N/A'}</span>
                  </div>
                  <div className="stat">
                    <span className="stat-label">Avg:</span>
                    <span className="stat-value">${series.stats?.avg?.toFixed(2) || 'N/A'}</span>
                  </div>
                </div>
                
                <div className="time-series-chart">
                  {getChartData(series.seriesId) && (
                    <Line 
                      data={getChartData(series.seriesId) || {labels: [], datasets: []}}
                      options={chartOptions}
                    />
                  )}
                </div>
                
                <div className="time-series-actions">
                  <button 
                    onClick={() => runForecast(series.seriesId)}
                    disabled={isLoading}
                  >
                    Run Forecast
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
        
        {forecastData && (
          <div className="forecast-container">
            <h2>Forecast Results</h2>
            <div className="forecast-models">
              <h3>Best Models</h3>
              <ul>
                {forecastData.recipes.slice(0, 3).map((recipe: any, index: number) => (
                  <li key={recipe.id}>
                    <strong>{index + 1}. {recipe.type}</strong> - Score: {recipe.score?.toFixed(4)}
                  </li>
                ))}
              </ul>
            </div>
            
            <div className="forecast-chart">
              {/* Forecast chart would go here */}
            </div>
          </div>
        )}
      </div>
      
      <div className="controls">
        <div className="control-group">
          <label>Color By:</label>
          <select 
            value={colorBy}
            onChange={(e) => setColorBy(e.target.value as any)}
          >
            <option value="type">Entity Type</option>
            <option value="group">Group</option>
            <option value="value">Dollar Value</option>
          </select>
        </div>
        
        <div className="control-group">
          <label>Size By:</label>
          <select 
            value={sizeBy}
            onChange={(e) => setSizeBy(e.target.value as any)}
          >
            <option value="none">Uniform</option>
            <option value="value">Dollar Value</option>
            <option value="connections">Number of Connections</option>
          </select>
        </div>
      </div>
    </div>
  );
};

export default TimeSeriesKGIntegration;
