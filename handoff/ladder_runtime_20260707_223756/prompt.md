# Mag One Prompt Packet: ThinkGraph Ladder Proof

Project id: 20ac92da-01fd-4cf6-97cc-0672421e751a
Feature page: wiki/harness-to-thinkgraph.md
Feature ids: feature.main-chat-harness-controller; feature.harness-to-thinkgraph; feature.saved-agent-card-runtime; feature.coder-to-mag-one-handoff

## Real ThinkGraph Fact
Fact id: ladder_proof_chat_to_thinkgraph_20260707_223756
Correlation id: 24ddf28a-835f-4766-946d-32df7f11f3ad
Card id: card_thinkgraph_agent
Conversation id: ladder-thinkgraph-20260707_223756
Status: stored
Stored kind: planning/proof fact
Stored scope: project 20ac92da-01fd-4cf6-97cc-0672421e751a
Stored purpose: proof-of-write from chat to ThinkGraph through the saved ThinkGraph capability; no Local Coder; no source inspection.
Independent readback: /api/thinkgraph/graph-view returned node id ladder_proof_chat_to_thinkgraph_20260707_223756 with sourceRef 24ddf28a-835f-4766-946d-32df7f11f3ad.

## CBM Starting Anchors
- C-Projects-main.apps.backend.src.coder.openclaude.session.grpcChatClient.startGrpcTurn
- C-Projects-main.apps.backend.src.coder.openclaude.session.grpcChatClient.selectDoorwayCards
- C-Projects-main.apps.backend.src.coder.openclaude.session.grpcChatClient.buildCardDoorwayDefinition
- C-Projects-main.apps.backend.src.services.thinkgraph.thinkGraphStore.readThinkGraphScope
- C-Projects-main.apps.backend.src.services.thinkgraph.thinkGraphStore.applyThinkGraphPatch
- C-Projects-main.apps.python-models.app.python_models.tool_registry.read_thinkgraph_scope_tool
- C-Projects-main.apps.python-models.app.python_models.tool_registry.apply_thinkgraph_patch_tool
- C-Projects-main.apps.python-models.app.control_plane.card_run_assistant_agent
- C-Projects-main.apps.python-models.app.python_models.job_folder.resolve_job_folder
- C-Projects-main.apps.python-models.app.python_models.job_folder.write_handoff_prompt
- C-Projects-main.apps.python-models.app.python_models.job_folder.read_handoff_prompt

## Intended Mag One Task
Review the chat-to-ThinkGraph ladder proof and produce a concise orchestration-readiness assessment. Do not edit code. Do not invoke Local Coder. Use the fact and CBM anchors above to identify what is proven, what remains unproven before Local Coder can safely be resumed, and the smallest next proof task.

## Proof Requirements
- Confirm Main Chat used persisted card configuration for OpenRouter GLM 5.2.
- Confirm ThinkGraph doorway selected card_thinkgraph_agent, not card_local_coder.
- Confirm ThinkGraph write used server-authorized thinkgraph_card_run authority.
- Confirm readback evidence comes from real ThinkGraph read path, not model prose only.
- Confirm this prompt packet was read back exact-byte through the existing job_folder helper.

## Scope Exclusions
- No code edits.
- No model/provider default changes.
- No Feature Context Resolver.
- No graph UI filtering.
- No Local Coder invocation.
