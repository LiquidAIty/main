import React, { useCallback, useEffect, useRef, useState } from "react";

import type { AgentCard, AgentConfig } from "../types/agentBuilder";
import { callBossAgent, getAgentConfig, listProjects, saveAgentConfig, solRun } from "../lib/api";
import { AgentManager } from "../components/AgentManager";

// AgentPage (MVP): left icon rail + main chat + right tabs (Plan, Links, Knowledge, Dashboard)
// No external deps. Persists per-project to localStorage. Includes mini force-graph.

const C = {
  primary: "#4FA2AD", // teal
  bg: "#1F1F1F",
  panel: "#2B2B2B",
  border: "#3A3A3A",
  text: "#FFFFFF",
  neutral: "#E0DED5",
  accent: "#8358A4",
  warn: "#D98458",
};

// ---- utils ----
function clamp(x: number, a: number, b: number) {
  return Math.min(b, Math.max(a, x));
}

const uid = () => Math.random().toString(36).slice(2, 8);
const DEBUG = false;

type PlanItem = { id: string; text: string; status: "draft" | "approved" | "done" };
type LinkRef = {
  id: string;
  title: string;
  url: string;
  src: string;
  accepted: boolean;
  ts: number;
};

type KNode = {
  id: string;
  label: string;
  ts?: number;
  confidence?: number;
  location?: string;
};
type KEdge = { a: string; b: string };

type AgentPrompt = {
  role: string;
  context: string;
  objectives: string;
  style: string;
};

type WorkbenchOutputMap = Record<"Plan" | "Links" | "Knowledge" | "Dashboard", string>;
type WorkbenchRating = { stars: number; note: string };

// helper: load all project-local state (defaults only; real data is fetched from backend)
function loadProjectState(_projectId: string, _mode: "assist" | "agents" = "assist") {
  return {
    messages: [] as { role: "assistant" | "user"; text: string }[],
    plan: [{ id: uid(), text: "Define objective", status: "draft" }] as PlanItem[],
    links: [] as LinkRef[],
  };
}

// helper: convert AGE query results to graph nodes/edges for visualization
function ageRowsToGraph(rows: any[]): { nodes: KNode[]; edges: KEdge[] } {
  const nodeMap = new Map<string, KNode>();
  const edges: KEdge[] = [];

  const extractNodeId = (obj: any): string => {
    if (!obj) return "";
    if (obj.id) return String(obj.id);
    if (obj._id) return String(obj._id);
    if (obj.vid) return String(obj.vid);
    return JSON.stringify(obj).slice(0, 32);
  };

  const extractNodeLabel = (obj: any, id: string): string => {
    if (!obj) return id;
    const props = obj.properties || obj;
    if (props.name) return String(props.name);
    if (props.label) return String(props.label);
    if (props.type) return `${props.type}:${id.slice(0, 8)}`;
    return id.slice(0, 12);
  };

  const addNode = (obj: any) => {
    if (!obj || typeof obj !== "object") return;
    const id = extractNodeId(obj);
    if (!id || nodeMap.has(id)) return;
    const label = extractNodeLabel(obj, id);
    nodeMap.set(id, { id, label });
  };

  rows.forEach((row) => {
    if (!row || typeof row !== "object") return;
    // Handle common AGE return shapes
    if (row.n) addNode(row.n);
    if (row.a && row.b) {
      addNode(row.a);
      addNode(row.b);
      const aId = extractNodeId(row.a);
      const bId = extractNodeId(row.b);
      if (aId && bId && !edges.some((e) => e.a === aId && e.b === bId)) {
        edges.push({ a: aId, b: bId });
      }
    }
    if (Array.isArray(row)) {
      row.forEach((cell) => {
        if (cell && typeof cell === "object") {
          if (cell.start && cell.end) {
            const aId = extractNodeId(cell.start);
            const bId = extractNodeId(cell.end);
            addNode(cell.start);
            addNode(cell.end);
            if (aId && bId && !edges.some((e) => e.a === aId && e.b === bId)) {
              edges.push({ a: aId, b: bId });
            }
          } else {
            addNode(cell);
          }
        }
      });
    }
  });

  return { nodes: Array.from(nodeMap.values()), edges };
}

