import React from 'react';
import { Card, CardContent, CardHeader } from '@mui/material';
import { Title } from 'react-admin';

const Dashboard = () => (
  <div style={{ margin: '1em' }}>
    <Title title="LiquidAIty Admin" />
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1em' }}>
      <Card sx={{ minWidth: 275, marginTop: 2, backgroundColor: '#121317', color: '#E9EEF5' }}>
        <CardHeader title="Welcome to the Admin Panel" />
        <CardContent>
          <p>This panel gives you central control over:</p>
          <ul>
            <li>Agent configurations (LangGraph/MCP connections, API keys)</li>
            <li>User management</li>
            <li>System health and status monitoring</li>
          </ul>
        </CardContent>
      </Card>
      
      <Card sx={{ minWidth: 275, marginTop: 2, backgroundColor: '#121317', color: '#E9EEF5' }}>
        <CardHeader title="System Status" />
        <CardContent>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
            <span>LangGraph Connection</span>
            <span style={{ 
              backgroundColor: '#4CAF50', 
              color: 'white', 
              padding: '2px 8px', 
              borderRadius: '4px',
              fontSize: '12px'
            }}>
              Online
            </span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
            <span>API Services</span>
            <span style={{ 
              backgroundColor: '#4CAF50', 
              color: 'white', 
              padding: '2px 8px', 
              borderRadius: '4px',
              fontSize: '12px'
            }}>
              Online
            </span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span>Model Workers</span>
            <span style={{ 
              backgroundColor: '#FFC107', 
              color: 'black', 
              padding: '2px 8px', 
              borderRadius: '4px',
              fontSize: '12px'
            }}>
              Partial
            </span>
          </div>
        </CardContent>
      </Card>
    </div>
  </div>
);

export default Dashboard;
