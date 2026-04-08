# Stabilization Audit - Probability System

## Goal
Prove that runtime uses the deck configs saved in Agent mode.

## What Was Added

### 1. Logging at Config Resolution Points

**Chat Runtime** (`agent.routes.ts:123-135`):
```
[ASSIST_CHAT] CONFIG RESOLUTION: {
  projectId, assist_main_agent_id, agent_name, agent_code,
  model_key, provider, temperature, max_tokens,
  system_prompt_length, system_prompt_preview (80 chars),
  system_prompt_hash (12 chars)
}
```

**KG Ingest Runtime** (`projects.routes.ts:1282-1290`):
```
[KG_INGEST] CONFIG RESOLUTION: {
  projectId, model_key, temperature, max_tokens,
  system_prompt_length, system_prompt_preview (80 chars),
  system_prompt_hash (12 chars)
}
```

### 2. How Config Resolution Works

**Chat** uses `resolveAssistMainAgent()`:
- Looks up agent by `assist_main_agent_id` or finds first `agent_type='llm_chat'`
- Builds system prompt from: `role_text`, `goal_text`, `constraints_text`, `memory_policy_text`, `prompt_template`
- Uses agent's `model` field or falls back to `DEFAULT_MODEL`

**KG Ingest** uses hardcoded system prompt (NOT from deck):
- System prompt is hardcoded: "Extract KG entities and relations..."
- Model key comes from function parameter `llmModelKey`
- Does NOT read from kg-ingest deck config

## Verification Commands

### 1. Check DB has saved templates
```powershell
psql "postgresql://postgres:postgres@localhost:5433/liquidaity" -c "SELECT id, name, code, LEFT(agent_prompt_template, 100) as prompt_preview FROM ag_catalog.projects WHERE project_type='agent' ORDER BY code;"
```

### 2. Test Chat uses deck config
1. Open Agent mode → Chat deck
2. Add to constraints: "Always include the word BANANA in the first sentence."
3. Save
4. Send a chat message
5. Check logs for `[ASSIST_CHAT] CONFIG RESOLUTION` - verify prompt_hash changed
6. Check response includes "BANANA"

### 3. Test KG Ingest logs config
1. Trigger any ingest event (upload doc or chat turn with KG enabled)
2. Check logs for `[KG_INGEST] CONFIG RESOLUTION`
3. Note: KG Ingest currently uses HARDCODED prompt, not deck config

## Current State

✅ **Chat Runtime**: Uses deck config from DB via `resolveAssistMainAgent()`
✅ **KG Ingest Runtime**: Uses deck config from DB via `loadKgIngestSystemPrompt()`
  - Looks up `projects.code='kg-ingest'` and loads `agent_prompt_template`
  - Falls back to hardcoded prompt if missing/empty/error
  - Logs `prompt_source: 'deck'` or `'fallback'` and prompt hash

## Implementation Details

**KG Ingest Prompt Resolution** (`projects.routes.ts:177-196`):
```typescript
async function loadKgIngestSystemPrompt(): Promise<{ prompt: string; fromDeck: boolean }> {
  const fallback = 'Extract KG entities and relations...';
  const q = `
    SELECT COALESCE(NULLIF(agent_prompt_template, ''), '') AS prompt
    FROM ag_catalog.projects
    WHERE project_type='agent' AND code='kg-ingest'
    LIMIT 1;
  `;
  try {
    const r = await pool.query(q);
    const prompt = (r?.rows?.[0]?.prompt || '').trim();
    return prompt.length ? { prompt, fromDeck: true } : { prompt: fallback, fromDeck: false };
  } catch (e: any) {
    console.warn('[KG_INGEST] prompt lookup failed, using fallback:', e?.message);
    return { prompt: fallback, fromDeck: false };
  }
}
```

## Probability System Status

✅ Table: `ag_catalog.llm_probability` (minimal schema)
✅ Parser: `@p=<float>` format with 0.50 default
✅ Capture: Wired into Chat and KG Ingest paths
✅ Rating: `POST /api/receipts/:run_id/rate`
✅ Query: `GET /api/receipts/latest?project_id=<uuid>`
✅ Prompts: Both decks require `@p=<float>` final line

## Volume Calculation

Volume = `SELECT COUNT(*) FROM ag_catalog.llm_probability WHERE project_id = $1`

No separate volume fields. Each insert = +1 volume automatically.

## Prior Probability

`probability_prior` can be stored in project `agent_config` JSON (one-time, when creating new deck version).
Used only when `runs = 0`.
