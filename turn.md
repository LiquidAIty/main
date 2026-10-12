# Turn Review

## Review Identity

**Verdict:** FAIL

**REVIEW_SNAPSHOT_SHA256:** `e3ec187e676c244f474d0ce0abe61ec26b88fa91dd07f29450d62b2585dbe2bc`

Independent reviewer: PromptSpec Agent 3. The implementation was frozen before this review. The reviewer used current source and the current controlling PromptSpec only, did not use Git or Codebase Memory, did not run or mutate product services or saved state, and modified no implementation file. This file is the reviewer's one authorized write.

The combined digest is SHA-256 over the UTF-8 bytes of the 132 manifest lines below, sorted by normalized repository-relative path and joined as `<sha256>  <path>\n`, including the final newline. `turn.md` is excluded from the reviewed implementation checksum.

## Reviewed Snapshot Manifest

```text
6a87b96aa0670f19316d824d3f0406496767e99c4acad7528a195a4b7ae0445a  AGENTS.md
33b223d357d822ab3e85647b0bfe421bdbf2d34f09597f3c875d5e8192c5375a  apps/backend/src/routes/index.ts
ae0e7b027cf5136caf70d78f52c5deefbfc2c3798df49688463f756f7fee0599  apps/backend/src/routes/jevGraphFocus.routes.spec.ts
df8790256b8b71c1d860e10b99a2699008af9ab536631fefbae91f35e8c3158c  apps/backend/src/routes/knowGraphWrite.routes.spec.ts
d3cd758b67bdb279b0e62b7757be109bae80505111b5fa890fa96deba86c89fa  apps/backend/src/routes/knowGraphWrite.routes.ts
267c382b27d0a1cb99b8b38396a672548f0122379a8957c5dd04ddbba0b5d56f  apps/backend/src/routes/projectGraph.routes.spec.ts
7965bc7d483b529b65febfd558ff8b7882f73a153ad2a2cbe280afb897bc521c  apps/backend/src/routes/projectGraph.routes.ts
8e24c3af94af55dc9182653a744ecd7727ba2bea5f879269bfdcf3462b2580c2  apps/backend/src/routes/thinkGraph.routes.spec.ts
191b823d6b5bc037a57470586b0a3d9889fefb90076d70cb498e44e7cc9f2864  apps/backend/src/routes/thinkGraph.routes.ts
45b22b3cbc3f851840f651ffb40cf329c252ed58d168227440e6f7e6afd971c0  apps/python-models/app/application_operation_catalog.py
ecf015b33a69b6e3611558a1be8c1df90e840db4122ed9756d1aab6c267f7032  apps/python-models/app/graph_routes.py
e77e3a7947afd53ba103c64564d5b75e42438194cd4d5700db814255abe7b680  apps/python-models/app/mcp_provider_operations.py
fb639d827cf15095a7072934bdeb2b8176e770ec143d7219797d761916235032  apps/python-models/app/project_graph_operations.py
d13f7b95865a41147d02baed29224bb634eae070161ea81f270461c976893092  apps/python-models/app/python_models/canonical_entity_directory.py
bdde64c6314dd1c2a0e3fdaa07917221c4086897cdcee67230583da322b17312  apps/python-models/app/python_models/card_invocation_preparation.py
c7b53f5537d62e8754a6e8492437eb2a30e631838da032ab5a225a81cf3906c0  apps/python-models/app/python_models/card_run_jev.py
9fb3444f06e8f091b4855d346af4e775f0837752845fde7fbde277dac973c4c4  apps/python-models/app/python_models/data_anchor.py
a4f8e28a4f4fa33e0b449bd94a32920abf3d6dab85d3838d34108362bb9e3b5d  apps/python-models/app/python_models/engraphis_operations.py
2a40138477c537ce0a929867b2b2340e4d6f07abf4bb27f532e7654f1b4b6f38  apps/python-models/app/python_models/engraphis.py
d66b834be7498767f8104000280e7bb4e740146af42e5e02d3f784b213893272  apps/python-models/app/python_models/jev_graph_focus.py
3ac4290f2ee6667ac632723dd39697e1ccfe643c5e60238302d49d74ba115fae  apps/python-models/app/python_models/knowgraph_exact_reads.py
3f47313bced44bb45284fcedda6bb6967cf2fd19bba51ce888be7a3c07fb4f47  apps/python-models/app/python_models/knowgraph_graphiti_read_support.py
a3ede6a25c5d06dd45f6075b123794f816bdff13a6452fa53cd478607978cb79  apps/python-models/app/python_models/knowgraph_know_contract.py
2876758321fbd437463829bae50eb49d26217f73b3ff48e7ec5e3f7b6f18a810  apps/python-models/app/python_models/knowgraph_projection_reads.py
43e6637c4ec7abaee7ffeff99ddbeaac20a7eb3d05fbf24bf40179c7007d7805  apps/python-models/app/python_models/project_entity_map.py
8d9af73aa1d072775a77ee8dd7c20df3b34627aa9c5732b3ceed43b2c37f0ceb  apps/python-models/app/python_models/project_graph_relevance.py
e6e190737b4da91fd9c0fe98f446c33060baa261ad134ac72e78456a4d382acc  apps/python-models/app/python_models/test_application_operations_contract.py
3a68cc4061a81a982a56d50595381ffc962b65e74820ce777ce291e2e841ef57  apps/python-models/app/python_models/test_card_invocation.py
7a555e3f1db4fd613cc9bd87e8da783f9433d72dc2520732fcf0c29bdf1b1745  apps/python-models/app/python_models/test_data_anchor.py
3a8a97f0b962fea79d24377690518a64dafbc7032de5a0a88f48a20b6a37c129  apps/python-models/app/python_models/test_engraphis.py
3c88f3d7a8ad17095a4a1659bff6ec6b60308e4714f2f66416cb5e6f5f567918  apps/python-models/app/python_models/test_knowgraph_jev.py
b91388c82d578e1a916b9238a5f12e307644e86be3be10e04f89bbe8f53429c6  apps/python-models/app/python_models/test_mcp_catalog_projection_contract.py
a0c4b7915e987b2033f9d54922cb907d781c0b1139bfc4941ac484c7427f678f  apps/python-models/app/python_models/test_mcp_provider_dispatch_contract.py
0413b3304fb95579897cafb0a6fd18e40beb4860a13329832b8e836f6c5474cd  apps/python-models/app/python_models/test_mcp_streamable_http_contract.py
3778bab1f1b4b04ca46d70fe5d33a481a3d00460c049b821f1e39479db61b6cf  apps/python-models/app/python_models/test_project_entity_map.py
34b67b3d55b1ef0358842d0875c7055ad8d955b6360aa5780ae926d4265f00f9  apps/python-models/app/python_models/test_project_graph_operations.py
d1ecda2ce19ba6df4412c826f7bd63c19db50633fc8fb409b7ee8a13caef10d4  apps/python-models/app/python_models/test_project_graph_relevance.py
5e3094c2bc34b26eaf5a3924e2ad660c3b755b9c6d63489fbfa065945824e0aa  apps/python-models/app/python_models/test_thinkgraph_hybrid.py
c70d8c61c24664b24138f2642134537fdf957237f727f415bf160cfbf65a7d59  apps/python-models/app/python_models/thinkgraph_completed_pair_extraction.py
c35bf0e7a2051a2c44fa4470a3192ce4ba216f06cb5acb90c26977c8fd071d1c  apps/python-models/app/python_models/thinkgraph_completed_pair_preparation.py
865a9857d27f78b888f3e98fd330133ecbd981704ae59938730ac7c28696073a  apps/python-models/app/python_models/thinkgraph_completed_pair_settlement.py
7ab94cdf1a256fe044099dfa8c8a13cdb9ca7f32b679d82eb6ebf31eacde8937  apps/python-models/app/python_models/thinkgraph_projection.py
2c7cb354567f866c572318a9c403ceeaff8fc3caebfb0432cdb183c5a780ce9a  apps/python-models/app/python_models/thinkgraph_reference_reads.py
f66e4987274f340a7505fe8808ce78f2e0ac3e07f6754fc590240629602fb242  apps/python-models/app/python_models/thinkgraph_relationship_settlement.py
3df5596613b056e307d98fbbc64f0bd79003ec6991c53c3299c56aa1702c8b94  apps/python-models/app/python_models/tool_registry.py
ed360d44cf2eb76d0e979c392414c452d1ca6d21a67e11359748369dc6b20bf5  apps/python-models/requirements.txt
331c2d118d81eb49e04d66fd0f200cf42cbaa5b1e22b1b4b1e3a7e55a6e238ea  ARCHITECTURE.md
9d9f48d45a377786b872c4e068b899cd2d15df9185d8c86297d62ab5c4c601aa  client/src/components/knowledge/canonicalEntityDirectory.ts
71fb4d2ce141bded003911e80f9e5cd1e9343ecde1d2cfbbbc4148af36cc53a2  client/src/components/knowledge/canonicalEntityLinks.spec.ts
47034b2274c204758e36824022ef1370d10ddbf21266e5e5f7b3a1f765990bf9  client/src/components/knowledge/canonicalEntityLinks.ts
6248fd0b8289942a58b651ad40c79672f4f8e7de62d52a8c5edf168a347f350d  client/src/components/knowledge/joinedKnowledgeGraphProjection.ts
b5f16048899ae0ab4f1c4db83f0b06c4513c69d893e9ea13f51d7d2fbaed2f24  client/src/components/knowledge/knowledgeAuthorityGraphSurface.css
8befb42eea5171c3dfdc64f8789172716ce3800ee7b6cd6b981739e3574df2da  client/src/components/knowledge/KnowledgeAuthorityGraphSurface.spec.tsx
5f03c5d96e9b1326a5cd21a2dcb21bddddd76caf45e39294dc41c9ea20e638e2  client/src/components/knowledge/KnowledgeAuthorityGraphSurface.tsx
92dd13a6cef6c6034fa26cbae65e7ff6cf0885c0f209c49c528ef2109daccade  client/src/components/knowledge/knowledgeGraphFocusPresentation.ts
e84d9af9719ddb92f943064c888c6ff0321fcb2b94eb0615a5caf8ae3f14ee03  client/src/components/knowledge/KnowledgeGraphFramework.tsx
2f89e49909e17675669f91968b5e043259a3ea7684ef7fa4b5260e0537de4cfa  client/src/components/knowledge/KnowledgeGraphInspector.tsx
5abf2a80b0d2e730530f97a75ffab5aa117eef769d4bf65fdfab9b75ba713dfa  client/src/components/knowledge/knowledgeGraphInspectorRecords.ts
8b7571a67ddca579befae8020aac8a7263b1c9ff590a318ca7692ed68e69acc9  client/src/components/knowledge/KnowledgeGraphPresentationControls.tsx
141f63385a015172980b51ef8dd1ea5485112daa68a3c905ed5092eddb887ba9  client/src/components/knowledge/knowledgeGraphPresentationPreferences.ts
e9625d467f988b3e48c833cf78553d6def6eafd5baf4139260628fcaa4539621  client/src/components/knowledge/KnowledgeGraphRecordCards.tsx
f06762d935398f30fb9fbdb91f4b6f5aa3a77d94676c97c21276452cd947348b  client/src/components/knowledge/knowledgeGraphRendererProjection.ts
cc80ebb626b49d1e8c4dcc20d1cdcaaa6c5a6726a1d1e7ef1ba6293cfab15a3e  client/src/components/knowledge/knowledgeGraphVisualSelection.ts
6bffa6ed95f209ab9320cb3fb860e7fd7148a1a882fac66b70726dda3b93b7c8  client/src/components/knowledge/ThinkGraphSemanticPhysics.spec.ts
5665309367cdcdce5112cbe098ae77a9a17b844ff469a46a51e0f3072d1a7c80  client/src/components/knowledge/useKnowledgeGraphManualFocus.ts
342affd70f681dcc7fe985e724427b96f9489f27f1765dda26956740c7a8614c  client/src/components/knowledge/useKnowledgeGraphPresentationLifecycle.ts
62915b98444f7185e911bd9ac728c2d499e7d7aa50ae5a6a7045f853b98d7912  client/src/features/agentbuilder/console/SharedCardChat.spec.tsx
aff7dfd7aa7f27a940fbe9da2313d2ee94b2518c5e6fe204acc2830c1e25a46b  client/src/features/agentbuilder/console/SharedCardChat.tsx
97d2cbb8148b1f157bbb242e35cb7c9d4a3a8ece80a46d946e30910873fe9ff1  client/src/features/agentbuilder/console/SharedCardChatMessage.tsx
b87929b0b6bd68e48d68432595f0e9cb335e2398eaa1e93fd101b993140f8e60  client/src/features/agentbuilder/console/SharedCardChatViewport.tsx
67d17f1bda3a64b6e0feef5dfa8432472c431fd7bbe7cee14a6f5fa65fcf8218  client/src/features/agentbuilder/console/useAgentBuilderSharedChat.ts
145cd3600533feb723295312d2f95cdb671f66340047fb3ecc3b5faa0c9adea9  client/src/features/agentbuilder/deck/deckDocument.spec.ts
0581e1971bd533f3fa8b0d2d3ea92a5995c8181cd2b4e110e221e2951995cf8a  client/src/features/agentbuilder/deck/deckPrimitives.ts
6a6fb415feaac6eae5b4c48fda9c2b962f92a4d4e7169e9cc2c48992926d9c22  client/src/features/agentbuilder/deck/newProjectDeck.ts
af9681ee95a39a2b2e6d4ea4d17ee279a3e82fb87c7b130e1c800b64769a14d6  client/src/features/agentbuilder/state/useAgentBuilderKnowledgeGraphs.ts
7787d37366b8387800a9b78af5e63a5aef596478052c04f7f737ca3a69227826  client/src/pages/agentbuilder.setup.spec.ts
8f3a5f8f3b81e955ff220ec5e4c8f1ec2bb0f074bc1e850505c602a8a2b73762  client/src/pages/agentbuilder.topology.spec.ts
acce8d50196f4a69c9e2f3150f6a2bf24cdba5f542f4d71e3e663b593ce65f4d  client/src/pages/agentbuilder.tsx
2086be8650431bebe287993160a332569f70a11e95a35fbc372c902340fb83c8  client/src/vendor/engraphis/engraphis-graph.js
a21ad6b622a9ff211378cc31d91983b5a4df715856e3e96a467159c6111500bf  DONT.md
995ab22ff8fd9de4bbb4dd342980b01362d7afe5e49b44e92e2f92c23045f112  EngraphisLatest/docs/AGENT_CONNECT.md
a84565991f90b8cc0cfe36999a149b476d8f208f6abc815a18f9e1a0fbfa6f4c  EngraphisLatest/docs/ARCHITECTURE_V3.md
a03b4d8558f8d565cf8565fca71510025d695fd296b5c3461c8338de12009e70  EngraphisLatest/docs/KILO_CODE_INTEGRATION.md
b43edaf926145eab147b27190cd991a19fafb8afde7b27e47f148f93a293fc33  EngraphisLatest/docs/MCP_CONTRACT.json
cfca8b0fde81ccc2cd3616537be375bdb682ca5144992fc04ba7ccd574fa7268  EngraphisLatest/docs/MCP_TOOLS.md
3f69cedd5d34b77b9ebe27804cddde86ac3365aa34a6b3209aeb46a09c830c92  EngraphisLatest/engraphis/core/engine.py
33c3436b9fd5d9d87305faa0a23d642c64e2295d93348cea893b5f71b43ef83e  EngraphisLatest/engraphis/core/store.py
406a6f9c9af1325086211a6410e723b50856f158cecdc307cbdd4bfe8eb0f3fc  EngraphisLatest/engraphis/mcp_server.py
8f707d9d90c6b8622ed31b823ef5833e7e545554cba07cb6d4e0ace1a6477099  EngraphisLatest/engraphis/service.py
61d6d00691c9a533f32bad9f7a3b43799d9840ed63f817babe9811c9ce722db2  EngraphisLatest/integrations/pi/index.ts
3fd22808eb59eda3001129963d456200daa81958e050158d87fbe5e0511d0d81  EngraphisLatest/integrations/pi/README.md
509c2b8fc5e746087a079344a728808cf048c25c87b28b17b07e55302a4f3c8c  EngraphisLatest/integrations/pi/src/config.ts
25af008a068066f97759ba79a9a2c217e50fa4cd1c6b325520183c8ade96a12d  EngraphisLatest/integrations/pi/src/generated-contract.ts
e1dc2a0bc931b56ff7ce5306f88602936be2fab9681650ee99cb88df4985bf9f  EngraphisLatest/integrations/pi/src/tool-schemas.ts
674e1058446178872c123b913ffea5e373d6b07f446f18ba7765525d103c2d65  EngraphisLatest/integrations/pi/test/config.test.ts
d43951c2f04358214131342a1b586c6bc68195d378daaa8d3f6692226ea5f86c  EngraphisLatest/integrations/prime_agent/README.md
9314dd9cfbfcb3196e56dcdd17665d27b9c114a83f20d644dd456cb52ac8a8ff  EngraphisLatest/integrations/prime_agent/src/engraphis_prime_agent/_contract.py
7c76ea7cc079f4a829f68719ae3d8507f39ddbb8f50b22aa13b8ac7306a01f0f  EngraphisLatest/integrations/prime_agent/src/engraphis_prime_agent/cli.py
e5ae75bd34e851354bcb60e4b217c717b853db23e92d4c8b03065913148b2034  EngraphisLatest/integrations/prime_agent/src/engraphis_prime_agent/mcp_client.py
bc08d3948bf8959774c04acee0374958b46f1ed38b63e6f2eb144c14596ca729  EngraphisLatest/integrations/prime_agent/src/engraphis_prime_agent/tools.py
06f08c92d81cc16e905756c3e4c724423da8be504e7cf1bc262c5241337608dd  EngraphisLatest/integrations/prime_agent/tests/test_fleet.py
77cb9e0395079bb171f898f76a938b429c0aeb48ba98a3ca7f3419c1f145afee  EngraphisLatest/integrations/prime_agent/tests/test_tools.py
aed1e7f0955feb5e0a98a135e68d030042845c5a80f11f12178fd769fee1ca4d  EngraphisLatest/skills/engraphis-memory/references/TOOLS.md
f77e7c3851d0d81ae2a9c035e3fb60f747575134674ffe1a47b11162e1d8e049  EngraphisLatest/skills/engraphis-memory/SKILL.md
844b6d6f38b81b0f3d3566bac057735aedf94a7f4d95ecfedb24dab42b5c4233  EngraphisLatest/tests/test_engine.py
a73e33d4e227d96dd03abc0b3fc1722d8aad57787f9db6ac87e606c78708d8bb  EngraphisLatest/tests/test_mcp_server.py
3623b4af189f388f5011e0e004c0168ef715ac35f30fc5564c9272cab8f6e0a5  EngraphisLatest/tests/test_release_infrastructure.py
9d2bcd68550edcf4299aef0d21042d8682d015e9d82648e54aefa92bef45c38e  EngraphisLatest/tests/test_skill_package.py
280fb5ba6ab6979d49ff30fbe7e0b18a94811a1364ad0da818d3f0a26ac3fee7  EngraphisLatest/tests/test_smart_mcp_gateway.py
ab41c399bf44b9c7bc0737c883c35c676b873cca13656239f87caf0c4f6a8da0  FUTURE.md
8d9df03b9376b34edced512df36f5bc5848628b10bdfb9de5c50927e419bf640  GraphitiLatest/graphiti_core/driver/falkordb/operations/episode_node_ops.py
b3c5484d0ce69e1618c0f9c7d7f1c8625a09250e53a2ba9d5414280a1473292b  GraphitiLatest/graphiti_core/driver/kuzu_driver.py
ea7dea1df15a611bf71fefd4e89c18338a5daa0024e474c51492777c3068edc5  GraphitiLatest/graphiti_core/driver/kuzu/operations/episode_node_ops.py
f8c9a2428e8ffbd62fc2d5de57a9e8e555b622f686acd9220f212d05de48f433  GraphitiLatest/graphiti_core/driver/neo4j/operations/episode_node_ops.py
3e3272bce8dea24382c49d3d6a2662b8dcab2034890a3b2c4cd8b3fdb928de58  GraphitiLatest/graphiti_core/driver/neptune/operations/episode_node_ops.py
71c57fda49ac56856ab29b25d719947aee79625090233f09f6b6aac743cf2112  GraphitiLatest/graphiti_core/driver/record_parsers.py
30dfb3ce6c7d082269e8f177cdcc723b7563db978db075d66eaf77e1886c69c5  GraphitiLatest/graphiti_core/edges.py
4f6f1b8820531365c446665eb0c21f8ed35c7b8c0609c5ea20b1af426f8e3579  GraphitiLatest/graphiti_core/graphiti.py
becd186a2345ee4d23c952fb89e5d8780450836d0d517bec3eae77427ca327d2  GraphitiLatest/graphiti_core/models/edges/edge_db_queries.py
b4a17ab5f1a036e74daa442adf6b66a28e785a732347a8d1600952df35bab276  GraphitiLatest/graphiti_core/models/nodes/node_db_queries.py
529eb74b7c93e7551f6287b1a7bf6818d31fd045623b3260967dad573e4d801c  GraphitiLatest/graphiti_core/nodes.py
d97632efea30b6a94ff1052adb81aecafad42a9bb3ce7dcf4aa43105a616a235  GraphitiLatest/graphiti_core/utils/bulk_utils.py
a4bc0d6f4af23f13fb9d0a4f7660cd46cad661f65b4bd6e80cca0677477ed1d7  GraphitiLatest/graphiti_core/utils/maintenance/node_operations.py
fc26ef1e1712039cd9290abc5644a3cb431bafc8f930890832286c9334294932  GraphitiLatest/mcp_server/README.md
4b9569ce54e6ac5e34688c1e29d9675e317ea24231daa3fab1e5126d3aa4edd8  GraphitiLatest/mcp_server/src/graphiti_mcp_server.py
3a0960db2b9ee7a7db337bb975ca0281e25dc7ecab714b314050904e942fb775  GraphitiLatest/mcp_server/src/models/response_types.py
b4d39365ce472b88f3239fc4a6e19c2ae831e1ba1979560b360a4c8a8b9207af  GraphitiLatest/mcp_server/src/services/queue_service.py
8d1f85f6780c0074ea291c18ad192e8e7f5a0cf88c690a15ef7052f7f57705f3  GraphitiLatest/mcp_server/tests/test_core_parity.py
7487e210998068fb6fb36cab7708f7d78f6ee091872c6f3f5c9ea3ae3034e9ce  GraphitiLatest/tests/test_entity_memory_attachment.py
b8fee36323b4a076b630a9da723b0ff8bfd49c780c2dda85b6e670dac3ed9325  PLAN.md
7c1e2297e4f85910e60d03c6cfb4a839860ffff143b5452350d06a7ad43adeb3  README.md
bbfc8ec37d39662992cf7584dca7699deea3541e1698670ecb636b9520e72f5a  skills/conversation-graph-acceptance.md
```

