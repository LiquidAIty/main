# Vendored Roots and Subrepos

These paths are not active LiquidAIty architecture truth:

- `localcoder/`
- `worldsignal/`
- `data-formulator-main/`
- `Understand-Anything-main/`
- `client/src/vendor/codebase-memory-ui/`
- `vendor/sim/`
- `vendor/vips/`
- `videocanvas/remotion-templates/`
- `videocanvas/react-video-editor/`
- `videocanvas/clip-js/`
- `gamecanvas/triplex/`
- `gamecanvas/react-three-game-engine/`
- `gamecanvas/cuberun/`
- `motioncanvas/theatre/`
- `spatialcanvas/needle-engine-support/`

Their old documentation, code, Dockerfiles, Compose files, package files, and dependency declarations must not drive current stack decisions.

Do not edit these paths during GPT cleanup or Fable runtime work. Only modify one when the user explicitly promotes it into active scope. Agents must exclude them from Markdown-wide audits unless specifically asked to audit vendored content.

If an excluded tracked file is accidentally touched, restore it exactly from Git. Do not hand-recreate vendored files.

The active stack is host Node backend source, host Python AutoGen sidecar source, `sim-pg` / Apache AGE for ThinkGraph, and `neo4j` for KnowGraph. Redis and Docker `python-models` are not part of the active AutoGen development runtime.
