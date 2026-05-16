# gamecanvas

Root-level game-of-video / playable scene feedstock for LiquidAIty.

Purpose:
- study open React Three Fiber / Three.js scene editing
- study game-loop, keyframe, camera, and physics patterns
- keep external repos as reference/feedstock
- LiquidAIty SceneGraph Source remains canonical

Current direction:
- Triplex for visual React Three Fiber scene/component editing reference
- React Three Fiber + Drei + Rapier for native LiquidAIty 3D runtime
- Theatre.js for keyframes/cinematic motion planning
- Needle Engine as later spatial/WebXR reference
- Small React Three Fiber game examples as lightweight movement/game-loop references

Rules:
- Do not import feedstock directly into app runtime until audited
- Do not let any external repo own LiquidAIty architecture
- SceneGraph Source stays canonical