## PromptSpec

### Requested Delta

- Use only Entity, Think, Know, Relationship, Citation, and authority at the active Project graph boundary.
- Keep Entity as the only visible Project graph node.
- Attach each Think to exactly one native Engraphis Entity and each Know to exactly one native Graphiti Entity without smearing.
- Store one valid Know as one atomic `know.v1` Graphiti episode containing both a cited supporting `idea` and a cited `counterIdea`; never split those sides into separate Knows and never project a one-sided cited statement as a Know.
- Preserve Relationship as a directed Entity-to-Entity edge, separate from Think and Know bodies.
- Provide exact Entity directory/context reads, native candidate retrieval, Jev relevance, one most Relevant plus one distinct most Recent record per authority, and the requested compact inspector presentation.
- Keep Main lean and fast, ThinkGraph on Luna and steelmanning Project intent, KnowGraph source-default on Sol and two-sided/reality-checking, and Builder as the heavy/admin owner.

### Preservation Set

- Native Graphiti queue semantics, extraction-owned `MENTIONS`, Relationships, Communities, Sagas, provenance, time fields, and ordinary Graphiti tools.
- Separate Engraphis ThinkGraph and Graphiti KnowGraph authorities and writers.
- Existing Team/Kanban, Magnetic, saved Card identity, persisted Card revisions, saved data, Runs, sessions, topology, authentication, and unrelated graph data.
- Existing Jev relationship movement/centrality, Solarpunk work, Focus/black-hole behavior, combined graph, native layout settings, and detailed inspector controls.
- No fake records, no duplicate graph/state owner, no deterministic TypeScript semantic ranking, and no provider/model fallback.

