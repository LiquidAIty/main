// Git utility for MCP AutoWrap server
import { execSync } from "node:child_process";

export function getStatus(args = {}) {
  try {
    const cwd = args.cwd || process.cwd();
    
    const status = execSync("git status --porcelain", { cwd, encoding: "utf8" });
    const branch = execSync("git branch --show-current", { cwd, encoding: "utf8" }).trim();
    const ahead = execSync("git rev-list --count @{u}..HEAD 2>/dev/null || echo 0", { 
      cwd, 
      encoding: "utf8",
      stdio: ['ignore', 'pipe', 'ignore'] 
    }).trim();
    
    const modifiedFiles = status.split('\n').filter(line => line.trim()).length;
    
    return {
      branch,
      ahead_commits: parseInt(ahead) || 0,
      modified_files: modifiedFiles,
      clean: status.trim() === "",
      raw_status: status.trim(),
      cwd
    };
  } catch (e) {
    return { 
      error: e.message, 
      branch: "unknown", 
      clean: false,
      modified_files: 0,
      ahead_commits: 0,
      cwd: args.cwd || process.cwd()
    };
  }
}
