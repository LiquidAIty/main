# CodeGraph

@skill id=codegraph
@type Skill
@status active
@graph codegraph

Use for selecting repository structure and source evidence for a coding task. Recovered from
`2ddadeeb^` and refreshed September 9, 2026. The existing CBM indexer owns CodeGraph.
When a PromptSpec is active, load `promptspec-receiver` first and defer repository process control to it.
The Primary alone uses the installed CBM CLI for bounded directional mapping, then hands exact anchors to
read-only direct-source scouts. See [codebasedmemory.md](codebasedmemory.md) for CLI discovery, coverage
limits, and inverse deletion/rename checks; do not duplicate that procedure.

LiquidAIty product clients are a separate boundary and use only their saved granted application-published
`cbm.*` operations. Repository CLI policy does not remove, add, or authorize product tools.

Return actual project identity, qualified symbols, paths, CBM references, and relevant callers.
Read current complete source before changing behavior. Report missing coverage and use the
documented source fallback; a missing graph result is not evidence that a function does not exist.

Select the small source boundary needed for the task. Avoid repeatedly handing complete files
to agents that need a contract or symbol reference. Include actual data where the recipient needs
it; references alone are not useful if the recipient has no granted way to retrieve them.

CBM describes structure; it does not decide intent, grants, runtime success, or what code should be
changed. Do not launch a frontend, manipulate its cache, add a TypeScript planning layer, or copy
repository source into a general Main prompt. The owner-required once-per-PromptSpec-run CLI reindex is
defined in `codebasedmemory.md`; any additional lifecycle action needs new explicit authorization. Builder
is the saved construction Card.
