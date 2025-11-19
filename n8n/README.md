# n8n Integration

## Run n8n locally
```
docker compose -f docker-compose.n8n.yml up -d
```
- n8n will be available at http://localhost:5678
- Runtime data lives in `./n8n_data/` (git ignored)
- Exported workflows should be saved as JSON in `n8n/flows/`
