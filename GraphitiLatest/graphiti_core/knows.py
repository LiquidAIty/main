"""First-class sourced Knows built on Graphiti episodes."""

from __future__ import annotations

import hashlib
import json
import unicodedata
from typing import Literal
from uuid import UUID, uuid5

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from graphiti_core.driver.driver import GraphDriver, GraphProvider
from graphiti_core.edges import Edge
from graphiti_core.errors import EdgeNotFoundError, NodeNotFoundError
from graphiti_core.graphiti_types import GraphitiClients
from graphiti_core.helpers import parse_db_date
from graphiti_core.nodes import EntityNode, EpisodeType, EpisodicNode
from graphiti_core.utils.datetime_utils import utc_now


KNOW_UUID_NAMESPACE = UUID('20c4bb9b-2662-46f8-83b6-a9f8a2e18342')
ABOUT_UUID_NAMESPACE = UUID('ddfd602d-a861-4490-bf4a-ef06556c0485')


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


class AboutEdge(Edge):
    """The one explicit Entity attachment owned by a Know."""

    entity_created: bool = False

    async def save(self, driver: GraphDriver):
        if driver.provider == GraphProvider.KUZU:
            raise NotImplementedError('Know storage is not available for Kuzu')
        records, _, _ = await driver.execute_query(
            """
            MATCH (know:Episodic:Know {uuid: $know_uuid})
            MATCH (entity:Entity {uuid: $entity_uuid})
            WHERE know.group_id = $group_id AND entity.group_id = $group_id
            MERGE (know)-[about:ABOUT]->(entity)
            ON CREATE SET about.uuid = $uuid,
                          about.group_id = $group_id,
                          about.created_at = $created_at,
                          about.entity_created = $entity_created
            RETURN about.uuid AS uuid
            """,
            know_uuid=self.source_node_uuid,
            entity_uuid=self.target_node_uuid,
            uuid=self.uuid,
            group_id=self.group_id,
            created_at=self.created_at,
            entity_created=self.entity_created,
        )
        if not records:
            raise RuntimeError('Know ABOUT attachment could not be stored')
        return records

    async def delete(self, driver: GraphDriver):
        records, _, _ = await driver.execute_query(
            """
            MATCH (:Episodic:Know)-[about:ABOUT {uuid: $uuid}]->(:Entity)
            DELETE about
            RETURN $uuid AS uuid
            """,
            uuid=self.uuid,
        )
        if not records:
            raise EdgeNotFoundError(self.uuid)
        return records


