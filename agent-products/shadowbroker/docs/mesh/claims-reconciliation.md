# ShadowBroker Mesh Claims Reconciliation

This file maps high-level release claims to implementation status for v0.9.83.
It exists to prevent the public README from promising stronger privacy or
security than the code provides.

| Claim | Status | Implementation Notes |
|---|---|---|
| InfoNet is a decentralized intelligence mesh. | Supported as testnet | Mesh routing, signed events, peer sync, gate personas, and Wormhole relay code are present, but deployment topology is still experimental. |
| Gate chat is private. | Not supported | Gate chat is obfuscated and signed, not end-to-end private. Public claims must say "obfuscated" rather than "private". |
| Dead Drop DMs are the strongest current private lane. | Supported with caveats | DM mailboxes, token handling, SAS/contact verification, sealed payloads, and witness/root transparency code exist. The lane is still experimental and should not be described as confidently private. |
| Sovereign Shell governance is public. | Supported | Governance events are signed public records and should be documented as observable. |
| Function Keys provide anonymous citizenship proof. | Partial | Nullifiers, challenge-response, receipts, denial codes, and settlement scaffolding exist. Blind-signature issuance is not complete. |
| RingCT, stealth addresses, shielded balances, and DEX privacy are live. | Not supported | Protocol interfaces and Rust integration targets exist, but final primitives are not selected, wired, and audited. |
| Legacy ZIP installs can update to v0.9.83. | Supported if release assets are attached | Publish `ShadowBroker_v0.9.83.zip` and `SHA256SUMS.txt`. Newer updaters can fall back to GitHub `zipball_url`, but the named asset is the verifiable path. |
| Docker users should update by pulling images. | Supported | The updater detects Docker/runtime contexts and returns Docker pull instructions instead of attempting in-place extraction. |