### Forbidden Work

- No Git, CBM, source history, memories, rejected reconstruction, restoration, or reuse as implementation authority during this review.
- No private root authority records, KnowGraph TaskGraph execution files, saved-card ledger changes, settlement/re-entry changes, worker bearer/Dynamic Tool carrier work, cancellation redesign, or KnowGraph Team/AutoTeam work.
- No Subject, `entityKind`, `portableKind`, or invented attachment wrappers at the active graph contract.
- No report-maker, pricing/retention, paid-setting entitlement, global default reset, time sorter, PDF-serving architecture, or other side quest.
- No reviewer repair after freeze.

## Review Inputs and Process

- The installed PromptSpec Receiver skill, repository `AGENTS.md`, `DONT.md`, `PLAN.md`, and the controlling PromptSpec were read completely before review.
- Current source and first-party docs were inspected directly. Rejected attempts and history were not used.
- No detailed Primary CBM map or exact scout-report text was supplied to Agent 3. Agent 3 was correctly prohibited from using CBM and therefore cannot independently attest to those process artifacts. The inherited review packet supplied the task map, central contract, proof results, runtime state, and saved-state inspection.
- The reviewed manifest was independently reconstructed without Git from current PromptSpec ownership, current source, and non-generated files modified during this run from 2026-10-11 08:00 local onward, plus `apps/python-models/requirements.txt`. Generated runtime artifacts, caches, virtual environments, `dist`, logs, outputs, and saved/database state are excluded.
- The support-agent ceiling presented to the reviewer is compatible with two read-only scouts plus this final reviewer. Agent 3 did not spawn another agent.

