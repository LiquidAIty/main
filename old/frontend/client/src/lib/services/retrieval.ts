/**
 * Hybrid Retrieval System for Explanations
 * Combines vector search, knowledge graph patterns, and time series analysis
 */

import { DocumentNode, EventNode, PredictionNode } from '../models/ontology';
import { findSimilarDocuments, getEmbedding } from './embedding';

/**
 * Time window for retrieval
 */
export interface TimeWindow {
  start: string; // ISO date string
  end: string;   // ISO date string
}

/**
 * Evidence package containing all relevant information for an explanation
 */
export interface EvidencePackage {
  docs: DocumentNode[];
  events: EventNode[];
  predictions: PredictionNode[];
  timeWindow: TimeWindow;
  entityIds: string[];
}

/**
 * Explanation generated from evidence
 */
export interface Explanation {
  summary: string;
  reasons: Array<{
    cause: string;
    evidence: string[];
    confidence: 'low' | 'medium' | 'high';
  }>;
  nextSteps: string[];
}

/**
 * Retrieve evidence for a specific entity and time window
 */
export async function retrieveEvidence(
  entityId: string,
  timeWindow: TimeWindow
): Promise<EvidencePackage> {
  try {
    const response = await fetch('/api/kg/retrieve-evidence', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        entityId,
        t0: timeWindow.start,
        t1: timeWindow.end
      })
    });
    
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`HTTP ${response.status} :: ${text}`);
    }
    
    const data = await response.json();
    
    return {
      docs: data.docs || [],
      events: data.events || [],
      predictions: data.predictions || [],
      timeWindow,
      entityIds: [entityId]
    };
  } catch (error) {
    console.error('Error retrieving evidence:', error);
    throw error;
  }
}

/**
 * Ground a text query to entities and time window
 */
export async function groundQuery(
  query: string
): Promise<{ entityIds: string[]; timeWindow: TimeWindow; docId?: string }> {
  try {
    const response = await fetch('/api/kg/ground-query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: query })
    });
    
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`HTTP ${response.status} :: ${text}`);
    }
    
    const data = await response.json();
    
    // Default to last 7 days if no time window detected
    if (!data.timeWindow) {
      const end = new Date();
      const start = new Date();
      start.setDate(start.getDate() - 7);
      
      data.timeWindow = {
        start: start.toISOString(),
        end: end.toISOString()
      };
    }
    
    return {
      entityIds: data.entityIds || [],
      timeWindow: data.timeWindow,
      docId: data.docId
    };
  } catch (error) {
    console.error('Error grounding query:', error);
    throw error;
  }
}

/**
 * Retrieve evidence based on a natural language query
 */
export async function retrieveEvidenceFromQuery(
  query: string
): Promise<EvidencePackage> {
  // First ground the query to entities and time window
  const grounding = await groundQuery(query);
  
  if (!grounding.entityIds.length) {
    throw new Error('Could not identify any entities in the query');
  }
  
  // Get evidence for each entity
  const evidencePromises = grounding.entityIds.map(entityId => 
    retrieveEvidence(entityId, grounding.timeWindow)
  );
  
  const evidenceResults = await Promise.all(evidencePromises);
  
  // Merge evidence from all entities
  const mergedEvidence: EvidencePackage = {
    docs: [],
    events: [],
    predictions: [],
    timeWindow: grounding.timeWindow,
    entityIds: grounding.entityIds
  };
  
  for (const evidence of evidenceResults) {
    mergedEvidence.docs = [...mergedEvidence.docs, ...evidence.docs];
    mergedEvidence.events = [...mergedEvidence.events, ...evidence.events];
    mergedEvidence.predictions = [...mergedEvidence.predictions, ...evidence.predictions];
  }
  
  // Deduplicate documents by ID
  mergedEvidence.docs = Array.from(
    new Map(mergedEvidence.docs.map(doc => [doc.id, doc])).values()
  );
  
  // Deduplicate events by ID
  mergedEvidence.events = Array.from(
    new Map(mergedEvidence.events.map(event => [event.id, event])).values()
  );
  
  // Deduplicate predictions by ID
  mergedEvidence.predictions = Array.from(
    new Map(mergedEvidence.predictions.map(pred => [pred.id, pred])).values()
  );
  
  return mergedEvidence;
}

/**
 * Generate explanation from evidence using LLM
 */
export async function generateExplanation(
  query: string,
  evidence: EvidencePackage
): Promise<Explanation> {
  try {
    // Format the evidence for the LLM
    const formattedDocs = evidence.docs.map(doc => ({
      id: doc.id,
      title: doc.title,
      text: doc.text.length > 300 ? doc.text.substring(0, 300) + '...' : doc.text,
      source: doc.source,
      timestamp: doc.timestamp
    }));
    
    const formattedEvents = evidence.events.map(event => ({
      id: event.id,
      title: event.title,
      description: event.description,
      type: event.type,
      timestamp: event.timestamp,
      severity: event.severity
    }));
    
    const formattedPredictions = evidence.predictions.map(pred => ({
      id: pred.id,
      model: pred.model,
      timestamp: pred.timestamp,
      horizon: pred.horizon,
      mean: pred.mean,
      q10: pred.q10,
      q90: pred.q90
    }));
    
    const response = await fetch('/api/explain', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query,
        evidence: {
          docs: formattedDocs,
          events: formattedEvents,
          predictions: formattedPredictions,
          timeWindow: evidence.timeWindow,
          entityIds: evidence.entityIds
        }
      })
    });
    
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`HTTP ${response.status} :: ${text}`);
    }
    
    const data = await response.json();
    return data.explanation;
  } catch (error) {
    console.error('Error generating explanation:', error);
    throw error;
  }
}

/**
 * End-to-end function to explain a query
 */
export async function explainQuery(query: string): Promise<Explanation> {
  // Retrieve evidence based on the query
  const evidence = await retrieveEvidenceFromQuery(query);
  
  // Generate explanation from the evidence
  return generateExplanation(query, evidence);
}

/**
 * Mock explanation function for testing without API calls
 */
export function mockExplanation(query: string): Explanation {
  return {
    summary: `This is a mock explanation for: "${query}"`,
    reasons: [
      {
        cause: 'Primary factor identified in the data',
        evidence: ['doc-123', 'event-456'],
        confidence: 'high'
      },
      {
        cause: 'Secondary contributing factor',
        evidence: ['doc-789'],
        confidence: 'medium'
      }
    ],
    nextSteps: [
      'Monitor the situation for the next 48 hours',
      'Investigate potential correlation with other metrics'
    ]
  };
}
