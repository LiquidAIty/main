from datetime import datetime, timezone

from app.python_models import card_domain


def root_row():
    return {"run_id": "root", "project_id": "p", "deck_id": "d", "card_id": "c", "title": "Saved name",
            "runtime_kind": "hermes", "runtime_mode": "delegate", "runtime_profile": "research",
            "provider_thread_ref": "native-session", "state": "completed", "final_result": "Accepted result"}


class Cursor:
    def __init__(self):
        self.statements = []

    def __enter__(self): return self

    def __exit__(self, *_args): return None

    def execute(self, query, params=None):
        self.statements.append((query, params))

    def fetchone(self):
        return root_row()

    def fetchall(self):
        return [{**root_row(), "run_id": name, "state": state,
                 "started_at": datetime(2026, 8, 26, tzinfo=timezone.utc)}
                for name, state in [("running-child", "running"), ("finished-child", "completed"), ("pending-child", "pending")]]


def test_terminal_reads_persisted_child_lineage_and_does_not_count_pending_capacity(monkeypatch):
    cursor = Cursor()
    monkeypatch.setattr(card_domain, "_age_rows", lambda *_args: [
        {"parent_id": "root", "child_id": name, "native_id": f"native-{name}"}
        for name in ["running-child", "finished-child", "pending-child"]
    ] + [{"parent_id": "sender", "child_id": "root", "native_id": None}])
    value = card_domain._read_run_terminal(cursor, root_row())
    assert value["activeChildren"] == 1
    assert value["parentRunIds"] == ["sender"]
    assert value["children"][0]["nativeChildId"] == "native-running-child"
    assert value["children"][0]["parentRunId"] == "root"
    assert value["children"][0]["cardName"] == "Saved name"
    assert "transcript" not in value
    assert all(query.strip().startswith("SELECT") for query, _ in cursor.statements)


def test_card_reconnect_selects_a_root_not_a_newer_inherited_native_child(monkeypatch):
    cursor = Cursor()
    cursor.fetchone = root_row

    class Connection:
        def __enter__(self): return self
        def __exit__(self, *_args): return None
        def cursor(self, **_kwargs): return cursor

    monkeypatch.setattr(card_domain, "connect_postgres", lambda **_kwargs: Connection())
    monkeypatch.setattr(card_domain, "_resolve_project", lambda *_args: {"id": "p"})
    monkeypatch.setattr(card_domain, "_age_rows", lambda *_args: [{"run_id": "native-child-run"}])
    monkeypatch.setattr(
        card_domain,
        "_read_run_terminal",
        lambda *_args, **_kwargs: {"children": []},
    )
    for _ in range(2):
        result = card_domain.read_run({"projectId": "p", "deckId": "d", "cardId": "c", "includeTerminal": True})
        assert result["run"]["runId"] == "root"
        assert result["run"]["result"] == "Accepted result"
    selections = [(query, params) for query, params in cursor.statements if "SELECT run.*" in query]
    assert selections[0][1] == ("p", "d", "c", ["native-child-run"])
    assert all("AND NOT (run.run_id = ANY" in query for query, _ in selections)
    assert all(query.strip().startswith(("SELECT", "SET TRANSACTION READ ONLY")) for query, _ in cursor.statements)