## Task Waterfall

### T001 — Exact Entity / Think / Know Foundation

**Key Objective**

- Make Entity the only Project graph node; make Think and one two-sided Know exact properties of one native Entity; keep Relationship separate.

**Definition of Done**

- [x] New Think settlement uses one native Engraphis memory plus one exact structured-extractor incidence (`thinkgraph_completed_pair_settlement.py:89-154`).
- [x] One valid Know requires both cited sides (`knowgraph_know_contract.py:54-68`, `85-109`).
- [x] Exact Know reads require structural `ABOUT` and discard content that is not valid `know.v1` (`knowgraph_exact_reads.py:24-91`).
- [x] Graph projections expose Entities as nodes and attach valid Think/Know evidence as properties.
- [x] A turn may return multiple Entity-specific Thinks while the extractor/settlement contract rejects duplicate Entity output; KnowGraph's source-default prompt permits several Entities but at most one Know per Entity.
- [ ] Real saved-agent behavior proves the model obeys the per-turn cardinality and two-sided Know contract.

**Reviewer Verdict:** BLOCKED — deterministic source is materially correct, but the required real saved-agent proof did not run and the authoritative saved prompts remain stale.

### T002 — Provider-Native Exact Storage

**Key Objective**

- Use native Engraphis/Graphiti extension points without a side table, second graph, alternate queue, or guessed attachment.

