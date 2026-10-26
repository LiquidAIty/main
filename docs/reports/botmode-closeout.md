# Bot Mode closeout — 2026-10-26

## Status

Working text/image checkpoint preserved. Local application repairs are implemented; voice input has an evidenced Windows policy blocker, and some live acceptance remains unproven. This is **not** a claim of complete Hermes Desktop parity or Oracle deployment acceptance. This dated report retains evidence; [ARCHITECTURE.md](../../ARCHITECTURE.md#bot-mode-application-boundary) owns the current implementation description and root [nextturn.md](../../nextturn.md) is the replaceable scratch handoff.

Starting checkpoint: the owner's 2026-10-26 commit titled `checkpoint Bot Mode text and images working; voice provider 403 pending`. No reset, restore, stage, commit, or push was performed during this wrap-up.

The owner subsequently approved updating the installed speech dependency, providing the full Builder CLI through the existing web backend with `node-pty`, and using the repo Python. Builder remains prepared in the existing lower terminal; other eligible Card terminals mount only when their existing CLI tab is selected. Main remains headless. Inline images and both TaskGraph workflows remain deferred.

## Implementation and owners

| Operation | Application owner | Actual Hermes counterpart |
| --- | --- | --- |
| User text and direct `@Name` | `apps/backend/src/routes/mainSession.routes.ts`: `addressedCard`, `requestForBot`, `/chat` | Desktop `HermesGateway`; `session.resume`, `prompt.submit`, `message.delta`, `message.complete` |
| Agent-to-agent work | Same route projects saved wired profile roster | `message_agent`, canonical Bot Chat, actual recipient execution and completion |
| Images | Existing composer, `mainSessionClient`, `/chat` | `image.attach_bytes` and prompt attachments; transmission unchanged |
| Later answers/history | Existing `/activity`, `useCardActiveAgentCounts`, `refreshHistory`, `/history` | `profiles.list.canonical_session`, exact `session.history` |
| Voice capture | `useAgentBuilderMainChat.startVoiceSession` | Browser `getUserMedia`/`MediaRecorder`; no server microphone |
| Transcription/speech | `/voice/transcribe`, `/voice/speak` | Desktop's profile-scoped HTTP ticket helper; `/api/audio/transcribe` and `/api/audio/speak` |
| Questions/approvals | Existing activity refresh, `AgentInput` inside `MainProjectChat`, `/respond` | Authoritative `session.resume.prompts`; original `clarify.respond` / `approval.respond` identities and execution generation |
| Full Card CLI | `cardTerminal.routes.ts`, existing `AgentTerminalPanel` | `node-pty` as used by Desktop; repo Python executes `hermes_cli.main -p <profile> --tui --resume <existing Bot Chat>` |

No second agent executor, Gateway owner, application prompt queue, reply waiter, transcript database, EventSource, or additional polling cadence was introduced. Pending questions use the existing roster cadence. Only user-selected answers are sent; no automatic approval was added.

### Changed files

- `apps/backend/src/routes/mainSession.routes.ts`: pending-input projection/response, sanitized audio endpoint errors, shared CLI conversation resolution, direct repo interpreter for Gateway ensure.
- `apps/backend/src/routes/cardTerminal.routes.ts`: new bounded HTTP/WebSocket PTY transport for the real Hermes CLI. Checks cookie session, allowed Origin, Project ownership, saved Card/profile, and exact canonical conversation. Browser callers cannot provide executable, command, environment, or working directory.
- `apps/backend/src/routes/index.ts`: authenticated terminal route mount.
- `apps/backend/src/main.ts`: terminal upgrades on the existing server and viewer cleanup at shutdown.
- `apps/backend/package.json`, `package-lock.json`: approved `node-pty` dependency; one package added, no broad dependency upgrade.
- `client/src/features/agentbuilder/console/mainSessionClient.ts`: typed original-request response transport.
- `client/src/features/agentbuilder/state/useCardActiveAgentCounts.ts`: reported live-session counts and pending requests on the existing timer.
- `client/src/features/agentbuilder/state/useCardActiveAgentCounts.spec.tsx`: existing observation tests updated to the actual count contract.
- `client/src/components/main/MainProjectChat.tsx`: minimal genuine question/choice controls and explicit browser microphone-permission state. No inline-image implementation or layout redesign.
- `client/src/features/agentbuilder/console/useAgentBuilderMainChat.ts`: recording cancellation/retargeting cleanup and separate permission-request state.
- `client/src/pages/agentbuilder.tsx`: passes existing activity requests to the conversation.
- This dated report. The separate continuation report was removed at the owner's request; durable contracts now belong in `ARCHITECTURE.md` and scratch continuation belongs only in root `nextturn.md`.

All ten touched TypeScript/TSX implementation/spec files were checked for Entity/Relationship headers. JSON dependency manifests retain their existing format. `.codebase-memory/artifact.json` changed through the installed indexer's operation; it was not edited or reverted by the implementation.

No tracked Hermes source was changed. The owner-approved environment update installed `edge-tts` 7.3.1 in `HermesLatest/.venv`. The existing Hermes TUI compiler generated the current `ui-tui/dist` bundle; the app checks Hermes's own `productCurrent` receipt before using that prepared bundle. This avoids launching another managed Python during terminal startup without accepting a stale TUI. Python and Node are explicitly supplied through Hermes's supported environment options.

## Acceptance matrix

| Capability | Result | Evidence and limits |
| --- | --- | --- |
| Ordinary Main answer | PASS | Prior real backtest answer retained; wrap-up's ATR question produced a real ordinary answer in rows 182–183. |
| Direct Trader answer | PASS | Owner sent another `@Trader` request during wrap-up, saw the attributed actual answer, and explicitly confirmed it worked as expected. Fresh preview readback retained it. |
| Main → Trader → Main | PASS | Existing recorded exchange has Main's actual `message_agent`, recipient execution, and later Main response appearing without manual reload. Not needlessly repeated. |
| Conversation persistence | PASS | Earlier reload proof and fresh preview retained exact Trader attribution and saved conversation. |
| Image input | PASS | Existing real screenshot requests received image-grounded answers; transmission was preserved. |
| Inline image presentation | DEFERRED | Explicitly left for the next chat. |
| Browser microphone capture/release | NOT TESTED | Owner clicked mic and spoke, but no captured transcript was established. Old preview control timed out; fresh preview was subsequently recovered. Permission-request state is now explicit. |
| Transcription | EXTERNAL BLOCK | Actual audio submitted to the configured local recognizer failed while importing PyAV DLLs blocked by Windows App Control. |
| Speech synthesis | PASS | Configured Edge provider returned HTTP 200 and real `audio/mpeg` data after the package update and Gateway restart. |
| Audible browser playback | NOT TESTED | Audio bytes are not proof that the user heard a reply. Full microphone-to-answer-to-playback remains pending. |
| Genuine structured clarify/approval | NOT TESTED | Source integrated with original identities. One safe real Main request returned an ordinary textual question; recorded rows show no `clarify` tool call. That does not prove the new structured UI. |
| Builder CLI transport | PASS | Real `/open` returned 200; authenticated WebSocket connected; actual repo-Python Hermes CLI rendered. A bounded connection remained open for 60 seconds before the diagnostic intentionally closed it. This alone did not establish usability of the owner's disconnected view. |
| Builder CLI after setup / model turn | PASS | After the owner's explicit no-sharing instruction, No thanks was selected and read back as collection/upload disabled. In the visible TradingProject preview, terminal input and Enter submitted `What is your workspace?`; Builder executed its Terminal tool, returned its directory/profile workspace, and returned to `builder ❯`. No API-only check substitutes for that visible result. |
| Recovery from prior closed terminal | PARTIAL | Reopening the preview restored an interactive CLI and existing conversation. The earlier `card_terminal_connection_closed` left old output visible but no live input transport. Its original disconnect cause remains unproven; no speculative reconnect timer was added. |
| Other Card lazy CLI | NOT TESTED | Existing conditional mount remains: only selected eligible CLI tab mounts a viewer. No blanket eager terminal startup added. Other CLI model turns not exercised. |
| Active-input steer | NOT TESTED | Existing `prompt.submit` path and configured Hermes busy behavior preserved; no application busy gate/queue introduced. No timed two-message acceptance was claimed. |
| Extra continuation | DEFERRED | Two real return paths identified below; no duplicate UI row or application resend established. Owner accepted the current direct replies. |
| All Projects / all agents | NOT TESTED | Shared source has no TradingProject/Trader special-case branches. Live work remained in TradingProject. Universal coverage and cross-Project isolation are not claimed. |

Focused existing tests: 22 passed across `MainProjectChat.spec.tsx` and `useCardActiveAgentCounts.spec.tsx`. Final client/backend source and spec typechecks passed. Final backend and frontend production builds passed. Existing WorldView browser-externalization and large-bundle warnings were not altered. Whitespace checks passed with an existing CRLF normalization warning. No mock result was used as live-runtime proof.

The final coherent `npm run dev:fresh` loaded the backend, Python rails, MCP and Vite. MCP published 60 tools with its configured catalog families ready. The fresh TradingProject preview loaded the saved attributed conversation, enabled composer, existing Canvas controls, and actual Builder terminal. Catalog readiness is not proof that every individual tool executed. Dependency installation reported four audit advisories; no unrelated audit-fix or deployment-security claim was made.

## Voice: exact diagnosis

Main's configured providers are **local transcription** and **Edge synthesis**, with Edge voice `en-US-AriaNeural`.

1. The initial failure was synthesis: `/api/audio/speak` reached Edge's WebSocket handshake and got 403. It was not an application-owner authentication denial or evidence of bad billing/API credentials.
2. The running environment had `edge-tts` 7.2.7 although current Hermes manifests/lock already specified 7.3.1. The maintainer documented the handshake protocol change: [issue 490](https://github.com/rany2/edge-tts/issues/490), [releases](https://github.com/rany2/edge-tts/releases). The owner explicitly authorized the update; the installed dependency is now 7.3.1. No speech provider/model/voice was switched.
3. Hermes's first restart verification reported a failure, then its supported background startup succeeded. The existing Gateway was recovered; its repo-venv launcher was confirmed. Windows exposes a base-interpreter child process underneath that venv launcher; it was not a switch to a different environment. Synthesis then returned 200 and real MP3 audio.
4. Actual transcription of generated speech reached `faster-whisper` 1.2.1 / PyAV 18.1.0, then failed on `av/index.pyd`; a direct repo-Python import also failed on `av/sidedata/encparams.pyd`. CodeIntegrity event 3077 confirmed those exact blocked paths. Both files match their installed package RECORD entries and have no Authenticode signature.
5. `VerifiedAndReputablePolicyState=1`; the Windows policy-list command returned Access denied. Microsoft documents no individual-app exception for Smart App Control: [official FAQ](https://support.microsoft.com/en-us/windows/security/threat-malware-protection/smart-app-control-frequently-asked-questions). No policy, antivirus, registry security setting, trust store, or execution restriction was weakened. The remaining decision belongs to the machine administrator or an approved signed distribution—not another app-runtime wrapper.

Provider URLs are redacted before audio errors reach the browser. No private audio, credential, authorization header, or secret is recorded here. The next voice proof must use an actual short microphone recording, its exact transcript, one actual agent response, and user-confirmed audible playback. Synthesized test audio proves only the downstream transport/provider stages.

## Extra continuation: evidence, not a cosmetic fix

The previously recorded exchange contains:

- Main row 169: real `message_agent` to Trader; row 170: queued delivery plus process receipt.
- Trader row 41: separate explicit `message_agent` back to Main; row 43: its normal final assistant answer.
- Main row 172: incoming agent message; row 173: substantive response.
- Main row 174: completion of the process named by row 170; row 175: actual model output, `No action needed.`

`HermesLatest/tools/bot_mode_dm.py::_spawn_delivery` requests `notify_on_complete=True`; `_run_delivery` waits for the actual recipient result and returns it through that original process. `gateway/session_automation.py::admit_process_notice` admits the completion with its own identity. Thus an explicit recipient message and the original delivery's completion can both reach Main. Desktop hydration renders ordinary assistant rows and separately types process notices; no evidence established that Desktop discards row 175's ordinary assistant text.

An internal completion record alone is not a defect. No second app submission or duplicate projection was established for this exchange. No literal-sentence filter, deleted history, completion suppression, roster alteration, or prompt rewrite was added. Whether to change this underlying two-return-path behavior remains a separate supported-configuration/upstream decision, not an excuse to undo working messaging.

## CLI and Oracle boundary

The prior browser `/api/pty` approach had a real contract mismatch: Gateway interactive grants are for `/api/ws`; HTTP grants are not accepted on core PTY sockets; `/api/auth/ws-ticket` requires a different authenticated session and actually returned 401 in the bounded probe. Windows's existing Hermes PTY bridge itself was importable.

The owner then approved the Desktop-style `node-pty` approach inside the **existing** authenticated Node backend. It runs the full CLI as a viewer of the saved profile's existing Bot Chat. It does not start `hermes serve`, create a second Gateway, expose an arbitrary shell command API, or use a reduced command console. Closing the browser viewer terminates its PTY, not the persistent Hermes conversation.

The owner subsequently explicitly rejected sharing with Nous. Builder's real first-run choice was answered No thanks. Readback confirmed `enabled=false`, `send=false`, and a recorded decision; the other inspected project profiles already had collection and upload disabled and were not rewritten. No saved Card prompt/model/tool changes were made for this choice.

The visible Builder CLI test reported current directory `C:\Users\jerem` and profile workspace `C:\Projects\LiquidAIty\main\HermesLatest\.hermes\profiles\builder`. This is execution evidence, not proof that Builder defaults to the repository working directory. That setting was not silently changed. A browser-control sequential-typing attempt partially entered text; it was cleared before the complete question was pasted and submitted with Enter. The real reply and returned prompt were observed in the same visible terminal.

On Oracle this PTY runs on the server. Deployment must install/build platform-appropriate dependencies, compile the Hermes TUI for that Node/platform/architecture, provide HTTPS and WebSocket proxying, configure the existing allowed origins/authentication, and retain saved profile storage. Copying Windows `.venv` or compiled PTY binaries to Linux is not deployment. Current owner checks do not constitute OS-level isolation for mutually untrusted tenants; Oracle deployment/security acceptance was not performed here.

## Other bounded findings

- Activity no longer uses `/domain/runs/latest`. Counts now represent the number of actual working/streaming sessions returned by Hermes, not a fabricated root-plus-workers estimate. This is not a promise that all nested subagents are represented by that endpoint.
- PostgreSQL remains the application conversation store. Hermes owns execution transcripts; `refreshOpenBotChat` appends exact provider-row identities once. No competing store or sync engine was created.
- Shared-source risk: canonical Bot Chat lookup is profile-scoped, not Project-keyed. If the same stable profile is shared between Projects, context/roster isolation needs explicit proof and a supported contract. Other Projects were not opened to investigate; profiles were not renamed or cloned.
- `prepareProfiles` currently refreshes scoped MCP credentials and connected rosters. The old profile-materialization file is absent; new saved-prompt/model/tool publication after Card edits was not exercised. Do not claim that surface is proven or silently recreate the removed materializer.
- Current visible-address validation in `projectCardAuthority.ts` accepts ASCII letters/digits/underscore/hyphen. No demonstrated current TradingProject address was blocked, so no naming policy was silently changed.
- No current first-party `learning.frames` call was found in the bounded inspected scope. `cardProfileClient.ts` still has profile/learning operations while the old profile route is absent. Inspector repair remains separate from messaging.

Use [ARCHITECTURE.md](../../ARCHITECTURE.md#bot-mode-application-boundary) for durable owners/contracts, [PLAN.md](../../PLAN.md) for current status, and [nextturn.md](../../nextturn.md) for the latest scratch handoff. None authorizes reopening deferred work. Preserve the owner's accepted text/image checkpoint throughout.
