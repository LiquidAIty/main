import React from 'react';
import { Admin, Resource, ListGuesser, EditGuesser, ShowGuesser } from 'react-admin';
import dataProvider from '../lib/adminDataProvider';
import Dashboard from '../components/admin/dashboard';
import { UserList, UserEdit, UserCreate } from '../components/admin/users';
import { AgentList, AgentEdit, AgentCreate } from '../components/admin/agents';
import { SystemDashboard } from '../components/admin/system';

// Custom theme to match the application's look and feel
const theme = {
  palette: {
    primary: {
      main: '#6EFAFB', // turquoise
    },
    secondary: {
      main: '#E2725B', // terra cotta
    },
    background: {
      default: '#0B0C0E',
    },
    text: {
      primary: '#E9EEF5',
      secondary: '#9AA3B2',
    },
  },
  components: {
    MuiAppBar: {
      styleOverrides: {
        root: {
          backgroundColor: '#121317',
        },
      },
    },
    MuiDrawer: {
      styleOverrides: {
        paper: {
          backgroundColor: '#121317',
          color: '#E9EEF5',
        },
      },
    },
    MuiCard: {
      styleOverrides: {
        root: {
          backgroundColor: '#121317',
          color: '#E9EEF5',
        },
      },
    },
  },
};

// Mock data provider - replace with actual API integration
// This is a placeholder until you connect to your actual backend
const mockDataProvider = {
  getList: (resource: string) => {
    if (resource === 'users') {
      return Promise.resolve({
        data: [
          { id: 1, username: 'admin', email: 'admin@example.com', role: 'admin' },
          { id: 2, username: 'user1', email: 'user1@example.com', role: 'user' },
        ],
        total: 2,
      });
    }
    if (resource === 'agents') {
      return Promise.resolve({
        data: [
          { id: 1, name: 'GPT-5 Agent', status: 'active', type: 'langchain' },
          { id: 2, name: 'MCP Agent', status: 'inactive', type: 'mcp' },
        ],
        total: 2,
      });
    }
    return Promise.resolve({ data: [], total: 0 });
  },
  getOne: (resource: string, params: { id: any }) => {
    return Promise.resolve({
      data: { id: params.id, name: `${resource} ${params.id}` },
    });
  },
  getMany: () => Promise.resolve({ data: [] }),
  getManyReference: () => Promise.resolve({ data: [], total: 0 }),
  create: (resource: string, params: { data: any }) => Promise.resolve({ data: { ...params.data, id: Date.now() } }),
  update: (resource: string, params: { id: any; data: any }) => Promise.resolve({ data: params.data }),
  updateMany: () => Promise.resolve({ data: [] }),
  delete: (resource: string, params: { id: any }) => Promise.resolve({ data: params }),
  deleteMany: () => Promise.resolve({ data: [] }),
};

// TODO: Replace this with your actual data provider that connects to your backend API
// For example:
// import { jsonServerProvider } from 'ra-data-json-server';
// const dataProvider = jsonServerProvider('https://your-api-url/api');

export default function AdminPanel() {
  return (
    <Admin 
      dashboard={Dashboard} 
      dataProvider={dataProvider}
      theme={theme}
      darkTheme={theme}
      requireAuth={false}
      title="LiquidAIty Admin"
    >
      <Resource 
        name="users" 
        list={UserList || ListGuesser} 
        edit={UserEdit || EditGuesser}
        create={UserCreate}
        options={{ label: 'Users' }}
      />
      <Resource 
        name="agents" 
        list={AgentList || ListGuesser}
        edit={AgentEdit || EditGuesser}
        create={AgentCreate}
        options={{ label: 'Agents' }}
      />
      <Resource
        name="system"
        options={{ label: 'System' }}
        list={SystemDashboard}
      />
    </Admin>
  );
}

// Note: You'll need to create the following components:
// - src/components/admin/dashboard.tsx
// - src/components/admin/users.tsx
// - src/components/admin/agents.tsx
// - src/components/admin/system.tsx
// - src/lib/adminDataProvider.ts
