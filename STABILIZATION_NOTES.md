# STABILIZATION NOTES - PHASE 1

## PHASE 1: Stop Project List Fetch Spam

### Problem
`refreshProjects()` was being called repeatedly due to dependency loop:
- Function had `[mode, activeProject, setActiveProjectWithUrl]` in deps
- Mount effect had `[refreshProjects, setActiveProjectWithUrl, mode]` in deps
- Every mode change triggered mount effect → infinite loop
- Backend logs showed: "rows: 0 then rows: 2 then rows: 2..." spam

### Changes Made

**File: `client/src/pages/agentbuilder.tsx`**

1. **Fixed `refreshProjects` callback deps (line 566)**
   - BEFORE: `[mode, activeProject, setActiveProjectWithUrl]`
   - AFTER: `[setActiveProjectWithUrl]` only
   - Removed `mode` and `activeProject` from deps (accessed via closure, not reactive)
   - Added `reason` parameter for tracking

2. **Fixed mount effect deps (line 667-675)**
   - BEFORE: `[refreshProjects, setActiveProjectWithUrl, mode]`
   - AFTER: `[]` (empty deps = mount only)
   - Added eslint-disable comment to suppress warning
   - Passes `reason='mount'` to track call source

3. **Added console.debug tracking (line 523)**
   ```typescript
   console.debug('[refreshProjects]', { 
     reason: reason || 'unknown', 
     mode, 
     project_type_filter: projectType, 
     seq 
   });
   ```

4. **Updated all call sites with reason tracking:**
   - Mount: `reason='mount'`
   - Mode toggle buttons: `reason='mode-change'`
   - After create: `reason='after-create'`
   - After delete: `reason='after-delete'`

### Expected Behavior

**On initial page load (React StrictMode dev):**
- Max 2 calls: `[refreshProjects] { reason: 'mount', seq: 1 }` and `seq: 2`
- Backend logs: 2 list calls max

**On mode toggle (Assist ↔ Agent):**
- Exactly 1 call: `[refreshProjects] { reason: 'mode-change', seq: N }`
- Backend logs: 1 list call

**On tab change (Chat/Plan/Knowledge/etc):**
- 0 calls (tabs don't trigger refresh)

**On project selection:**
- 0 calls (project selection doesn't trigger refresh)

### Test Commands

```powershell
# 1. Start dev server
cd client
npm run dev

# 2. Open browser console (F12)
# 3. Reload page → count [refreshProjects] logs (should be 2 max in dev, 1 in prod)
# 4. Toggle Assist → Agent → count logs (should be 1 per toggle)
# 5. Switch tabs → count logs (should be 0)
# 6. Switch projects → count logs (should be 0)
```

### Backend Verification

```powershell
# Watch backend logs for list calls
# Should see max 2 on page load, 1 per mode toggle
# No spam, no "rows: 0 then rows: 2" loops
```

### Done Criteria

✅ Client build passes  
✅ `refreshProjects` has stable deps (no mode/activeProject)  
✅ Mount effect runs once (empty deps array)  
✅ All call sites pass reason tracking  
✅ Console logs show reason + seq for debugging  

### Next: PHASE 2

Fix model dropdown - ensure provider keys match exactly ("openai"/"openrouter") and dropdown populates correctly.

---

## CHUNKING FIX: Force OpenAI for Structured JSON

### Problem
Kimi K2 was returning `{"chunks":[]}` (empty array) for semantic chunking, causing ingest to fail with:
```
chunking_invalid_json: LLM chunking produced no valid chunks
```

### Root Cause
- Kimi and other OpenRouter models don't reliably produce structured JSON with non-empty arrays
- Chunking requires strict schema compliance (chunk_index, title, text fields)
- OpenAI has native JSON schema mode that enforces structure

### Changes Made

**File: `apps/backend/src/routes/projects.routes.ts`**

1. **Force OpenAI for chunking (lines 320-325)**
   ```typescript
   // FORCE OpenAI for structured JSON output (chunking requires strict schema)
   const OPENAI_JSON_MODEL = process.env.OPENAI_DEFAULT_MODEL || 'gpt-5-nano';
   const actualModelKey = OPENAI_JSON_MODEL;
   console.log('[LLM chunking] forcing provider=openai model=%s (structured JSON required)', actualModelKey);
   ```

2. **Update runLLM call to use actualModelKey (line 357)**
   - Changed from `modelKey: llmModelKey` to `modelKey: actualModelKey`
   - Ensures OpenAI is used regardless of project config

3. **Add fallback for empty chunks (lines 459-485)**
   - If LLM returns empty chunks, create 1 chunk from full text
   - Prevents ingest failure, allows pipeline to continue
   - Logs `fallback_chunking_used=true` in trace

### Expected Logs

**On KG ingest trigger:**
```
[LLM chunking] requested_model_key=kimi-k2-thinking prompt_sha1=...
[LLM chunking] forcing provider=openai model=gpt-5-nano (structured JSON required)
[LLM chunking] raw_output_sha1=... raw_len=... provider=openai
```

**Success criteria:**
- `provider=openai` (not openrouter)
- `chunk_count > 0` (at least 1 chunk)
- No `chunking_invalid_json` errors
- Downstream steps run (embedding, extract, DB write)

### Test Commands

```powershell
# 1. Start backend
nx serve backend

# 2. Trigger KG ingest (send chat message or upload doc with KG enabled)

# 3. Watch backend logs for:
#    - [LLM chunking] forcing provider=openai
#    - chunk_count > 0
#    - No chunking_failed errors

# 4. Verify ingest completes successfully
```

### Done Criteria

✅ Backend builds successfully  
✅ Chunking forces OpenAI (not Kimi)  
✅ Fallback creates 1 chunk if LLM returns empty  
✅ Logs show provider=openai  
⏳ Test: Verify chunk_count > 0 in real ingest  
⏳ Test: Verify downstream pipeline completes  
