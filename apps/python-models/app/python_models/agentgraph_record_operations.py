"""Optional team-data operations in the existing application catalog."""
# Entity: AgentGraph
# Relationship: Exposes independently granted publish/read/search/link tools with authenticated authorship and optional Hermes provenance, never a prerequisite for agent work.
# Entity: Tool Catalog
# Relationship: Defines the generic shared-record schemas and failure receipts without granting tools to any saved Card automatically.

import asyncio

import psycopg

from app.python_models import agentgraph_records as records
from app.python_models.operation_definition import OperationDefinition


async def _call(function, **arguments):
    try:
        return await asyncio.to_thread(function, **arguments)
    except psycopg.Error:
        return {'ok': False, 'saved': None, 'failureCode': 'agentgraph_storage_unavailable',
                'message': 'Record persistence is not confirmed. Continue otherwise authorized work. Retry the same publication key or exact link before assuming it saved.'}


async def publish_record(kind, content, idempotencyKey, details=None, sourceReferences=None, eventAt=None,
                         *, projectId, deckId, _callerCardId, _sourceExecution=None):
    return await _call(records.publish, project=projectId, deck=deckId, card=_callerCardId,
        kind=kind, content=content, details={} if details is None else details,
        sources=[] if sourceReferences is None else sourceReferences, event_at=eventAt,
        key=idempotencyKey, execution=_sourceExecution)


async def read_record(recordId, *, projectId, deckId, _callerCardId):
    return await _call(records.read, project=projectId, deck=deckId, card=_callerCardId, record_id=recordId)


async def search_records(query, limit=10, *, projectId, deckId, _callerCardId):
    return await _call(records.search, project=projectId, deck=deckId, card=_callerCardId, query=query, limit=limit)


async def link_records(sourceId, targetId, relation, *, projectId, deckId, _callerCardId):
    return await _call(records.link, project=projectId, deck=deckId, card=_callerCardId,
                       source_id=sourceId, target_id=targetId, relation=relation)


def record_operation_definitions():
    identifier = {'type': 'string', 'format': 'uuid'}
    definitions = [
        ('publish', publish_record, 'Publish a shared team record',
         'Optionally publish one human-readable work product in this Project/team. Incomplete proposals are valid. '
         'No Trade Job, Run, other record, fixed sequence or journal is required. Attribution comes from this saved Card. '
         'Original content is immutable; corrections are new publications linked with SUPERSEDES. Reuse idempotencyKey only for the exact same content. '
         'details may retain equity/ETF, options/multileg, futures, forex, crypto or prediction-market specifics, or non-Trading work. '
         'PROPOSED is an idea; SUBMITTED is not filled; PARTIALLY_FILLED is not a complete IMPLEMENTED position. '
         'Only authoritative execution evidence supports implemented quantities/prices; missing evidence stays unknown. '
         'Publication, a claimed state or an EXECUTED_AS link does not verify a claim or grant execution authority. '
         'Do not mirror complete conversations or publish credentials. Failure to save never prohibits normal work.',
         {'kind': {'type': 'string', 'minLength': 1, 'maxLength': 80},
          'content': {'type': 'string', 'minLength': 1, 'maxLength': 32000},
          'details': {'type': ['object', 'null']},
          'sourceReferences': {'type': ['array', 'null'], 'maxItems': 32,
                               'items': {'type': 'string', 'minLength': 1, 'maxLength': 4096}},
          'eventAt': {'type': ['string', 'null'], 'format': 'date-time',
                      'description': 'Actual source event time if known, not a fabricated completion time.'},
          'idempotencyKey': {'type': 'string', 'minLength': 1, 'maxLength': 160}},
         ['kind', 'content', 'idempotencyKey']),
        ('read', read_record, 'Read a shared team record',
         'Read one exact Project/team publication and its bounded links. Content is an attributed claim, not automatically verified truth. '
         'Read superseding links to inspect corrections; the original remains intact. No transcript or credentials are returned.',
         {'recordId': identifier}, ['recordId']),
        ('search', search_records, 'Search shared team records',
         'Optional PostgreSQL full-text search of this Project/team content, newest matching publications first. '
         'No semantic ranking or fact verification is implied. Search does not run agents.',
         {'query': {'type': 'string', 'minLength': 1, 'maxLength': 2000},
          'limit': {'type': 'integer', 'minimum': 1, 'maximum': 50, 'default': 10}}, ['query']),
        ('link', link_records, 'Link shared team records',
         'Optionally append an attributed relation between two existing records in this Project/team. '
         'sourceId is the supporting/challenging/evaluating/new correction record; targetId is the work it concerns. '
         'SUPERSEDES preserves both originals. EXECUTED_AS should point only to an authoritative execution receipt, never a proposal or unfilled order. '
         'A link does not independently verify content. PostgreSQL content survives an optional AGE projection failure.',
         {'sourceId': identifier, 'targetId': identifier, 'relation': {'type': 'string', 'enum': list(records.RELATIONS)}},
         ['sourceId', 'targetId', 'relation']),
    ]
    return [OperationDefinition(
        canonical_id='agentgraph.' + name, title=title, description=description,
        parameters_schema={'type': 'object', 'properties': properties, 'required': required, 'additionalProperties': False},
        output_schema={'type': 'object'}, handler=handler, available=True,
        publishers=frozenset({'internal-plugin'}), access='write' if name in {'publish', 'link'} else 'read',
        namespace='agentgraph', grant_eligible=True, external_source_id='python_runtime',
        annotations={'readOnlyHint': name in {'read', 'search'}, 'destructiveHint': False,
                     'idempotentHint': True, 'openWorldHint': False},
        dispatcher_context_arguments=frozenset({'projectId', 'deckId', '_callerCardId'} |
                                               ({'_sourceExecution'} if name == 'publish' else set())),
        requires_execution_reference=name != 'publish',
    ) for name, handler, title, description, properties, required in definitions]
