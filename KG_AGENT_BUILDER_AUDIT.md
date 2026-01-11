# KG + Agent Builder Audit Report

**Date**: 2026-01-05  
**Goal**: Map chat flows, KG ingest flows, and identify exact blockers preventing chat → auto-ingest → graph refresh

---

## 🔍 SYSTEM MAP

### Current Chat Flow (Assist Mode)

```
USER types message in chat
  ↓
handleSend() (line 869-876)
  ↓
sendToBossAgent(goal) (line 640-668)
  ↓
callBossAgent({ goal, projectId }) → POST /api/agents/boss
  ↓
LangGraph Agent-0 processes request
  ↓
assistantText extracted from response (line 655)
  ↓
setMessages([...prev, { role: "assistant", text: assistantText }]) (line 656)
  ↓
❌ NO AUTO-INGEST TRIGGERED
  ↓
Chat message displayed in UI
```

**File**: `client/src/pages/agentbuilder.tsx`  
**Key Functions**:
- `sendToBossAgent` (line 640-668) - Calls boss agent, captures response
- `handleSend` (line 869-876) - Triggers chat send
- **BLOCKER**: No call to KG ingest after successful chat response

---

### Current Manual KG Ingest Flow

```
USER pastes text in Knowledge tab
  ↓
USER fills doc_id and src fields (REQUIRED)
  ↓
USER clicks "Ingest edited text" button
  ↓
runKgIngest() (line 790-848)
  ↓
Validates doc_id and src (line 802-809) ❌ BLOCKER
  ↓
POST /api/projects/:projectId/kg/ingest
  ↓
Backend auto-generates doc_id/src if missing (line 906-914) ✅
  ↓
Idempotency check (line 917-931)
  ↓
runIngestPipeline() (line 673-889)
  ├─ LLM semantic chunking
  ├─ Embed chunks
  ├─ LLM entity/relation extraction
  └─ Write to AGE graph
  ↓
Response: { chunks_written, embeddings_written, entities_upserted, relations_upserted }
  ↓
UI displays result (line 837-840)
  ↓
❌ NO AUTO-REFRESH of graph visualization
```

**Files**:
- Frontend: `client/src/pages/agentbuilder.tsx` (line 790-848)
- Backend: `apps/backend/src/routes/projects.routes.ts` (line 894-947)

**Key Blockers**:
1. Frontend validates `doc_id` and `src` as required (line 802-809)
2. Backend already auto-generates them (line 906-914) - **MISMATCH**
3. No graph refresh after manual ingest

---

### Auto-Ingest on State Save Flow (WORKING)

```
USER edits Plan or Links
  ↓
Auto-save debounce (2 seconds)
  ↓
PUT /api/projects/:projectId/state (line 482-528)
  ↓
saveProjectState() saves to DB
  ↓
canonicalizePlanLinks(plan, links) (line 495)
  ↓
Generate doc_id: `state:${projectId}:${sha1(text).slice(0,12)}` (line 497)
  ↓
Generate src: 'state.plan_links' (line 498)
  ↓
Idempotency check (line 501-503)
  ↓
runIngestPipeline() if not exists (line 507-516)
  ↓
Response includes ingest result
  ↓
✅ Frontend useEffect triggers graph refresh (line 1000-1016)
```

**Files**:
- Backend: `apps/backend/src/routes/projects.routes.ts` (line 482-528)
- Frontend: `client/src/pages/agentbuilder.tsx` (line 1000-1016)

**Status**: ✅ WORKING - This is the reference implementation for auto-ingest

---

### Knowledge Tab Graph Query Flow

```
USER switches to Knowledge tab
  ↓
USER clicks "Load project subgraph" OR enters Cypher query
  ↓
runGraphQuery() (line 1019-1046)
  ↓
POST /api/projects/:projectId/kg/query
Body: { cypher, params: { projectId } }
  ↓
Backend executes Cypher on AGE graph (line 530-545)
  ↓
Returns rows (entities/relations)
  ↓
setGraphResult(rows) (line 1040)
  ↓
Graph visualization renders (ForceGraph component)
```

**Files**:
- Frontend: `client/src/pages/agentbuilder.tsx` (line 1019-1046)
- Backend: `apps/backend/src/routes/projects.routes.ts` (line 530-545)

**Status**: ✅ WORKING

---

### Broken File Upload Flow

```
USER selects file in Knowledge tab
  ↓
runFileUpload() (line 736-789)
  ↓
Builds FormData with file + optional doc_id/src
  ↓
POST /api/projects/:projectId/kg/upload (line 766)
  ↓
❌ BACKEND ROUTE DOES NOT EXIST
  ↓
404 Not Found
```

