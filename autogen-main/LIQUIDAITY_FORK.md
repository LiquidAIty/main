# LiquidAIty AutoGen 0.7.5 fork

This tree is first-party LiquidAIty execution infrastructure derived from Microsoft AutoGen. It is
not a reference checkout or runtime fallback.

## Upstream base

- Repository: `https://github.com/microsoft/autogen.git`
- Tag: `python-v0.7.5`
- Commit: `83afbf5857aac683340d4c692194e548b1e8edda`
- Imported packages:
  - `python/packages/autogen-core`
  - `python/packages/autogen-agentchat`
  - `python/packages/autogen-ext`
- Upstream `LICENSE`, `LICENSE-CODE`, `README.md`, and `SECURITY.md` are preserved at this root.

The package directories were copied from a sparse checkout of that exact commit, not from
`site-packages`. At the import checkpoint, all 398 package files matched the upstream checkout by
SHA-256.

## Product ownership and public contract

LiquidAIty maintains this fork as the native Python execution engine for saved AutoGen Cards:

- saved single-assistant Cards project into native `AssistantAgent` configuration;
- the saved Mag One Card projects into native `MagenticOneGroupChat` configuration;
- Python rails resolves saved Card, transient call input, IDD, tool-grant, provider/model, and AGE-edge authority;
- AutoGen owns its native agent/team lifecycle and returns native results/events.

AutoGen must not query ReactFlow or product PostgreSQL/AGE authority, reconstruct Cards, reinterpret
Card-call format, or expose private Magentic-One ledgers as product state.

`apps/python-models/requirements.txt` installs all three packages from this checked-in tree. Wheel
fallbacks and runtime `sys.path` substitution are forbidden.

## Divergence register

There are no AutoGen internal source divergences at the initial 0.7.5 import. LiquidAIty integration
remains in `apps/python-models` adapters and contract tests. Every later internal change must record:

- upstream file and symbol;
- product reason and unavailable extension point;
- behavior preserved;
- focused no-provider and runtime tests;
- removal or upstream-contribution strategy.

Private Magentic-One Task/Progress Ledger fields and prompts are not extension points.

## Maintenance procedure

AutoGen is frozen at this exact 0.7.5 base. LiquidAIty will not rebase this fork onto later Microsoft
AutoGen versions. A specific security or compatibility fix may be manually evaluated and ported only
through an explicit bounded task; that does not change the fork version or upstream base.

1. Finish and save the current product checkpoint before changing this fork.
2. Record every local file/symbol divergence against the immutable base commit above.
3. Prefer LiquidAIty-owned Python-rails adapters until an AutoGen extension point is genuinely
   insufficient.
4. Make the smallest internal fork change and preserve native AssistantAgent/Mag One behavior.
5. Install the three local packages into the Python-rails environment and prove all imports resolve
   to this tree.
6. Run the single-assistant characterization first, then one-worker Mag One, then full connected-team
   tests. Provider tests remain a separately approved stage.
7. Rebuild the canonical Codebase Memory project only after the source boundary is stable.

## Tests and rollback

Focused parity is owned by:

- `apps/python-models/app/python_models/test_autogen_adapter.py`
- `apps/python-models/app/python_models/test_run_configured_card.py`
- `apps/python-models/app/python_models/test_mag_one_characterization.py`
- `apps/python-models/app/python_models/test_card_domain.py`

Rollback of a local divergence means restoring the affected file from the recorded upstream base and
removing its divergence entry. Rolling the product back to external AutoGen wheels is not an allowed
hidden fallback; it requires an explicit architecture decision and matching dependency/test changes.
