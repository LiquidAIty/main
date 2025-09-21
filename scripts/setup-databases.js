/**
 * Database Setup Script
 * Creates schema files for TimescaleDB and Neo4j
 */

const fs = require('fs');
const path = require('path');

// Create directories if they don't exist
const scriptsDir = path.join(__dirname, 'db');
if (!fs.existsSync(scriptsDir)) {
  fs.mkdirSync(scriptsDir, { recursive: true });
}

// TimescaleDB Schema
const timescaleSchema = `
-- Create time series database
CREATE DATABASE timeseries;
\\c timeseries

-- Enable TimescaleDB extension
CREATE EXTENSION IF NOT EXISTS timescaledb;

-- Create time series table
CREATE TABLE time_points (
  time TIMESTAMPTZ NOT NULL,
  series_id TEXT NOT NULL,
  value DOUBLE PRECISION NOT NULL,
  tags JSONB,
  metadata JSONB
);

-- Create hypertable
SELECT create_hypertable('time_points', 'time');

-- Create index on series_id
CREATE INDEX ON time_points (series_id, time DESC);

-- Create time series config table
CREATE TABLE time_series_config (
  series_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  source TEXT NOT NULL,
  collect_interval_ms INTEGER DEFAULT 60000,
  retention_periods JSONB,
  default_aggregations JSONB,
  tags JSONB,
  entity_id TEXT
);

-- Create aggregation tables
CREATE TABLE hourly_aggregations (
  time TIMESTAMPTZ NOT NULL,
  series_id TEXT NOT NULL,
  value DOUBLE PRECISION NOT NULL,
  min DOUBLE PRECISION,
  max DOUBLE PRECISION,
  count INTEGER,
  PRIMARY KEY (series_id, time)
);

CREATE TABLE daily_aggregations (
  time TIMESTAMPTZ NOT NULL,
  series_id TEXT NOT NULL,
  value DOUBLE PRECISION NOT NULL,
  min DOUBLE PRECISION,
  max DOUBLE PRECISION,
  count INTEGER,
  PRIMARY KEY (series_id, time)
);

CREATE TABLE weekly_aggregations (
  time TIMESTAMPTZ NOT NULL,
  series_id TEXT NOT NULL,
  week_number INTEGER NOT NULL,
  value DOUBLE PRECISION NOT NULL,
  min DOUBLE PRECISION,
  max DOUBLE PRECISION,
  count INTEGER,
  PRIMARY KEY (series_id, time)
);

CREATE TABLE monthly_aggregations (
  time TIMESTAMPTZ NOT NULL,
  series_id TEXT NOT NULL,
  value DOUBLE PRECISION NOT NULL,
  min DOUBLE PRECISION,
  max DOUBLE PRECISION,
  count INTEGER,
  PRIMARY KEY (series_id, time)
);

CREATE TABLE yearly_aggregations (
  time TIMESTAMPTZ NOT NULL,
  series_id TEXT NOT NULL,
  value DOUBLE PRECISION NOT NULL,
  min DOUBLE PRECISION,
  max DOUBLE PRECISION,
  count INTEGER,
  PRIMARY KEY (series_id, time)
);

-- Create collection jobs table
CREATE TABLE collection_jobs (
  job_id TEXT PRIMARY KEY,
  series_id TEXT NOT NULL REFERENCES time_series_config(series_id),
  data_source_config JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'running',
  last_run TIMESTAMPTZ,
  points_collected INTEGER DEFAULT 0,
  error TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
`;

// Neo4j Schema
const neo4jSchema = `
// Create constraints
CREATE CONSTRAINT entity_id IF NOT EXISTS FOR (e:Entity) REQUIRE e.id IS UNIQUE;
CREATE CONSTRAINT time_series_id IF NOT EXISTS FOR (ts:TimeSeries) REQUIRE ts.seriesId IS UNIQUE;

// Create indexes
CREATE INDEX entity_name IF NOT EXISTS FOR (e:Entity) ON (e.name);
CREATE INDEX time_series_name IF NOT EXISTS FOR (ts:TimeSeries) ON (ts.name);

// Create time series metadata schema
MERGE (tsm:TimeSeriesMetadata {id: 'schema'})
SET tsm.dataTypes = ['numeric', 'categorical'],
    tsm.intervals = ['minute', 'hour', 'day', 'week', 'month', 'year'],
    tsm.aggregations = ['avg', 'sum', 'min', 'max', 'count', 'stddev']
RETURN tsm;
`;

try {
  // Write schema files
  fs.writeFileSync(path.join(scriptsDir, 'timescale-schema.sql'), timescaleSchema);
  fs.writeFileSync(path.join(scriptsDir, 'neo4j-schema.cypher'), neo4jSchema);

  console.log('Schema files created:');
  console.log('- scripts/db/timescale-schema.sql');
  console.log('- scripts/db/neo4j-schema.cypher');
  console.log('\nTo apply these schemas:');
  console.log('1. For TimescaleDB (if using Docker):');
  console.log('   docker exec -i timescaledb psql -U postgres -f - < scripts/db/timescale-schema.sql');
  console.log('\n2. For Neo4j (if using Docker):');
  console.log('   docker exec -i neo4j cypher-shell -u neo4j -p password < scripts/db/neo4j-schema.cypher');
} catch (error) {
  console.error('Error creating schema files:', error);
  process.exit(1);
}