**Definition of Done**

- [x] Controlled Engraphis `remember_entities` creates one exact incidence per Fact and retains generic memory behavior.
- [x] Controlled Graphiti adds an additive `ABOUT` edge and queued `add_memory_to_entity`; `MENTIONS` remains independent (`graphiti.py:762-834`, `1121-1189`, `GraphitiLatest/mcp_server/src/graphiti_mcp_server.py:541-623`).
- [x] A missing exact Graphiti Entity may be created with its caller-declared UUID/name inside native episode persistence; no name search or similarity chooses it.
- [x] Ordinary `add_memory` retains its `update_communities=False` default while the exact Entity sibling defaults community refresh on.
- [x] The application imports both controlled forks through editable package requirements.

**Reviewer Verdict:** COMPLETE in source and deterministic proof.

### T003 — Native Retrieval plus Jev

**Key Objective**

- Produce a non-persisting current-request packet from native bounded candidates and Jev ranking, with one Relevant and one distinct Recent record per authority.

**Definition of Done**

- [x] Engraphis native recall and Graphiti native Entity search/exact `ABOUT` hydration produce candidates (`project_graph_relevance.py`).
- [x] Recent IDs are excluded from relevant candidates (`project_graph_relevance.py:384-390`).
- [x] Jev rates opaque candidate IDs; no TypeScript prose scoring was added.
- [x] Default automatic result limit is one (`project_graph_relevance.py:32`, `352-424`).
- [x] Relevance failure returns no Relevant record rather than relabeling Recent.
- [ ] Real Main/Builder/ThinkGraph/KnowGraph Runs prove the packet reaches the effective saved agents and changes behavior as intended.

**Reviewer Verdict:** BLOCKED — source and deterministic contracts exist; real behavior is unproven and saved authority is not aligned.

### T004 — Exact Entity Directory and Context

**Key Objective**

- Expose complete exact identity and bounded exact Entity context without fuzzy Entity lookup or merged graph authority.

**Definition of Done**

- [x] `project_graph.list_entities` returns exact canonical name, native IDs, authority, revisions, and hash without bodies or `entityKind`.
- [x] `project_graph.read_entity_context` requires an exact current directory object plus query, supports transient 1-12 results, and preserves each authority's native IDs (`project_graph_operations.py:25-143`).
- [x] Backend route requires project ownership and carries only transport fields.
- [x] Inspector count does not widen automatic Card grounding, whose caller leaves `result_limit=1`.

**Reviewer Verdict:** COMPLETE in source and deterministic proof.

### T005 — Relevant / Recent Inspector

**Key Objective**

- Land on Know when both authorities have attached records, default to Relevant, use a small arrow to swap the same space to Recent, and provide Search plus Results 1-12.

**Definition of Done**

- [x] Know is selected when the joined Entity has direct Know evidence (`knowledgeGraphVisualSelection.ts:46-54`).
- [x] Search, Results 1-12, the arrow, and separate Relevant/Recent record surfaces exist (`KnowledgeGraphInspector.tsx:296-395`).
- [x] Think detail and each Know side's detail remain behind **More**; Know cards render **For** and **Against** with independent citations.
- [ ] The inspector authority controls are literally **Think** on the left and **Know** on the right. Source renders **ThinkGraph** / **KnowGraph** (`KnowledgeGraphInspector.tsx:280`).
- [ ] Relevant remains the landing view even when no current query is available. Source forcibly substitutes Recent when `entityContextQuery` is blank (`KnowledgeGraphInspector.tsx:159-161`), contradicting the no-promotion rule and the unqualified Relevant-default docs.

**Reviewer Verdict:** INCORRECT.

### T006 — Lean Main and Builder Grounding

**Key Objective**

- Give Main and Builder the exact Entity/Relationship map and default grounding while preserving Main's fast, concise, delegating role and Builder's heavier construction/admin role.

**Definition of Done**

- [x] Python preparation includes Main, Builder, ThinkGraph, and KnowGraph IDs and appends one canonical packet before IDF materialization (`card_invocation_preparation.py:57-60`, `391-407`).
- [x] Source-default Main tools are lean and Builder receives the expanded explicit admin corridor (`deckPrimitives.ts:46-72`).
- [x] Source-default prompts encode the concise good-boss and two-thirds-supportive/one-third-challenging discipline (`newProjectDeck.ts:109-118`, `136-140`).
- [ ] The authoritative persisted Main and Builder Card revisions carry those prompts/grants.
- [ ] A real loaded Main and Builder turn proves grounding use and correct delegation behavior.

**Reviewer Verdict:** BLOCKED.

### T007 — Fast ThinkGraph and Deep KnowGraph

**Key Objective**

- Keep ThinkGraph on Luna and optimized for a faithful compact steelman; put source-default KnowGraph on Sol with one atomic cited For/Against reality check.

**Definition of Done**

- [x] Source defaults keep ThinkGraph on Luna and KnowGraph on Sol (`newProjectDeck.ts:468`, `539`).
- [x] Source prompts encode graph awareness, compact Thinks, no near-duplicate write, two-sided Knows, and no strawman counter (`newProjectDeck.ts:148-169`, `206-224`).
- [x] Python validates and encodes both Know sides before calling the native provider tool (`mcp_provider_operations.py:57-128`).
- [ ] Persisted ThinkGraph/KnowGraph saved Cards match the source defaults.
- [ ] Real loaded agent runs prove the semantic behavior, actual tool choice, citations, per-turn cardinality, and queue write.

**Reviewer Verdict:** BLOCKED.

### T008 — Graph Presentation and Removal

**Key Objective**

- Preserve one combined view; make Think/Know color-key labels select isolated views; return combined on empty canvas; scale Entity size linearly by attached words; retain Jev physics; provide exact single-item removal.

**Definition of Done**

- [x] The graph-level color key uses literal **Think** and **Know** and empty-canvas selection clears to combined (`KnowledgeAuthorityGraphSurface.tsx:204`, `342-361`).
- [x] Joined Entity attached word totals combine authority variants and renderer weights normalize linearly (`joinedKnowledgeGraphProjection.ts:269-279`, `knowledgeGraphRendererProjection.ts:13-31`).
- [x] Renderer consumes transient `visual_size_weight` separately from `gravity_mass`; Jev relationship physics remains intact.
- [x] Single Think, Know, and Relationship removal remains explicit; Entity is not deleted as a side effect.
- [ ] Owner visual acceptance exists for the actual loaded UI.
- [ ] Inspector authority labels satisfy the requested one-word Think/Know surface.

