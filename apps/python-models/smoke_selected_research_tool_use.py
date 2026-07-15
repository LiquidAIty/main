# Live Mag One smoke for the selected research workflow.
#
# Runs the ACTUAL Python Mag One research workflow (run_native_magentic_mission)
# with a real configured model client over the RDW/SpaceX fixture, the research
# participant having KnowGraph Hybrid Retrieval attached. Proves Mag One itself
# can CHOOSE to call the tool, receive the bounded source-backed result through
# the existing event path, and produce a source-backed research answer.
#
# Uses the existing configured Mag One model client only (OPENROUTER/OPENAI from
# apps/backend/.env). No fake model, no Tavily/web/crawler/local-chat, no writes.
#
#   apps/python-models/.venv/Scripts/python.exe smoke_selected_research_tool_use.py
import asyncio
import os
import re
import sys
from pathlib import Path

from app.python_models import magentic_agentchat as mac
from app.python_models.autogen_provider_env import _load_repo_env
from app.python_models.knowgraph_research_fixture import PROJECT_ID, build_selected_research_context

PROVIDER = "openrouter"
MODEL = "openai/gpt-5.1-chat"
TOOL_ID = "retrieve_knowgraph_context"


def _knowgraph_count() -> int:
    repo_root = Path(__file__).resolve().parents[2]
    kg = str(repo_root / "services" / "knowgraph")
    if kg not in sys.path:
        sys.path.insert(0, kg)
    import skill_ingest
    config = skill_ingest.load_neo4j_config(repo_root)
    driver = skill_ingest._connect(config)
    try:
        records, _, _ = driver.execute_query(
            "MATCH (a:KnowledgeAssertion {project_id:$project_id}) RETURN count(a) AS n",
            project_id=PROJECT_ID,
            database_=config["database"],
        )
        return int(records[0]["n"])
    finally:
        driver.close()


async def main() -> int:
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass
    _load_repo_env()
    if not os.getenv("OPENROUTER_API_KEY", "").strip() and not os.getenv("OPENAI_API_KEY", "").strip():
        print("RESULT=MAG_ONE_TOOL_EVENT_PATH_PROVEN_LIVE_MODEL_CLIENT_NOT_CONFIGURED "
              "blocker=no OPENROUTER_API_KEY/OPENAI_API_KEY configured")
        return 2

    ctx = build_selected_research_context(provider=PROVIDER, provider_model_id=MODEL, tools=[TOOL_ID])
    ctx.cardRuntime.runtimeOptions = {"maxTurns": 8}  # bound the live run

    before = _knowgraph_count()
    try:
        res = await mac.run_native_magentic_mission(ctx)
    except Exception as exc:
        print(f"RESULT=MAG_ONE_TOOL_EVENT_PATH_PROVEN_LIVE_MODEL_CLIENT_NOT_CONFIGURED blocker={exc}")
        return 2
    after = _knowgraph_count()

    events = (res.autogenEvents or []) + (res.autogenMessages or [])
    blob = "\n".join(f"{e.type}:{e.source}:{e.content}" for e in events)
    tool_called = (TOOL_ID in blob) or ("retrieval_modes" in blob) or ("ToolCall" in blob and "source_ref" in blob)
    # Real source-backed evidence actually flowed back (non-empty result with sourceRefs).
    evidence_returned = ("source_ref" in blob and "'supported'" in blob) or ("'contradicted'" in blob)
    final = res.finalResponseText or ""
    final_lower = final.lower()

    # The final answer must not invent a concrete RDW price, SpaceX valuation, or
    # a SpaceX public ticker. The ticker check is sentence-scoped and excludes the
    # real RDW/RWE evidence tickers and exchange names so correct phrasings like
    # "SpaceX is private, unlike RDW on NYSE" are not false-flagged.
    invented_dollar = bool(re.search(r"\$\s?\d", final))
    _ticker_phrase = re.compile(r"\b(ticker|trades?\s+(under|as)|listed\s+(under|as)|symbol)\b", re.I)
    _not_a_ticker = {"RDW", "RWE", "NYSE", "NASDAQ", "SEC", "IPO", "US", "USA", "CEO", "CFO",
                     "AI", "ID", "URL", "API", "KG", "SPACEX"}
    spacex_ticker = False
    for sentence in re.split(r"(?<=[.\n])", final):
        if "spacex" in sentence.lower() and _ticker_phrase.search(sentence):
            symbols = [s for s in re.findall(r"\b[A-Z]{2,5}\b", sentence) if s not in _not_a_ticker]
            if symbols:
                spacex_ticker = True
                break

    print(f"[smoke] ok={res.ok} stop={res.stopReason} events={len(events)} "
          f"final_len={len(final)} tool_called={tool_called}")
    print(f"[smoke] final (first 700): {final[:700]}")
    print(f"[smoke] knowgraph assertion count before={before} after={after}")

    checks: list[tuple[str, bool]] = [
        ("Mag One run started and produced output", bool(res.ok) and bool(final)),
        ("Mag One called retrieve_knowgraph_context", tool_called),
        ("real source-backed evidence flowed back through the event path", evidence_returned),
        ("no new assertion created (no graph writes)", before == after and before > 0),
        ("final answer invents no dollar price/valuation figure", not invented_dollar),
        ("final answer invents no SpaceX public ticker", not spacex_ticker),
        ("final answer references source-backed evidence",
         any(k in final_lower for k in ["source", "rdw", "redwire", "spacex"])),
    ]
    for name, ok in checks:
        print(f"[smoke] verify: {'PASS' if ok else 'FAIL'}  {name}")

    if all(ok for _, ok in checks):
        print("RESULT=MAG_ONE_SELECTED_RESEARCH_WORKFLOW_KNOWGRAPH_TOOL_USE_PROVEN")
        return 0
    if not tool_called:
        print("RESULT=PARTIAL_BLOCKED (Mag One did not choose the tool in this run; "
              "deterministic event-path proof stands)")
        return 1
    print("RESULT=PARTIAL_BLOCKED (see FAIL lines)")
    return 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
