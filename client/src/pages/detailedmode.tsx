import React, { useState, useEffect } from 'react';
import MonacoEditor from '@monaco-editor/react';
import { Link } from 'react-router-dom';

// Theme colors (matching the agentic UI)
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

export default function DetailedMode() {
  const [code, setCode] = useState('// select a node or create a new snippet');
  const [training, setTraining] = useState<{ jobId?: string, status?: string }>({});
  const [selection, setSelection] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    // Set document styles for full-page mode
    document.body.style.backgroundColor = C.bg;
    document.body.style.color = C.text;
    document.body.style.margin = '0';
    document.body.style.padding = '0';
    document.body.style.height = '100vh';
    document.body.style.overflow = 'hidden';
    
    return () => {
      // Clean up styles when component unmounts
      document.body.style.backgroundColor = '';
      document.body.style.color = '';
      document.body.style.margin = '';
      document.body.style.padding = '';
      document.body.style.height = '';
      document.body.style.overflow = '';
    };
  }, []);

  useEffect(() => {
    // Load example or selection context
    if (selection) {
      setCode(`// Loading context from: ${selection}\n// This would load real data in production`);
    }
  }, [selection]);

  async function startTraining() {
    if (!code.trim()) return;
    
    try {
      setIsLoading(true);
      // Send code/context to python-models service
      const res = await fetch('/api/models/train', {
        method: 'POST',
        headers: {'content-type':'application/json'},
        body: JSON.stringify({ code, contextPath: selection })
      });
      
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      }
      
      const body = await res.json();
      setTraining({ jobId: body.jobId, status: 'queued' });
      
      // Poll for status
      const jobId = body.jobId;
      const interval = setInterval(async () => {
        try {
          const statusRes = await fetch(`/api/models/status/${jobId}`);
          const statusData = await statusRes.json();
          
          setTraining(prev => ({...prev, status: statusData.status}));
          
          if (['finished', 'failed', 'error'].includes(statusData.status?.toLowerCase())) {
            clearInterval(interval);
            setIsLoading(false);
          }
        } catch (err) {
          console.error('Error checking job status:', err);
        }
      }, 3000);
    } catch (error) {
      console.error('Error starting training:', error);
      setTraining(prev => ({...prev, status: 'error'}));
      setIsLoading(false);
    }
  }

  async function getStatus() {
    if (!training.jobId) return;
    
    try {
      setIsLoading(true);
      const res = await fetch(`/api/models/status/${training.jobId}`);
      
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      }
      
      const body = await res.json();
      setTraining(prev => ({...prev, status: body.status}));
    } catch (error) {
      console.error('Error getting status:', error);
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100vh',
      backgroundColor: C.bg,
      color: C.text,
      fontFamily: 'system-ui, -apple-system, sans-serif'
    }}>
      {/* Header */}
      <header style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 16px',
        height: '56px',
        borderBottom: `1px solid ${C.border}`,
        backgroundColor: C.panel
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div 
            style={{ 
              width: 32, 
              height: 32, 
              borderRadius: '50%', 
              background: `radial-gradient(circle at 50% 50%, ${C.primary} 0%, ${C.accent} 75%)`, 
              boxShadow: '0 0 0 2px #000 inset' 
            }} 
          />
          <h1 style={{ 
            fontSize: '18px', 
            fontWeight: 600, 
            color: C.text,
            margin: 0
          }}>
            Detailed Mode
          </h1>
        </div>
        
        <Link 
          to="/agentic" 
          style={{ 
            color: C.primary, 
            textDecoration: 'none',
            fontSize: '14px',
            padding: '6px 12px',
            border: `1px solid ${C.primary}`,
            borderRadius: '4px'
          }}
        >
          Back to Agentic
        </Link>
      </header>
      
      {/* Main content */}
      <div style={{
        display: 'flex',
        flex: 1,
        overflow: 'hidden'
      }}>
        {/* Sidebar */}
        <aside style={{
          width: 300,
          padding: 16,
          borderRight: `1px solid ${C.border}`,
          backgroundColor: C.panel,
          display: 'flex',
          flexDirection: 'column'
        }}>
          <div style={{ marginBottom: '16px' }}>
            <label style={{ 
              display: 'block', 
              marginBottom: '8px',
              fontSize: '14px',
              color: C.muted
            }}>
              Context
            </label>
            <select 
              onChange={e => setSelection(e.target.value)}
              style={{
                width: '100%',
                padding: '8px 12px',
                backgroundColor: C.bg,
                color: C.text,
                border: `1px solid ${C.border}`,
                borderRadius: '4px',
                fontSize: '14px'
              }}
            >
              <option value="">--select--</option>
              <option value="dash/alpha">dash/alpha</option>
              <option value="knowledge/graph">knowledge/graph</option>
            </select>
          </div>
          
          <div style={{ marginTop: '16px' }}>
            <button 
              onClick={startTraining}
              disabled={isLoading}
              style={{
                padding: '8px 16px',
                backgroundColor: C.primary,
                color: '#0B0C0E',
                border: 'none',
                borderRadius: '4px',
                fontSize: '14px',
                fontWeight: 600,
                cursor: isLoading ? 'not-allowed' : 'pointer',
                opacity: isLoading ? 0.7 : 1,
                width: '100%'
              }}
            >
              {isLoading ? 'Processing...' : 'Start Model Training'}
            </button>
            
            <button 
              onClick={getStatus}
              disabled={!training.jobId || isLoading}
              style={{
                marginTop: '8px',
                padding: '8px 16px',
                backgroundColor: 'transparent',
                color: C.primary,
                border: `1px solid ${C.primary}`,
                borderRadius: '4px',
                fontSize: '14px',
                cursor: (!training.jobId || isLoading) ? 'not-allowed' : 'pointer',
                opacity: (!training.jobId || isLoading) ? 0.5 : 1,
                width: '100%'
              }}
            >
              Refresh Status
            </button>
          </div>
          
          <div style={{ 
            marginTop: '24px',
            padding: '16px',
            backgroundColor: C.bg,
            borderRadius: '4px',
            fontSize: '14px'
          }}>
            <strong style={{ color: C.primary }}>Status:</strong>{' '}
            <span style={{ 
              color: training.status === 'error' ? C.accent : C.text 
            }}>
              {training.status || 'idle'}
            </span>
          </div>
          
          <div style={{ marginTop: 'auto', fontSize: '13px', color: C.muted, padding: '16px 0' }}>
            <p>Use this mode for detailed model training experiments.</p>
            <p>Connect to the knowledge graph to train models on selected nodes.</p>
          </div>
        </aside>

        {/* Editor */}
        <main style={{ flex: 1, position: 'relative' }}>
          <MonacoEditor
            height="100%"
            defaultLanguage="javascript"
            value={code}
            onChange={(v) => setCode(v || '')}
            theme="vs-dark"
            options={{
              minimap: { enabled: true },
              scrollBeyondLastLine: false,
              fontSize: 14,
              wordWrap: 'on'
            }}
          />
        </main>
      </div>
    </div>
  );
}
