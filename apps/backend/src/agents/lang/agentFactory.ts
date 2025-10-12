import { ChatOpenAI } from '@langchain/openai';
import { StateGraph, MessagesAnnotation } from '@langchain/langgraph';
import { ToolNode } from '@langchain/langgraph/prebuilt';
import { HumanMessage } from '@langchain/core/messages';
import { resolve_model_by_role, type agent_role } from '../../llm/models.config';
import { createAgentTools } from './tools/agentFactoryTools';

// TODO: Neo4j connection moved to agentFactoryTools.ts

// Interface for knowledge graph nodes - used in type definitions for Neo4j results
// Commented out as currently unused
/* 
type KGNode = {
  id: string;
  labels: string[];
  properties: Record<string, any>;
}

// Interface for knowledge graph relationships - used in type definitions for Neo4j results
type KGRelationship = {
  source: string;
  target: string;
  type: string;
  properties: Record<string, any>;
}
*/

export type DeptAgentSpec = {
  id: string;
  name: string;
  defaultPersona: string;
  matchKeywords: string[];
};

export function createDeptAgent(spec: DeptAgentSpec) {
  return {
    id: spec.id,
    name: spec.name,
    kind: 'internal' as const,
    endpoint: `internal:/api/tools/${spec.id}`,
    enabled: true,
    match: { keywords: spec.matchKeywords, weight: 1 },

    async run(params: {
      prompt?: string;
      persona?: string;
      role?: agent_role;
      n8nWebhook?: string;
      threadId?: string;
      maxSteps?: number;
    }) {
      const persona = params.persona ?? spec.defaultPersona;
      const role = params.role ?? 'worker';
      const model = resolve_model_by_role(role);
      
      console.log('[Agent Factory] Model config:', {
        provider: model.provider,
        id: model.id,
        baseUrl: model.baseUrl,
        hasApiKey: !!model.apiKey,
        apiKeyPrefix: model.apiKey?.substring(0, 10)
      });
      
      const modelLC = new ChatOpenAI({
        model: model.id,
        openAIApiKey: model.apiKey,
        maxTokens: model.maxTokens,
        timeout: 30000,
        ...(model.baseUrl !== 'https://api.openai.com/v1' ? {
          configuration: {
            baseURL: model.baseUrl
          }
        } : {})
      });

      // TODO: Legacy JSON schema tools below - converted to Zod in agentFactoryTools.ts
      const tools = createAgentTools(spec.id, params.threadId);
      
      /* OLD JSON SCHEMA TOOLS - KEEPING FOR REFERENCE
      const oldTools = [
        {
          name: 'memory_op',
          description: "Store or retrieve information. ops: put|get|all. Example: {op:'put', key:'project', value:'LiquidAIty'}",
          schema: {
            type: 'object',
            properties: {
              op: { type: 'string', enum: ['put', 'get', 'all'] },
              key: { type: 'string' },
              value: { type: 'object' }
            },
            required: ['op']
          },
          func: async (args: any) => {
            // Mock memory for now - can be enhanced later
            const threadId = params.threadId ?? `dept:${spec.id}`;
            if (args.op === 'put') {
              return { success: true, stored: args.key, threadId };
            } else if (args.op === 'get') {
              return { success: true, key: args.key, value: null, threadId };
            } else {
              return { success: true, all: [], threadId };
            }
          }
        },
        {
          name: 'knowledge_graph',
          description: 'Create or update knowledge graph nodes and relationships. Nodes should have id, labels (array), and properties. Relationships should have source, target, type, and optional properties.',
          schema: {
            type: 'object',
            properties: {
              nodes: { 
                type: 'array', 
                items: { 
                  type: 'object',
                  properties: {
                    id: { type: 'string' },
                    labels: { type: 'array', items: { type: 'string' } },
                    properties: { type: 'object' }
                  },
                  required: ['id', 'labels']
                } 
              },
              relationships: { 
                type: 'array', 
                items: { 
                  type: 'object',
                  properties: {
                    source: { type: 'string' },
                    target: { type: 'string' },
                    type: { type: 'string' },
                    properties: { type: 'object' }
                  },
                  required: ['source', 'target', 'type']
                } 
              }
            },
            required: ['nodes']
          },
          func: async (args: any) => {
            const session = driver.session();
            const graphId = `kg-${Date.now()}`;
            
            try {
              // Process nodes
              const nodes = args.nodes || [];
              const createdNodes: string[] = [];
              
              for (const node of nodes) {
                // Ensure node has required properties
                if (!node.id || !node.labels || !Array.isArray(node.labels)) {
                  continue;
                }
                
                // Create Cypher query for node
                const labels = node.labels.map((l: string) => `:${l}`).join('');
                const properties = node.properties || {};
                properties.createdBy = spec.id;
                properties.createdAt = new Date().toISOString();
                properties.graphId = graphId;
                
                // Merge node (create if not exists, update if exists)
                await session.run(
                  `MERGE (n${labels} {id: $id})
                   ON CREATE SET n = $properties
                   ON MATCH SET n += $updateProperties`,
                  {
                    id: node.id,
                    properties: { ...properties, id: node.id },
                    updateProperties: { 
                      updatedAt: properties.createdAt,
                      graphId: properties.graphId
                    }
                  }
                );
                
                createdNodes.push(node.id);
              }
              
              // Process relationships
              const relationships = args.relationships || [];
              const createdRelationships: string[] = [];
              
              for (const rel of relationships) {
                // Ensure relationship has required properties
                if (!rel.source || !rel.target || !rel.type) {
                  continue;
                }
                
                // Create Cypher query for relationship
                const properties = rel.properties || {};
                properties.createdBy = spec.id;
                properties.createdAt = new Date().toISOString();
                properties.graphId = graphId;
                
                // Create relationship
                await session.run(
                  `MATCH (source {id: $sourceId})
                   MATCH (target {id: $targetId})
                   MERGE (source)-[r:${rel.type}]->(target)
                   ON CREATE SET r = $properties
                   ON MATCH SET r += $updateProperties`,
                  {
                    sourceId: rel.source,
                    targetId: rel.target,
                    properties,
                    updateProperties: { 
                      updatedAt: properties.createdAt,
                      graphId: properties.graphId
                    }
                  }
                );
                
                createdRelationships.push(`${rel.source}-${rel.type}->${rel.target}`);
              }
              
              return {
                success: true,
                graphId,
                nodesCreated: createdNodes.length,
                nodes: createdNodes,
                relationshipsCreated: createdRelationships.length,
                relationships: createdRelationships
              };
            } catch (error) {
              console.error('Error creating knowledge graph:', error);
              return {
                success: false,
                error: `Failed to create knowledge graph: ${error}`,
                graphId
              };
            } finally {
              await session.close();
            }
          }
        },
        {
          name: 'knowledge_graph_query',
          description: 'Query the knowledge graph using Cypher or natural language. Use this to retrieve information from the knowledge graph.',
          schema: {
            type: 'object',
            properties: {
              query: { type: 'string', description: 'Cypher query or natural language question' },
              queryType: { type: 'string', enum: ['cypher', 'natural'], default: 'natural' },
              graphId: { type: 'string', description: 'Optional specific graph ID to query' },
              limit: { type: 'number', description: 'Optional limit on results', default: 10 }
            },
            required: ['query']
          },
          func: async (args: any) => {
            const session = driver.session();
            
            try {
              if (args.queryType === 'cypher') {
                // Direct Cypher query
                const result = await session.run(args.query, {
                  graphId: args.graphId,
                  limit: args.limit || 10
                });
                
                // Process and return results
                const records = result.records.map(record => {
                  const obj: Record<string, any> = {};
                  record.keys.forEach(key => {
                    const value = record.get(key);
                    const keyStr = String(key); // Convert key to string to avoid symbol index errors
                    
                    // Handle Neo4j node objects
                    if (value && typeof value === 'object' && value.labels && value.properties) {
                      obj[keyStr] = {
                        id: value.identity.toString(),
                        labels: value.labels,
                        properties: value.properties
                      };
                    }
                    // Handle Neo4j relationship objects
                    else if (value && typeof value === 'object' && value.type && value.start && value.end) {
                      obj[keyStr] = {
                        id: value.identity.toString(),
                        type: value.type,
                        source: value.start.toString(),
                        target: value.end.toString(),
                        properties: value.properties
                      };
                    }
                    // Handle path objects
                    else if (value && typeof value === 'object' && value.segments) {
                      obj[keyStr] = 'Path object (simplified)';
                    }
                    // Handle all other values
                    else {
                      obj[keyStr] = value;
                    }
                  });
                  return obj;
                });
                
                return {
                  success: true,
                  queryType: 'cypher',
                  records,
                  summary: {
                    resultAvailable: records.length,
                    resultConsumed: records.length
                  }
                };
              } else {
                // Natural language query - translate to Cypher
                // For specific graph
                if (args.graphId) {
                  // First, get node labels and relationship types in this graph
                  const schemaResult = await session.run(`
                    MATCH (n)
                    WHERE n.graphId = $graphId
                    WITH DISTINCT labels(n) AS nodeLabels
                    RETURN COLLECT(nodeLabels) AS allLabels
                    
                    UNION
                    
                    MATCH ()-[r]->()
                    WHERE r.graphId = $graphId
                    WITH DISTINCT type(r) AS relType
                    RETURN COLLECT(relType) AS allLabels
                  `, { graphId: args.graphId });
                  
                  // Extract schema information
                  const nodeLabels = schemaResult.records[0]?.get('allLabels') || [];
                  
                  // Build a query based on the natural language and schema
                  let cypher = '';
                  const nlQuery = args.query.toLowerCase();
                  
                  if (nlQuery.includes('all') || nlQuery.includes('everything')) {
                    cypher = `
                      MATCH (n)
                      WHERE n.graphId = $graphId
                      RETURN n
                      LIMIT $limit
                    `;
                  } else {
                    // Try to match specific node labels from the query
                    const matchedLabels = nodeLabels.filter((label: string) => 
                      nlQuery.includes(label.toLowerCase())
                    );
                    
                    if (matchedLabels.length > 0) {
                      const labelCondition = matchedLabels.map((l: string) => `"${l}" IN labels(n)`).join(' OR ');
                      cypher = `
                        MATCH (n)
                        WHERE n.graphId = $graphId AND (${labelCondition})
                        RETURN n
                        LIMIT $limit
                      `;
                    } else {
                      // Default to a text search on properties
                      cypher = `
                        MATCH (n)
                        WHERE n.graphId = $graphId
                        AND ANY(key IN keys(n) WHERE toString(n[key]) CONTAINS $searchText)
                        RETURN n
                        LIMIT $limit
                      `;
                    }
                  }
                  
                  // Execute the generated Cypher query
                  const result = await session.run(cypher, {
                    graphId: args.graphId,
                    limit: args.limit || 10,
                    searchText: args.query
                  });
                  
                  // Process and return results
                  const nodes = result.records.map(record => {
                    const node = record.get('n');
                    return {
                      id: node.identity.toString(),
                      labels: node.labels,
                      properties: node.properties
                    };
                  });
                  
                  return {
                    success: true,
                    queryType: 'natural',
                    translatedQuery: cypher,
                    nodes,
                    summary: {
                      resultCount: nodes.length
                    }
                  };
                } else {
                  // Query across all graphs
                  // This is a simplified approach - in production, you'd want more sophisticated NL->Cypher translation
                  const cypher = `
                    MATCH (n)
                    WHERE ANY(key IN keys(n) WHERE toString(n[key]) CONTAINS $searchText)
                    RETURN n
                    LIMIT $limit
                  `;
                  
                  const result = await session.run(cypher, {
                    searchText: args.query,
                    limit: args.limit || 10
                  });
                  
                  // Process and return results
                  const nodes = result.records.map(record => {
                    const node = record.get('n');
                    return {
                      id: node.identity.toString(),
                      labels: node.labels,
                      properties: node.properties
                    };
                  });
                  
                  return {
                    success: true,
                    queryType: 'natural',
                    translatedQuery: cypher,
                    nodes,
                    summary: {
                      resultCount: nodes.length
                    }
                  };
                }
              }
            } catch (error) {
              console.error('Error querying knowledge graph:', error);
              return {
                success: false,
                error: `Failed to query knowledge graph: ${error}`
              };
            } finally {
              await session.close();
            }
          }
        }
      ];
      */

      const toolNode = new ToolNode(tools);
      const bound = modelLC.bindTools(tools);

      function shouldContinue({ messages }: typeof MessagesAnnotation.State) {
        const last: any = messages[messages.length - 1];
        return last?.tool_calls?.length ? 'tools' : '__end__';
      }

      async function callModel(state: typeof MessagesAnnotation.State) {
        const messages = [{ role: 'system', content: persona }, ...state.messages];
        const response = await bound.invoke(messages as any);
        return { messages: [response] };
      }

      const graph = new StateGraph(MessagesAnnotation)
        .addNode('agent', callModel)
        .addNode('tools', toolNode)
        .addEdge('__start__', 'agent')
        .addEdge('tools', 'agent')
        .addConditionalEdges('agent', shouldContinue)
        .compile();

      try {
        console.log('[Agent Factory] Invoking graph with prompt:', params.prompt?.substring(0, 50));
        
        const final = await graph.invoke(
          { messages: [new HumanMessage(params.prompt ?? 'Assist the user.')] },
          { configurable: { thread_id: params.threadId ?? `dept:${spec.id}` } }
        );

        const last = (final as any).messages[(final as any).messages.length - 1] as any;
        console.log('[Agent Factory] Graph completed successfully');
        
        return { 
          ok: true, 
          provider: model.provider, 
          model: model.id, 
          output: last?.content, 
          steps: (final as any).messages.length 
        };
      } catch (error) {
        console.error('[Agent Factory] Graph invocation failed:', error);
        throw error;
      }
    }
  };
}
