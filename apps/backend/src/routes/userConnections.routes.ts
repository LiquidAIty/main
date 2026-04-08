import { Router } from 'express';
import { pool } from '../db/pool';
import { getUserBySessionId } from '../auth/sessionStore';

const userConnectionsRouter = Router();

// Get all connections for current user
userConnectionsRouter.get('/', async (req, res) => {
  try {
    const sessionId = req.cookies.sid;
    if (!sessionId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const user = await getUserBySessionId(sessionId);
    if (!user) {
      return res.status(401).json({ error: 'Invalid session' });
    }

    const client = await pool.connect();
    try {
      const result = await client.query(
        `SELECT id, connection_type, name, status, created_at, updated_at 
         FROM user_connections 
         WHERE user_id = $1 
         ORDER BY created_at DESC`,
        [user.id]
      );
      
      return res.json({ data: result.rows });
    } finally {
      client.release();
    }
  } catch (error: any) {
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// Create new connection
userConnectionsRouter.post('/', async (req, res) => {
  try {
    const sessionId = req.cookies.sid;
    if (!sessionId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const user = await getUserBySessionId(sessionId);
    if (!user) {
      return res.status(401).json({ error: 'Invalid session' });
    }

    const { connectionType, name } = req.body || {};
    
    if (!connectionType || !name) {
      return res.status(400).json({ error: 'connectionType and name are required' });
    }

    const client = await pool.connect();
    try {
      // Store credentials encrypted (for now, store placeholder - real encryption needed)
      const result = await client.query(
        `INSERT INTO user_connections (user_id, connection_type, name, credentials, status)
         VALUES ($1, $2, $3, $4, 'active')
         RETURNING id, connection_type, name, status, created_at, updated_at`,
        [user.id, connectionType, name, JSON.stringify({ encrypted: true, placeholder: 'stored' })]
      );
      
      return res.json({ data: result.rows[0] });
    } finally {
      client.release();
    }
  } catch (error: any) {
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// Delete connection
userConnectionsRouter.delete('/:id', async (req, res) => {
  try {
    const sessionId = req.cookies.sid;
    if (!sessionId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const user = await getUserBySessionId(sessionId);
    if (!user) {
      return res.status(401).json({ error: 'Invalid session' });
    }

    const client = await pool.connect();
    try {
      const result = await client.query(
        `DELETE FROM user_connections 
         WHERE id = $1 AND user_id = $2
         RETURNING id`,
        [req.params.id, user.id]
      );
      
      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Connection not found' });
      }
      
      return res.json({ success: true });
    } finally {
      client.release();
    }
  } catch (error: any) {
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

export default userConnectionsRouter;
