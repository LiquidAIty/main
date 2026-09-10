# CodeGraph

@skill id=codegraph
@type Skill
@status active
@graph codegraph

Use for selecting repository structure and source evidence for a coding task. Recovered from
`2ddadeeb^` and refreshed September 9, 2026. The existing native CBM indexer owns CodeGraph.
Clients use only the application's published `cbm.*` tools. See [codebasedmemory.md](codebasedmemory.md)
for discovery, coverage limits and inverse deletion/rename checks; do not duplicate that procedure.

Return actual project identity, qualified symbols, paths, native references, and relevant callers.
Read current complete source before changing behavior. Report missing coverage and use the
documented source fallback; a missing graph result is not evidence that a function does not exist.

Select the small source boundary needed for the task. Avoid repeatedly handing complete files
to agents that need a contract or symbol reference. Include actual data where the recipient needs
it; references alone are not useful if the recipient has no granted way to retrieve them.

CBM describes structure; it does not decide intent, grants, or runtime success. Do not launch a
frontend, index, manipulate its cache, add a TypeScript planning layer, or copy repository source
into a general Main prompt. Agent Builder and Local Coder retain their distinct saved Card roles.
