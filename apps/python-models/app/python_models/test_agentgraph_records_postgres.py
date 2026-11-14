"""Real isolated PostgreSQL acceptance; never inserts into the saved demo Project."""
# Entity: AgentGraph
# Relationship: Tests append-only generic records, exact retries, cross-Project refusal and independent AGE projection failure using the established isolated PostgreSQL fixture.

from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from uuid import uuid4

import psycopg
from psycopg import sql
import pytest

from app.application_tool_error import ApplicationToolError
from app.python_models import agentgraph_records as records
from app.python_models.test_trading_postgres import database, pytestmark


@pytest.fixture(scope='module')
def record_schema(database):
    params, role = database
    with psycopg.connect(**params, autocommit=True) as owner:
        owner.execute('CREATE TABLE ag_catalog.deck_card_memberships (project_id uuid, deck_id text, card_id text, PRIMARY KEY(project_id,deck_id,card_id))')
        path = Path(__file__).resolve().parents[3] / 'backend/migrations/065_optional_agentgraph_records.sql'
        owner.execute(path.read_text(encoding='utf-8'))
        owner.execute(sql.SQL('GRANT SELECT ON ag_catalog.deck_card_memberships TO {}').format(sql.Identifier(role)))
        owner.execute(sql.SQL('GRANT SELECT,INSERT ON ag_catalog.agent_records,ag_catalog.agent_record_links TO {}').format(sql.Identifier(role)))
    return params, role


@pytest.fixture
def scope(record_schema, monkeypatch):
    params, role = record_schema
    project = str(uuid4())
    with psycopg.connect(**params, autocommit=True) as owner:
        for card in ['research', 'reviewer']:
            revision = str(uuid4())
            owner.execute('INSERT INTO ag_catalog.agent_cards VALUES (%s,%s,%s,%s)', (project, 'deck', card, revision))
            owner.execute("INSERT INTO ag_catalog.agent_card_revisions VALUES (%s,'hermes','delegate',%s,'{}',true)", (revision, card))
            owner.execute('INSERT INTO ag_catalog.deck_card_memberships VALUES (%s,%s,%s)', (project, 'deck', card))
            for operation in ['publish', 'read', 'search', 'link']:
                owner.execute("INSERT INTO ag_catalog.card_capability_grants VALUES (%s,'tool',%s)", (revision, 'agentgraph.' + operation))
    def connect(**kwargs):
        connection = psycopg.connect(**params, **kwargs)
        connection.execute(sql.SQL('SET ROLE {}').format(sql.Identifier(role)))
        return connection
    monkeypatch.setattr(records, 'connect_postgres', connect)
    return {'project': project, 'deck': 'deck', 'card': 'research'}, params, connect


def publish(scope, **changes):
    return records.publish(**scope[0], kind='research', content='Evidence for an incomplete proposal',
        details=changes.pop('details', {}), sources=[], event_at=None, key=changes.pop('key', 'one'), **changes)


def test_publication_survives_missing_age_graph_and_is_readable_without_a_run(scope):
    saved = publish(scope)
    assert saved['saved'] is True
    assert saved['graphProjection']['status'] == 'failed'
    row = records.read(**scope[0], record_id=saved['record']['record_id'])['record']
    assert row == saved['record']
    assert row['source_execution'] is None
    assert row['event_at'] is None
    assert row['card_id'] == 'research'
    assert records.search(**scope[0], query='incomplete')['records'] == [row]


def test_concurrent_retry_is_one_immutable_publication(scope):
    with ThreadPoolExecutor(max_workers=3) as pool:
        results = list(pool.map(lambda _: publish(scope), range(3)))
    assert len({item['record']['record_id'] for item in results}) == 1
    assert sum(item['created'] for item in results) == 1
    with pytest.raises(ApplicationToolError, match='idempotency_conflict'):
        publish(scope, details={'changed': True})
    with scope[2]() as connection:
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            connection.execute('DELETE FROM ag_catalog.agent_records')
    with psycopg.connect(**scope[1], autocommit=True) as owner:
        with pytest.raises(psycopg.errors.RaiseException, match='append_only'):
            owner.execute('UPDATE ag_catalog.agent_records SET content=%s WHERE project_id=%s', ('changed', scope[0]['project']))


