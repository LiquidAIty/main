import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, Grid, Typography, Box, Button } from '@mui/material';
import { Title, useDataProvider } from 'react-admin';

// Status component with color-coded indicators
const StatusIndicator = ({ status }: { status: 'online' | 'offline' | 'partial' }) => {
  const getColor = () => {
    switch (status) {
      case 'online': return '#4CAF50';
      case 'offline': return '#F44336';
      case 'partial': return '#FFC107';
      default: return '#9AA3B2';
    }
  };

  const getLabel = () => {
    switch (status) {
      case 'online': return 'Online';
      case 'offline': return 'Offline';
      case 'partial': return 'Partial';
      default: return 'Unknown';
    }
  };

  return (
    <Box 
      sx={{ 
        backgroundColor: getColor(), 
        color: status === 'partial' ? 'black' : 'white',
        padding: '4px 12px',
        borderRadius: '4px',
        display: 'inline-block',
        fontSize: '0.875rem',
        fontWeight: 'medium'
      }}
    >
      {getLabel()}
    </Box>
  );
};

// System component that displays system status
export const SystemDashboard = () => {
  const [systemStatus, setSystemStatus] = useState({
    langGraph: 'online',
    apiServices: 'online',
    modelWorkers: 'partial',
    database: 'online',
    lastUpdated: new Date().toISOString()
  });
  const [loading, setLoading] = useState(false);
  const dataProvider = useDataProvider();

  const refreshStatus = async () => {
    setLoading(true);
    try {
      // In a real implementation, this would call your backend API
      // For now, we'll simulate a delay and return mock data
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      setSystemStatus({
        ...systemStatus,
        lastUpdated: new Date().toISOString()
      });
    } catch (error) {
      console.error('Error fetching system status:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refreshStatus();
    // Set up periodic refresh (every 30 seconds)
    const interval = setInterval(refreshStatus, 30000);
    return () => clearInterval(interval);
  }, []);

  return (
    <>
      <Title title="System Status" />
      
      <Card sx={{ marginBottom: 2, backgroundColor: '#121317', color: '#E9EEF5' }}>
        <CardHeader title="System Health" />
        <CardContent>
          <Grid container spacing={2}>
            <Grid item xs={12} md={6}>
              <Card variant="outlined" sx={{ backgroundColor: '#0B0C0E', marginBottom: 2 }}>
                <CardContent>
                  <Typography variant="h6" gutterBottom>Services</Typography>
                  
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
                    <Typography>LangGraph Connection</Typography>
                    <StatusIndicator status={systemStatus.langGraph as any} />
                  </Box>
                  
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
                    <Typography>API Services</Typography>
                    <StatusIndicator status={systemStatus.apiServices as any} />
                  </Box>
                  
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
                    <Typography>Model Workers</Typography>
                    <StatusIndicator status={systemStatus.modelWorkers as any} />
                  </Box>
                  
                  <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                    <Typography>Database</Typography>
                    <StatusIndicator status={systemStatus.database as any} />
                  </Box>
                </CardContent>
              </Card>
            </Grid>
            
            <Grid item xs={12} md={6}>
              <Card variant="outlined" sx={{ backgroundColor: '#0B0C0E', marginBottom: 2 }}>
                <CardContent>
                  <Typography variant="h6" gutterBottom>System Information</Typography>
                  
                  <Box sx={{ mb: 1 }}>
                    <Typography variant="body2" color="#9AA3B2">Last Updated</Typography>
                    <Typography>
                      {new Date(systemStatus.lastUpdated).toLocaleString()}
                    </Typography>
                  </Box>
                  
                  <Box sx={{ mt: 2 }}>
                    <Button 
                      variant="contained" 
                      onClick={refreshStatus}
                      disabled={loading}
                      sx={{ 
                        backgroundColor: '#6EFAFB',
                        color: '#0B0C0E',
                        '&:hover': {
                          backgroundColor: '#5DE8E9'
                        }
                      }}
                    >
                      {loading ? 'Refreshing...' : 'Refresh Status'}
                    </Button>
                  </Box>
                </CardContent>
              </Card>
            </Grid>
          </Grid>
        </CardContent>
      </Card>
      
      <Card sx={{ backgroundColor: '#121317', color: '#E9EEF5' }}>
        <CardHeader title="System Configuration" />
        <CardContent>
          <Typography paragraph>
            This section allows you to view and modify system-wide configuration settings.
            In a production environment, you would be able to:
          </Typography>
          
          <ul>
            <li>Configure default model settings</li>
            <li>Set up authentication providers</li>
            <li>Manage API rate limits</li>
            <li>Configure logging and monitoring</li>
          </ul>
          
          <Box sx={{ mt: 2, p: 2, backgroundColor: '#0B0C0E', borderRadius: 1 }}>
            <Typography align="center">
              System configuration features coming soon
            </Typography>
          </Box>
        </CardContent>
      </Card>
    </>
  );
};
