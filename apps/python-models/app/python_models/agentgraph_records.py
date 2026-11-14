"""Optional immutable work sharing; Hermes never depends on these publications."""
# Entity: AgentGraph
# Relationship: Publishes and reads Project-scoped PostgreSQL work records and separately projects their genuine provenance links into existing AGE without controlling agent execution.

from __future__ import annotations

import hashlib
import json
from datetime import datetime
from typing import Any
from uuid import UUID, uuid4

from psycopg.rows import dict_row

from app.application_tool_error import ApplicationToolError
from app.python_models.agentgraph_query import execute_fixed_agentgraph_query
from app.python_models.postgres import connect_postgres


RELATIONS = ('SUPPORTS', 'CHALLENGES', 'EVALUATES', 'SUPERSEDES', 'EXECUTED_AS', 'REFERENCES')


def _text(value, field, maximum):
    if not isinstance(value, str) or not value.strip() or len(value) > maximum:
        raise ApplicationToolError(f'agentgraph_{field}_invalid')
    return value


def _id(value):
    try:
        return str(UUID(value))
    except (ValueError, TypeError, AttributeError):
        raise ApplicationToolError('agentgraph_record_id_invalid') from None


def _scope(cursor, project, deck, card, operation):
    cursor.execute('''SELECT c.current_revision_id, r.runtime_profile
        FROM ag_catalog.agent_cards c JOIN ag_catalog.agent_card_revisions r ON r.revision_id=c.current_revision_id
        JOIN ag_catalog.deck_card_memberships m ON m.project_id=c.project_id AND m.deck_id=c.deck_id AND m.card_id=c.card_id
        WHERE c.project_id=%s AND c.deck_id=%s AND c.card_id=%s AND r.enabled AND r.runtime_kind='hermes'
        AND EXISTS (SELECT 1 FROM ag_catalog.card_capability_grants g
          WHERE g.revision_id=c.current_revision_id AND g.grant_kind='tool' AND g.grant_id=%s)''',
        (project, deck, card, operation))
    row = cursor.fetchone()
    if not row:
        raise ApplicationToolError('agentgraph_saved_card_grant_required')
    return row


def _public(row):
    result = dict(row)
    for key in ('record_id', 'project_id', 'card_revision_id', 'created_at', 'event_at', 'link_id', 'source_id', 'target_id'):
        if result.get(key) is not None:
            result[key] = result[key].isoformat() if isinstance(result[key], datetime) else str(result[key])
    result.pop('idempotency_key', None)
    result.pop('payload_sha256', None)
    result['verification'] = 'attributed_publication_not_independent_verification'
    return result


def _record(cursor, project, deck, record_id):
    cursor.execute('SELECT * FROM ag_catalog.agent_records WHERE project_id=%s AND deck_id=%s AND record_id=%s',
                   (project, deck, _id(record_id)))
    row = cursor.fetchone()
    if not row:
        raise ApplicationToolError('agentgraph_record_not_found')
    return row


def _project_record(cursor, record):
    rows = execute_fixed_agentgraph_query(cursor, '''
        MATCH (author:Card {projectId:$project, deckId:$deck, cardId:$card})
        MERGE (record:Record {projectId:$project, deckId:$deck, recordId:$id})
        SET record.kind=$kind, record.createdAt=$created, record.eventAt=$event
        MERGE (author)-[:AUTHORED]->(record)
        RETURN record.recordId AS id''',
        {'project': record['project_id'], 'deck': record['deck_id'], 'card': record['card_id'],
         'id': record['record_id'], 'kind': record['record_kind'],
         'created': record['created_at'], 'event': record['event_at']}, 'id agtype')
    if len(rows) != 1:
        raise ApplicationToolError('agentgraph_author_projection_unavailable')


def _project(records, link=None):
    """Independent transaction: an AGE failure cannot undo committed content."""
    try:
        with connect_postgres(autocommit=False) as connection, connection.cursor(row_factory=dict_row) as cursor:
            cursor.execute("LOAD 'age'")
            cursor.execute('SET LOCAL search_path=ag_catalog,public')
            for record in records:
                _project_record(cursor, record)
            if link:
                if link['relation'] not in RELATIONS:
                    raise ApplicationToolError('agentgraph_relation_invalid')
                rows = execute_fixed_agentgraph_query(cursor, f'''
                    MATCH (source:Record {{projectId:$project, deckId:$deck, recordId:$source}}),
                          (target:Record {{projectId:$project, deckId:$deck, recordId:$target}})
                    MERGE (source)-[edge:{link['relation']} {{linkId:$id}}]->(target)
                    SET edge.authorCardId=$card, edge.createdAt=$created
                    RETURN edge.linkId AS id''',
                    {'project': link['project_id'], 'deck': link['deck_id'], 'source': link['source_id'],
                     'target': link['target_id'], 'id': link['link_id'], 'card': link['card_id'],
                     'created': link['created_at']}, 'id agtype')
                if len(rows) != 1:
                    raise ApplicationToolError('agentgraph_link_projection_unavailable')
            connection.commit()
        return {'status': 'projected'}
    except Exception:
        return {'status': 'failed', 'limitation': 'Content is saved in PostgreSQL; its optional AGE graph link failed. Retry the same publication or link to retry projection.'}