def test_correction_links_new_publication_and_preserves_original(scope):
    original = publish(scope)['record']
    correction = publish(scope, key='correction', details={'correction': 'Source timing clarified'})['record']
    reviewer = {**scope[0], 'card': 'reviewer'}
    linked = records.link(**reviewer, source_id=correction['record_id'], target_id=original['record_id'], relation='SUPERSEDES')
    retry = records.link(**reviewer, source_id=correction['record_id'], target_id=original['record_id'], relation='SUPERSEDES')
    assert retry['link']['link_id'] == linked['link']['link_id']
    read = records.read(**reviewer, record_id=original['record_id'])
    assert read['record'] == original
    assert len(read['links']) == 1
    assert read['links'][0]['card_id'] == 'reviewer'
    assert linked['saved'] is True and linked['graphProjection']['status'] == 'failed'


def test_foreign_scope_unknown_record_and_retired_membership_cannot_access(scope):
    saved = publish(scope)['record']['record_id']
    with pytest.raises(ApplicationToolError, match='grant_required'):
        records.read(**{**scope[0], 'project': str(uuid4())}, record_id=saved)
    with pytest.raises(ApplicationToolError, match='record_not_found'):
        records.link(**scope[0], source_id=saved, target_id=str(uuid4()), relation='REFERENCES')
    with psycopg.connect(**scope[1], autocommit=True) as owner:
        owner.execute('DELETE FROM ag_catalog.deck_card_memberships WHERE project_id=%s AND card_id=%s', (scope[0]['project'], 'research'))
    with pytest.raises(ApplicationToolError, match='grant_required'):
        records.read(**scope[0], record_id=saved)


@pytest.mark.parametrize('instrument', ['equity', 'etf', 'options', 'multileg_options', 'futures', 'forex', 'crypto', 'prediction_market'])
def test_instrument_details_are_records_not_execution_claims_or_runtime_requirements(scope, instrument):
    detail = {'instrument': {'type': instrument}, 'state': 'PROPOSED', 'missingTerms': ['current executable quote']}
    result = publish(scope, details=detail)
    assert result['record']['details'] == detail
    assert result['record']['verification'] == 'attributed_publication_not_independent_verification'


def test_real_age_projection_retains_only_record_identity_and_author_provenance(scope, monkeypatch):
    from psycopg.rows import dict_row
    from app.python_models.agentgraph_query import execute_fixed_agentgraph_query
    # Only this module's disposable database. No product graph or role changes.
    with psycopg.connect(**scope[1], autocommit=True) as owner:
        owner.execute("LOAD 'age'")
        owner.execute('SET search_path=ag_catalog,public')
        owner.execute("SELECT create_graph('agentgraph')")
        with owner.cursor(row_factory=dict_row) as cursor:
            execute_fixed_agentgraph_query(cursor,
                'CREATE (card:Card {projectId:$project,deckId:$deck,cardId:$card}) RETURN card.cardId AS id',
                scope[0], 'id agtype')
    # SQL/AGE compatibility proof under the disposable database owner; least-
    # privilege record writes are independently tested in the other cases.
    monkeypatch.setattr(records, 'connect_postgres', lambda **kwargs: psycopg.connect(**scope[1], **kwargs))
    result = publish(scope)
    assert result['graphProjection']['status'] == 'projected'
    assert publish(scope)['record']['record_id'] == result['record']['record_id']
    with psycopg.connect(**scope[1]) as owner, owner.cursor(row_factory=dict_row) as cursor:
        cursor.execute("LOAD 'age'")
        cursor.execute('SET LOCAL search_path=ag_catalog,public')
        rows = execute_fixed_agentgraph_query(cursor,
            'MATCH (card:Card)-[:AUTHORED]->(record:Record {recordId:$id}) RETURN properties(record) AS record,card.cardId AS card',
            {'id': result['record']['record_id']}, 'record agtype,card agtype')
        assert len(rows) == 1 and rows[0]['card'] == 'research'
        assert rows[0]['record']['recordId'] == result['record']['record_id']
        assert 'content' not in rows[0]['record'] and 'source_execution' not in rows[0]['record']
        from app.python_models.agentgraph_inspection import _record_references
        references = _record_references(cursor, project_id=scope[0]['project'], deck_id='deck', card_id='', limit=5)
        assert references == [{'id': result['record']['record_id'], 'kind': 'research', 'author': 'research',
                               'created': result['record']['created_at'], 'event': None}]
