// Goal Runner: executes an approved plan JSON by calling MCP tools via stdio.
// No DB writes. Read-only by default. Stops on low confidence or errors.
import fs from "node:fs";
import readline from "node:readline";
import { MCPClient } from "./02_mcp_client.mjs";

const K_CAP = 20; const TMO_CAP = 15000;

function ask(q){
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(res => rl.question(q, ans => { rl.close(); res(ans); }));
}

function clamp(v,min,max){ const n=Number(v); return Math.max(min,Math.min(max,isFinite(n)?n:min)); }

function usage(){
  console.log("Usage:");
  console.log("  node agents/05_goal_runner.mjs plan.json");
  console.log("");
  console.log("Plan format:");
  console.log(JSON.stringify({
    goal: "Wire SIM → MCP hybrid search",
    min_confidence: 0.35,
    steps: [
      {
        id: "s1",
        kind: "mcp.call",
        tool: "db.rag_topk_hybrid",
        args: { query: "hello world", k: 8, min_confidence: 0.35, timeout_ms: 5000 },
        expect: { min_confidence: 0.35 }
      }
    ]
  }, null, 2));
}

async function run(planPath){
  const raw = fs.readFileSync(planPath, "utf8");
  const plan = JSON.parse(raw);
  console.log(`\nGoal: ${plan.goal}`);
  const minConf = Number(plan.min_confidence ?? 0.35);

  const client = new MCPClient(); // spawns 03_mcp_autowrap.mjs by default
  const tools = await client.listTools().catch(e => { console.error("tools/list failed:", e.message); process.exit(1); });
  const toolNames = new Set(tools.map(t=>t.name));

  for (const step of plan.steps){
    if (step.kind !== "mcp.call") {
      console.log(`\n[SKIP] Unsupported step kind: ${step.kind}`); continue;
    }
    if (!toolNames.has(step.tool)){
      console.log(`\n[BLOCK] Missing MCP tool: ${step.tool}`);
      console.log(`Hint: ensure it's in TARGETS of 03_mcp_autowrap.mjs`);
      process.exit(2);
    }

    // Normalize args and caps
    const args = { ...(step.args||{}) };
    if (typeof args.k !== "undefined") args.k = clamp(args.k, 1, K_CAP);
    if (typeof args.timeout_ms !== "undefined") args.timeout_ms = clamp(args.timeout_ms, 100, TMO_CAP);

    console.log(`\nStep ${step.id}: ${step.tool}`);
    console.log(`Args: ${JSON.stringify(args)}`);

    const a = await ask("Approve? [y/N] ");
    if (!/^y(es)?$/i.test(a)) { console.log("Aborted by user."); process.exit(0); }

    let result;
    try {
      result = await client.callTool(step.tool, args);
    } catch (e) {
      console.log(`[FAIL] ${e.message}`);
      process.exit(3);
    }

    const item = Array.isArray(result?.content) ? result.content.find(x=>x?.type==="json") : null;
    const data = item?.data ?? [];
    const topScore = typeof data?.[0]?.score === "number" ? data[0].score : 0;
    const need = Number(step?.expect?.min_confidence ?? minConf);

    console.log(`Rows: ${Array.isArray(data)?data.length:0}; top score: ${topScore.toFixed(3)}`);

    if (topScore < need) {
      console.log(`[ABSTAIN] confidence ${topScore.toFixed(3)} < ${need.toFixed(2)}. Refine query or raise k.`);
      process.exit(4);
    }
  }

  console.log("\nAll approved steps executed. ✅");
  process.exit(0);
}

// entry
if (process.argv.length < 3) { usage(); process.exit(0); }
run(process.argv[2]).catch(e => { console.error(e); process.exit(99); });
