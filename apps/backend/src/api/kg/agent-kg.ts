import express from 'express';
import neo4j from 'neo4j-driver';

// Create router
const router = express.Router();

// Environment variables
const NEO4J_URI = process.env.NEO4J_URI || 'neo4j://localhost:7687';
const NEO4J_USER = process.env.NEO4J_USER || 'neo4j';
const NEO4J_PASSWORD = process.env.NEO4J_PASSWORD || 'password';

// Connect to Neo4j
const driver = neo4j.driver(
  NEO4J_URI,
  neo4j.auth.basic(NEO4J_USER, NEO4J_PASSWORD)
);

// Define types
interface Node {
  id: string;
  labels: string[];
  properties: Record<string, any>;
}

interface Link {
  source: string;
  target: string;
  type: string;
  properties: Record<string, any>;
}

interface GraphData {
  nodes: Node[];
  links: Link[];
}

// Define Neo4j record type
type Neo4jRecord = any;

/**
 * Get all agent-generated knowledge graphs
 */
router.get('/', async (req, res) => {
  const session = driver.session();
  
  try {
    // Get all unique graphIds
    const graphIdsResult = await session.run(`
      MATCH (n)
      WHERE exists(n.graphId)
      RETURN DISTINCT n.graphId AS graphId, n.createdAt AS createdAt, n.createdBy AS createdBy
      ORDER BY n.createdAt DESC
    `);
    
    const graphs = graphIdsResult.records.map((record: Neo4jRecord) => ({
      id: record.get('graphId'),
      createdAt: record.get('createdAt'),
      createdBy: record.get('createdBy')
    }));
    
    return res.json({ graphs });
  } catch (error) {
    console.error('Error fetching agent knowledge graphs:', error);
    return res.status(500).json({ error: 'Error fetching agent knowledge graphs' });
  } finally {
    await session.close();
  }
});

/**
 * Get a specific agent-generated knowledge graph by ID
 */
router.get('/:graphId', async (req, res) => {
  const { graphId } = req.params;
  const session = driver.session();
  
  try {
    // Get all nodes with this graphId
    const nodesResult = await session.run(`
      MATCH (n)
      WHERE n.graphId = $graphId
      RETURN n
    `, { graphId });
    
    // Get all relationships with this graphId
    const relsResult = await session.run(`
      MATCH ()-[r]->()
      WHERE r.graphId = $graphId
      RETURN r
    `, { graphId });
    
    const nodes: Node[] = nodesResult.records.map((record: Neo4jRecord) => {
      const node = record.get('n');
      return {
        id: node.properties.id || node.identity.toString(),
        labels: node.labels,
        properties: node.properties
      };
    });
    
    const links: Link[] = [];
    
    relsResult.records.forEach((record: Neo4jRecord) => {
      const rel = record.get('r');
      
      // Find source and target node IDs
      const sourceNode = nodes.find(n => n.id === rel.start.toString() || n.properties.id === rel.start.toString());
      const targetNode = nodes.find(n => n.id === rel.end.toString() || n.properties.id === rel.end.toString());
      
      if (sourceNode && targetNode) {
        links.push({
          source: sourceNode.id,
          target: targetNode.id,
          type: rel.type,
          properties: rel.properties
        });
      }
    });
    
    const graphData: GraphData = {
      nodes,
      links
    };
    
    return res.json(graphData);
  } catch (error) {
    console.error(`Error fetching knowledge graph ${graphId}:`, error);
    return res.status(500).json({ error: `Error fetching knowledge graph ${graphId}` });
  } finally {
    await session.close();
  }
});

/**
 * Delete a specific agent-generated knowledge graph by ID
 */
router.delete('/:graphId', async (req, res) => {
  const { graphId } = req.params;
  const session = driver.session();
  
  try {
    // Delete all relationships with this graphId
    await session.run(`
      MATCH ()-[r]->()
      WHERE r.graphId = $graphId
      DELETE r
    `, { graphId });
    
    // Delete all nodes with this graphId
    const deleteResult = await session.run(`
      MATCH (n)
      WHERE n.graphId = $graphId
      DETACH DELETE n
      RETURN count(n) as deletedCount
    `, { graphId });
    
    const deletedCount = deleteResult.records[0].get('deletedCount').toNumber();
    
    return res.json({ 
      success: true, 
      message: `Successfully deleted knowledge graph ${graphId}`,
      deletedCount
    });
  } catch (error) {
    console.error(`Error deleting knowledge graph ${graphId}:`, error);
    return res.status(500).json({ error: `Error deleting knowledge graph ${graphId}` });
  } finally {
    await session.close();
  }
});

/**
 * Get neighborhood around a specific node
 */
router.post('/neighborhood', async (req, res) => {
  const { uid, depth = 1, limit = 20 } = req.body;
  
  if (!uid) {
    return res.status(400).json({ error: 'uid parameter required' });
  }
  
  const session = driver.session();
  
  try {
    // Get nodes within specified depth and their relationships
    const query = `
      MATCH path = (center)-[*1..${Math.min(depth, 3)}]-(neighbor)
      WHERE center.id = $uid OR center.uid = $uid
      WITH DISTINCT center, neighbor, relationships(path) as rels
      LIMIT ${Math.min(limit, 100)}
      RETURN center, neighbor, rels
    `;
    
    const result = await session.run(query, { uid });
    
    const nodes = new Map();
    const edges: Link[] = [];
    
    result.records.forEach((record) => {
      const center = record.get('center');
      const neighbor = record.get('neighbor');
      const rels = record.get('rels');
      
      // Add center node
      if (!nodes.has(center.properties.id || center.properties.uid)) {
        nodes.set(center.properties.id || center.properties.uid, {
          id: center.properties.id || center.properties.uid,
          labels: center.labels,
          properties: center.properties
        });
      }
      
      // Add neighbor node
      if (!nodes.has(neighbor.properties.id || neighbor.properties.uid)) {
        nodes.set(neighbor.properties.id || neighbor.properties.uid, {
          id: neighbor.properties.id || neighbor.properties.uid,
          labels: neighbor.labels,
          properties: neighbor.properties
        });
      }
      
      // Add relationships
      rels.forEach((rel: any) => {
        edges.push({
          source: center.properties.id || center.properties.uid,
          target: neighbor.properties.id || neighbor.properties.uid,
          type: rel.type,
          properties: rel.properties
        });
      });
    });
    
    return res.json({
      center_uid: uid,
      depth,
      nodes: Array.from(nodes.values()),
      edges
    });
  } catch (error) {
    console.error(`Error fetching neighborhood for ${uid}:`, error);
    return res.status(500).json({ error: `Error fetching neighborhood for ${uid}` });
  } finally {
    await session.close();
  }
});

export default router;
