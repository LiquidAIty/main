# Run the project_agents migration
$env:PGPASSWORD = "postgres"
psql -U postgres -d liquidaity -f "20_project_agents_multi.sql"

if ($LASTEXITCODE -eq 0) {
    Write-Host "Migration completed successfully" -ForegroundColor Green
} else {
    Write-Host "Migration failed with exit code $LASTEXITCODE" -ForegroundColor Red
}