**Reviewer Verdict:** INCORRECT / visually unproven.

### T009 — Proof, Documentation, Freeze, and Review

**Key Objective**

- Complete deterministic proof, real agent proof, documentation coherence, exact freeze, and independent checksum-bound review.

**Definition of Done**

- [x] Focused deterministic suites, typechecks, and build were reported and separated by tier.
- [x] Services other than Hermes were reloaded and health checked against current source.
- [x] First-party documentation was updated with current source, accepted direction, and deferred ideas separated.
- [x] Implementation was frozen and a 132-file exact reviewed manifest was independently hashed.
- [ ] Full client suite is green: it reports 412 passing and 5 failing untouched `sharedChatClient.spec.ts` expectations.
- [ ] Real saved-agent acceptance suite ran through Hermes.
- [ ] Saved-card authority matches the new source-default prompts/models/grants.
- [ ] Owner visual acceptance was obtained.

**Reviewer Verdict:** BLOCKED / FAIL.

## Planned-vs-Actual File and Task Mapping

| Task | Planned boundary | Actual reviewed files/symbols | Review |
| --- | --- | --- | --- |
| T001 | Literal Entity terminology and exact attached properties | Canonical Entity directory/link files, data anchors, Think settlement/projection, Know contract/exact reads/projection, related tests | Mapped; no active `entityKind`, `portableKind`, Subject, or wrapper schema remains |
| T002 | Provider-native exact attachment | Controlled `EngraphisLatest` engine/service/MCP/contracts/integrations/tests; controlled `GraphitiLatest` edge/core/MCP/queue/tests; application requirements | Mapped; additive vendor changes are directly coupled to exact attachment |
| T003 | Native candidates + Jev | `card_run_jev.py`, `project_graph_relevance.py`, `engraphis.py`, `knowgraph_exact_reads.py`, relevance tests | Mapped; Python owns ranking transport and Jev owns semantic rating |
| T004 | Exact public reads | `project_graph_operations.py`, `application_operation_catalog.py`, Python/backend routes, client read hook, tests | Mapped |
| T005 | Relevant/Recent detailed inspector | Inspector, record cards, surface/framework, CSS, tests | Mapped, but two literal UI requirements remain wrong |
| T006 | Main/Builder role and grounding | `card_invocation_preparation.py`, deck prompts/tools, topology/deck tests, shared chat query plumbing | Mapped; source defaults are not the authoritative existing saved Card revisions |
| T007 | Think/Know roles and writes | Think preparation/extraction/reference reads; Know schema/provider adapter; deck prompts/model/tools; tests | Mapped; semantic behavior lacks live proof |
| T008 | Views, sizing, native presentation, removal | Joined projection, renderer projection/fork, lifecycle/preferences/controls, removal routes/hooks, surface tests | Mapped; deterministic only, no owner visual acceptance |
| T009 | Canonical docs and proof | `README.md`, `PLAN.md`, `AGENTS.md`, `DONT.md`, `ARCHITECTURE.md`, `FUTURE.md`, `skills/conversation-graph-acceptance.md`, focused tests | Mapped; proof tier incomplete |

The 132-file scope is large but mechanically explained by two controlled vendor contract additions and their generated/bundled parity surfaces, plus the cross-stack Project read/UI boundary. No unrelated Hermes, Team, Magnetic, saved-run ledger, bearer, cancellation, settlement, or task-graph source file appears in the reviewed manifest.

## Vendored Project Review

### GraphitiLatest

- **VENDORED PROJECT:** `getzep/graphiti`, core 0.30.2 / MCP 1.1.0.
- **PURPOSE:** one exact native Entity attachment for one queued episode.
- **EXTERNAL ALTERNATIVE CHECK:** existing episode metadata was declared but not persisted through the installed write/read path; the implementation instead uses a native structural edge and additive provider tool rather than a LiquidAIty side table or replacement graph.
- **FILES AND SYMBOLS:** `AboutEdge`, `ABOUT_EDGE_SAVE`, `Graphiti._resolve_exact_entity_attachment`, optional `entity_uuid/entity_name`, bulk persistence, queue arguments, `add_memory_to_entity`, response model, parity tests.
- **UPSTREAM BEHAVIOR PRESERVED:** ordinary `add_memory`, extraction, `MENTIONS`, Entity/Relationship extraction, Communities, Saga, search, delete, and queue ordering remain distinct; ordinary community-refresh default remains false.
- **CONTRACTS:** UUID is exact authority; name is required to create/validate; one `ABOUT`; queue response reports acceptance only.
- **TESTS:** 3 focused core tests and 30 MCP parity tests were reported passing.
- **FORK COST:** one additive edge type, optional core arguments, and one additive MCP operation across supported drivers.
- **ROLLBACK:** remove the additive attachment path and revert requirements to upstream; existing data remains, but `ABOUT`-dependent Entity attachment becomes unavailable.

### EngraphisLatest

- **VENDORED PROJECT:** `Coding-Dev-Tools/engraphis` 1.7.9 baseline plus the existing controlled MCP SDK v2 port.
- **PURPOSE:** atomically write one memory and one exact Entity incidence per requested Fact.
- **EXTERNAL ALTERNATIVE CHECK:** generic remember/extraction could attach one memory to multiple inferred Entities; no existing public exact batch contract met the invariant.
- **FILES AND SYMBOLS:** engine/service `remember_entities`, Smart and Classic MCP operation, bundled Pi/Prime contracts, docs, tests.
- **UPSTREAM BEHAVIOR PRESERVED:** generic remember, recall, extraction, conflict handling, graph operations, and existing public Smart/Classic surfaces remain available.
- **CONTRACTS:** one Fact pairs with one caller-declared Entity; exact ID/name mismatch fails; automatic text-derived incidence is disabled for this operation; transaction/finalizer failure rolls back.
- **TESTS:** application Python suite and focused vendor/integration contract tests were reported passing except the explicitly unavailable Pi optional development dependencies.
- **FORK COST:** one additive exact batch operation and parity updates across bundled clients.
- **ROLLBACK:** remove the operation and return ThinkGraph to having no exact current write path; existing stored data needs no migration.

## Deterministic Verification

