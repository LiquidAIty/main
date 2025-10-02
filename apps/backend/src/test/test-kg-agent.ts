/**
 * Test script for knowledge graph agent integration
 * 
 * This script tests the integration between LangGraph agents and Neo4j knowledge graph
 * Run with: npx ts-node src/test/test-kg-agent.ts
 */

import dotenv from 'dotenv';
import { createDeptAgent } from '../agents/lang/agentFactory';

// Load environment variables
dotenv.config();

// Test function
async function testKnowledgeGraphAgent() {
  console.log('🧪 Testing Knowledge Graph Agent Integration');
  console.log('===========================================');
  
  try {
    // Create a test agent
    const agent = createDeptAgent({
      id: 'test-kg-agent',
      name: 'Test KG Agent',
      defaultPersona: `You are a test agent for knowledge graph integration.
      
Your task is to create a simple knowledge graph about artificial intelligence concepts
and then query that knowledge graph to demonstrate the integration works.

First, create a knowledge graph with key AI concepts like:
- Machine Learning
- Neural Networks
- Natural Language Processing
- Computer Vision
- Reinforcement Learning

Then, establish relationships between these concepts.
Finally, query the graph to show how concepts are related.`,
      matchKeywords: ['test', 'knowledge graph', 'ai']
    });
    
    console.log('✅ Agent created successfully');
    
    // Step 1: Create knowledge graph
    console.log('\n📊 Step 1: Creating knowledge graph...');
    const createResult = await agent.run({
      prompt: 'Create a knowledge graph of key AI concepts and their relationships.',
      threadId: `test-kg-${Date.now()}`
    });
    
    console.log('✅ Knowledge graph creation response:');
    console.log('----------------------------------');
    console.log(createResult.output);
    console.log('----------------------------------');
    
    // Extract graph ID from the response if possible
    let graphId = '';
    try {
      const match = createResult.output.match(/graphId[:\s]+"?(kg-\d+)"?/i);
      if (match && match[1]) {
        graphId = match[1];
        console.log(`📝 Extracted graph ID: ${graphId}`);
      }
    } catch (e) {
      console.log('⚠️ Could not extract graph ID from response');
    }
    
    // Step 2: Query the knowledge graph
    console.log('\n🔍 Step 2: Querying knowledge graph...');
    const queryPrompt = graphId 
      ? `Query the knowledge graph with ID ${graphId} to find relationships between Neural Networks and other AI concepts.`
      : 'Query the most recent knowledge graph to find relationships between Neural Networks and other AI concepts.';
      
    const queryResult = await agent.run({
      prompt: queryPrompt,
      threadId: `test-kg-query-${Date.now()}`
    });
    
    console.log('✅ Knowledge graph query response:');
    console.log('----------------------------------');
    console.log(queryResult.output);
    console.log('----------------------------------');
    
    // Step 3: Test natural language query
    console.log('\n💬 Step 3: Testing natural language query...');
    const nlQueryResult = await agent.run({
      prompt: 'What is the relationship between Machine Learning and Neural Networks in the knowledge graph?',
      threadId: `test-kg-nl-${Date.now()}`
    });
    
    console.log('✅ Natural language query response:');
    console.log('----------------------------------');
    console.log(nlQueryResult.output);
    console.log('----------------------------------');
    
    console.log('\n🎉 Knowledge Graph Agent Integration Test Completed');
    
  } catch (error) {
    console.error('❌ Test failed with error:', error);
  }
}

// Run the test
testKnowledgeGraphAgent().catch(console.error);