class KnowNode(EpisodicNode):
    """A durable, searchable, cited observation attached to one Entity."""

    entity_uuid: str = Field(min_length=1)
    observation: str = Field(min_length=1, max_length=8000)
    interpretation: str = Field(min_length=1, max_length=8000)
    citation: KnowCitation
    direction: KnowDirection | None = None
    content_hash: str = Field(min_length=64, max_length=64)
    entity_created: bool = False
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
        if 'Know' not in self.labels:
            self.labels.append('Know')
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
        return cls(
            **episode.model_dump(),
            entity_uuid=entity_uuid,
            observation=observation,
            interpretation=interpretation,
            citation=citation,
            direction=direction,
            content_hash=content_hash,
        )

    async def save_know(self, driver: GraphDriver, about_edge: AboutEdge) -> None:
        """Promote the stored episode to a Know and add its sole ABOUT edge."""

        if driver.provider == GraphProvider.KUZU:
            raise NotImplementedError('Know storage is not available for Kuzu')
        existing, _, _ = await driver.execute_query(
            """
            MATCH (know:Episodic {uuid: $know_uuid})
            OPTIONAL MATCH (know)-[:ABOUT]->(entity:Entity)
            RETURN collect(DISTINCT entity.uuid) AS entity_uuids
            """,
            know_uuid=self.uuid,
            routing_='r',
        )
        attached = {
            str(value)
            for record in existing
            for value in (record.get('entity_uuids') or [])
            if value is not None
        }
        if attached and attached != {self.entity_uuid}:
            raise ValueError('Know is already attached to a different Entity')

        citation = self.citation
        direction = self.direction
        records, _, _ = await driver.execute_query(
            """
            MATCH (know:Episodic {uuid: $know_uuid})
            MATCH (entity:Entity {uuid: $entity_uuid})
            WHERE know.group_id = $group_id AND entity.group_id = $group_id
            SET know:Know,
                know.observation = $observation,
                know.interpretation = $interpretation,
                know.citation_url = $citation_url,
                know.citation_title = $citation_title,
                know.citation_publisher = $citation_publisher,
                know.citation_evidence = $citation_evidence,
                know.citation_locator = $citation_locator,
                know.citation_published_at = $citation_published_at,
                know.citation_event_at = $citation_event_at,
                know.citation_resolved_url = $citation_resolved_url,
                know.citation_retrieved_at = $citation_retrieved_at,
                know.citation_document_title = $citation_document_title,
                know.citation_content_fingerprint = $citation_content_fingerprint,
                know.proposition = $proposition,
                know.direction = $direction,
                know.content_hash = $content_hash,
                know.know_format = 1
            MERGE (know)-[about:ABOUT]->(entity)
            ON CREATE SET about.uuid = $about_uuid,
                          about.group_id = $group_id,
                          about.created_at = $created_at,
                          about.entity_created = $entity_created
            RETURN know.uuid AS uuid, entity.uuid AS entity_uuid, about.uuid AS about_uuid
            """,
            know_uuid=self.uuid,
            entity_uuid=self.entity_uuid,
            group_id=self.group_id,
            observation=self.observation,
            interpretation=self.interpretation,
            citation_url=citation.url,
            citation_title=citation.title,
            citation_publisher=citation.publisher,
            citation_evidence=citation.evidence,
            citation_locator=citation.locator,
            citation_published_at=citation.published_at,
            citation_event_at=citation.event_at,
            citation_resolved_url=citation.resolved_url,
            citation_retrieved_at=citation.retrieved_at,
            citation_document_title=citation.document_title,
            citation_content_fingerprint=citation.content_fingerprint,
            proposition=direction.proposition if direction else None,
            direction=direction.relation if direction else None,
            content_hash=self.content_hash,
            about_uuid=about_edge.uuid,
            created_at=about_edge.created_at,
            entity_created=about_edge.entity_created,
        )
        if len(records) != 1:
            raise RuntimeError('Know could not be stored with one exact Entity attachment')

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
            raise RuntimeError('Know must have exactly one ABOUT Entity')
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
            WHERE entity.uuid = $entity_uuid AND know.group_id = $group_id
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


_KNOW_MATCH = """
    MATCH (know:Episodic:Know)-[about:ABOUT]->(entity:Entity)
    OPTIONAL MATCH (saga:Saga)-[:HAS_EPISODE]->(know)
    WITH know, about, entity, saga
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
    entity.uuid AS entity_uuid,
    about.uuid AS about_uuid,
    coalesce(about.entity_created, false) AS entity_created,
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


def about_uuid(know_id: str, entity_uuid: str) -> str:
    return str(uuid5(ABOUT_UUID_NAMESPACE, f'{know_id}\0{entity_uuid}'))


def know_episode_content(
    *,
    observation: str,
    interpretation: str,
    citation: KnowCitation,
    direction: KnowDirection | None,
) -> str:
    """Build normal episode text for Graphiti extraction and retrieval."""

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
    entity_name: str,
    entity_uuid: str | None,
) -> tuple[EntityNode, bool]:
    """Reuse one exact Entity or create it without semantic target substitution."""

    name = ' '.join(entity_name.split()).strip()
    if not name:
        raise ValueError('entity_name must not be blank')
    driver = clients.driver
    if entity_uuid:
        try:
            entity = await EntityNode.get_by_uuid(driver, entity_uuid)
        except NodeNotFoundError:
            entity = EntityNode(
                uuid=entity_uuid,
                name=name,
                group_id=group_id,
                created_at=utc_now(),
            )
            await entity.generate_name_embedding(clients.embedder)
            await entity.save(driver)
            return entity, True
        if entity.group_id != group_id:
            raise ValueError('entity_uuid belongs to a different group')
        if normalize_entity_name(entity.name) != normalize_entity_name(name):
            raise ValueError('entity_uuid does not match entity_name')
        return entity, False

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
    await entity.save(driver)
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
        source=EpisodeType.from_str(record['source']),
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
        saga_uuid=record.get('saga_uuid'),
        saga_name=record.get('saga_name'),
    )
