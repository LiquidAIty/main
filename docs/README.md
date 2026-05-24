# Documentation Map

This folder is the canonical documentation surface for LiquidAIty project/runtime behavior.

## Structure

```text
docs/
├── README.md                     # This index
├── architecture.md               # System architecture and execution rails
├── AGENT_RUNTIME_README.md       # Runtime integration specifics and smoke guidance
├── entity-relationship-architecture-spec.md
├── runbooks/
│   └── full-stack-dev.md         # Canonical local start + validation flow
└── decisions/
    └── README.md                 # ADR index + template
```

## How To Use
- Start with `architecture.md` for system model.
- Use `runbooks/full-stack-dev.md` for operational startup/testing.
- Record architecture decisions under `docs/decisions/` as ADRs.
- Keep runtime-specific details in `AGENT_RUNTIME_README.md`.

## Documentation Rules
- Prefer explicit commands and expected outputs.
- Include file paths for every technical claim.
- Separate stable architecture from temporary debugging notes.
