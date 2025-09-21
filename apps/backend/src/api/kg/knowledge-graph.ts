import express from 'express';
import neo4j from 'neo4j-driver';
import { analyzeSentiment } from '../../services/sentimentService.js';
import { z } from 'zod';

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

interface TimeSeriesPoint {
  timestamp: string;
  value: number;
}

interface TimeSeries {
  seriesId: string;
  name: string;
  type: string;
  points: TimeSeriesPoint[];
}

// Define Neo4j record type
type Neo4jRecord = any;

/**
 * Get the entire knowledge graph
 */
router.get('/', async (req, res) => {
  const session = driver.session();
  
  try {
    // Get all nodes
    const nodesResult = await session.run(`
      MATCH (n)
      RETURN n
    `);
    
    // Get all relationships
    const relsResult = await session.run(`
      MATCH ()-[r]->()
      RETURN r
    `);
    
    const nodes: Node[] = nodesResult.records.map((record: Neo4jRecord) => {
      const node = record.get('n');
      return {
        id: node.identity.toString(),
        labels: node.labels,
        properties: node.properties
      };
    });
    
    const links: Link[] = [];
    
    relsResult.records.forEach((record: Neo4jRecord) => {
      const rel = record.get('r');
      links.push({
        source: rel.start.toString(),
        target: rel.end.toString(),
        type: rel.type,
        properties: rel.properties
      });
    });
    
    const graphData: GraphData = {
      nodes,
      links
    };
    
    return res.json(graphData);
  } catch (error) {
    console.error('Error fetching knowledge graph:', error);
    return res.status(500).json({ error: 'Error fetching knowledge graph' });
  } finally {
    await session.close();
  }
});

/**
 * Get company details by symbol
 */
router.get('/company/:symbol', async (req, res) => {
  const { symbol } = req.params;
  const session = driver.session();
  
  try {
    // Get company node
    const companyResult = await session.run(`
      MATCH (c:Company {symbol: $symbol})
      RETURN c
    `, { symbol });
    
    if (companyResult.records.length === 0) {
      return res.status(404).json({ error: `Company ${symbol} not found` });
    }
    
    const companyRecord = companyResult.records[0];
    const company = companyRecord.get('c');
    
    // Get time series data
    const timeSeriesResult = await session.run(`
      MATCH (c:Company {symbol: $symbol})-[:HAS_TIME_SERIES]->(ts:TimeSeries)
      RETURN ts
    `, { symbol });
    
    const timeSeries = timeSeriesResult.records.map((record: Neo4jRecord) => {
      const ts = record.get('ts');
      return ts.properties as TimeSeries;
    });
    
    // Get relationships
    const relationshipsResult = await session.run(`
      MATCH (c:Company {symbol: $symbol})-[r]-(other)
      RETURN r, other
    `, { symbol });
    
    const relationships = relationshipsResult.records.map((record: Neo4jRecord) => {
      const rel = record.get('r');
      const other = record.get('other');
      
      return {
        type: rel.type,
        direction: rel.start.toString() === company.identity.toString() ? 'outgoing' : 'incoming',
        properties: rel.properties,
        node: {
          id: other.identity.toString(),
          labels: other.labels,
          properties: other.properties
        }
      };
    });
    
    return res.json({
      company: {
        id: company.identity.toString(),
        labels: company.labels,
        properties: company.properties
      },
      timeSeries,
      relationships
    });
  } catch (error) {
    console.error(`Error fetching company ${symbol}:`, error);
    return res.status(500).json({ error: `Error fetching company ${symbol}` });
  } finally {
    await session.close();
  }
});

/**
 * Get forex details by pair
 */
router.get('/forex/:pair', async (req, res) => {
  const { pair } = req.params;
  const session = driver.session();
  
  try {
    // Get forex node
    const forexResult = await session.run(`
      MATCH (f:Currency {pair: $pair})
      RETURN f
    `, { pair });
    
    if (forexResult.records.length === 0) {
      return res.status(404).json({ error: `Forex pair ${pair} not found` });
    }
    
    const forexRecord = forexResult.records[0];
    const forex = forexRecord.get('f');
    
    // Get time series data
    const timeSeriesResult = await session.run(`
      MATCH (f:Currency {pair: $pair})-[:HAS_TIME_SERIES]->(ts:TimeSeries)
      RETURN ts
    `, { pair });
    
    const timeSeries = timeSeriesResult.records.map((record: Neo4jRecord) => {
      const ts = record.get('ts');
      return ts.properties as TimeSeries;
    });
    
    // Get relationships
    const relationshipsResult = await session.run(`
      MATCH (f:Currency {pair: $pair})-[r]-(other)
      RETURN r, other
    `, { pair });
    
    const relationships = relationshipsResult.records.map((record: Neo4jRecord) => {
      const rel = record.get('r');
      const other = record.get('other');
      
      return {
        type: rel.type,
        direction: rel.start.toString() === forex.identity.toString() ? 'outgoing' : 'incoming',
        properties: rel.properties,
        node: {
          id: other.identity.toString(),
          labels: other.labels,
          properties: other.properties
        }
      };
    });
    
    return res.json({
      forex: {
        id: forex.identity.toString(),
        labels: forex.labels,
        properties: forex.properties
      },
      timeSeries,
      relationships
    });
  } catch (error) {
    console.error(`Error fetching forex pair ${pair}:`, error);
    return res.status(500).json({ error: `Error fetching forex pair ${pair}` });
  } finally {
    await session.close();
  }
});

/**
 * Get all relationships
 */
router.get('/relationships', async (req, res) => {
  const session = driver.session();
  
  try {
    // Get all paths
    const result = await session.run(`
      MATCH path = (a)-[r]->(b)
      RETURN path, a, b, r
    `);
    
    const nodes = new Map<string, Node>();
    const links: Link[] = [];
    
    result.records.forEach((record: Neo4jRecord) => {
      // No need to get path as it's not used
      const a = record.get('a');
      const b = record.get('b');
      const r = record.get('r');
      
      // Add nodes if they don't exist yet
      if (!nodes.has(a.identity.toString())) {
        nodes.set(a.identity.toString(), {
          id: a.identity.toString(),
          labels: a.labels,
          properties: a.properties
        });
      }
      
      if (!nodes.has(b.identity.toString())) {
        nodes.set(b.identity.toString(), {
          id: b.identity.toString(),
          labels: b.labels,
          properties: b.properties
        });
      }
      
      // Add relationship
      links.push({
        source: a.identity.toString(),
        target: b.identity.toString(),
        type: r.type,
        properties: r.properties
      });
    });
    
    const graphData: GraphData = {
      nodes: Array.from(nodes.values()),
      links
    };
    
    return res.json(graphData);
  } catch (error) {
    console.error('Error fetching relationships:', error);
    return res.status(500).json({ error: 'Error fetching relationships' });
  } finally {
    await session.close();
  }
});

/**
 * Analyze sentiment for a text
 */
router.post('/sentiment-analysis', async (req, res) => {
  try {
    const schema = z.object({
      text: z.string().min(1)
    });
    
    const { text } = schema.parse(req.body);
    const sentiment = await analyzeSentiment(text);
    
    return res.json(sentiment);
  } catch (error) {
    console.error('Error analyzing sentiment:', error);
    return res.status(500).json({ error: 'Error analyzing sentiment' });
  }
});

export default router;
