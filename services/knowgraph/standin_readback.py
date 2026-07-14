"""Read-only KnowGraph readback for stand-in proofs. Usage: python standin_readback.py <project_id>"""
import os, sys
from dotenv import load_dotenv
from neo4j import GraphDatabase

load_dotenv()
project = sys.argv[1] if len(sys.argv) > 1 else ""
d = GraphDatabase.driver(os.getenv("NEO4J_URI"), auth=(os.getenv("NEO4J_USER"), os.getenv("NEO4J_PASSWORD")))
with d.session() as s:
    counts = {}
    for lbl in ["Document", "Chunk", "Concept", "Person", "Organization"]:
        counts[lbl] = s.run(f"MATCH (x:{lbl} {{project_id:$p}}) RETURN count(x) AS c", p=project).single()["c"]
    print("counts:", counts)
    concepts = s.run("MATCH (c:Concept {project_id:$p}) RETURN c.name AS name ORDER BY name", p=project).data()
    print("concepts:", [r["name"] for r in concepts])
    docs = s.run(
        "MATCH (dn:Document {project_id:$p}) RETURN coalesce(dn.source_url, dn.document_id, dn.path,'?') AS src, dn.source_type AS t",
        p=project,
    ).data()
    print("documents:", docs)
    rels = s.run(
        "MATCH (a {project_id:$p})-[r]->(b {project_id:$p}) RETURN type(r) AS t, count(*) AS c ORDER BY c DESC",
        p=project,
    ).data()
    print("rel_types:", rels)
    prov = s.run(
        "MATCH (c:Concept {project_id:$p}) WHERE c.source IS NOT NULL RETURN c.name AS name, c.source AS source, c.source_pages AS pages LIMIT 5",
        p=project,
    ).data()
    print("sample_provenance:", prov)
d.close()