def publish(*, project, deck, card, kind, content, details, sources, event_at, key, execution=None):
    kind, content, key = _text(kind, 'kind', 80), _text(content, 'content', 32000), _text(key, 'idempotency_key', 160)
    if not isinstance(details, dict) or not isinstance(sources, list) or len(sources) > 32:
        raise ApplicationToolError('agentgraph_record_details_invalid')
    if any(not isinstance(ref, str) or not ref.strip() or len(ref) > 4096 for ref in sources):
        raise ApplicationToolError('agentgraph_source_references_invalid')
    if event_at is not None:
        try:
            stamp = datetime.fromisoformat(event_at.replace('Z', '+00:00'))
            if stamp.tzinfo is None:
                raise ValueError()
            event_at = stamp.isoformat()
        except (AttributeError, TypeError, ValueError):
            raise ApplicationToolError('agentgraph_event_time_requires_timezone') from None
    payload = {'kind': kind, 'content': content, 'details': details, 'sources': sources, 'event_at': event_at}
    try:
        encoded = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(',', ':'), allow_nan=False)
    except (TypeError, ValueError):
        raise ApplicationToolError('agentgraph_record_json_invalid') from None
    if len(encoded.encode('utf-8')) > 128000:
        raise ApplicationToolError('agentgraph_record_size_exceeded')
    digest = hashlib.sha256(encoded.encode('utf-8')).hexdigest()
    with connect_postgres(autocommit=False) as connection, connection.cursor(row_factory=dict_row) as cursor:
        authority = _scope(cursor, project, deck, card, 'agentgraph.publish')
        if execution is not None and execution.get('profile') != authority['runtime_profile']:
            raise ApplicationToolError('hermes_execution_profile_mismatch')
        cursor.execute('''INSERT INTO ag_catalog.agent_records
            (record_id,project_id,deck_id,card_id,card_revision_id,record_kind,content,details,source_references,
             source_execution,event_at,idempotency_key,payload_sha256)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s::jsonb,%s::jsonb,%s::jsonb,%s,%s,%s)
            ON CONFLICT (project_id,deck_id,card_id,idempotency_key) DO NOTHING RETURNING *''',
            (str(uuid4()), project, deck, card, authority['current_revision_id'], kind, content,
             json.dumps(details, allow_nan=False), json.dumps(sources),
             json.dumps(execution) if execution is not None else None, event_at, key, digest))
        row = cursor.fetchone()
        created = row is not None
        if row is None:
            cursor.execute('SELECT * FROM ag_catalog.agent_records WHERE project_id=%s AND deck_id=%s AND card_id=%s AND idempotency_key=%s',
                           (project, deck, card, key))
            row = cursor.fetchone()
            if row is None or row['payload_sha256'] != digest:
                raise ApplicationToolError('agentgraph_idempotency_conflict')
        record = _public(row)
        connection.commit()
    return {'ok': True, 'saved': True, 'created': created, 'record': record, 'graphProjection': _project([record])}


def read(*, project, deck, card, record_id):
    with connect_postgres(autocommit=False) as connection, connection.cursor(row_factory=dict_row) as cursor:
        cursor.execute('SET TRANSACTION READ ONLY')
        _scope(cursor, project, deck, card, 'agentgraph.read')
        record = _public(_record(cursor, project, deck, record_id))
        cursor.execute('''SELECT * FROM ag_catalog.agent_record_links WHERE project_id=%s AND deck_id=%s
            AND (source_id=%s OR target_id=%s) ORDER BY created_at,link_id LIMIT 101''',
            (project, deck, record['record_id'], record['record_id']))
        links = cursor.fetchall()
        return {'ok': True, 'record': record, 'links': [_public(row) for row in links[:100]],
                'linksTruncated': len(links) > 100,
                'linkLimit': 100, 'note': 'A retained publication is attributed evidence, not proof that its claims or execution status are true.'}


def search(*, project, deck, card, query, limit=10):
    _text(query, 'query', 2000)
    if type(limit) is not int or not 1 <= limit <= 50:
        raise ApplicationToolError('agentgraph_limit_invalid')
    with connect_postgres(autocommit=False) as connection, connection.cursor(row_factory=dict_row) as cursor:
        cursor.execute('SET TRANSACTION READ ONLY')
        _scope(cursor, project, deck, card, 'agentgraph.search')
        cursor.execute('''SELECT * FROM ag_catalog.agent_records WHERE project_id=%s AND deck_id=%s
            AND to_tsvector('simple',content) @@ plainto_tsquery('simple',%s)
            ORDER BY created_at DESC,record_id LIMIT %s''', (project, deck, query, limit))
        return {'ok': True, 'records': [_public(row) for row in cursor.fetchall()],
                'ordering': 'newest_matching_publications', 'limit': limit}


def link(*, project, deck, card, source_id, target_id, relation):
    source_id, target_id = _id(source_id), _id(target_id)
    if source_id == target_id or relation not in RELATIONS:
        raise ApplicationToolError('agentgraph_link_invalid')
    with connect_postgres(autocommit=False) as connection, connection.cursor(row_factory=dict_row) as cursor:
        authority = _scope(cursor, project, deck, card, 'agentgraph.link')
        records = [_public(_record(cursor, project, deck, value)) for value in (source_id, target_id)]
        cursor.execute('''INSERT INTO ag_catalog.agent_record_links
            (link_id,project_id,deck_id,card_id,card_revision_id,source_id,target_id,relation)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s)
            ON CONFLICT (project_id,deck_id,card_id,source_id,target_id,relation) DO NOTHING RETURNING *''',
            (str(uuid4()), project, deck, card, authority['current_revision_id'], source_id, target_id, relation))
        row = cursor.fetchone()
        if row is None:
            cursor.execute('''SELECT * FROM ag_catalog.agent_record_links WHERE project_id=%s AND deck_id=%s
                AND card_id=%s AND source_id=%s AND target_id=%s AND relation=%s''',
                (project, deck, card, source_id, target_id, relation))
            row = cursor.fetchone()
        result = _public(row)
        connection.commit()
    return {'ok': True, 'saved': True, 'link': result, 'graphProjection': _project(records, result)}
