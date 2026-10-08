# Agent products

This directory contains source for agent-driven products that LiquidAIty
integrates, presents, or may host. It is separate from the platform engine so
Builder work does not need write access to LiquidAIty's application code.

Current controlled products:

- `gods-eye-view/` — the WorldView globe and interaction engine;
- `shadowbroker/` — the WorldSignals source and visualization service;
- `kronos/` — the pinned Kronos forecasting submodule used by the Trading
  adapter.

The source directory is not a second agent authority. Saved Cards and topology
remain in PostgreSQL/AGE, reusable execution configuration and learning remain
in Hermes profiles, and IDD remains the typed editor dictionary. Product code,
UI assets, package files, and deployable artifacts live here or in a
Project-owned managed code folder.

Builder sessions use one saved `projectCodeFolder`. LiquidAIty resolves that
portable folder name beneath managed Project storage and Hermes mounts only the
resolved folder into Builder's Docker terminal. The LiquidAIty checkout is not
Builder's default working directory and is never mounted as a fallback.

Imported projects remain controlled upstream forks. Keep LiquidAIty-specific
changes narrow, record them in `ARCHITECTURE.md`, and repair all startup/import
paths when a product directory moves.
