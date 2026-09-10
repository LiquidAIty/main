# Publishing Reusable Skills

@skill id=knowgraph-skill-ingestion
@type Skill
@status active
@related_to skillgraph

Historical filename and skill ID retained during recovery from `2ddadeeb^`, September 9, 2026.
The former Neo4j SkillGraph importer is not an active publication path. This skill now covers
making an intentionally maintained procedure available through the existing file/profile owner.

Direct-read the changed skill and its callers. Preserve the reusable lesson and scope; remove
obsolete commands only after checking the current owner. Validate referenced paths, tool names
and examples. Record unsupported behavior as unproven rather than inventing an implementation.

Repository coding procedures live in `skills/*.md`. A saved Hermes Card's skill selection and
native profile own its runtime skill availability. Do not assume adding a repo document grants
it to every Card or that a displayed skill was loaded into a Run. Inspect the current selected
profile and native discovery when runtime availability matters.

Publish or change a profile only within the user's authorized task, using its existing supported
configuration path. Verify discovery and the exact changed selection independently from useful
behavior. No automatic Neo4j ingestion, full projection replacement, CBM indexing, all-Card
attachment, or copying operating instructions into ThinkGraph/KnowGraph.

The original `services/knowgraph/skill_ingest.py` commands are retired historical context, not
commands to restore or run. A future code-wiki/index proposal must identify its real consumer
and demonstrate a retrieval benefit before adding a storage or ingestion system.
