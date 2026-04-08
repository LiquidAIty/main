import { DataProvider } from 'react-admin';

// Mock data for development
const users = [
  { id: 1, username: 'admin', email: 'admin@example.com', role: 'admin', isActive: true, lastLogin: new Date().toISOString() },
  { id: 2, username: 'user1', email: 'user1@example.com', role: 'user', isActive: true, lastLogin: new Date().toISOString() },
];

const agents = [
  { 
    id: 1, 
    name: 'GPT-5 Agent', 
    type: 'langchain', 
    status: 'active', 
    endpoint: 'https://api.openai.com/v1', 
    apiKey: '••••••••••••••••',
    config: '{\n  "model": "gpt-5",\n  "temperature": 0.7\n}',
    lastUsed: new Date().toISOString()
  },
  { 
    id: 2, 
    name: 'MCP Agent', 
    type: 'mcp', 
    status: 'inactive', 
    endpoint: 'https://mcp.example.com/api',
    apiKey: '••••••••••••••••',
    config: '{\n  "timeout": 30000,\n  "retries": 3\n}',
    lastUsed: new Date().toISOString()
  },
];

/**
 * This is a mock data provider for development.
 * In production, you would replace this with a real data provider
 * that connects to your backend API.
 */
const dataProvider: DataProvider = {
  getList: (resource, params) => {
    // Get data based on resource
    let data: any[] = [];
    if (resource === 'users') {
      data = users;
    } else if (resource === 'agents') {
      data = agents;
    }

    // Apply filters if any
    if (params.filter && Object.keys(params.filter).length > 0) {
      Object.keys(params.filter).forEach(key => {
        if (key === 'q') {
          // Search in all fields
          const searchTerm = params.filter[key].toLowerCase();
          data = data.filter(item => 
            Object.values(item).some(val => 
              val && val.toString().toLowerCase().includes(searchTerm)
            )
          );
        } else {
          // Filter by specific field
          data = data.filter(item => item[key] === params.filter[key]);
        }
      });
    }

    // Apply sorting
    if (params.sort) {
      const { field, order } = params.sort;
      data = [...data].sort((a, b) => {
        if (a[field] < b[field]) return order === 'ASC' ? -1 : 1;
        if (a[field] > b[field]) return order === 'ASC' ? 1 : -1;
        return 0;
      });
    }

    // Apply pagination
    const start = (params.pagination.page - 1) * params.pagination.perPage;
    const end = start + params.pagination.perPage;
    const paginatedData = data.slice(start, end);

    return Promise.resolve({
      data: paginatedData,
      total: data.length,
    });
  },

  getOne: (resource, params) => {
    let data: any = null;
    
    if (resource === 'users') {
      data = users.find(user => user.id === params.id);
    } else if (resource === 'agents') {
      data = agents.find(agent => agent.id === params.id);
    }

    return Promise.resolve({ data });
  },

  getMany: (resource, params) => {
    let data: any[] = [];
    
    if (resource === 'users') {
      data = users.filter(user => params.ids.includes(user.id));
    } else if (resource === 'agents') {
      data = agents.filter(agent => params.ids.includes(agent.id));
    }

    return Promise.resolve({ data });
  },

  getManyReference: (resource, params) => {
    let data: any[] = [];
    
    if (resource === 'users') {
      data = users.filter(user => user[params.target] === params.id);
    } else if (resource === 'agents') {
      data = agents.filter(agent => agent[params.target] === params.id);
    }

    return Promise.resolve({
      data,
      total: data.length,
    });
  },

  create: (resource, params) => {
    const newId = Date.now();
    const newRecord = { ...params.data, id: newId };
    
    if (resource === 'users') {
      users.push(newRecord);
    } else if (resource === 'agents') {
      agents.push(newRecord);
    }

    return Promise.resolve({ data: newRecord });
  },

  update: (resource, params) => {
    let updatedRecord = null;
    
    if (resource === 'users') {
      const index = users.findIndex(user => user.id === params.id);
      if (index !== -1) {
        users[index] = { ...users[index], ...params.data };
        updatedRecord = users[index];
      }
    } else if (resource === 'agents') {
      const index = agents.findIndex(agent => agent.id === params.id);
      if (index !== -1) {
        agents[index] = { ...agents[index], ...params.data };
        updatedRecord = agents[index];
      }
    }

    return Promise.resolve({ data: updatedRecord });
  },

  updateMany: (resource, params) => {
    const updatedIds: any[] = [];
    
    if (resource === 'users') {
      params.ids.forEach(id => {
        const index = users.findIndex(user => user.id === id);
        if (index !== -1) {
          users[index] = { ...users[index], ...params.data };
          updatedIds.push(id);
        }
      });
    } else if (resource === 'agents') {
      params.ids.forEach(id => {
        const index = agents.findIndex(agent => agent.id === id);
        if (index !== -1) {
          agents[index] = { ...agents[index], ...params.data };
          updatedIds.push(id);
        }
      });
    }

    return Promise.resolve({ data: updatedIds });
  },

  delete: (resource, params) => {
    let deletedRecord = null;
    
    if (resource === 'users') {
      const index = users.findIndex(user => user.id === params.id);
      if (index !== -1) {
        deletedRecord = users[index];
        users.splice(index, 1);
      }
    } else if (resource === 'agents') {
      const index = agents.findIndex(agent => agent.id === params.id);
      if (index !== -1) {
        deletedRecord = agents[index];
        agents.splice(index, 1);
      }
    }

    return Promise.resolve({ data: deletedRecord });
  },

  deleteMany: (resource, params) => {
    const deletedIds: any[] = [];
    
    if (resource === 'users') {
      params.ids.forEach(id => {
        const index = users.findIndex(user => user.id === id);
        if (index !== -1) {
          users.splice(index, 1);
          deletedIds.push(id);
        }
      });
    } else if (resource === 'agents') {
      params.ids.forEach(id => {
        const index = agents.findIndex(agent => agent.id === id);
        if (index !== -1) {
          agents.splice(index, 1);
          deletedIds.push(id);
        }
      });
    }

    return Promise.resolve({ data: deletedIds });
  },
};

export default dataProvider;
