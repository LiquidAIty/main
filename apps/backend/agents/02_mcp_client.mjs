// MCP Client: spawn MCP server and call tools via stdio JSON-RPC
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

export class MCPClient {
  constructor(serverPath = "agents/03_mcp_autowrap.mjs") {
    this.serverPath = serverPath;
    this.proc = null;
    this.rl = null;
    this.requestId = 0;
    this.pending = new Map();
  }

  async spawn() {
    if (this.proc) return;
    
    this.proc = spawn("node", [this.serverPath], {
      stdio: ["pipe", "pipe", "inherit"],
      env: process.env
    });

    this.rl = createInterface({ input: this.proc.stdout });
    this.rl.on("line", (line) => {
      try {
        const msg = JSON.parse(line);
        const { resolve, reject } = this.pending.get(msg.id) || {};
        if (resolve) {
          this.pending.delete(msg.id);
          if (msg.error) reject(new Error(`MCP Error: ${msg.error.message}`));
          else resolve(msg.result);
        }
      } catch (e) {
        console.error("MCP parse error:", e);
      }
    });

    this.proc.on("exit", (code) => {
      console.log(`MCP server exited with code ${code}`);
      this.cleanup();
    });
  }

  async call(method, params = {}) {
    await this.spawn();
    
    const id = ++this.requestId;
    const req = { jsonrpc: "2.0", id, method, params };
    
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.proc.stdin.write(JSON.stringify(req) + "\n");
      
      // Timeout after 30s
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error("MCP call timeout"));
        }
      }, 30000);
    });
  }

  async listTools() {
    const result = await this.call("tools/list");
    return result.tools || [];
  }

  async callTool(name, args = {}) {
    return await this.call("tools/call", { name, arguments: args });
  }

  cleanup() {
    if (this.rl) {
      this.rl.close();
      this.rl = null;
    }
    if (this.proc) {
      this.proc.kill();
      this.proc = null;
    }
    this.pending.clear();
  }
}
