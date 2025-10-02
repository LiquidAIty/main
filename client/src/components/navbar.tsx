import React from 'react';
import { Link, useLocation } from 'react-router-dom';

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

interface NavbarProps {
  showDetailedMode?: boolean;
}

export default function Navbar({ showDetailedMode = true }: NavbarProps) {
  const location = useLocation();
  
  const isActive = (path: string) => {
    return location.pathname === path;
  };
  
  const navLinkStyle = (path: string) => ({
    color: isActive(path) ? C.primary : C.text,
    textDecoration: 'none',
    padding: '8px 16px',
    borderBottom: isActive(path) ? `2px solid ${C.primary}` : '2px solid transparent',
    fontSize: '14px',
    fontWeight: isActive(path) ? 600 : 400,
    transition: 'all 0.2s ease'
  });
  
  return (
    <nav style={{
      display: 'flex',
      alignItems: 'center',
      height: '56px',
      backgroundColor: C.bg,
      borderBottom: `1px solid ${C.border}`,
      padding: '0 16px'
    }}>
      <div style={{ 
        width: 32, 
        height: 32, 
        borderRadius: '50%', 
        background: `radial-gradient(circle at 50% 50%, ${C.primary} 0%, ${C.accent} 75%)`, 
        boxShadow: '0 0 0 2px #000 inset',
        marginRight: '16px'
      }} />
      
      <div style={{ display: 'flex', gap: '8px' }}>
        <Link to="/agent-manager" style={navLinkStyle('/agent-manager')}>
          Agent Manager
        </Link>
        <Link to="/agentic" style={navLinkStyle('/agentic')}>
          Agentic
        </Link>
        <Link to="/boss-agent" style={navLinkStyle('/boss-agent')}>
          Boss Agent
        </Link>
        {showDetailedMode && (
          <Link to="/detailed" style={navLinkStyle('/detailed')}>
            Detailed Mode
          </Link>
        )}
      </div>
      
      <div style={{ marginLeft: 'auto' }}>
        <button style={{
          backgroundColor: C.accent,
          color: '#111',
          border: 'none',
          borderRadius: '4px',
          padding: '8px 16px',
          fontSize: '13px',
          fontWeight: 600,
          cursor: 'pointer'
        }}>
          Publish
        </button>
      </div>
    </nav>
  );
}