- Application Python full suite: **526 passed**, one upstream Pydantic deprecation warning.
- Focused post-vendor catalog/relevance tests: **26 passed**.
- Graphiti exact-attachment core: **3 passed**.
- Graphiti MCP parity: **30 passed**.
- Client application and spec typechecks: **passed**.
- Backend application and spec typechecks: **passed**.
- Client production build: **passed** with existing `node:fs`/chunk warnings.
- Focused UI/Card tests: **67 passed**.
- Backend Project Graph route: **2 passed**.
- Full client suite: **412 passed, 5 failed**. All five failures are in untouched `sharedChatClient.spec.ts`; current `streamSession` returns `state: 'completed'` while those expectations omit it. Timestamp reconstruction places neither that source nor its spec in this run's reviewed manifest, so this is not attributed as a new task regression. It still means the full client proof tier is not green.
- Pi full suite: **not established** because optional local development packages `typebox` and `@earendil-works/pi-coding-agent` were unavailable; the dependency-free MCP result test was reported **5/5 passed**. No package was installed to conceal this.

## Loaded Product Proof

- After reload, backend `4000`, client `5173`, Python rails `8003`, KnowGraph `8001`, and MCP `8765` were reported healthy.
- MCP catalog was ready with **38 unique tools**.
- Loaded Graphiti imports reported core **0.30.2** and MCP **1.1.0** from the vendored editable paths.
- Hermes was **not running**. Whole-stack normal reload failed because the Gateway credential was unavailable in the executor. The Primary did not inspect, invent, or repair that credential.
- The one saved Trading Project graph was empty: ThinkGraph and KnowGraph projections had zero nodes/edges. No fake data was inserted for proof.
- **Python rails restart/reload required:** yes, and the reported Python rails reload completed; Hermes still remained unavailable.

## Live Agent Acceptance

### Runtime

- Real loaded Hermes runtime: **NO**.
- Real saved Main/Builder/ThinkGraph/KnowGraph behavior path: **NOT RUN**.

### Natural User Scenario

- SpaceX / Rocket Lab / investment / cadence / margins / cash-generation / trade follow-up suite: **NOT RUN**.

### Result

- **NOT LIVE-PROVEN**.

### Mock/Scaffold/Unit-Test Substitute Used for Agent Behavior

- **NO.** Deterministic prompt/schema/tool tests were correctly reported only as deterministic proof, not as proof of model decisions.

The missing live tier is blocking because this run changed source-default prompts, tool grants, model selection, current-request grounding, model-authored per-Entity cardinality, KnowGraph two-sided research behavior, and delegation expectations. Those behaviors cannot pass from unit tests alone.

## Saved Authority Review

The authoritative persisted deck was saved at **2026-10-10T04:17:04.408572-04:00** and inspected at **2026-10-11T17:49:04.7639395-04:00**, age **37.53 hours**. This is older than the owner's 24-hour residue threshold. It was correctly not removed or rewritten; it must be reported in detail.

- Main revision 17 retains old graph/CBM tools and Subject-language prompt content rather than the new lean source-default grant/prompt.
- Builder revision 2 retains old grants and prompt rather than the new grounding/admin contract.
- ThinkGraph revision 17 retains generic `engraphis_remember` and Subject-language prompt content rather than exact `engraphis_remember_entities` and the current Entity contract.
- KnowGraph revision 9 retains Luna, generic `graphiti.add_memory`, Subject-language prompt content, and no mandatory two-sided `know.v1` contract rather than source-default Sol plus `graphiti.add_memory_to_entity`.
- Saved topology and state were preserved. No migration was authorized or attempted.

Because saved Cards are the sole permanent authority, the changed source defaults do not make those existing Project Cards compliant. The authoritative Project therefore cannot provide live acceptance for the requested Main/ThinkGraph/KnowGraph behavior without a separately authorized exact saved-card migration or a clean new-Project acceptance target.

## Documentation Coherence Review

### Blocking Normative Conflicts

1. `AGENTS.md:481`, `PLAN.md:50-52`, `ARCHITECTURE.md:298-302`, and `skills/conversation-graph-acceptance.md:104-106` describe Relevant as the inspector landing state and Recent only as the arrow-selected alternate. Current source forces Recent whenever the current query is blank (`KnowledgeGraphInspector.tsx:159-161`). The documents describe the requested contract; source does not fully implement it.
2. `ARCHITECTURE.md:301-302` describes inspector tabs as ThinkGraph/KnowGraph, matching current source, but the latest owner correction and final-review contract require the simple inspector controls to be **Think** left and **Know** right. The graph-level color-key is correct; the Entity inspector still renders **ThinkGraph** / **KnowGraph** (`KnowledgeGraphInspector.tsx:280`). The normative source/doc pair is stale relative to the latest owner decision.
3. Source-default Card prompts/models/grants are documented as current source while root docs correctly state persisted revisions remain authority. The saved-state gap is disclosed in `PLAN.md:101-109`, but no document wording can convert the 37.53-hour-old persisted Cards into the new behavior.

### Stale / Out-of-Place Ideas

- `README.md` keeps KnowGraph-Team integration under **Deferred**, and `FUTURE.md` explicitly labels KnowGraph evolution unaccepted. These are proposal-only and did not create runtime residue.
- Report generation, paid entitlement, Project retention/billing, global reset, and time sorting remain deferred/unapproved. No implementation file in the manifest introduces them.
- The existing technical graph preset reset is not the unapproved global product-settings reset.

### Consistent Documents

- Root docs consistently define Entity-only visible nodes, exact Think/Know attachment, two-sided Knows, separate Relationships, native candidates plus Jev, one Relevant plus one distinct Recent default, and separate graph authorities.
- `PLAN.md` honestly records the source-default versus persisted-Card gap and the separate live/visual proof tiers.
- `ARCHITECTURE.md` contains controlled Graphiti and Engraphis divergence entries with purpose, preservation, proof, fork cost, and rollback.
- `DONT.md` explicitly prohibits one-sided or split Knows, relevance-as-recency fallback, smearing, and duplicate graph authorities.

## Findings

### Blockers

1. **Authoritative saved Cards are materially stale and older than one day.** The existing Project's Main, Builder, ThinkGraph, and KnowGraph prompts/models/grants do not implement the reviewed source-default contract. Source seeds are not saved authority.
2. **Required real agent acceptance was not run.** Hermes could not start because the executor lacked the Gateway credential. No mock/unit substitute was used, which is honest but incomplete.
3. **The inspector violates the literal requested controls and landing behavior.** It renders ThinkGraph/KnowGraph instead of Think/Know and substitutes Recent when no query is present rather than keeping Relevant as the default/unavailable state.
4. **Owner visual acceptance is absent.** Renderer tests prove deterministic mechanics, not appearance, discoverability, arrow subtlety, card readability, or preservation of Solarpunk/Focus in the real loaded UI.

### Important

- The full client suite has five pre-existing/untouched expectation failures. They are not attributed to this PromptSpec, but a green full-suite claim would be false.
- The final reviewer did not receive the Primary's exact CBM map or complete scout reports. This does not invalidate direct-source findings, but the process artifact cannot be independently confirmed.
- The saved Project graph is empty, so loaded projection health did not exercise exact attachment, two-sided Know rendering, relevance selection, or deletion against real durable records.

### Minor

- None beyond the reported warnings and unavailable optional Pi development dependencies.

