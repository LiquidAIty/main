/**
 * Knowledge Graph Ontology Schema
 * Defines the structure and relationships for the knowledge graph
 */

/**
 * Entity types in the knowledge graph
 */
export enum EntityType {
  ORGANIZATION = 'organization',
  PERSON = 'person',
  PRODUCT = 'product',
  PLACE = 'place',
  CONCEPT = 'concept',
  TECHNOLOGY = 'technology',
  EVENT = 'event',
  OTHER = 'other'
}

/**
 * Relation types between entities
 */
export enum RelationType {
  // Organizational relations
  WORKS_AT = 'works_at',
  FOUNDED = 'founded',
  ACQUIRED = 'acquired',
  COMPETES_WITH = 'competes_with',
  PARTNERS_WITH = 'partners_with',
  INVESTS_IN = 'invests_in',
  
  // Product relations
  DEVELOPS = 'develops',
  PRODUCES = 'produces',
  USES = 'uses',
  SELLS = 'sells',
  PART_OF = 'part_of',
  
  // Temporal relations
  BEFORE = 'before',
  AFTER = 'after',
  DURING = 'during',
  
  // Causal relations
  CAUSES = 'causes',
  AFFECTS = 'affects',
  CORRELATES_WITH = 'correlates_with',
  
  // Spatial relations
  LOCATED_IN = 'located_in',
  NEAR = 'near',
  
  // Conceptual relations
  SIMILAR_TO = 'similar_to',
  INSTANCE_OF = 'instance_of',
  RELATED_TO = 'related_to',
  
  // Other
  OTHER = 'other'
}

/**
 * Event types in the knowledge graph
 */
export enum EventType {
  NEWS = 'news',
  RELEASE = 'release',
  ANNOUNCEMENT = 'announcement',
  FINANCIAL = 'financial',
  SOCIAL = 'social',
  LEGAL = 'legal',
  TECHNICAL = 'technical',
  OTHER = 'other'
}

/**
 * Document types in the knowledge graph
 */
export enum DocumentType {
  NEWS_ARTICLE = 'news_article',
  BLOG_POST = 'blog_post',
  RESEARCH_PAPER = 'research_paper',
  FINANCIAL_REPORT = 'financial_report',
  SOCIAL_MEDIA = 'social_media',
  TRANSCRIPT = 'transcript',
  CODE = 'code',
  OTHER = 'other'
}

/**
 * Series types in the knowledge graph
 */
export enum SeriesType {
  PRICE = 'price',
  VOLUME = 'volume',
  METRIC = 'metric',
  SENTIMENT = 'sentiment',
  ENGAGEMENT = 'engagement',
  TECHNICAL = 'technical',
  OTHER = 'other'
}

/**
 * Model types in the knowledge graph
 */
export enum ModelType {
  ARIMA = 'arima',
  TBATS = 'tbats',
  PROPHET = 'prophet',
  ESN = 'esn',
  TFT = 'tft',
  NBEATS = 'nbeats',
  ENSEMBLE = 'ensemble',
  OTHER = 'other'
}

/**
 * Entity node in the knowledge graph
 */
export interface EntityNode {
  id: string;
  label: string;
  type: EntityType;
  properties?: Record<string, any>;
  embedding?: number[];
}

/**
 * Document node in the knowledge graph
 */
export interface DocumentNode {
  id: string;
  title: string;
  text: string;
  type: DocumentType;
  timestamp: string;
  source: string;
  url?: string;
  embedding?: number[];
}

/**
 * Event node in the knowledge graph
 */
export interface EventNode {
  id: string;
  title: string;
  description: string;
  type: EventType;
  timestamp: string;
  severity: number; // 0-1 scale
  source?: string;
  url?: string;
}

/**
 * Series node in the knowledge graph
 */
export interface SeriesNode {
  id: string;
  name: string;
  type: SeriesType;
  unit?: string;
  frequency?: string;
  source?: string;
  properties?: Record<string, any>;
}

/**
 * Prediction node in the knowledge graph
 */
export interface PredictionNode {
  id: string;
  model: string;
  timestamp: string;
  horizon: number;
  mean: number;
  q10?: number;
  q90?: number;
  properties?: Record<string, any>;
}

/**
 * Relationship between nodes in the knowledge graph
 */
export interface Relationship {
  source: string;
  target: string;
  type: RelationType | string;
  properties?: Record<string, any>;
  confidence?: number;
  timestamp?: string;
}

/**
 * Cypher queries for common knowledge graph operations
 */