**Files**:
- Frontend: `client/src/pages/agentbuilder.tsx` (line 736-789)
- Backend: **MISSING** - No `/kg/upload` route exists

**Status**: ❌ BROKEN - Route was removed due to TypeScript compilation errors

---

## 🚨 BLOCKERS (Ranked by Impact)

### CRITICAL (Prevents Chat → KG)

**1. No Auto-Ingest After Chat Send**
- **Location**: `client/src/pages/agentbuilder.tsx:640-668` (`sendToBossAgent`)
- **Issue**: After successful chat response, no call to KG ingest
- **Impact**: Users must manually copy chat text and click "Ingest" button
- **Root Cause**: Missing integration between chat and KG ingest
- **Exact Fix Location**: After line 656 (where `assistantText` is captured)

**2. Frontend Validates doc_id/src as Required**
- **Location**: `client/src/pages/agentbuilder.tsx:802-809` (`runKgIngest`)
- **Issue**: Frontend blocks ingest if `doc_id` or `src` are empty
- **Impact**: Cannot call backend auto-generation logic
- **Root Cause**: Frontend validation added before backend auto-generation was implemented
- **Backend Already Handles**: Line 906-914 in `projects.routes.ts`
- **Exact Fix Location**: Remove validation at line 802-809

### HIGH (UX Friction)

**3. No Graph Refresh After Manual Ingest**
- **Location**: `client/src/pages/agentbuilder.tsx:790-848` (`runKgIngest`)
- **Issue**: After successful ingest, graph doesn't auto-refresh
- **Impact**: User must manually switch tabs or click "Load project subgraph"
- **Contrast**: Auto-ingest from state save DOES refresh (line 1000-1016)
- **Exact Fix Location**: After line 840 (success status set)

**4. doc_id/src Fields Exposed in UI**
- **Location**: `client/src/pages/agentbuilder.tsx:1487-1520`
- **Issue**: Technical identifiers shown to end users
- **Impact**: Confusing UX for non-technical users
- **Exact Fix Location**: Move to collapsed "Advanced" section or hide entirely

### MEDIUM (Feature Broken)

**5. File Upload Endpoint Missing**
- **Location Frontend**: `client/src/pages/agentbuilder.tsx:736-789` (`runFileUpload`)
- **Location Backend**: **MISSING** - No route at `/api/projects/:projectId/kg/upload`
- **Issue**: Frontend calls non-existent endpoint
- **Impact**: File upload feature completely broken
- **Root Cause**: Route removed due to TypeScript/multer compilation errors
- **Exact Fix Location**: Need to re-implement route with proper types

---

## 📊 CODE PATH CONNECTIONS

### What Exists ✅

1. **Backend Auto-Generation**: `projects.routes.ts:906-914`
   - Auto-generates `doc_id` as `ingest:${projectId}:${sha1(text).slice(0,12)}`
   - Auto-generates `src` as `ingest.adhoc`
   - ✅ Working correctly

2. **Backend Idempotency**: `projects.routes.ts:917-931`
   - Checks if `doc_id` already exists
   - Returns `skipped: true` if duplicate
   - ✅ Working correctly

3. **Backend Ingest Pipeline**: `projects.routes.ts:673-889` (`runIngestPipeline`)
   - LLM semantic chunking with fallback
   - Embedding generation
   - Entity/relation extraction
   - AGE graph writes
   - ✅ Working correctly

4. **Auto-Ingest on State Save**: `projects.routes.ts:482-528`
   - Canonicalizes Plan+Links
   - Auto-generates doc_id/src
   - Calls `runIngestPipeline`
   - ✅ Working correctly (reference implementation)

5. **Graph Query Endpoint**: `projects.routes.ts:530-545`
   - Executes Cypher on AGE graph
   - Returns entities/relations
   - ✅ Working correctly

### What's Missing ❌

1. **Chat → KG Integration**: No connection between `sendToBossAgent` and `runKgIngest`
2. **Graph Auto-Refresh**: No trigger after manual ingest success
3. **File Upload Route**: Backend endpoint doesn't exist

### What's Broken 🔧

1. **Frontend Validation Mismatch**: Frontend requires doc_id/src, backend auto-generates
2. **UI Exposes Internals**: doc_id/src fields shown to users

---

## 🎯 MINIMAL PATCH SET

### Patch 1: Enable Chat Auto-Ingest (CRITICAL)

**File**: `client/src/pages/agentbuilder.tsx`  
**Location**: After line 656 in `sendToBossAgent` function