// -------- Knowledge: tiny force-layout canvas --------
function MiniForce({
  nodes,
  edges,
}: {
  nodes: { id: string; label: string }[];
  edges: { a: string; b: string }[];
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pos = useRef<Record<string, { x: number; y: number; vx: number; vy: number }>>({});
  const baseRadius = 3.5;
  const bgColor = "#0b0d10";
  const nodeCold = "#6c7380";
  const nodeWarm = "#5ee8a6";
  const nodeGlow = "#8ae2ff";
  const edgeColor = "rgba(94, 232, 166, 0.6)";

  useEffect(() => {
    const cvs = canvasRef.current!;
    const ctx = cvs.getContext("2d")!;
    const W = cResize(cvs);

    const ensure = (id: string) =>
      pos.current[id] ||
      (pos.current[id] = {
        x: Math.random() * W,
        y: Math.random() * W,
        vx: 0,
        vy: 0,
      });

    let raf = 0;
    function tick() {
      const P = pos.current;
      // physics
      nodes.forEach((n) => ensure(n.id));
      // repulsion
      nodes.forEach((n) =>
        nodes.forEach((m) => {
          if (n === m) return;
          const a = P[n.id];
          const b = P[m.id];
          const dx = a.x - b.x;
          const dy = a.y - b.y;
          const d = Math.hypot(dx, dy) + 0.01;
          const rep = 30 / (d * d);
          a.vx += dx * rep;
          a.vy += dy * rep;
        }),
      );
      // springs
      edges.forEach((e) => {
        const a = P[e.a];
        const b = P[e.b];
        if (!a || !b) return;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        a.vx += dx * 0.002;
        a.vy += dy * 0.002;
        b.vx -= dx * 0.002;
        b.vy -= dy * 0.002;
      });
      // integrate
      nodes.forEach((n) => {
        const a = P[n.id];
        a.vx *= 0.9;
        a.vy *= 0.9;
        a.x += a.vx;
        a.y += a.vy;
        a.x = clamp(a.x, 10, W - 10);
        a.y = clamp(a.y, 10, W - 10);
      });
      // draw
      ctx.clearRect(0, 0, W, W);
      ctx.fillStyle = bgColor;
      ctx.fillRect(0, 0, W, W);
      ctx.strokeStyle = edgeColor;
      ctx.lineWidth = 0.9;
      edges.forEach((e) => {
        const a = P[e.a];
        const b = P[e.b];
        if (a && b) {
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
        }
      });
      nodes.forEach((n, idx) => {
        const a = P[n.id];
        const r = baseRadius + ((n.id.length + idx) % 4);
        const fill =
          idx % 5 === 0
            ? nodeGlow
            : idx % 3 === 0
              ? nodeWarm
              : nodeCold;
        ctx.fillStyle = fill;
        ctx.shadowBlur = 12;
        ctx.shadowColor = fill;
        ctx.beginPath();
        ctx.arc(a.x, a.y, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
      });
      raf = requestAnimationFrame(tick);
    }
    tick();
    return () => cancelAnimationFrame(raf);
  }, [nodes, edges]);

  return (
    <canvas
      ref={canvasRef}
      width={320}
      height={320}
      style={{
        width: "100%",
        height: 320,
        background: bgColor,
        border: `1px solid ${C.border}`,
        borderRadius: 8,
      }}
    />
  );
}

function cResize(cvs: HTMLCanvasElement) {
  const r = cvs.getBoundingClientRect();
  cvs.width = Math.floor(r.width * 2);
  cvs.height = Math.floor(320 * 2);
  const W = cvs.width / 2;
  const ctx = cvs.getContext("2d")!;
  ctx.scale(2, 2);
  return W;
}

// ---- small components ----
function Icon({ d, size = 22 }: { d: string; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={d} />
    </svg>
  );
}

function Drawer({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    // clicking the dark background closes the drawer
    <div
      className="fixed inset-0"
      style={{ background: "#0008" }}
      onClick={onClose}
    >
      <div
        className="absolute top-0 left-0 h-full"
        style={{
          width: 300,
          background: C.panel,
          borderRight: `1px solid ${C.border}`,
        }}
        // stop clicks inside the panel from bubbling to the background
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="flex items-center justify-between px-4"
          style={{ height: 52, borderBottom: `1px solid ${C.border}` }}
        >
          <div style={{ color: C.text, fontWeight: 600 }}>{title}</div>
          <button
            onClick={onClose}
            className="px-2 py-1 rounded"
            style={{ border: `1px solid ${C.border}`, color: C.neutral }}
          >
            ✕
          </button>
        </div>
        <div className="p-4 text-sm" style={{ color: C.text }}>
          {children}
        </div>
      </div>
    </div>
  );
}

function Chat({
  messages,
  onSend,
  disabled = false,
}: {
  messages: { role: "assistant" | "user"; text: string }[];
  onSend: (t: string) => void;
  disabled?: boolean;
}) {
  const [v, setV] = useState("");
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    listRef.current?.scrollTo({ top: 999999, behavior: "smooth" });
  }, [messages.length]);

  const send = () => {
    if (disabled) return;
    const trimmed = v.trim();
    if (!trimmed) return;
    onSend(trimmed);
    setV("");
  };

  return (
    <div className="h-full flex flex-col" style={{ gap: 12 }}>
      <div
        ref={listRef}
        className="flex-1 overflow-auto"
        style={{
          padding: "14px 18px",
          display: "grid",
          gap: 10,
          alignContent: "start",
        }}
      >
        {messages.map((m, i) => {
          const right = m.role !== "assistant";
          const bg = m.role === "user" ? C.panel : C.bg;
          return (
            <div
              key={i}
              style={{ justifySelf: right ? "end" : "start", maxWidth: "86%" }}
            >
              <div
                style={{ fontSize: 11, color: C.neutral, marginBottom: 4 }}
              >
                {m.role === "assistant" ? "Assistant" : "You"}
              </div>
              <div
                style={{
                  background: bg,
                  border: `1px solid ${C.border}`,
                  borderRadius: 12,
                  padding: "10px 12px",
                  color: C.text,
                  whiteSpace: "pre-wrap",
                }}
              >
                {m.text}
              </div>
            </div>
          );
        })}
      </div>
      <div className="px-4 pb-4 flex items-center gap-2">
        <input
          value={v}
          onChange={(e) => setV(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") send();
          }}
          placeholder="Type a message…"
          className="flex-1"
          style={{
            background: C.panel,
            border: `1px solid ${C.border}`,
            borderRadius: 10,
            padding: "12px 14px",
            color: C.text,
          }}
          disabled={disabled}
        />
        <button
          onClick={send}
          aria-label="Send"
          className="rounded-full flex items-center justify-center"
          style={{
            width: 42,
            height: 42,
            background: C.primary,
            boxShadow: "0 2px 6px rgba(0,0,0,0.3)",
          }}
          disabled={disabled}
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#FFFFFF"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M12 19V5" />
            <path d="M5 12l7-7 7 7" />
          </svg>
        </button>
      </div>
    </div>
  );
}