export const cypherQueries = {
  /**
   * Create entity node
   */
  createEntity: `
    CREATE CONSTRAINT entity_id IF NOT EXISTS FOR (e:Entity) REQUIRE (e.id) IS UNIQUE;
    MERGE (e:Entity {id: $id})
    SET e.label = $label,
        e.type = $type,
        e.properties = $properties
    RETURN e
  `,
  
  /**
   * Create document node
   */
  createDocument: `
    CREATE CONSTRAINT doc_id IF NOT EXISTS FOR (d:Doc) REQUIRE (d.id) IS UNIQUE;
    MERGE (d:Doc {id: $id})
    SET d.title = $title,
        d.text = $text,
        d.type = $type,
        d.ts = datetime($timestamp),
        d.source = $source,
        d.url = $url,
        d.embedding = $embedding
    RETURN d
  `,
  
  /**
   * Link document to entity
   */
  linkDocToEntity: `
    MATCH (d:Doc {id: $docId})
    MATCH (e:Entity {id: $entityId})
    MERGE (d)-[:ABOUT]->(e)
    RETURN d, e
  `,
  
  /**
   * Create event node
   */
  createEvent: `
    CREATE CONSTRAINT event_id IF NOT EXISTS FOR (ev:Event) REQUIRE (ev.id) IS UNIQUE;
    CREATE INDEX event_ts IF NOT EXISTS FOR (ev:Event) ON (ev.ts);
    MERGE (ev:Event {id: $id})
    SET ev.title = $title,
        ev.description = $description,
        ev.type = $type,
        ev.ts = datetime($timestamp),
        ev.severity = $severity,
        ev.source = $source,
        ev.url = $url
    RETURN ev
  `,
  
  /**
   * Link event to entity
   */
  linkEventToEntity: `
    MATCH (ev:Event {id: $eventId})
    MATCH (e:Entity {id: $entityId})
    MERGE (ev)-[:AFFECTS]->(e)
    RETURN ev, e
  `,
  
  /**
   * Create series node
   */
  createSeries: `
    CREATE CONSTRAINT series_id IF NOT EXISTS FOR (s:Series) REQUIRE (s.id) IS UNIQUE;
    MERGE (s:Series {id: $id})
    SET s.name = $name,
        s.type = $type,
        s.unit = $unit,
        s.frequency = $frequency,
        s.source = $source,
        s.properties = $properties
    RETURN s
  `,
  
  /**
   * Link series to entity
   */
  linkSeriesToEntity: `
    MATCH (s:Series {id: $seriesId})
    MATCH (e:Entity {id: $entityId})
    MERGE (s)-[:FOR]->(e)
    RETURN s, e
  `,
  
  /**
   * Create prediction node
   */
  createPrediction: `
    MERGE (p:Prediction {id: $id})
    SET p.model = $model,
        p.ts = datetime($timestamp),
        p.horizon = $horizon,
        p.mean = $mean,
        p.q10 = $q10,
        p.q90 = $q90,
        p.properties = $properties
    RETURN p
  `,
  
  /**
   * Link prediction to series
   */
  linkPredictionToSeries: `
    MATCH (p:Prediction {id: $predictionId})
    MATCH (s:Series {id: $seriesId})
    MERGE (p)-[:FOR]->(s)
    RETURN p, s
  `,
  
  /**
   * Link prediction to evidence (events)
   */
  linkPredictionToEvidence: `
    MATCH (p:Prediction {id: $predictionId})
    MATCH (ev:Event {id: $eventId})
    MERGE (p)-[:EVIDENCE]->(ev)
    RETURN p, ev
  `,
  
  /**
   * Create relationship between entities
   */
  createRelationship: `
    MATCH (a:Entity {id: $sourceId})
    MATCH (b:Entity {id: $targetId})
    MERGE (a)-[r:RELATES {type: $type}]->(b)
    SET r.properties = $properties,
        r.confidence = $confidence,
        r.timestamp = datetime($timestamp)
    RETURN a, r, b
  `,
  
  /**
   * Vector search for similar documents
   */
  vectorSearch: `
    CALL db.index.vector.queryNodes('doc_embedding_idx', $embedding, $limit)
    YIELD node, score
    RETURN node.id AS id, node.title AS title, node.text AS text, node.type AS type, 
           node.source AS source, node.url AS url, score
    LIMIT $limit
  `,
  
  /**
   * Find evidence for time period
   */
  findEvidence: `
    WITH datetime($t0) AS t0, datetime($t1) AS t1, $entityId AS eid
    MATCH (e:Entity {id: eid})
    CALL {
      WITH e, t0, t1
      MATCH (d:Doc)-[:ABOUT]->(e)
      WHERE d.ts >= t0 AND d.ts < t1
      RETURN collect(d)[0..20] AS docs
    }
    CALL {
      WITH e, t0, t1
      MATCH (ev:Event)-[:AFFECTS]->(e)
      WHERE ev.ts >= t0 AND ev.ts < t1
      RETURN collect(ev)[0..10] AS events
    }
    MATCH (p:Prediction)-[:FOR]->(:Series)-[:FOR]->(e)
    WHERE p.ts >= t0 AND p.ts < t1
    RETURN docs, events, collect(p) AS preds
  `
};
