/**
 * Sample Data Generator
 * Generates sample financial data for the knowledge graph
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import neo4j from 'neo4j-driver';

// Get current file directory with ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuration
const config = {
  neo4j: {
    uri: process.env.NEO4J_URI || 'neo4j://localhost:7687',
    user: process.env.NEO4J_USER || 'neo4j',
    password: process.env.NEO4J_PASSWORD || 'password'
  },
  outputDir: path.join(__dirname, 'sample-data')
};

// Create output directory if it doesn't exist
if (!fs.existsSync(config.outputDir)) {
  fs.mkdirSync(config.outputDir, { recursive: true });
}

// Connect to Neo4j
const driver = neo4j.driver(
  config.neo4j.uri,
  neo4j.auth.basic(config.neo4j.user, config.neo4j.password)
);

// Sample data
const companies = [
  { symbol: 'AAPL', name: 'Apple Inc.', sector: 'Technology', industry: 'Consumer Electronics', country: 'USA' },
  { symbol: 'MSFT', name: 'Microsoft Corporation', sector: 'Technology', industry: 'Software', country: 'USA' },
  { symbol: 'GOOGL', name: 'Alphabet Inc.', sector: 'Technology', industry: 'Internet Content & Information', country: 'USA' },
  { symbol: 'AMZN', name: 'Amazon.com Inc.', sector: 'Consumer Cyclical', industry: 'Internet Retail', country: 'USA' },
  { symbol: 'META', name: 'Meta Platforms Inc.', sector: 'Technology', industry: 'Internet Content & Information', country: 'USA' },
  { symbol: 'TSLA', name: 'Tesla Inc.', sector: 'Consumer Cyclical', industry: 'Auto Manufacturers', country: 'USA' },
  { symbol: 'NVDA', name: 'NVIDIA Corporation', sector: 'Technology', industry: 'Semiconductors', country: 'USA' },
  { symbol: 'JPM', name: 'JPMorgan Chase & Co.', sector: 'Financial Services', industry: 'Banks', country: 'USA' },
  { symbol: 'V', name: 'Visa Inc.', sector: 'Financial Services', industry: 'Credit Services', country: 'USA' },
  { symbol: 'JNJ', name: 'Johnson & Johnson', sector: 'Healthcare', industry: 'Drug Manufacturers', country: 'USA' }
];

const people = [
  { name: 'Tim Cook', role: 'CEO', company: 'AAPL' },
  { name: 'Satya Nadella', role: 'CEO', company: 'MSFT' },
  { name: 'Sundar Pichai', role: 'CEO', company: 'GOOGL' },
  { name: 'Andy Jassy', role: 'CEO', company: 'AMZN' },
  { name: 'Mark Zuckerberg', role: 'CEO', company: 'META' },
  { name: 'Elon Musk', role: 'CEO', company: 'TSLA' },
  { name: 'Jensen Huang', role: 'CEO', company: 'NVDA' },
  { name: 'Jamie Dimon', role: 'CEO', company: 'JPM' },
  { name: 'Alfred Kelly', role: 'CEO', company: 'V' },
  { name: 'Joaquin Duato', role: 'CEO', company: 'JNJ' }
];

const currencies = [
  { pair: 'EUR/USD', name: 'Euro / US Dollar' },
  { pair: 'USD/JPY', name: 'US Dollar / Japanese Yen' },
  { pair: 'GBP/USD', name: 'British Pound / US Dollar' },
  { pair: 'USD/CHF', name: 'US Dollar / Swiss Franc' },
  { pair: 'AUD/USD', name: 'Australian Dollar / US Dollar' }
];

const countries = [
  { code: 'USA', name: 'United States', continent: 'North America', currency: 'USD' },
  { code: 'EUR', name: 'European Union', continent: 'Europe', currency: 'EUR' },
  { code: 'JPN', name: 'Japan', continent: 'Asia', currency: 'JPY' },
  { code: 'GBR', name: 'United Kingdom', continent: 'Europe', currency: 'GBP' },
  { code: 'CHE', name: 'Switzerland', continent: 'Europe', currency: 'CHF' },
  { code: 'AUS', name: 'Australia', continent: 'Oceania', currency: 'AUD' }
];

// Relationships
const relationships = [
  // Company partnerships
  { source: 'AAPL', target: 'MSFT', type: 'PARTNERS_WITH', properties: { since: '2020-01-15', strength: 0.7 } },
  { source: 'GOOGL', target: 'AMZN', type: 'PARTNERS_WITH', properties: { since: '2019-05-22', strength: 0.6 } },
  { source: 'MSFT', target: 'NVDA', type: 'PARTNERS_WITH', properties: { since: '2021-03-10', strength: 0.8 } },
  
  // Company competes with
  { source: 'AAPL', target: 'GOOGL', type: 'COMPETES_WITH', properties: { market: 'Mobile OS', strength: 0.9 } },
  { source: 'MSFT', target: 'GOOGL', type: 'COMPETES_WITH', properties: { market: 'Cloud Services', strength: 0.8 } },
  { source: 'AMZN', target: 'MSFT', type: 'COMPETES_WITH', properties: { market: 'Cloud Services', strength: 0.9 } },
  { source: 'META', target: 'GOOGL', type: 'COMPETES_WITH', properties: { market: 'Online Advertising', strength: 0.9 } },
  
  // Company supplies to
  { source: 'NVDA', target: 'AAPL', type: 'SUPPLIES_TO', properties: { product: 'GPUs', since: '2018-06-12' } },
  { source: 'NVDA', target: 'MSFT', type: 'SUPPLIES_TO', properties: { product: 'GPUs', since: '2017-09-05' } },
  
  // Currency relationships
  { source: 'USA', target: 'EUR/USD', type: 'HAS_CURRENCY_PAIR', properties: {} },
  { source: 'EUR', target: 'EUR/USD', type: 'HAS_CURRENCY_PAIR', properties: {} },
  { source: 'USA', target: 'USD/JPY', type: 'HAS_CURRENCY_PAIR', properties: {} },
  { source: 'JPN', target: 'USD/JPY', type: 'HAS_CURRENCY_PAIR', properties: {} }
];

// Time series data
const generateTimeSeries = (symbol, type, startDate, endDate) => {
  const start = new Date(startDate);
  const end = new Date(endDate);
  const days = Math.floor((end - start) / (24 * 60 * 60 * 1000));
  
  const baseValue = Math.random() * 100 + 50; // Random base value between 50 and 150
  const trend = (Math.random() - 0.5) * 0.1; // Random trend between -0.05 and 0.05
  const volatility = baseValue * 0.02; // 2% volatility
  
  const points = [];
  
  for (let i = 0; i <= days; i++) {
    const date = new Date(start);
    date.setDate(start.getDate() + i);
    
    // Skip weekends for stock data
    if (type === 'stock' && (date.getDay() === 0 || date.getDay() === 6)) {
      continue;
    }
    
    const trendComponent = baseValue * trend * i;
    const seasonalComponent = Math.sin(i / 30 * Math.PI) * baseValue * 0.05; // Monthly seasonality
    const randomComponent = (Math.random() - 0.5) * volatility;
    
    const value = baseValue + trendComponent + seasonalComponent + randomComponent;
    
    points.push({
      timestamp: date.toISOString(),
      value: Math.max(0, value)
    });
  }
  
  return {
    seriesId: `${symbol}_${type}`,
    name: `${symbol} ${type.charAt(0).toUpperCase() + type.slice(1)}`,
    type,
    points
  };
};

// Generate time series for each company
const timeSeriesData = [];

const today = new Date();
const oneYearAgo = new Date();
oneYearAgo.setFullYear(today.getFullYear() - 1);

companies.forEach(company => {
  // Stock price time series
  timeSeriesData.push(generateTimeSeries(company.symbol, 'stock', oneYearAgo, today));
  
  // Trading volume time series
  timeSeriesData.push(generateTimeSeries(company.symbol, 'volume', oneYearAgo, today));
  
  // Sentiment time series
  timeSeriesData.push(generateTimeSeries(company.symbol, 'sentiment', oneYearAgo, today));
});

// Generate time series for each currency pair
currencies.forEach(currency => {
  timeSeriesData.push(generateTimeSeries(currency.pair, 'forex', oneYearAgo, today));
});

// Save sample data to files
fs.writeFileSync(
  path.join(config.outputDir, 'companies.json'),
  JSON.stringify(companies, null, 2)
);

fs.writeFileSync(
  path.join(config.outputDir, 'people.json'),
  JSON.stringify(people, null, 2)
);

fs.writeFileSync(
  path.join(config.outputDir, 'currencies.json'),
  JSON.stringify(currencies, null, 2)
);

fs.writeFileSync(
  path.join(config.outputDir, 'countries.json'),
  JSON.stringify(countries, null, 2)
);

fs.writeFileSync(
  path.join(config.outputDir, 'relationships.json'),
  JSON.stringify(relationships, null, 2)
);

fs.writeFileSync(
  path.join(config.outputDir, 'time-series.json'),
  JSON.stringify(timeSeriesData, null, 2)
);

// Generate Cypher script for Neo4j
const generateCypherScript = () => {
  let script = '// Sample Financial Knowledge Graph\n\n';
  
  // Create constraints
  script += '// Create constraints\n';
  script += 'CREATE CONSTRAINT company_symbol IF NOT EXISTS FOR (c:Company) REQUIRE c.symbol IS UNIQUE;\n';
  script += 'CREATE CONSTRAINT person_name IF NOT EXISTS FOR (p:Person) REQUIRE p.name IS UNIQUE;\n';
  script += 'CREATE CONSTRAINT currency_pair IF NOT EXISTS FOR (c:Currency) REQUIRE c.pair IS UNIQUE;\n';
  script += 'CREATE CONSTRAINT country_code IF NOT EXISTS FOR (c:Country) REQUIRE c.code IS UNIQUE;\n';
  script += 'CREATE CONSTRAINT time_series_id IF NOT EXISTS FOR (ts:TimeSeries) REQUIRE ts.seriesId IS UNIQUE;\n\n';
  
  // Create companies
  script += '// Create companies\n';
  companies.forEach(company => {
    script += `MERGE (c:Company {symbol: "${company.symbol}"})
  SET c.name = "${company.name}",
      c.sector = "${company.sector}",
      c.industry = "${company.industry}",
      c.country = "${company.country}";\n`;
  });
  script += '\n';
  
  // Create people
  script += '// Create people\n';
  people.forEach(person => {
    script += `MERGE (p:Person {name: "${person.name}"})
  SET p.role = "${person.role}";\n`;
    
    // Create relationship to company
    script += `MATCH (p:Person {name: "${person.name}"}), (c:Company {symbol: "${person.company}"})
  MERGE (p)-[:WORKS_FOR]->(c);\n`;
  });
  script += '\n';
  
  // Create currencies
  script += '// Create currencies\n';
  currencies.forEach(currency => {
    script += `MERGE (c:Currency {pair: "${currency.pair}"})
  SET c.name = "${currency.name}";\n`;
  });
  script += '\n';
  
  // Create countries
  script += '// Create countries\n';
  countries.forEach(country => {
    script += `MERGE (c:Country {code: "${country.code}"})
  SET c.name = "${country.name}",
      c.continent = "${country.continent}",
      c.currency = "${country.currency}";\n`;
  });
  script += '\n';
  
  // Create relationships
  script += '// Create relationships\n';
  relationships.forEach(rel => {
    let sourceType, targetType;
    
    // Determine node types based on ID format
    if (rel.source.length <= 4 && rel.source === rel.source.toUpperCase()) {
      if (rel.source.includes('/')) {
        sourceType = 'Currency';
      } else {
        sourceType = 'Company';
      }
    } else {
      sourceType = 'Country';
    }
    
    if (rel.target.length <= 7 && rel.target === rel.target.toUpperCase()) {
      if (rel.target.includes('/')) {
        targetType = 'Currency';
      } else {
        targetType = 'Company';
      }
    } else {
      targetType = 'Country';
    }
    
    // Create the relationship
    script += `MATCH (a:${sourceType} {${sourceType === 'Company' ? 'symbol' : sourceType === 'Currency' ? 'pair' : 'code'}: "${rel.source}"}),
      (b:${targetType} {${targetType === 'Company' ? 'symbol' : targetType === 'Currency' ? 'pair' : 'code'}: "${rel.target}"})
  MERGE (a)-[:${rel.type} {`;
    
    // Add properties
    const props = [];
    for (const [key, value] of Object.entries(rel.properties)) {
      if (typeof value === 'string') {
        props.push(`${key}: "${value}"`);
      } else {
        props.push(`${key}: ${value}`);
      }
    }
    
    script += props.join(', ');
    script += '}]->(b);\n';
  });
  script += '\n';
  
  // Create time series
  script += '// Create time series\n';
  timeSeriesData.forEach(series => {
    script += `MERGE (ts:TimeSeries {seriesId: "${series.seriesId}"})
  SET ts.name = "${series.name}",
      ts.type = "${series.type}",
      ts.startDate = "${series.points[0].timestamp}",
      ts.endDate = "${series.points[series.points.length - 1].timestamp}",
      ts.pointCount = ${series.points.length},
      ts.stats = {
        min: ${Math.min(...series.points.map(p => p.value)).toFixed(2)},
        max: ${Math.max(...series.points.map(p => p.value)).toFixed(2)},
        avg: ${(series.points.reduce((sum, p) => sum + p.value, 0) / series.points.length).toFixed(2)}
      };\n`;
    
    // Link time series to entity
    if (series.type === 'forex') {
      script += `MATCH (c:Currency {pair: "${series.seriesId.split('_')[0]}"}), (ts:TimeSeries {seriesId: "${series.seriesId}"})
  MERGE (c)-[:HAS_TIME_SERIES]->(ts);\n`;
    } else {
      script += `MATCH (c:Company {symbol: "${series.seriesId.split('_')[0]}"}), (ts:TimeSeries {seriesId: "${series.seriesId}"})
  MERGE (c)-[:HAS_TIME_SERIES]->(ts);\n`;
    }
  });
  
  return script;
};

const cypherScript = generateCypherScript();
fs.writeFileSync(
  path.join(config.outputDir, 'load-sample-data.cypher'),
  cypherScript
);

// Load data into Neo4j
const loadDataIntoNeo4j = async () => {
  const session = driver.session();
  
  try {
    console.log('Loading sample data into Neo4j...');
    await session.run(cypherScript);
    console.log('Sample data loaded successfully!');
  } catch (error) {
    console.error('Error loading data into Neo4j:', error);
  } finally {
    await session.close();
    await driver.close();
  }
};

// Check if we should load data directly
if (process.argv.includes('--load')) {
  loadDataIntoNeo4j();
} else {
  console.log('Sample data generated successfully!');
  console.log(`Files saved to: ${config.outputDir}`);
  console.log('To load data into Neo4j, run: node scripts/generate-sample-data.js --load');
}

// Export for testing
export {
  companies,
  people,
  currencies,
  countries,
  relationships,
  timeSeriesData
};