### Plan Drift

- Later owner steering explicitly moved current-request retrieval, prompt/tool roles, UI search/results, presentation sizing, and source-default model work into this run, superseding the original PromptSpec's deferred interaction section. The implementation followed that later scope rather than silently treating it as future.
- The run expanded to 132 reviewed files. Most expansion is traceable to controlled vendor parity and cross-stack consumers; however, no exact Primary file ledger was supplied to the reviewer, so only current-source plausibility—not pre-edit ledger compliance—can be attested.

### Side Quests

- No implemented report maker, pricing, paid entitlement, retention, global reset, time sorter, PDF-serving layer, alternate graph, duplicate scheduler, or new runtime was found.

### Preservation Violations

- No reviewed Team/Kanban, Magnetic, bearer, cancellation, settlement/re-entry, saved-run ledger, or Hermes task-runtime source file was changed.
- Existing source-default Card seed changes do not mutate saved Cards; persisted state was preserved.
- No provider/model fallback or fake success path was found.

### Agent Test Quality

- **INSUFFICIENT.** Deterministic proof is extensive and honestly labeled, but the changed agent behavior has no real loaded-runtime acceptance.

## Residue Audit

### Rejected Residue

- **Private root authority records:** none found in the affected current-source boundary.
- **KnowGraph TaskGraph execution files:** none found in the reviewed manifest.
- **`savedCardRunLedger` changes:** no ledger file is in the reviewed manifest. `ARCHITECTURE.md` mentions the existing ledger as a current execution owner only.
- **Backend settlement/re-entry changes:** none found in the reviewed manifest.
- **Worker bearer / Dynamic Tool carrier:** none found in the reviewed manifest.
- **Cancellation redesign:** none found in the reviewed manifest.
- **KnowGraph Team/AutoTeam changes:** none found. `ARCHITECTURE.md` mentions rejected KnowGraph AutoTeam only to prohibit it; `README.md`/`FUTURE.md` keep any integration deferred.
- **Subject / `entityKind` / `portableKind`:** no active production graph-contract occurrence was found. Remaining `subject` occurrences are OAuth identity or unrelated WorldSignals English; negative tests assert removed graph fields remain absent.
- **Invented attachment wrappers:** no `ownerEntityUuid`, `ownerEntityId`, `primaryEntity`, or `anchorEntity` production contract remains.

### Temporary Helpers / State

- No new side table, duplicate episode ledger, graph, queue, persistence store, or relevance store was found.
- `turn.md` is the only reviewer write and is not part of the implementation checksum.

### Duplicate Owner / Transport

- ThinkGraph remains Engraphis-owned, KnowGraph remains Graphiti-owned, and Python rails performs exact preparation/validation. TypeScript transports and renders; it does not rank semantic candidates.
- Graphiti's `ABOUT` attachment is structural and coexists with extraction-owned `MENTIONS`; it is not another Know store.

### Dead Code Introduced

- No obvious dead public operation or uncalled alternate graph route was identified by direct source inspection. Without Git/CBM and without the Primary's detailed inverse map, this is not a proof of global absence.

## Completed Correctly

- Exact Entity terminology and cross-authority directory/map source.
- Exact one-Entity Think settlement through Engraphis `remember_entities`.
- Exact queued one-Entity Graphiti attachment through structural `ABOUT`.
- One atomic two-sided cited `know.v1` validation, encoding, exact read, and projection.
- Native candidate retrieval plus Jev selection with distinct Recent exclusion.
- One Relevant plus one distinct Recent automatic source packet at limit one.
- Search/Results 1-12 transport without widening automatic agent context.
- Entity-only projections, attached Think/Know evidence, two-sided Know cards, `More`, removal, combined/isolation graph controls, and word-count renderer mechanics at deterministic source/test level.
- Source-default Main/Builder/ThinkGraph/KnowGraph role, tool, and model definitions.
- Rejected runtime/Team/AutoTeam/bearer/cancellation/ledger residue remains absent from the changed source set.

## Left TODO / Blocked

- Align or deliberately migrate the authoritative saved Main/Builder/ThinkGraph/KnowGraph Cards only under a new exact owner authorization, or run acceptance in a deliberately clean new Project whose saved revisions come from the reviewed source defaults.
- Restore the real Hermes/Gateway credential through its existing owner, then run the natural-user agent suite and inspect exact Run/tool/IDF/native-write receipts.
- Obtain owner visual acceptance of the actual inspector and graph.
- Correct the inspector's literal **Think**/**Know** labels and no-query Relevant behavior only in a new owner-authorized retry; the implementation is frozen now.
- Decide separately whether the five untouched full-client expectation failures should be repaired; they are not part of this PromptSpec's reviewed implementation.

## Not Attempted Because Dependent on Blocker

- Real per-turn proof that ThinkGraph produces at most one Think per Entity while creating several Entity-specific Thinks when useful.
- Real proof that KnowGraph uses Sol, selects the exact tool, creates one two-sided cited Know per Entity, preserves independent citations, and does not strawman the counter idea.
- Real proof that Main and Builder actually consume the Relevant/Recent packet, preserve the intended 2/3 supportive versus 1/3 challenging balance, and delegate/own work correctly.
- Persistence readback from a real queued KnowGraph write and a real completed-pair ThinkGraph write in the saved Project.

## Deferred / Proposal — Not Implemented

- Report/plan/prompt expansion into a center-view data document.
- Paid settings, pricing, Project retention/billing, or disappearing free Projects.
- Global application-default reset.
- Subtle time-sort interaction.
- Quick-Web durable-evidence handoff and PDF-serving architecture.
- KnowGraph-Team integration or another repository-review agent/product.

## Final Independent Opinion

The frozen source contains a substantial, mostly coherent exact Entity/Think/Know foundation. The two-sided Know correction is implemented at the right boundary: one validated episode, one exact Entity, two mandatory independently cited sides, and one native queued Graphiti path. The Engraphis exact batch write and Graphiti structural `ABOUT` extension avoid the fake bridges the owner prohibited. Native retrieval and Jev selection are also owned in Python rather than pushed into TypeScript.

This snapshot nevertheless fails the PromptSpec completion standard. The authoritative saved Cards are 37.53 hours old and materially disagree with the reviewed source defaults; Hermes was unavailable, so none of the model-dependent behavior was tested through the real saved runtime; the real Project graph is empty; owner visual acceptance is absent; and the inspector still has two literal contract defects. Deterministic tests cannot close those gaps. No same-run repair is allowed.

## Owner Action

- **REVIEW FAILED — inspect this `turn.md`.**
- The implementation must remain frozen. The Primary must not patch this run.
- The owner may choose to save/accept the partial source foundation with these limitations, separately authorize an exact saved-card migration and clean retry, or wipe/revert and retry from a clean checkpoint.
- Do not automatically remove the older-than-one-day persisted Cards; they are authoritative saved state and were reported rather than mutated.