// -------- Main page --------
export default function AgentBuilder() {
  const [activeProject, setActiveProject] = useState("");
  const [panelOpen, setPanelOpen] = useState(true);
  const [panelWidth, setPanelWidth] = useState(480);
  const [mode, setMode] = useState<"assist" | "agents">("assist");
  const [projectsLoaded, setProjectsLoaded] = useState(false);
  const messagesByScopeRef = useRef<Record<string, { role: "assistant" | "user"; text: string }[]>>({});
  const [projectLoading, setProjectLoading] = useState(false);
  const [projectSaveStatus, setProjectSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [projectSaveError, setProjectSaveError] = useState<string | null>(null);
  const [assistStarted, setAssistStarted] = useState(true);
  const setActiveProjectWithUrl = useCallback(
    (projectId: string) => {
      const currentSearch = window.location.search.replace(/^\?/, "");
      const current = new URLSearchParams(currentSearch).get("projectId") || "";
      if (projectId === activeProject && projectId === current) {
        return;
      }
      const nextSearch = new URLSearchParams(window.location.search);
      nextSearch.set("projectId", projectId);
      const nextQs = nextSearch.toString();
      setActiveProject(projectId);
      if (nextQs !== currentSearch) {
        window.history.replaceState({}, "", `${window.location.pathname}?${nextQs}`);
      }
    },
    [activeProject],
  );

  const tabs = ["Plan", "Links", "Knowledge", "Dashboard"] as const;
  const activeTabs = tabs;

  const [tab, setTab] = useState<string>("Knowledge");
  const [openDrawer, setOpenDrawer] = useState<
    null | "project" | "apps" | "settings" | "admin"
  >(null);
  const [sending, setSending] = useState(false);

  // agent builder state
  const [agentConfig, setAgentConfig] = useState<AgentConfig | null>(null);
  const [projects, setProjects] = useState<AgentCard[]>([]);
  const [projectsError, setProjectsError] = useState<string | null>(null);
  const [agentPrompt, setAgentPrompt] = useState<AgentPrompt>({
    role: "",
    context: "",
    objectives: "",
    style: "",
  });
  
  // Boss agent prompt configuration (per project)
  const [bossPromptConfig, setBossPromptConfig] = useState({
    role: "You are Sol, the primary assistant inside LiquidAIty.\nYou talk with the user to help them build their system.\nYou are direct and practical.\nYou do not invent features that don't exist.\nWhen something is broken, you help debug it using the UI and logs.\nYou remember project facts only when they appear in retrieved context (KG/RAG).\nIf no retrieved context is provided, you do not pretend to remember.",
    goal: "Help the user make progress building LiquidAIty.\nPriorities:\n- Keep Assist chat working reliably.\n- Capture durable facts into knowledge (through the KG ingest pipeline).\n- Use retrieved knowledge to answer with better continuity and less repetition.\n- Keep solutions minimal and avoid UI bloat.",
    constraints: "- Do not claim something works unless it is wired and verified.\n- Prefer the smallest change that restores functionality.\n- When diagnosing errors, ask for the exact error message or stack trace.\n- Do not suggest new UI controls unless required for the core loop.\n- When referring to acronyms, expand them the first time (e.g., KG (Knowledge Graph), RAG (Retrieval-Augmented Generation)).",
    ioSchema: "Input: user message text + optional retrieved context block.\nOutput: normal conversational text.\nIf you need structured output, ask before switching formats.",
    memoryPolicy: "No hidden memory.\nOnly use:\n- the visible chat history in this session, and\n- any explicit retrieved context provided from KG/RAG.\nIf context is missing, say so plainly.",
    model: "gpt-5.1-chat-latest",
    temperature: 0.7,
  });
  const refreshProjects = useCallback(async (preferredId?: string) => {
    try {
      setProjectsError(null);
      const cards = await listProjects();
      setProjects(cards);
      const search = new URLSearchParams(window.location.search);
      const urlId = search.get("projectId") || "";
      const current = preferredId || activeProject || "";
      const hasCurrent = current && cards.some((c) => c.id === current);
      const nextId = urlId || (hasCurrent ? current : cards[0]?.id || "");
      if (nextId) {
        setActiveProjectWithUrl(nextId);
      }
    } catch (err: any) {
      console.error("Error loading projects:", err);
      setProjectsError(err?.message || 'Error loading projects');
    }
  }, [activeProject, setActiveProjectWithUrl]);

  // chat state
  const [messages, setMessages] = useState<
    { role: "assistant" | "user"; text: string }[]
  >(() => loadProjectState(activeProject, mode).messages);

  // Reset tab when mode changes
  useEffect(() => {
    setTab(mode === "assist" ? "Knowledge" : "Plan");
  }, [mode]);

  // Enforce panel visibility by mode
  useEffect(() => {
    if (!panelOpen) {
      setPanelOpen(true);
    }
  }, [mode, panelOpen]);

  // Load agent config when in agents mode and activeProject changes
  useEffect(() => {
    if (mode === "agents" && activeProject) {
      getAgentConfig(activeProject)
        .then((config) => setAgentConfig(config))
        .catch((err) => {
          console.error("Error loading agent config:", err);
          setAgentConfig(null);
        });
    }
  }, [mode, activeProject]);

  // plan
  const [plan, setPlan] = useState<PlanItem[]>(
    () => loadProjectState(activeProject, mode).plan,
  );
  const [stateLoaded, setStateLoaded] = useState(false);

  // links
  const [links, setLinks] = useState<LinkRef[]>(
    () => loadProjectState(activeProject, mode).links,
  );
  // knowledge graph
  const [cypher, setCypher] = useState("");
  const [graphResult, setGraphResult] = useState<any[]>([]);
  const [graphError, setGraphError] = useState<string | null>(null);
  const [graphLoading, setGraphLoading] = useState(false);
  const [kgDebugTrace, setKgDebugTrace] = useState<any>(null);
  const [lastIngestTrace, setLastIngestTrace] = useState<any>(null);
  const [runtimeConfig, setRuntimeConfig] = useState<any>(null);
  const scopeKey = `${mode}:${activeProject || ""}`;

  // Fetch runtime config when project changes (Agent Builder mode only)
  useEffect(() => {
    if (mode === 'agents' && activeProject) {
      fetch(`/api/projects/${activeProject}/runtime-config`)
        .then(res => res.json())
        .then(data => {
          if (data.ok) {
            setRuntimeConfig(data);
          }
        })
        .catch(err => console.error('[RUNTIME_CONFIG] fetch failed:', err));
    }
  }, [mode, activeProject]);

  const runGraphQuery = async (query?: string) => {
    const q = (query ?? cypher).trim();
    if (!q) {
      setGraphError("Enter a Cypher query first.");
      return;
    }
    setGraphError(null);
    setGraphLoading(true);
    try {
      const res = await fetch(`/api/projects/${activeProject}/kg/query`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cypher: q, params: { projectId: activeProject } }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        const msg =
          (data && typeof data.error === "string" && data.error) ||
          `HTTP ${res.status}`;
        throw new Error(msg);
      }
      const rows = Array.isArray(data.rows) ? data.rows : [];
      setGraphResult(rows);
    } catch (err: any) {
      setGraphError(err?.message || "Graph error");
    } finally {
      setGraphLoading(false);
    }
  };

  // When switching projects, reload all per-project state from storage
  useEffect(() => {
    if (!activeProject) return;
    setStateLoaded(false);
    fetch(`/api/projects/${activeProject}/state`)
      .then((r) => r.json())
      .then((data) => {
        setMessages(Array.isArray(data?.messages) ? data.messages : loadProjectState("", mode).messages);
        setPlan(Array.isArray(data?.plan) ? data.plan : []);
        setLinks(Array.isArray(data?.links) ? data.links : []);
        setStateLoaded(true);
      })
      .catch(() => {
        const next = loadProjectState(activeProject, mode);
        setMessages(next.messages);
        setPlan(next.plan);
        setLinks(next.links);
        setStateLoaded(true);
      });
  }, [activeProject, mode]);

  // Load projects on mount
  useEffect(() => {
    const search = new URLSearchParams(window.location.search);
    const urlId = search.get("projectId") || "";
    if (urlId) {
      setActiveProjectWithUrl(urlId);
      setMode("agents");
    }
    void refreshProjects();
  }, [refreshProjects]);

  const loadProjectSubgraph = useCallback(() => {
    const q = [
      "MATCH (a { project_id: $projectId })-[r { project_id: $projectId }]->(b { project_id: $projectId })",
      "RETURN a,b,r",
      "LIMIT 200",
    ].join(" ");
    setCypher(q);
    runGraphQuery(q);
  }, [runGraphQuery]);

  // Auto-load project subgraph when Knowledge tab opens or project changes
  useEffect(() => {
    if (tab === 'Knowledge' && activeProject && panelOpen) {
      loadProjectSubgraph();
    }
  }, [tab, activeProject, panelOpen, loadProjectSubgraph]);

  // Poll for last ingest trace when Dashboard tab is active
  useEffect(() => {
    if (tab !== 'Dashboard' || !activeProject) return;
    
    const fetchIngestTrace = async () => {
      try {
        const res = await fetch(`/api/projects/${activeProject}/kg/last-trace`);
        const data = await res.json();
        if (data.ok && data.trace) {
          setLastIngestTrace(data.trace);
        }
      } catch (err) {
        console.error('[Dashboard] Failed to fetch ingest trace:', err);
      }
    };
    
    fetchIngestTrace();
    const interval = setInterval(fetchIngestTrace, 3000); // Poll every 3s
    return () => clearInterval(interval);
  }, [tab, activeProject]);

  const markAssistStarted = useCallback(() => {
    setAssistStarted(true);
    setPanelOpen(true);
    setTab("Knowledge");
  }, []);

  // Load boss agent prompt config when project changes
  useEffect(() => {
    if (mode === "assist" && activeProject) {
      const saved = localStorage.getItem(`boss-prompt:${activeProject}`);
      if (saved) {
        try {
          const parsed = JSON.parse(saved);
          setBossPromptConfig({
            role: parsed.role || "",
            goal: parsed.goal || "",
            constraints: parsed.constraints || "",
            ioSchema: parsed.ioSchema || "",
            memoryPolicy: parsed.memoryPolicy || "",
            model: parsed.model || "gpt-5.1-chat-latest",
            temperature: parsed.temperature ?? 0.7,
          });
        } catch (err) {
          console.warn("Failed to load boss prompt config:", err);
        }
      } else {
        // Reset to defaults if no saved config
        setBossPromptConfig({
          role: "",
          goal: "",
          constraints: "",
          ioSchema: "",
          memoryPolicy: "",
          model: "gpt-5.1-chat-latest",
          temperature: 0.7,
        });
      }
    }
  }, [mode, activeProject]);

  const sendToBossAgent = async (userText: string) => {
    setSending(true);
    try {
      // Load main agent config from Agent Builder mode (project_agents table)
      let mainAgentConfig = null;
      try {
        const payload = await fetch(`/api/projects/${activeProject}/agents`).then(r => r.json());
        const agents = Array.isArray(payload)
          ? payload
          : Array.isArray((payload as any)?.agents)
            ? (payload as any).agents
            : [];
        const mainAgent = agents.find((a: any) => a?.name === 'Main Chat' || a?.agent_type === 'llm_chat');
        if (mainAgent) {
          mainAgentConfig = {
            role: mainAgent.role_text || bossPromptConfig.role,
            goal: mainAgent.goal_text || bossPromptConfig.goal,
            constraints: mainAgent.constraints_text || bossPromptConfig.constraints,
            ioSchema: mainAgent.io_schema_text || bossPromptConfig.ioSchema,
            memoryPolicy: mainAgent.memory_policy_text || bossPromptConfig.memoryPolicy,
            model: mainAgent.model || bossPromptConfig.model,
          };
        }
      } catch (err) {
        // Fallback: use AgentManager cache so chat still uses your edited config
        try {
          const cached = localStorage.getItem(`agent-manager:agents:${activeProject}`);
          const parsed = cached ? JSON.parse(cached) : null;
          const agents = Array.isArray(parsed) ? parsed : [];
          const mainAgent = agents.find((a: any) => a?.name === 'Main Chat' || a?.agent_type === 'llm_chat');
          if (mainAgent) {
            mainAgentConfig = {
              role: mainAgent.role_text || bossPromptConfig.role,
              goal: mainAgent.goal_text || bossPromptConfig.goal,
              constraints: mainAgent.constraints_text || bossPromptConfig.constraints,
              ioSchema: mainAgent.io_schema_text || bossPromptConfig.ioSchema,
              memoryPolicy: mainAgent.memory_policy_text || bossPromptConfig.memoryPolicy,
              model: mainAgent.model || bossPromptConfig.model,
            };
          }
        } catch {
          // ignore
        }
      }

      const payload: any = { 
        goal: userText, 
        projectId: activeProject,
        agentConfig: mainAgentConfig || {
          role: bossPromptConfig.role,
          goal: bossPromptConfig.goal,
          constraints: bossPromptConfig.constraints,
          ioSchema: bossPromptConfig.ioSchema,
          memoryPolicy: bossPromptConfig.memoryPolicy,
          model: bossPromptConfig.model,
        }
      };
      
      const data = await callBossAgent(payload);

      let assistantText = "";
      if (data?.ok) {
        const finalText =
          (typeof data?.result?.final === "string" && data.result.final.trim()) ||
          (typeof (data as any)?.result === "string" && (data as any).result.trim()) ||
          (typeof (data as any)?.answer === "string" && (data as any).answer.trim()) ||
          (typeof (data as any)?.text === "string" && (data as any).text.trim());
        assistantText =
          typeof finalText === "string" && finalText.length > 0 ? finalText : JSON.stringify(data);
      } else {
        const fallback = await solRun(userText);
        if (!fallback?.ok) {
          throw new Error(fallback?.text || "Sol chat failed");
        }
        assistantText = fallback.text;
      }
      setMessages((prev) => [...prev, { role: "assistant", text: assistantText }]);
      if (assistantText) {
        markAssistStarted();
      }
      if (mode === "assist" && activeProject && userText && assistantText) {
        void (async () => {
          try {
            await fetch(`/api/projects/${activeProject}/kg/ingest_chat_turn`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                user_text: userText,
                assistant_text: assistantText,
                src: "chat.auto",
              }),
            });
          } catch (err) {
            console.warn("[KG][auto_ingest] failed", err);
          }
        })();
      }
    } catch (error: any) {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          text: `Error: ${error?.message || "Request failed"}`,
        },
      ]);
    } finally {
      setSending(false);
    }
  };

  const handleSend = (t: string) => {
    const trimmed = t.trim();
    if (!trimmed) return;
    if (sending) return;

    setMessages((m) => [...m, { role: "user", text: trimmed }]);

    const userText = trimmed;
    void sendToBossAgent(userText);
  };

  const approve = (id: string) =>
    setPlan((p) =>
      p.map((it) =>
        it.id === id
          ? {
              ...it,
              status: it.status === "approved" ? "draft" : "approved",
            }
          : it,
      ),
    );

  const addTask = (text: string) =>
    setPlan((p) => [{ id: uid(), text, status: "draft" }, ...p]);

  const addLinks = (seed: string) => {
    setMessages((m) => [
      ...m,
      {
        role: "assistant",
        text: `Link search for "${seed}" is not connected to the backend yet.`,
      },
    ]);
  };

  const accept = (id: string) =>
    setLinks((ls) =>
      ls.map((x) => (x.id === id ? { ...x, accepted: true } : x)),
    );

  const reject = (id: string) =>
    setLinks((ls) => ls.filter((x) => x.id !== id));

  const graphViz = ageRowsToGraph(graphResult);

  // derive counts
  const approved = plan.filter((p) => p.status === "approved");
  const accepted = links.filter((l) => l.accepted);

  const createProjectPrompt = async () => {
    const name = window.prompt("New project name?");
    if (!name || !name.trim()) return;
    let code = window.prompt("Project code (optional)") || "";
    code = code.trim();
    if (!code) {
      code = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
    }
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), code }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(text || `HTTP ${res.status}`);
      }
      const data = await res.json().catch(() => null);
      const newId = (data && data.id) || "";
      await refreshProjects(newId);
    } catch (err) {
      console.error("Create project failed", err);
    }
  };

  return (
    <div
      className="h-screen w-full flex flex-col overflow-hidden"
      style={{ background: C.bg, color: C.text }}
    >
      {/* Top bar */}
      <div
        className="flex items-center justify-between px-5"
        style={{ height: 56, borderBottom: `1px solid ${C.border}` }}
      >
        <div className="flex items-center gap-3">
          <div
            style={{
              width: 32,
              height: 32,
              borderRadius: "50%",
              background:
                "radial-gradient(circle at 35% 30%, #7ED1DB 0%, " +
                C.primary +
                " 55%, #2E6C75 100%)",
              boxShadow: "0 0 0 2px #000 inset",
            }}
          />
        </div>
        <div className="flex items-center gap-3" />
      </div>

      <div className="flex flex-1 overflow-hidden min-h-0">
        {/* LEFT rail */}
        <aside
          className="h-full flex flex-col items-center gap-3 py-3"
          style={{
            width: 54,
            background: C.panel,
            borderRight: `1px solid ${C.border}`,
          }}
        >
          <button
            title="Project"
            onClick={() => setOpenDrawer("project")}
            className="p-2 rounded"
            style={{ color: C.text }}
          >
            <Icon d="M4 7l8-4 8 4v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z" />
          </button>
          <button
            title={panelOpen ? "Hide Context" : "Show Context"}
            onClick={() => setPanelOpen((v) => !v)}
            className="p-2 rounded"
            style={{ color: panelOpen ? C.primary : C.text }}
          >
            <Icon d="M3 12h18M12 3v18" />
          </button>
          <button
            title="Settings"
            onClick={() => setOpenDrawer("settings")}
            className="p-2 rounded"
            style={{ color: C.text }}
          >
            <Icon d="M12 1v3M12 20v3M4.22 4.22l2.12 2.12M17.66 17.66l2.12 2.12M1 12h3M20 12h3M4.22 19.78l2.12-2.12M17.66 6.34l2.12-2.12M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z" />
          </button>
          <div className="flex-1" />
          <button
            title="Admin"
            onClick={() => setOpenDrawer("admin")}
            className="p-2 rounded"
            style={{ color: "#ffb86b" }}
          >
            <Icon d="M3 12l2-2 4 4L21 4" />
          </button>
        </aside>

        {/* CENTER chat */}
        <div
          className="h-full transition-[width] duration-300 ease-out min-w-0"
          style={{
            width: panelOpen ? `calc(100% - ${panelWidth}px)` : "100%",
          }}
        >
          <Chat messages={messages} onSend={handleSend} disabled={sending} />
        </div>

        {/* RIGHT panel */}
        {panelOpen && (mode === "agents" || assistStarted) && (
          <aside
            className="h-full relative"
            style={{
              width: panelWidth,
              borderLeft: `1px solid ${C.border}`,
              background: C.panel,
              flexShrink: 0,
              overflow: "hidden",
            }}
          >
            <div className="px-4 pt-4 h-full flex flex-col overflow-hidden min-h-0">
              <div className="flex gap-6 mb-3">
                {activeTabs.map((t) => (
                  <button
                    key={t}
                    onClick={() => setTab(t)}
                    className="font-semibold transition-colors"
                    style={{
                      padding: "8px 10px",
                      color: tab === t ? "#FFFFFF" : C.neutral,
                      background:
                        tab === t
                          ? "rgba(79,162,173,0.18)"
                          : "transparent",
                      border:
                        "1px solid " +
                        (tab === t ? C.primary : "transparent"),
                      borderRadius: 10,
                    }}
                  >
                    {t}
                  </button>
                ))}
              </div>

              <div
                className="flex-1 overflow-auto px-1 pr-3 pb-6 text-sm"
                style={{ color: C.neutral }}
              >
                <>
                  {mode === "agents" && tab === "Plan" && (
                    <AgentManager
                      projectId={activeProject}
                      activeTab={tab}
                      onGraphRefresh={() => {
                        // no-op
                      }}
                    />
                  )}

                  {/* Plan tab for assist mode - task management only */}
                  {mode === "assist" && tab === "Plan" && (
                    <div className="space-y-3">
                      <div className="space-y-2">
                        {plan.map((p) => (
                          <div
                            key={p.id}
                            className="flex items-center justify-between"
                            style={{
                              border: `1px solid ${C.border}`,
                              borderRadius: 8,
                              padding: "8px 10px",
                            }}
                          >
                            <div style={{ color: C.text }}>{p.text}</div>
                            <button
                              onClick={() => approve(p.id)}
                              className="px-2 py-1 text-xs rounded"
                              style={{
                                background:
                                  p.status === "approved" ? C.primary : "transparent",
                                border: `1px solid ${C.primary}`,
                                color: p.status === "approved" ? "#0F0F0F" : C.text,
                              }}
                            >
                              {p.status === "approved" ? "Approved" : "Approve"}
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {tab === "Links" && (
                    <div className="space-y-3">
                      {/* Runtime Wiring - resolved config for this project */}
                      <div
                        className="text-xs p-2 rounded"
                        style={{
                          background: C.bg,
                          border: `1px solid ${C.border}`,
                          marginBottom: 12,
                        }}
                      >
                        <div style={{ color: C.primary, fontWeight: 600, marginBottom: 4 }}>Runtime Wiring</div>
                        {runtimeConfig ? (
                          <div style={{ color: C.neutral, fontSize: 10, lineHeight: 1.5 }}>
                            <div>Assist Main: {runtimeConfig.assist_main_agent.provider}/{runtimeConfig.assist_main_agent.model_key}</div>
                            <div>KG Ingest: {runtimeConfig.kg_ingest_agent.provider}/{runtimeConfig.kg_ingest_agent.model_key}</div>
                            <div>KG Chunking: {runtimeConfig.kg_chunking_model.provider}/{runtimeConfig.kg_chunking_model.model_key}</div>
                            <div>Embedding: {runtimeConfig.embed_model.provider}/{runtimeConfig.embed_model.model_key}</div>
                            <div style={{ opacity: 0.7 }}>Graph: graph_liq</div>
                          </div>
                        ) : (
                          <div style={{ color: '#f87171', fontSize: 10 }}>Failed to resolve runtime config - check agent assignments</div>
                        )}
                      </div>

                      {/* Sources/Links */}
                      {links.map((l) => (
                        <div
                          key={l.id}
                          style={{
                            border: `1px solid ${C.border}`,
                            borderRadius: 8,
                            padding: "8px",
                          }}
                        >
                          <div
                            style={{
                              color: C.text,
                              fontWeight: 600,
                            }}
                          >
                            {l.title}
                          </div>
                          <div
                            className="text-xs"
                            style={{ opacity: 0.8, margin: "4px 0 8px" }}
                          >
                            {l.url}
                          </div>
                          <div className="flex gap-6 text-sm">
                            {!l.accepted && (
                              <button
                                onClick={() => accept(l.id)}
                                style={{ color: C.primary }}
                              >
                                Accept
                              </button>
                            )}
                            <button
                              onClick={() => reject(l.id)}
                              style={{ color: C.warn }}
                            >
                              Reject
                            </button>
                            <a
                              href={l.url}
                              target="_blank"
                              rel="noreferrer"
                              style={{ color: C.neutral }}
                            >
                              open
                            </a>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {tab === "Knowledge" && (
                    <div className="space-y-3">
                      {/* Force-directed graph visualization */}
                      <div style={{ display: "flex", justifyContent: "center" }}>
                        <MiniForce nodes={graphViz.nodes} edges={graphViz.edges} />
                      </div>

                      {/* Cypher console removed - graph auto-loads */}
                    </div>
                  )}

                  {tab === "Dashboard" && (
                    <div className="space-y-3">
                      {/* KG Ingest Results - auto-populated from Assist chat */}
                      <div className="space-y-2">
                        <div
                          className="text-xs font-semibold"
                          style={{ color: C.text }}
                        >
                          Last KG Ingest
                        </div>
                        <div className="text-xs" style={{ color: C.neutral, marginBottom: 8 }}>
                          Auto-populated when Assist chat triggers ingest.
                        </div>
                        {lastIngestTrace ? (
                            <div
                              className="text-xs space-y-2 p-3 rounded"
                              style={{
                                background: C.bg,
                                border: `1px solid ${C.border}`,
                                maxHeight: 400,
                                overflow: 'auto',
                              }}
                            >
                              {lastIngestTrace.error ? (
                                <div style={{ color: '#f87171' }}>
                                  <div style={{ fontWeight: 600, marginBottom: 4 }}>❌ Ingest Failed</div>
                                  <div style={{ marginBottom: 4 }}>Step: {lastIngestTrace.error.step}</div>
                                  <div style={{ marginBottom: 4 }}>Code: {lastIngestTrace.error.code}</div>
                                  <div style={{ marginBottom: 8 }}>{lastIngestTrace.error.message}</div>
                                  
                                  {lastIngestTrace.step_states.chunking && !lastIngestTrace.step_states.chunking.ok && (
                                    <div style={{ marginTop: 12, padding: 8, background: '#1a1a1a', borderRadius: 4, fontSize: '11px' }}>
                                      <div style={{ fontWeight: 600, marginBottom: 4, color: '#f87171' }}>CHUNKING EVIDENCE</div>
                                      {lastIngestTrace.step_states.chunking.model_key && (
                                        <div style={{ marginBottom: 4 }}>Model: {lastIngestTrace.step_states.chunking.model_key}</div>
                                      )}
                                      {lastIngestTrace.step_states.chunking.prompt_user_sha1 && (
                                        <div style={{ marginBottom: 4 }}>Prompt SHA1: {lastIngestTrace.step_states.chunking.prompt_user_sha1.slice(0, 12)}...</div>
                                      )}
                                      {lastIngestTrace.step_states.chunking.raw_output_sha1 && (
                                        <div style={{ marginBottom: 4 }}>Output SHA1: {lastIngestTrace.step_states.chunking.raw_output_sha1.slice(0, 12)}...</div>
                                      )}
                                      {lastIngestTrace.step_states.chunking.parse_error && (
                                        <div style={{ marginBottom: 4, color: '#fca5a5' }}>Parse Error: {lastIngestTrace.step_states.chunking.parse_error}</div>
                                      )}
                                      {lastIngestTrace.step_states.chunking.raw_output_preview && (
                                        <div style={{ marginTop: 8 }}>
                                          <div style={{ fontWeight: 600, marginBottom: 4 }}>Raw Output Preview:</div>
                                          <pre style={{ 
                                            whiteSpace: 'pre-wrap', 
                                            wordBreak: 'break-all',
                                            fontSize: '10px',
                                            maxHeight: 200,
                                            overflow: 'auto',
                                            background: '#0a0a0a',
                                            padding: 8,
                                            borderRadius: 4,
                                            margin: 0
                                          }}>{lastIngestTrace.step_states.chunking.raw_output_preview}</pre>
                                        </div>
                                      )}
                                      {lastIngestTrace.step_states.chunking.prompt_user_preview && (
                                        <div style={{ marginTop: 8 }}>
                                          <div style={{ fontWeight: 600, marginBottom: 4 }}>Prompt Preview:</div>
                                          <pre style={{ 
                                            whiteSpace: 'pre-wrap', 
                                            wordBreak: 'break-all',
                                            fontSize: '10px',
                                            maxHeight: 200,
                                            overflow: 'auto',
                                            background: '#0a0a0a',
                                            padding: 8,
                                            borderRadius: 4,
                                            margin: 0
                                          }}>{lastIngestTrace.step_states.chunking.prompt_user_preview}</pre>
                                        </div>
                                      )}
                                    </div>
                                  )}
                                </div>
                              ) : (
                                <>
                                  <div>
                                    <div style={{ color: C.primary, fontWeight: 600 }}>✅ LAST INGEST</div>
                                    <div style={{ color: C.neutral }}>Time: {new Date(lastIngestTrace.created_at).toLocaleString()}</div>
                                    <div style={{ color: C.neutral }}>Trace ID: {lastIngestTrace.trace_id}</div>
                                    <div style={{ color: C.neutral }}>Model: {lastIngestTrace.model_key}</div>
                                    <div style={{ color: C.neutral }}>Source: {lastIngestTrace.src}</div>
                                  </div>
                                  <div style={{ marginTop: 8 }}>
                                    <div style={{ color: C.primary, fontWeight: 600 }}>STEP CHECKSUMS</div>
                                    <div style={{ color: C.neutral }}>Start: {lastIngestTrace.step_states.start?.ok ? '✅' : '❌'}</div>
                                    {lastIngestTrace.step_states.chunking && (
                                      <>
                                        <div style={{ color: C.neutral }}>Chunking: {lastIngestTrace.step_states.chunking.ok ? '✅' : '❌'} {lastIngestTrace.step_states.chunking.chunk_count ? `(${lastIngestTrace.step_states.chunking.chunk_count} chunks)` : ''}</div>
                                        {lastIngestTrace.step_states.chunking.ok && (
                                          <div style={{ marginLeft: 16, marginTop: 4, fontSize: '11px', color: C.neutral }}>
                                            {lastIngestTrace.step_states.chunking.model_key && (
                                              <div>Model: {lastIngestTrace.step_states.chunking.model_key}</div>
                                            )}
                                            {lastIngestTrace.step_states.chunking.prompt_user_sha1 && (
                                              <div>Prompt SHA1: {lastIngestTrace.step_states.chunking.prompt_user_sha1.slice(0, 12)}...</div>
                                            )}
                                            {lastIngestTrace.step_states.chunking.raw_output_sha1 && (
                                              <div>Output SHA1: {lastIngestTrace.step_states.chunking.raw_output_sha1.slice(0, 12)}...</div>
                                            )}
                                          </div>
                                        )}
                                      </>
                                    )}
                                    {lastIngestTrace.step_states.embed && (
                                      <div style={{ color: C.neutral }}>Embed: {lastIngestTrace.step_states.embed.ok ? '✅' : '❌'} {lastIngestTrace.step_states.embed.vectors_count ? `(${lastIngestTrace.step_states.embed.vectors_count} vectors)` : ''}</div>
                                    )}
                                    {lastIngestTrace.step_states.write && (
                                      <div style={{ color: C.neutral }}>Write: {lastIngestTrace.step_states.write.ok ? '✅' : '❌'} {lastIngestTrace.step_states.write.entity_count ? `(${lastIngestTrace.step_states.write.entity_count} entities, ${lastIngestTrace.step_states.write.relation_count} relations)` : ''}</div>
                                    )}
                                    {lastIngestTrace.step_states.done && (
                                      <div style={{ color: lastIngestTrace.step_states.done.ok ? '#10b981' : '#f87171', fontWeight: 600 }}>
                                        Done: {lastIngestTrace.step_states.done.ok ? '✅' : '❌'} ({lastIngestTrace.step_states.done.t_ms}ms)
                                        {lastIngestTrace.step_states.done.entity_count !== undefined && (
                                          <div style={{ fontWeight: 400 }}>Entities: {lastIngestTrace.step_states.done.entity_count}, Relations: {lastIngestTrace.step_states.done.relation_count}, Chunks: {lastIngestTrace.step_states.done.chunk_count}</div>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                </>
                              )}
                            </div>
                        ) : (
                          <div className="text-xs" style={{ color: C.neutral, fontStyle: 'italic' }}>
                            No ingest activity yet. Send a chat message to trigger auto-ingest.
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </>
              </div>

              {/* resize handle */}
              <div
                onMouseDown={(e) => {
                  const sx = e.clientX;
                  const sw = panelWidth;
                  const minW = 360;
                  const maxW = 920;
                  const mv = (ev: MouseEvent) => {
                    const d = sx - ev.clientX;
                    setPanelWidth(clamp(sw + d, minW, maxW));
                  };
                  const up = () => {
                    window.removeEventListener("mousemove", mv);
                    window.removeEventListener("mouseup", up);
                  };
                  window.addEventListener("mousemove", mv);
                  window.addEventListener("mouseup", up);
                }}
                style={{
                  position: "absolute",
                  left: -6,
                  top: 0,
                  width: 8,
                  height: "100%",
                  cursor: "col-resize",
                }}
              />
            </div>
          </aside>
        )}
      </div>

      {/* drawers */}
      {openDrawer === "project" && (
        <Drawer title="Project" onClose={() => setOpenDrawer(null)}>
          <div className="space-y-3">
            <div
              className="text-xs uppercase mb-2 flex items-center justify-between"
              style={{ color: C.neutral }}
            >
              <span>Projects</span>
              <button
                onClick={createProjectPrompt}
                className="text-[11px] px-2 py-1 rounded"
                style={{ border: `1px solid ${C.border}`, color: C.text }}
              >
                New Project
              </button>
            </div>
            <div className="space-y-2">
              {!Array.isArray(projects) && (
                <div className="text-xs" style={{ color: C.neutral }}>
                  No projects available.
                </div>
              )}
              {projectsError && (
                <div className="text-xs" style={{ color: C.neutral }}>
                  {projectsError}
                </div>
              )}
              {(Array.isArray(projects) ? projects : []).map((project) => (
                <button
                  key={project.id}
                  onClick={() => {
                    setActiveProjectWithUrl(project.id);
                    setOpenDrawer(null);
                  }}
                  className="w-full text-left p-3 rounded"
                  style={{
                    background:
                      activeProject === project.id
                        ? "rgba(79,162,173,0.18)"
                        : "transparent",
                    border: `1px solid ${
                      activeProject === project.id ? C.primary : C.border
                    }`,
                    color: C.text,
                  }}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="font-medium">
                        {project.name || project.id}
                      </div>
                      {project.slug && (
                        <div className="opacity-60 text-xs">
                          {project.slug}
                        </div>
                      )}
                    </div>
                  </div>
                </button>
              ))}

              {Array.isArray(projects) && projects.length === 0 && !projectsError && (
                <div className="text-xs" style={{ color: C.neutral }}>
                  No projects available.
                </div>
              )}
            </div>
            <div className="text-xs mt-4" style={{ color: C.neutral }}>
              Admin toggles live under Admin drawer.
            </div>
          </div>
        </Drawer>
      )}
      {openDrawer === "settings" && (
        <Drawer title="Settings" onClose={() => setOpenDrawer(null)}>
          <div className="text-sm" style={{ color: C.text }}>
            No settings available yet.
          </div>
        </Drawer>
      )}

      {openDrawer === "admin" && (
        <Drawer title="Admin" onClose={() => setOpenDrawer(null)}>
          <div className="space-y-3 text-sm">
            <button
              onClick={() => setMode("assist")}
              className="px-3 py-2 rounded w-full text-left"
              style={{
                border: `1px solid ${C.border}`,
                color: C.text,
                background: mode === "assist" ? C.primary : "transparent",
              }}
            >
              Assist mode
            </button>
            <button
              onClick={() => setMode("agents")}
              className="px-3 py-2 rounded w-full text-left"
              style={{
                border: `1px solid ${C.border}`,
                color: C.text,
                background: mode === "agents" ? C.primary : "transparent",
              }}
            >
              Agent Builder mode
            </button>
          </div>
        </Drawer>
      )}
    </div>
  );
}

function StatCard({ title, value }: { title: string; value: string }) {
  return (
    <div
      style={{
        background: C.bg,
        border: `1px solid ${C.border}`,
        borderRadius: 10,
        padding: "12px",
      }}
    >
      <div className="text-xs" style={{ color: C.neutral, marginBottom: 6 }}>
        {title}
      </div>
      <div style={{ fontSize: 22, fontWeight: 700, color: C.text }}>{value}</div>
    </div>
  );
}
