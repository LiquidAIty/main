-- Check project_type distribution
SELECT project_type, count(*) 
FROM ag_catalog.projects 
GROUP BY project_type
ORDER BY project_type;

-- Check recent projects
SELECT id, name, project_type, created_at
FROM ag_catalog.projects
ORDER BY created_at DESC
LIMIT 20;

-- Check agent counts per project
SELECT p.id, p.name, p.project_type, COUNT(a.agent_id) as agent_count
FROM ag_catalog.projects p
LEFT JOIN ag_catalog.project_agents a ON p.id = a.project_id
GROUP BY p.id, p.name, p.project_type
ORDER BY p.created_at DESC
LIMIT 20;
