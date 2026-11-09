"""First-class cited Knows with one Project-scoped Entity owner."""

from __future__ import annotations

import hashlib
import json
import unicodedata
from datetime import datetime
from typing import Literal
from uuid import UUID, uuid5

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from graphiti_core.driver.driver import GraphDriver, GraphProvider
from graphiti_core.errors import NodeNotFoundError
from graphiti_core.graphiti_types import GraphitiClients
from graphiti_core.driver.record_parsers import entity_node_from_record
from graphiti_core.edges import EntityEdge
from graphiti_core.graph_queries import get_nodes_query
from graphiti_core.helpers import parse_db_date
from graphiti_core.models.nodes.node_db_queries import get_entity_node_return_query
from graphiti_core.nodes import EntityNode, EpisodicNode, Node
from graphiti_core.search.search_utils import fulltext_query
from graphiti_core.utils.datetime_utils import utc_now


KNOW_UUID_NAMESPACE = UUID('20c4bb9b-2662-46f8-83b6-a9f8a2e18342')


class KnowCitation(BaseModel):
    """Inspectable provenance for one sourced Know."""

    url: str = Field(min_length=1, max_length=2048)
    title: str = Field(min_length=1, max_length=1000)
    publisher: str = Field(min_length=1, max_length=1000)
    evidence: str = Field(min_length=20, max_length=12000)
    locator: str | None = Field(default=None, max_length=1000)
    published_at: str | None = Field(default=None, alias='publishedAt', max_length=1000)
    event_at: str | None = Field(default=None, alias='eventAt', max_length=1000)
    resolved_url: str | None = Field(default=None, alias='resolvedUrl', max_length=2048)
    retrieved_at: str | None = Field(default=None, alias='retrievedAt', max_length=1000)
    document_title: str | None = Field(default=None, alias='documentTitle', max_length=1000)
    content_fingerprint: str | None = Field(
        default=None,
        alias='contentFingerprint',
        max_length=128,
    )

    model_config = ConfigDict(
        extra='forbid',
        populate_by_name=True,
        str_strip_whitespace=True,
    )


class KnowDirection(BaseModel):
    """Optional relationship between a Know and one explicit proposition."""

    proposition: str = Field(min_length=1, max_length=4000)
    relation: Literal['supports', 'challenges', 'context']

    model_config = ConfigDict(extra='forbid', str_strip_whitespace=True)


class KnowRelationship(BaseModel):
    """An explicitly authored relationship supported by the submitted Know."""

    source_entity_uuid: str | None = Field(
        default=None, min_length=1,
        description='Omit to use the Entity owning this Know as the source.',
    )
    target_entity_uuid: str = Field(
        min_length=1, description='Exact Graphiti UUID of the target Entity that owns a Know in this Project.',
    )
    fact: str = Field(
        min_length=1,
        description="Authored prose explaining the source Entity's meaningful directed relationship to the target, "
                    "supported by this Know. Jev classifies this prose; do not supply a label, probability, "
                    "generic related-to phrase or mirrored reverse paraphrase. The sentence and source/target "
                    "direction must agree; use source_entity_uuid if the Know's owner is not the source.",
    )

    model_config = ConfigDict(extra='forbid', str_strip_whitespace=True)


