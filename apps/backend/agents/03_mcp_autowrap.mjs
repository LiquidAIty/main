// AutoWrap MCP server: expose multiple tools from a tiny inline manifest.
// KISS: stdio JSON-RPC, read-first defaults, SMOKE mode, k/time caps.
import { createInterface } from "node:readline";
import { Pool } from "pg";

// ---- Config & caps ----
const PGURL = process.env.PGURL || "postgres://postgres:postgres@localhost:5432/liquidaity";
const SMOKE = (process.env.MCP_SMOKE || "0") === "1";
const K_CAP = 20, TMO_CAP = 15000;
const pool = SMOKE ? null : new Pool({ connectionString: PGURL });

// Manifest: add tools here. Keep names stable.
// kind: "pg-sql" (param order: [query,k,min_conf]) or "node-func" ({module,export})
const TARGETS = [
  {
    name: "db.rag_topk_cosine",
    desc: "RAG cosine via api.rag_topk_cosine",
    kind: "pg-sql",
    sql: "select * from api.rag_topk_cosine($1,$2,$3)"
  },
  {
    name: "db.rag_topk_hybrid",
    desc: "RAG hybrid via api.rag_topk_hybrid_cosine",
    kind: "pg-sql",
    sql: "select * from api.rag_topk_hybrid_cosine($1,$2,$3)"
  },
  {
    name: "git.status",
    desc: "Get git repository status",
    kind: "node-func",
    mod: "./utils/git.js",
    exp: "getStatus"
  },
  {
    name: "db.list_projects",
    desc: "List active projects from personal DB",
    kind: "pg-sql",
    sql: "select * from api.list_projects($1)"
  },
  {
    name: "db.get_active_tasks",
    desc: "Get active tasks for user",
    kind: "pg-sql",
    sql: "select * from api.get_active_tasks($1,$2)"
  }
];

// Shared schema
const baseProps = {
  query: { type:"string", description:"Query or input string" },
  k: { type:"integer", minimum:1, maximum:K_CAP, default:8 },
  min_confidence: { type:"number", minimum:0, maximum:1, default:0 },
  timeout_ms: { type:"integer", minimum:100, maximum:TMO_CAP, default:5000 },
  smoke: { type:"boolean" }
};

// Build tool list w/ JSON Schemas
const tools = TARGETS.map(t => ({
  name: t.name,
  description: t.desc,
  input_schema: { type:"object", properties: baseProps, required: t.kind==="pg-sql" ? ["query"] : [] }
}));

// Util
function ok(id, result){ return { jsonrpc:"2.0", id, result }; }
function er(id, code, msg, data){ return { jsonrpc:"2.0", id, error:{ code, message:msg, data } }; }
const clamp = (v,min,max)=>Math.max(min,Math.min(max,Number(v)));
const toBool = v => (typeof v==="boolean"?v:["1","true","yes","y"].includes(String(v).toLowerCase()));

function smokeRows(name, q, k){
  const n = clamp(k,1,K_CAP);
  return Array.from({length:n},(_,i)=>({ id:`smoke_${name}_${i+1}`, score:0.99-i*0.01, chunk:`SMOKE ${name} #${i+1}: ${q}`, meta:{source:"smoke"} }));
}

async function runPg(sql, params, timeoutMs){
  const c = await pool.connect();
  try {
    return await Promise.race([
      c.query({ text: sql, values: params }).then(r=>r.rows),
      new Promise((_,rej)=>setTimeout(()=>rej(new Error("timeout")), timeoutMs))
    ]);
  } finally { c.release(); }
}

async function callTool(target, args){
  const q = String(args?.query ?? "").trim();
  const k = clamp(args?.k ?? 8, 1, K_CAP);
  const minc = Number(args?.min_confidence ?? 0);
  const tmo = clamp(args?.timeout_ms ?? 5000, 100, TMO_CAP);
  const useSmoke = SMOKE || toBool(args?.smoke);

  if (target.kind === "pg-sql") {
    if (useSmoke) return smokeRows(target.name, q, k);
    try { return await runPg(target.sql, [q, k, minc], tmo); }
    catch(e){ throw new Error(`${target.name} failed: ${e.message}`); }
  }

  if (target.kind === "node-func") {
    if (useSmoke) return [{ id:"smoke_func", out:`ok:${target.name}`, args }];
    const mod = await import(target.mod);
    const fn = mod[target.exp];
    if (typeof fn !== "function") throw new Error(`Export not found: ${target.mod}::${target.exp}`);
    // Pass raw args; keep tool-specific validation in the function.
    const res = await Promise.race([
      Promise.resolve(fn(args)),
      new Promise((_,rej)=>setTimeout(()=>rej(new Error("timeout")), tmo))
    ]);
    return Array.isArray(res) ? res : [res];
  }

  throw new Error(`Unknown kind: ${target.kind}`);
}

// JSON-RPC loop
const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on("line", async (line)=>{
  let msg; try { msg = JSON.parse(line); } catch { return; }
  const { id, method, params } = msg;
  try {
    if (method==="tools/list") return process.stdout.write(JSON.stringify(ok(id,{ tools }))+"\n");
    if (method==="tools/call") {
      const name = params?.name, args = params?.arguments || {};
      const t = TARGETS.find(x=>x.name===name);
      if (!t) return process.stdout.write(JSON.stringify(er(id,-32601,"Tool not found",{name}))+"\n");
      const data = await callTool(t, args);
      return process.stdout.write(JSON.stringify(ok(id,{ content:[{type:"json", data}] }))+"\n");
    }
    if (method==="ping") return process.stdout.write(JSON.stringify(ok(id,{ok:true}))+"\n");
    return process.stdout.write(JSON.stringify(er(id,-32601,"Method not found",{method}))+"\n");
  } catch(e){
    return process.stdout.write(JSON.stringify(er(id,-32000,e.message))+"\n");
  }
});

process.on("SIGINT", async ()=>{ if (pool) await pool.end().catch(()=>{}); process.exit(0); });