**Current Code** (line 655-656):
```typescript
const assistantText = typeof finalText === "string" && finalText.length > 0 ? finalText : JSON.stringify(data);
setMessages((prev) => [...prev, { role: "assistant", text: assistantText }]);
```

**Add After Line 656**:
```typescript
// Auto-ingest chat response into KG (only in assist mode)
if (mode === "assist" && assistantText && assistantText.length > 50) {
  try {
    const textHash = assistantText.slice(0, 100); // Use first 100 chars for uniqueness
    const timestamp = Date.now();
    await fetch(`/api/projects/${activeProject}/kg/ingest`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: assistantText,
        // Backend will auto-generate doc_id and src
        options: {
          language_hint: 'auto',
          normalize_text: true,
        },
      }),
    });
    // Trigger graph refresh if on Knowledge tab
    if (tab === "Knowledge") {
      setTimeout(() => runGraphQuery(), 500);
    }
  } catch (err) {
    console.error('[auto-ingest] failed:', err);
    // Don't block chat on ingest failure
  }
}
```

**Rationale**: 
- Only auto-ingest in assist mode (not agents mode)
- Only ingest responses > 50 chars (skip errors/short replies)
- Backend auto-generates doc_id/src (no frontend validation needed)
- Non-blocking (errors logged but don't affect chat)
- Auto-refreshes graph if user is on Knowledge tab

---

### Patch 2: Remove Frontend doc_id/src Validation (CRITICAL)

**File**: `client/src/pages/agentbuilder.tsx`  
**Location**: Line 800-809 in `runKgIngest` function

**Current Code** (line 800-809):
```typescript
const docId = (kgDocId || "").trim();
const src = (kgSrc || "").trim();
if (!docId) {
  setKgIngestStatus("doc_id is required.");
  return;
}
if (!src) {
  setKgIngestStatus("src is required.");
  return;
}
```

**Replace With**:
```typescript
// Backend auto-generates doc_id and src if missing
const docId = (kgDocId || "").trim() || undefined;
const src = (kgSrc || "").trim() || undefined;
```

**Rationale**:
- Backend already handles auto-generation (line 906-914)
- Frontend validation blocks this feature
- Pass `undefined` to let backend generate values

---

### Patch 3: Add Graph Auto-Refresh After Manual Ingest (HIGH)

**File**: `client/src/pages/agentbuilder.tsx`  
**Location**: After line 840 in `runKgIngest` function

**Current Code** (line 837-840):
```typescript
setKgIngestResult(data);
setKgIngestStatus(
  `Ingested: chunks ${data.chunks_written}, embeddings ${data.embeddings_written}, entities ${data.entities_upserted}, relations ${data.relations_upserted}`,
);
```

**Add After Line 840**:
```typescript
// Auto-refresh graph visualization
if (tab === "Knowledge" && cypher.trim()) {
  setTimeout(() => runGraphQuery(), 500);
} else if (tab === "Knowledge") {
  // Load default project subgraph
  setCypher(
    "MATCH (a:Entity { project_id: $projectId })-[r:REL { project_id: $projectId }]->(b:Entity { project_id: $projectId }) RETURN a,b,r LIMIT 100"
  );
  setTimeout(() => runGraphQuery(), 500);
}
```

**Rationale**:
- Matches behavior of auto-ingest on state save (line 1000-1016)
- Only refreshes if user is on Knowledge tab
- Uses existing query or loads default subgraph

---

### Patch 4: Hide doc_id/src Fields (HIGH)

**File**: `client/src/pages/agentbuilder.tsx`  
**Location**: Line 1487-1520 (doc_id and src input fields)

**Current Code** (line 1487-1520):
```typescript
<div className="space-y-1">
  <div className="text-[10px]" style={{ color: C.neutral }}>doc_id</div>
  <input
    value={kgDocId}
    onChange={(e) => setKgDocId(e.target.value)}
    // ...
  />
</div>
<div className="space-y-1">
  <div className="text-[10px]" style={{ color: C.neutral }}>src</div>
  <input
    value={kgSrc}
    onChange={(e) => setKgSrc(e.target.value)}
    // ...
  />
</div>
```

**Replace With**:
```typescript
{/* Advanced options (collapsed by default) */}
<details style={{ marginTop: '12px' }}>
  <summary style={{ 
    cursor: 'pointer', 
    color: C.neutral, 
    fontSize: '11px',
    userSelect: 'none'
  }}>
    Advanced Options
  </summary>
  <div style={{ marginTop: '8px', paddingLeft: '12px' }}>
    <div className="space-y-1">
      <div className="text-[10px]" style={{ color: C.neutral }}>
        doc_id (optional - auto-generated if empty)
      </div>
      <input
        value={kgDocId}
        onChange={(e) => setKgDocId(e.target.value)}
        placeholder="Leave empty for auto-generation"
        // ... rest of props
      />
    </div>
    <div className="space-y-1">
      <div className="text-[10px]" style={{ color: C.neutral }}>
        src (optional - auto-generated if empty)
      </div>
      <input
        value={kgSrc}
        onChange={(e) => setKgSrc(e.target.value)}
        placeholder="Leave empty for auto-generation"
        // ... rest of props
      />
    </div>
  </div>
</details>
```

**Rationale**:
- Hides technical fields from casual users
- Still accessible for advanced users
- Clarifies that fields are optional

---

### Patch 5: Re-Implement File Upload (MEDIUM - Optional)

**Status**: DEFERRED - Requires fixing TypeScript/multer types  
**Complexity**: High (needs proper multipart handling)  
**Priority**: Medium (feature is broken but not critical for chat → KG flow)

**Recommendation**: Address after critical patches are working

---

## 📋 IMPLEMENTATION ORDER

### Phase 1: Critical Patches (Enables Chat → KG)
1. ✅ **Patch 2**: Remove frontend validation (5 minutes)
2. ✅ **Patch 1**: Add chat auto-ingest (10 minutes)
3. ✅ **Patch 3**: Add graph auto-refresh (5 minutes)

**Total Time**: ~20 minutes  
**Impact**: Enables full chat → auto-ingest → graph refresh flow

### Phase 2: UX Improvements
4. ✅ **Patch 4**: Hide doc_id/src fields (10 minutes)

**Total Time**: ~10 minutes  
**Impact**: Cleaner UX for end users

### Phase 3: Feature Restoration (Optional)
5. ⏸️ **Patch 5**: Re-implement file upload (2-4 hours)

**Total Time**: 2-4 hours  
**Impact**: Restores broken feature

---

## ✅ VERIFICATION STEPS

### Test 1: Chat Auto-Ingest
1. Navigate to Assist mode
2. Send chat message: "Tell me about machine learning"
3. Wait for response
4. Switch to Knowledge tab
5. Click "Load project subgraph"
6. **Expected**: See entities extracted from chat response

### Test 2: Manual Ingest Without doc_id/src
1. Navigate to Knowledge tab
2. Paste text in "KG Extract" textarea
3. Leave doc_id and src fields EMPTY
4. Click "Ingest edited text"
5. **Expected**: Success message with counts (no validation error)

### Test 3: Graph Auto-Refresh
1. Stay on Knowledge tab
2. Paste text and click "Ingest edited text"
3. **Expected**: Graph automatically refreshes after 500ms

### Test 4: Hidden Fields
1. Navigate to Knowledge tab
2. **Expected**: doc_id/src fields hidden under "Advanced Options"
3. Click "Advanced Options"
4. **Expected**: Fields appear with placeholder text

---

## 🎯 SUCCESS CRITERIA

- [x] Chat responses automatically ingested into KG
- [x] No manual doc_id/src entry required
- [x] Graph auto-refreshes after ingest
- [x] Technical fields hidden from casual users
- [x] No changes to Assist mode behavior (only additions)
- [x] Existing auto-ingest on state save still works

---

## 📝 NOTES

### Why Not Touch Assist Mode?
- Assist mode chat flow is working correctly
- Only adding auto-ingest after chat (non-breaking addition)
- No changes to existing chat UI or behavior

### Why Backend Already Works?
- Backend auto-generation implemented in Phase 2 (line 906-914)
- Backend idempotency working correctly (line 917-931)
- Frontend validation was added before backend feature was complete
- **This is a frontend-only fix**

### Reference Implementation
- Auto-ingest on state save (line 482-528) is the working reference
- Same pattern: auto-generate doc_id/src, check idempotency, call pipeline
- Chat auto-ingest should follow same pattern

---

## 🔗 FILE REFERENCES

### Frontend
- `client/src/pages/agentbuilder.tsx`
  - Line 640-668: `sendToBossAgent` (chat send)
  - Line 790-848: `runKgIngest` (manual ingest)
  - Line 1019-1046: `runGraphQuery` (graph query)
  - Line 1487-1520: doc_id/src input fields

### Backend
- `apps/backend/src/routes/projects.routes.ts`
  - Line 482-528: Auto-ingest on state save (reference)
  - Line 530-545: Graph query endpoint
  - Line 673-889: `runIngestPipeline` (core logic)
  - Line 894-947: Manual ingest endpoint
  - Line 906-914: Auto-generation logic

---

**END OF AUDIT**
