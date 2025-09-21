# Time Series and Knowledge Graph Integration Setup

This guide will help you set up the time series data collection and knowledge graph integration for LiquidAIty.

## Prerequisites

- Docker installed on your system
- Node.js 16+ and npm

## Quick Setup

1. **Install dependencies**:
   ```bash
   npm install
   ```

2. **Set up database schemas**:
   ```bash
   npm run setup-db-schemas
   ```
   This will create the necessary schema files in the `scripts/db/` directory.

3. **Start databases and apply schemas**:
   ```bash
   npm run setup-databases
   ```
   This command will:
   - Start TimescaleDB in Docker
   - Start Neo4j in Docker
   - Apply the schemas to both databases

4. **Start the backend server**:
   ```bash
   npm run start-ts-server
   ```

## Manual Setup

If you prefer to set up each component manually:

### 1. Start TimescaleDB

```bash
npm run start-timescaledb
```

### 2. Start Neo4j

```bash
npm run start-neo4j
```

### 3. Apply Database Schemas

Wait for the databases to start (about 10 seconds), then:

```bash
npm run apply-timescale-schema
npm run apply-neo4j-schema
```

### 4. Start the Backend Server

```bash
npm run start-ts-server
```

## Testing the API

You can test the API endpoints using curl:

```bash
# Register a time series
curl -X POST http://localhost:3001/api/ts/register \
  -H "Content-Type: application/json" \
  -d '{
    "seriesId": "test-series-001",
    "name": "Test Time Series",
    "source": "manual",
    "collectIntervalMs": 60000,
    "tags": {
      "category": "test"
    }
  }'

# Insert time points
curl -X POST http://localhost:3001/api/ts/insert \
  -H "Content-Type: application/json" \
  -d '{
    "seriesId": "test-series-001",
    "points": [
      {
        "timestamp": "2025-09-19T15:00:00Z",
        "value": 42.5
      },
      {
        "timestamp": "2025-09-19T15:01:00Z",
        "value": 43.2
      }
    ]
  }'

# Query time series
curl "http://localhost:3001/api/ts/query?seriesId=test-series-001&start=2025-09-19T00:00:00Z&end=2025-09-20T00:00:00Z"
```

## Environment Variables

Create a `.env` file in the project root with the following variables:

```
# Database connections
TIMESCALEDB_URL=postgresql://postgres:password@localhost:5432/timeseries
NEO4J_URI=neo4j://localhost:7687
NEO4J_USER=neo4j
NEO4J_PASSWORD=password

# Server configuration
PORT=3001

# MCP servers (if using)
MCP_BASE_URL=http://localhost:8000

# API keys for external services (replace with your actual keys)
ALPHAVANTAGE_API_KEY=your_key_here
GOOGLE_TRENDS_API_KEY=your_key_here
REDDIT_CLIENT_ID=your_client_id
REDDIT_CLIENT_SECRET=your_client_secret
OPENWEATHER_API_KEY=your_key_here
```

## External Data Sources

To use external data sources, you'll need to set up the appropriate MCP servers or API connections. The following data sources are supported:

- Stock market data
- Google Trends
- Reddit
- Weather data
- Ask the Public
- Custom data sources

## Knowledge Graph Integration

The time series data is automatically integrated with the knowledge graph. You can:

- Link time series to entities
- Store time series statistics in the knowledge graph
- Query time series associated with specific entities
- Store aggregated data (hourly, daily, weekly, monthly, yearly) in the knowledge graph
