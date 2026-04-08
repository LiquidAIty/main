import { Router } from 'express';
import { getUsers, getSessions } from '../auth/sessionStore';
import { pool } from '../db/pool';

const adminRouter = Router();

// Get all users with their session info
adminRouter.get('/users', async (_req, res) => {
  try {
    const users = await getUsers();
    const sessions = await getSessions();
    
    // Enrich user data with session info
    const enrichedUsers = users.map(user => {
      const userSessions = sessions.filter(s => s.userId === user.id);
      const lastSession = userSessions.sort((a, b) => 
        new Date(b.created).getTime() - new Date(a.created).getTime()
      )[0];
      
      return {
        id: user.id,
        username: user.id.slice(0, 8), // Use first 8 chars of UUID as username display
        email: `${user.id.slice(0, 8)}@anonymous.local`,
        role: 'user',
        isActive: true,
        createdAt: user.created,
        lastLogin: lastSession?.created || null,
        sessionCount: userSessions.length,
      };
    });
    
    return res.json({ data: enrichedUsers, total: enrichedUsers.length });
  } catch (error: any) {
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// Get single user
adminRouter.get('/users/:id', async (req, res) => {
  try {
    const users = await getUsers();
    const user = users.find(u => u.id === req.params.id);
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    return res.json({ data: user });
  } catch (error: any) {
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// Get all agents from project_agents table
adminRouter.get('/agents', async (_req, res) => {
  try {
    const client = await pool.connect();
    try {
      const result = await client.query(`
        SELECT 
          pa.id,
          pa.project_id,
          pa.agent_type,
          pa.config,
          p.name as project_name,
          p.code as project_code,
          pa.created_at,
          pa.updated_at
        FROM project_agents pa
        LEFT JOIN projects p ON pa.project_id = p.id
        ORDER BY pa.updated_at DESC
      `);
      
      const agents = result.rows.map((row: any) => ({
        id: row.id,
        name: row.project_name || `Agent ${row.id.slice(0, 8)}`,
        type: row.agent_type || 'unknown',
        status: 'active', // TODO: derive from actual runtime state
        projectId: row.project_id,
        projectCode: row.project_code,
        config: row.config || {},
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      }));
      
      return res.json({ data: agents, total: agents.length });
    } finally {
      client.release();
    }
  } catch (error: any) {
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// Get single agent
adminRouter.get('/agents/:id', async (req, res) => {
  try {
    const client = await pool.connect();
    try {
      const result = await client.query(
        'SELECT * FROM project_agents WHERE id = $1',
        [req.params.id]
      );
      
      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Agent not found' });
      }
      
      return res.json({ data: result.rows[0] });
    } finally {
      client.release();
    }
  } catch (error: any) {
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// Update agent config
adminRouter.put('/agents/:id', async (req, res) => {
  try {
    const { config } = req.body || {};
    
    const client = await pool.connect();
    try {
      const result = await client.query(
        `UPDATE project_agents 
         SET config = $1, updated_at = NOW()
         WHERE id = $2
         RETURNING *`,
        [JSON.stringify(config), req.params.id]
      );
      
      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Agent not found' });
      }
      
      return res.json({ data: result.rows[0] });
    } finally {
      client.release();
    }
  } catch (error: any) {
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// Get system stats
adminRouter.get('/system/stats', async (_req, res) => {
  try {
    const users = await getUsers();
    const sessions = await getSessions();
    
    const client = await pool.connect();
    let projectCount = 0;
    let agentCount = 0;
    try {
      const projectResult = await client.query('SELECT COUNT(*) as count FROM projects');
      projectCount = parseInt(projectResult.rows[0].count, 10);
      
      const agentResult = await client.query('SELECT COUNT(*) as count FROM project_agents');
      agentCount = parseInt(agentResult.rows[0].count, 10);
    } finally {
      client.release();
    }
    
    return res.json({
      data: {
        userCount: users.length,
        sessionCount: sessions.length,
        projectCount,
        agentCount,
        uptime: process.uptime(),
        memoryUsage: process.memoryUsage(),
      }
    });
  } catch (error: any) {
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

export default adminRouter;
