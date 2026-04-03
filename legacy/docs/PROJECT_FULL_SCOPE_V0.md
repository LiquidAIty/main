# ARCHIVED

This file is retained for historical reference only.
It is not the active architecture plan.

# LIQUIDAIty — PROJECT FULL SCOPE (v0)

## Status
Current
Owner: Jeremiah
Purpose: Authoritative project scope and system definition for v0

---

# What This System Is

This is not:

- a chatbot
- a workflow tool
- a basic multi-agent system

This is:

**A project-based, contract-driven, graph-informed AI system that improves decisions, plans, and execution quality on every loop.**

Everything else, including trading, research, simulations, and business operations, sits on top of this.

---

# Core Philosophy

## 1. Data-Driven Decisions

All decisions move toward:

- evidence-backed conclusions through KnowGraph
- measured outputs through contract scoring
- reduced reliance on intuition alone

Subjective ideas are allowed, but they must be tested, grounded, and refined.

## 2. Objective + Subjective Synthesis

The system intentionally combines:

- **ThinkGraph** for subjective ideas, hypotheses, and plans
- **KnowGraph** for objective research and evidence

The system improves by continuously comparing the two and resolving gaps.

## 3. Prompt Shaping as the Intelligence Layer

AI quality improves through:

- `improvementPromptBit`
- `passforward`
- issuer-based scoring

This replaces model retraining with runtime learning through prompt shaping.

## 4. Planning Is the Core Control Surface

Better execution comes from:

- better plans
- better structured research
- better decomposition into tasks

The plan is the control layer for downstream execution.

## 5. Recursive Improvement

### Agent-Level

Each agent run:

- is scored
- produces improvement signals
- persists lineage

Future runs improve from past runs.

### Plan-Level

Each loop is:

idea -> research -> compare -> refine -> plan -> execute -> improve -> repeat

---

# Core System Loop

INPUT
-> CONTRACT
-> SUBAGENTS (DECK)
-> SCORED OUTPUTS
-> GRAPH UPDATE
-> THINK vs KNOW COMPARISON
-> PLAN UPDATE
-> HUMAN REVIEW
-> DECISION (research loop OR plan ready)
-> TASK DECOMPOSITION (if ready)
-> NEXT LOOP

Important:

- research loops still run agents
- planning loops still run agents
- execution is continuous

---

# Core System Components

## 1. Project

Projects replace chat as the main container.

A project contains:

- plan
- scratch state
- decks
- runs
- graphs
- decisions
- tasks

This is the container of truth.

## 2. Plan / Wiki Surface

The plan/wiki surface should contain:

- Idea
- Current Goal
- ThinkGraph
- KnowGraph
- Research Findings
- Convergences
- Gaps / Contradictions
- Recommended Improvements
- Next Move
- Tasks

This is the human-readable system brain.

## 3. Deck System

Decks are the execution layer.

- Card = atomic agent step
- Deck = ordered execution chain

Examples:

- Research Deck
- Extraction Deck
- Synthesis Deck
- Plan Writer Deck

## 4. Contract Runtime

Every card runs through:

contract -> handshake -> execute -> score -> result

Contracts define:

- task
- constraints
- output schema
- scoring

## 5. Graph System

### ThinkGraph

- ideas
- hypotheses
- subjective structure

### KnowGraph

- validated research
- evidence

### AgentGraph

- lineage
- scores
- improvements

For v0, AgentGraph is emerging and does not need a large standalone UI yet.

---

# Graph Flow

User Input -> ThinkGraph
ThinkGraph -> entity/relationship extraction
-> research agents
-> KnowGraph
KnowGraph <-> ThinkGraph comparison
-> plan refinement
-> new hypotheses

---

# Context Shaping

Context should be shaped from project state, not raw transcript history.

The working packet should use:

- current input
- plan summary
- graph summaries
- improvement signals
- next moves

---

# Front Door Reasoner

The front door is a decision engine, not loose chat.

It determines whether the next move is:

- research
- refine
- plan
- execute
- ask human

---

# Universal Improvement Substrate

Every run should eventually produce:

- `score`
- `probabilityRight`
- `improvementPromptBit`
- `passforward`
- `lineage`

Rules:

- issuer scores subagents
- `improvementPromptBit` stays minimal
- `passforward` carries constraints and context forward
- runs should persist when the runtime path is ready

For v0, this is the target runtime shape even if parts are still being completed.

---

# Agent Identity

Agent identity is accumulated, evaluated execution history.

---

# Research Process

1. ThinkGraph produces entities and relationships.
2. Research agents are generated or selected.
3. Evidence is gathered.
4. Evidence is written into KnowGraph.

---

# Comparison Layer

The comparison layer should produce:

- confirmed
- contradicted
- missing
- improved
- next steps

---

# Human Review

At the end of each meaningful turn, the system should support human review:

- continue research
- plan ready
- revise assumptions

---

# Plan Formation

The plan should include:

- goal
- state
- constraints
- next steps
- open questions

---

# Task Decomposition

### Agent Tasks

Executed through decks.

### Human Tasks

Agent-managed or manual.

### Prompt Tasks

Embedded in the plan when needed.

---

# v0 Scope

## In Scope

- contract runtime
- deck execution
- research loop
- ThinkGraph / KnowGraph
- plan generation
- human review
- basic tasking
- improvement signals

## Out of Scope

- advanced AgentGraph UI
- complex branching runtime
- full automation systems
- domain apps layered on top

---

# Build Order

1. Research Deck
2. Structured output
3. Plan transform
4. Assist trigger
5. Plan UI
6. Human review
7. Tasking
8. Improvement signals

---

# System Rules

- project state is more important than chat history
- contracts are required
- all runs should be scored
- improvement signals are required
- ThinkGraph and KnowGraph are distinct
- plans drive execution
- humans approve meaningful decisions
- no uncontrolled agents

---

# Final Definition

LiquidAIty v0 is a recursive, data-grounded decision and execution engine that improves plans, agents, and outcomes through structured research, comparison, and prompt-based learning.

---