class KnowNode(Node):
    """A durable, searchable, cited observation attached to one Entity."""

    source: str = 'text'
    source_description: str
    content: str
    valid_at: datetime
    entity_edges: list[str] = Field(default_factory=list)
    entity_uuid: str = Field(min_length=1)
    observation: str = Field(min_length=1, max_length=8000)
    interpretation: str = Field(min_length=1, max_length=8000)
    citation: KnowCitation
    direction: KnowDirection | None = None
    content_hash: str = Field(min_length=64, max_length=64)
    entity_created: bool = False
    research_origin_think_id: str | None = Field(default=None, min_length=1, max_length=512)
    research_request_version: int | None = Field(default=None, ge=1, strict=True)
    saga_uuid: str | None = None
    saga_name: str | None = None

    @field_validator('entity_uuid', 'observation', 'interpretation')
    @classmethod
    def strip_required_text(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError('value must not be blank')
        return value

    @model_validator(mode='after')
    def require_know_label(self) -> 'KnowNode':
        self.labels[:] = ['Know']
        if bool(self.research_origin_think_id) != (self.research_request_version is not None):
            raise ValueError('Research origin requires both Think ID and request version')
        if self.research_request_version is not None and (
            type(self.research_request_version) is not int or self.research_request_version < 1
        ):
            raise ValueError('Research request version must be a positive integer')
        return self

    @classmethod
    def from_episode(
        cls,
        episode: EpisodicNode,
        *,
        entity_uuid: str,
        observation: str,
        interpretation: str,
        citation: KnowCitation,
        direction: KnowDirection | None,
        content_hash: str,
    ) -> 'KnowNode':
        # Decode an existing legacy object; this does not ingest or promote it.
        values = episode.model_dump()
        values['source'] = episode.source.value
        return cls(
            **values,
            entity_uuid=entity_uuid,
            observation=observation,
            interpretation=interpretation,
            citation=citation,
            direction=direction,
            content_hash=content_hash,
        )

    async def save(self, driver: GraphDriver):
        return await self.save_know(driver)

    def _properties(self) -> dict:
        """The shared storage representation for creation and in-place edits."""
        citation = self.citation
        direction = self.direction
        return {
            'uuid': self.uuid, 'name': self.name, 'group_id': self.group_id,
            'created_at': self.created_at, 'valid_at': self.valid_at,
            'source': self.source, 'source_description': self.source_description,
            'content': self.content, 'entity_edges': self.entity_edges,
            'entity_uuid': self.entity_uuid, 'observation': self.observation,
            'interpretation': self.interpretation, 'content_hash': self.content_hash,
            'citation_url': citation.url, 'citation_title': citation.title,
            'citation_publisher': citation.publisher, 'citation_evidence': citation.evidence,
            'citation_locator': citation.locator, 'citation_published_at': citation.published_at,
            'citation_event_at': citation.event_at, 'citation_resolved_url': citation.resolved_url,
            'citation_retrieved_at': citation.retrieved_at,
            'citation_document_title': citation.document_title,
            'citation_content_fingerprint': citation.content_fingerprint,
            'proposition': direction.proposition if direction else None,
            'direction': direction.relation if direction else None, 'know_format': 3,
            'researchOriginThinkId': self.research_origin_think_id,
            'researchRequestVersion': self.research_request_version,
        }

    async def save_know(
        self, driver: GraphDriver, *, entity: EntityNode | None = None,
        owner_by_name: bool = False, mentions: list[str] | None = None,
        relationships: list[EntityEdge] | None = None,
    ) -> tuple['KnowNode', EntityNode, bool, bool, list[EntityEdge]]:
        """Commit one Know and owner atomically, without episode ingestion."""
        if driver.provider != GraphProvider.NEO4J:
            raise NotImplementedError('Atomic Know writes require Neo4j')
        entity = entity or await EntityNode.get_by_uuid(driver, self.entity_uuid)
        if entity.group_id != self.group_id:
            raise ValueError('Know owner belongs to a different group')
        properties = self._properties()
        properties['entity_uuid'] = entity.uuid
        identity = hashlib.sha256(f'{self.group_id}\0{self.content_hash}'.encode()).hexdigest()
        written_edges: list[EntityEdge] = []
        async with driver.transaction() as tx:
            # Existing legacy Knows remain untouched and retain their IDs/labels.
            result = await tx.run(
                'MATCH (know:Know) WHERE know.uuid=$uuid OR '
                '(know.group_id=$group AND know.content_hash=$digest) '
                'RETURN properties(know) AS properties LIMIT 2',
                uuid=self.uuid, group=self.group_id, digest=self.content_hash,
            )
            rows = await result.data()
            if len(rows) > 1:
                raise ValueError('Know identity is not unique')
            created = False
            if rows:
                existing = rows[0]['properties']
                if existing.get('group_id') != self.group_id or existing.get('content_hash') != self.content_hash:
                    raise ValueError('Know UUID is already used by a different finding')
                stored = _know_from_record(existing)
            else:
                result = await tx.run(
                    'MERGE (know:Know {know_write_key:$identity}) '
                    'ON CREATE SET know += $properties '
                    'RETURN properties(know) AS properties',
                    identity=identity, properties=properties,
                )
                rows = await result.data()
                created = (await result.consume()).counters.nodes_created == 1
                stored = _know_from_record(rows[0]['properties'])

            if self.research_origin_think_id:
                # Reuse an already verified identical finding for an explicitly
                # claimed request without creating a corrected/research copy.
                # A concurrent claimant cannot overwrite an established origin.
                result = await tx.run(
                    'MATCH (know:Know {uuid:$uuid,group_id:$group}) '
                    'SET know.researchOriginThinkId=coalesce(know.researchOriginThinkId,$origin),'
                    'know.researchRequestVersion=coalesce(know.researchRequestVersion,$version) '
                    'RETURN properties(know) AS properties',
                    uuid=stored.uuid, group=self.group_id, origin=self.research_origin_think_id,
                    version=self.research_request_version,
                )
                stored = _know_from_record((await result.data())[0]['properties'])
                if (stored.research_origin_think_id != self.research_origin_think_id
                        or stored.research_request_version != self.research_request_version):
                    raise ValueError('Existing Know has different research provenance; do not duplicate or overwrite it')
            owner_created = False
            if not created:
                result = await tx.run(
                    'MATCH (n:Entity {uuid:$uuid,group_id:$group}) RETURN '
                    + get_entity_node_return_query(driver.provider),
                    uuid=stored.entity_uuid, group=self.group_id,
                )
            else:
                selector = (
                    'toLower(trim(n.name))=toLower(trim($name))' if owner_by_name
                    else 'n.uuid=$uuid'
                )
                result = await tx.run(
                    'MATCH (n:Entity) WHERE n.group_id=$group AND ' + selector
                    + ' RETURN ' + get_entity_node_return_query(driver.provider) + ' LIMIT 2',
                    group=self.group_id, name=entity.name, uuid=entity.uuid,
                )
            owners = await result.data()
            if len(owners) > 1:
                raise ValueError('entity_name is ambiguous; provide entity_uuid')
            if owners:
                owner = entity_node_from_record(owners[0])
            elif not created:
                raise ValueError('Stored Know owner is unavailable')
            else:
                owner_identity = ('name:' + normalize_entity_name(entity.name)) if owner_by_name else ('uuid:' + entity.uuid)
                owner_key = hashlib.sha256(f'{self.group_id}\0{owner_identity}'.encode()).hexdigest()
                result = await tx.run(
                    'MERGE (n:Entity {know_owner_key:$identity}) '
                    'ON CREATE SET n.uuid=$uuid,n.name=$name,n.group_id=$group,'
                    'n.created_at=$created,n.summary=$summary,n.name_embedding=$embedding '
                    'RETURN ' + get_entity_node_return_query(driver.provider),
                    identity=owner_key, uuid=entity.uuid, name=entity.name, group=self.group_id,
                    created=entity.created_at, summary=entity.summary, embedding=entity.name_embedding,
                )
                owner = entity_node_from_record((await result.data())[0])
                owner_created = (await result.consume()).counters.nodes_created == 1
            if normalize_entity_name(owner.name) != normalize_entity_name(entity.name):
                raise ValueError('Know owner identity does not match its name')
            if not owner_by_name and owner.uuid != entity.uuid:
                raise ValueError('Know is already attached to a different Entity')
            if created:
                result = await tx.run(
                    'MATCH (know:Know {uuid:$uuid,group_id:$group}) '
                    'SET know.entity_uuid=$owner,know.entity_created=$created '
                    'RETURN properties(know) AS properties',
                    uuid=stored.uuid, group=self.group_id, owner=owner.uuid, created=owner_created,
                )
                stored = _know_from_record((await result.data())[0]['properties'])

            # Names do nothing. Only explicitly supplied IDs can become references.
            for target in dict.fromkeys(mentions or []):
                if target == owner.uuid:
                    continue
                await tx.run(
                    'MATCH (know:Know {uuid:$know,group_id:$group}),(target:Entity {uuid:$target,group_id:$group}) '
                    'WHERE EXISTS { MATCH (support:Know {group_id:$group}) WHERE support.entity_uuid=target.uuid } '
                    'MERGE (know)-[m:MENTIONS {uuid:$uuid}]->(target) '
                    'ON CREATE SET m.group_id=$group,m.created_at=$created',
                    know=stored.uuid, group=self.group_id, target=target, created=self.created_at,
                    uuid=str(uuid5(KNOW_UUID_NAMESPACE, f'mention\0{stored.uuid}\0{target}')),
                )
            for edge in relationships or []:
                # A concurrently resolved owner may replace the prepared new Entity.
                if edge.source_node_uuid == entity.uuid:
                    edge.source_node_uuid = owner.uuid
                if edge.target_node_uuid == entity.uuid:
                    edge.target_node_uuid = owner.uuid
                endpoints = {edge.source_node_uuid, edge.target_node_uuid}
                result = await tx.run(
                    'MATCH (n:Entity) WHERE n.uuid IN $ids AND n.group_id=$group '
                    'AND EXISTS { MATCH (support:Know {group_id:$group}) WHERE support.entity_uuid=n.uuid } '
                    'RETURN n.uuid AS uuid', ids=list(endpoints), group=self.group_id,
                )
                if len(endpoints) != 2 or {r['uuid'] for r in await result.data()} != endpoints:
                    raise ValueError('Relationship endpoints must own Knows in this Project')
                edge.uuid = str(uuid5(KNOW_UUID_NAMESPACE,
                    f'relationship\0{stored.uuid}\0{edge.source_node_uuid}\0{edge.target_node_uuid}\0{edge.fact}'))
                edge.attributes['supporting_know_uuids'] = [stored.uuid]
                result = await tx.run('MATCH ()-[r:RELATES_TO {uuid:$uuid}]->() RETURN r.uuid AS uuid', uuid=edge.uuid)
                if await result.data():
                    continue
                await driver.entity_edge_ops.save(driver, edge, tx=tx)
                written_edges.append(edge)
            if written_edges:
                ids = list(dict.fromkeys(stored.entity_edges + [edge.uuid for edge in written_edges]))
                await tx.run('MATCH (know:Know {uuid:$uuid,group_id:$group}) SET know.entity_edges=$ids',
                             uuid=stored.uuid, group=self.group_id, ids=ids)
                stored.entity_edges = ids
        return stored, owner, created, owner_created, written_edges

    @classmethod
    async def update_know(
        cls, driver: GraphDriver, uuid: str, *, group_id: str,
        name: str | None = None, observation: str | None = None,
        interpretation: str | None = None, citation: KnowCitation | None = None,
    ) -> 'KnowNode':
        """Edit one exact Know in place, retaining its ownership and graph links."""
        if driver.provider != GraphProvider.NEO4J:
            raise NotImplementedError('Atomic Know writes require Neo4j')
        async with driver.transaction() as tx:
            # Lock before reading so disjoint partial edits do not lose each other.
            result = await tx.run(
                'MATCH (know:Know {uuid:$uuid,group_id:$group}) '
                'SET know.content_hash=know.content_hash '
                'RETURN properties(know) AS properties', uuid=uuid, group=group_id,
            )
            rows = await result.data()
            if len(rows) != 1:
                raise NodeNotFoundError(uuid)
            current = _know_from_record(rows[0]['properties'])
            result = await tx.run(
                'MATCH (owner:Entity {uuid:$owner,group_id:$group}) RETURN owner.name AS name',
                owner=current.entity_uuid, group=group_id,
            )
            owners = await result.data()
            if len(owners) != 1:
                raise ValueError('Stored Know owner is unavailable')
            values = current.model_dump()
            for key, value in dict(name=name, observation=observation,
                                   interpretation=interpretation, citation=citation).items():
                if value is not None:
                    values[key] = value
            edited = cls.model_validate(values)
            edited.content_hash = know_content_hash(
                entity_name=owners[0]['name'], observation=edited.observation,
                interpretation=edited.interpretation, citation=edited.citation,
                direction=edited.direction,
            )
            edited.content = know_episode_content(
                observation=edited.observation, interpretation=edited.interpretation,
                citation=edited.citation, direction=edited.direction,
            )
            edited.source_description = f'{edited.citation.publisher}: {edited.citation.title}'
            result = await tx.run(
                'MATCH (other:Know {group_id:$group,content_hash:$digest}) '
                'WHERE other.uuid<>$uuid RETURN other.uuid AS uuid LIMIT 1',
                group=group_id, digest=edited.content_hash, uuid=uuid,
            )
            if await result.data():
                raise ValueError('Edited finding duplicates another Know')
            identity = hashlib.sha256(f'{group_id}\0{edited.content_hash}'.encode()).hexdigest()
            await tx.run(
                'MATCH (know:Know {uuid:$uuid,group_id:$group}) '
                'SET know += $properties,know.know_write_key=$identity',
                uuid=uuid, group=group_id, properties=edited._properties(), identity=identity,
            )
        return edited

    @classmethod
    async def remove_know(cls, driver: GraphDriver, uuid: str, *, group_id: str) -> None:
        """Remove an explicitly selected Know and only its unsupported relationships."""
        if driver.provider != GraphProvider.NEO4J:
            raise NotImplementedError('Atomic Know writes require Neo4j')
        async with driver.transaction() as tx:
            result = await tx.run(
                'MATCH (know:Know {uuid:$uuid,group_id:$group}) RETURN know.uuid AS uuid',
                uuid=uuid, group=group_id,
            )
            if len(await result.data()) != 1:
                raise NodeNotFoundError(uuid)
            await tx.run(
                'MATCH ()-[r:RELATES_TO {group_id:$group}]->() '
                'WHERE $uuid IN coalesce(r.supporting_know_uuids,[]) '
                'AND all(id IN r.supporting_know_uuids WHERE id=$uuid) '
                'AND size(coalesce(r.episodes,[]))=0 DELETE r', uuid=uuid, group=group_id,
            )
            await tx.run(
                'MATCH ()-[r:RELATES_TO {group_id:$group}]->() '
                'WHERE $uuid IN coalesce(r.supporting_know_uuids,[]) '
                'SET r.supporting_know_uuids=[id IN r.supporting_know_uuids WHERE id<>$uuid]',
                uuid=uuid, group=group_id,
            )
            await tx.run('MATCH (know:Know {uuid:$uuid,group_id:$group}) DETACH DELETE know',
                         uuid=uuid, group=group_id)

    @classmethod
    async def get_by_uuid(cls, driver: GraphDriver, uuid: str) -> 'KnowNode':
        records, _, _ = await driver.execute_query(
            _KNOW_MATCH + ' WHERE know.uuid = $uuid RETURN ' + _KNOW_RETURN,
            uuid=uuid,
            routing_='r',
        )
        knows = [_know_from_record(record) for record in records]
        if not knows:
            raise NodeNotFoundError(uuid)
        if len(knows) != 1:
            raise RuntimeError('Know identity is not unique')
        return knows[0]

    @classmethod
    async def get_by_uuids(cls, driver: GraphDriver, uuids: list[str]) -> list['KnowNode']:
        if not uuids:
            return []
        records, _, _ = await driver.execute_query(
            _KNOW_MATCH + ' WHERE know.uuid IN $uuids RETURN ' + _KNOW_RETURN,
            uuids=uuids,
            routing_='r',
        )
        by_uuid = {know.uuid: know for know in map(_know_from_record, records)}
        return [by_uuid[uuid] for uuid in uuids if uuid in by_uuid]

    @classmethod
    async def get_by_entity_uuid(
        cls,
        driver: GraphDriver,
        entity_uuid: str,
        *,
        group_id: str,
        limit: int = 10,
    ) -> list['KnowNode']:
        records, _, _ = await driver.execute_query(
            _KNOW_MATCH
            + """
            WHERE know.entity_uuid = $entity_uuid AND know.group_id = $group_id
            RETURN
            """
            + _KNOW_RETURN
            + """
            ORDER BY know.valid_at DESC, know.created_at DESC, know.uuid DESC
            LIMIT $limit
            """,
            entity_uuid=entity_uuid,
            group_id=group_id,
            limit=limit,
            routing_='r',
        )
        return [_know_from_record(record) for record in records]

    @classmethod
    async def get_by_research_origin(cls, driver: GraphDriver, *, group_id: str,
                                     think_id: str, version: int) -> list['KnowNode']:
        records, _, _ = await driver.execute_query(
            _KNOW_MATCH + ' WHERE know.group_id=$group AND know.researchOriginThinkId=$think '
            'AND know.researchRequestVersion=$version RETURN ' + _KNOW_RETURN,
            group=group_id, think=think_id, version=version, routing_='r',
        )
        return [_know_from_record(record) for record in records]

    @classmethod
    async def get_by_content_hash(
        cls,
        driver: GraphDriver,
        *,
        group_id: str,
        content_hash: str,
    ) -> 'KnowNode | None':
        records, _, _ = await driver.execute_query(
            _KNOW_MATCH
            + """
            WHERE know.group_id = $group_id AND know.content_hash = $content_hash
            RETURN
            """
            + _KNOW_RETURN
            + ' LIMIT 2',
            group_id=group_id,
            content_hash=content_hash,
            routing_='r',
        )
        knows = [_know_from_record(record) for record in records]
        if len(knows) > 1:
            raise RuntimeError('Know content identity is not unique')
        return knows[0] if knows else None

    @classmethod
    async def search(cls, driver: GraphDriver, query: str, *, group_id: str, limit: int) -> list['KnowNode']:
        query = fulltext_query(query, [group_id], driver)
        if not query:
            return []
        records, _, _ = await driver.execute_query(
            get_nodes_query('know_content', '$query', limit=limit, provider=driver.provider)
            + ' YIELD node AS know, score WHERE know.group_id=$group '
              'WITH know, score OPTIONAL MATCH (saga:Saga)-[:HAS_EPISODE]->(know) '
              'RETURN ' + _KNOW_RETURN + ' ORDER BY score DESC LIMIT $limit',
            query=query, group=group_id, limit=limit, routing_='r',
        )
        return [_know_from_record(record) for record in records]


_KNOW_MATCH = """
    MATCH (know:Know)
    OPTIONAL MATCH (saga:Saga)-[:HAS_EPISODE]->(know)
    WITH know, saga
"""

_KNOW_RETURN = """
    know.uuid AS uuid,
    know.name AS name,
    know.group_id AS group_id,
    know.created_at AS created_at,
    know.source AS source,
    know.source_description AS source_description,
    know.content AS content,
    know.valid_at AS valid_at,
    know.entity_edges AS entity_edges,
    know.observation AS observation,
    know.interpretation AS interpretation,
    know.citation_url AS citation_url,
    know.citation_title AS citation_title,
    know.citation_publisher AS citation_publisher,
    know.citation_evidence AS citation_evidence,
    know.citation_locator AS citation_locator,
    know.citation_published_at AS citation_published_at,
    know.citation_event_at AS citation_event_at,
    know.citation_resolved_url AS citation_resolved_url,
    know.citation_retrieved_at AS citation_retrieved_at,
    know.citation_document_title AS citation_document_title,
    know.citation_content_fingerprint AS citation_content_fingerprint,
    know.proposition AS proposition,
    know.direction AS direction,
    know.content_hash AS content_hash,
    know.entity_uuid AS entity_uuid,
    know.researchOriginThinkId AS researchOriginThinkId,
    know.researchRequestVersion AS researchRequestVersion,
    coalesce(know.entity_created, false) AS entity_created,
    saga.uuid AS saga_uuid,
    saga.name AS saga_name
"""


def normalize_entity_name(value: str) -> str:
    return ' '.join(unicodedata.normalize('NFKC', value).split()).casefold()


def know_content_hash(
    *,
    entity_name: str,
    observation: str,
    interpretation: str,
    citation: KnowCitation,
    direction: KnowDirection | None,
) -> str:
    """Return the portable content identity without storing a JSON envelope."""

    citation_identity = citation.model_dump(by_alias=True, exclude_none=True)
    citation_identity.pop('retrievedAt', None)
    canonical = {
        'entity_name': normalize_entity_name(entity_name),
        'observation': observation.strip(),
        'interpretation': interpretation.strip(),
        'citation': citation_identity,
        'direction': direction.model_dump() if direction else None,
    }
    return hashlib.sha256(
        json.dumps(canonical, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode(
            'utf-8'
        )
    ).hexdigest()


def know_uuid(group_id: str, entity_name: str, content_hash: str) -> str:
    return str(
        uuid5(
            KNOW_UUID_NAMESPACE,
            f'{group_id}\0{normalize_entity_name(entity_name)}\0{content_hash}',
        )
    )


def know_episode_content(
    *,
    observation: str,
    interpretation: str,
    citation: KnowCitation,
    direction: KnowDirection | None,
) -> str:
    """Build plain searchable Know text; never send it through extraction."""

    parts = [
        f'Observation: {observation.strip()}',
        f'Interpretation: {interpretation.strip()}',
        f'Evidence: {citation.evidence}',
        f'Citation title: {citation.title}',
        f'Citation publisher: {citation.publisher}',
    ]
    if citation.locator:
        parts.append(f'Citation locator: {citation.locator}')
    if citation.published_at:
        parts.append(f'Published at: {citation.published_at}')
    if citation.event_at:
        parts.append(f'Event at: {citation.event_at}')
    if direction:
        parts.extend(
            (
                f'Proposition: {direction.proposition}',
                f'Direction: {direction.relation}',
            )
        )
    return '\n\n'.join(parts)


async def resolve_know_entity(
    clients: GraphitiClients,
    *,
    group_id: str,
    entity_name: str | None,
    entity_uuid: str | None,
) -> tuple[EntityNode, bool]:
    """Resolve an exact owner or prepare it without committing an empty Entity."""

    name = ' '.join((entity_name or '').split()).strip()
    driver = clients.driver
    if entity_uuid:
        try:
            entity = await EntityNode.get_by_uuid(driver, entity_uuid)
        except NodeNotFoundError:
            if not name:
                raise
            entity = EntityNode(
                uuid=entity_uuid,
                name=name,
                group_id=group_id,
                created_at=utc_now(),
            )
            await entity.generate_name_embedding(clients.embedder)
            return entity, True
        if entity.group_id != group_id:
            raise ValueError('entity_uuid belongs to a different group')
        if name and normalize_entity_name(entity.name) != normalize_entity_name(name):
            raise ValueError('entity_uuid does not match entity_name')
        return entity, False

    if not name:
        raise ValueError('Provide entity_uuid or entity_name for the Know owner')
    records, _, _ = await driver.execute_query(
        """
        MATCH (entity:Entity)
        WHERE entity.group_id = $group_id
          AND toLower(trim(entity.name)) = toLower(trim($entity_name))
        RETURN entity.uuid AS uuid
        ORDER BY entity.uuid
        LIMIT 2
        """,
        group_id=group_id,
        entity_name=name,
        routing_='r',
    )
    entity_ids = [str(record['uuid']) for record in records if record.get('uuid')]
    if len(entity_ids) > 1:
        raise ValueError('entity_name is ambiguous; provide entity_uuid')
    if entity_ids:
        return await EntityNode.get_by_uuid(driver, entity_ids[0]), False

    entity = EntityNode(name=name, group_id=group_id, created_at=utc_now())
    await entity.generate_name_embedding(clients.embedder)
    return entity, True


def _know_from_record(record: dict) -> KnowNode:
    created_at = parse_db_date(record['created_at'])
    valid_at = parse_db_date(record['valid_at'])
    if created_at is None or valid_at is None:
        raise ValueError('Know timestamps must not be null')
    citation = KnowCitation(
        url=record['citation_url'],
        title=record['citation_title'],
        publisher=record['citation_publisher'],
        evidence=record['citation_evidence'],
        locator=record.get('citation_locator'),
        publishedAt=record.get('citation_published_at'),
        eventAt=record.get('citation_event_at'),
        resolvedUrl=record.get('citation_resolved_url'),
        retrievedAt=record.get('citation_retrieved_at'),
        documentTitle=record.get('citation_document_title'),
        contentFingerprint=record.get('citation_content_fingerprint'),
    )
    direction = (
        KnowDirection(
            proposition=record['proposition'],
            relation=record['direction'],
        )
        if record.get('proposition') and record.get('direction')
        else None
    )
    return KnowNode(
        uuid=record['uuid'],
        name=record['name'],
        group_id=record['group_id'],
        labels=['Know'],
        created_at=created_at,
        source=str(record.get('source') or 'text'),
        source_description=record['source_description'],
        content=record['content'],
        valid_at=valid_at,
        entity_edges=record.get('entity_edges') or [],
        entity_uuid=record['entity_uuid'],
        observation=record['observation'],
        interpretation=record['interpretation'],
        citation=citation,
        direction=direction,
        content_hash=record['content_hash'],
        entity_created=bool(record.get('entity_created', False)),
        research_origin_think_id=record.get('researchOriginThinkId'),
        research_request_version=record.get('researchRequestVersion'),
        saga_uuid=record.get('saga_uuid'),
        saga_name=record.get('saga_name'),
    )
