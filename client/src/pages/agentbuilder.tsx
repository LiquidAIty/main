import React, { useCallback, useEffect, useRef, useState } from "react";

import type { AgentCard, AgentConfig } from "../types/agentBuilder";
import { callBossAgent, getAgentConfig, listProjects, saveAgentConfig, solRun } from "../lib/api";
import { AgentManager } from "../components/AgentManager";

// AgentPage (MVP): left icon rail + main chat + right tabs (Plan, Links, Knowledge, Dashboard)
// No external deps. Persists per-project to localStorage. Includes CoachBar and mini force-graph.

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

function jget<T>(k: string, fallback: T): T {
  try {
    const v = localStorage.getItem(k);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}

function jset<T>(k: string, v: T) {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch {
    // ignore
  }
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
  const size = 2; // node radius

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
      ctx.strokeStyle = C.border;
      ctx.lineWidth = 1;
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
      ctx.fillStyle = C.primary;
      nodes.forEach((n) => {
        const a = P[n.id];
        ctx.beginPath();
        ctx.arc(a.x, a.y, size, 0, Math.PI * 2);
        ctx.fill();
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
        background: C.bg,
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
  const messagesByScopeRef = useRef<Record<string, { role: "assistant" | "user"; text: string }[]>>({});
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

  const [tab, setTab] = useState<string>("Plan");
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
    setTab(activeTabs[0]);
  }, [mode]);

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
  const scopeKey = `${mode}:${activeProject || ""}`;

  useEffect(() => {
    const scoped = messagesByScopeRef.current[scopeKey];
    if (DEBUG) {
      console.log("[AB] scope sync effect (scope change)", { scopeKey, hasScoped: Boolean(scoped), scopedSize: scoped?.length });
    }
    setMessages(scoped ? scoped : []);
  }, [scopeKey]);

  useEffect(() => {
    const current = messagesByScopeRef.current[scopeKey];
    if (current === messages) return;
    messagesByScopeRef.current[scopeKey] = messages;
    if (DEBUG) {
      console.log("[AB] write scope map", { scopeKey, msgSize: messages.length });
    }
  }, [messages, scopeKey]);

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

  const runGraphQuery = async () => {
    if (!cypher.trim()) {
      setGraphError("Enter a Cypher query first.");
      return;
    }
    setGraphError(null);
    setGraphLoading(true);
    try {
      const res = await fetch(`/api/projects/${activeProject}/kg/query`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cypher, params: { projectId: activeProject } }),
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
        {panelOpen && (
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
                      {links.length === 0 && (
                        <div>
                          No links yet.
                        </div>
                      )}
                    </div>
                  )}

                  {tab === "Knowledge" && (
                    <div className="space-y-3">
                      <div
                        className="text-xs font-semibold mb-2"
                        style={{ color: C.text }}
                      >
                        Graph View (Apache AGE)
                      </div>
                      <MiniForce nodes={graphViz.nodes} edges={graphViz.edges} />
                      <div
                        className="flex items-center justify-between text-xs"
                        style={{ opacity: 0.8 }}
                      >
                        <span>
                          Nodes: {graphViz.nodes.length} · Edges: {graphViz.edges.length}
                        </span>
                        <button
                          onClick={() => {
                            setCypher(
                              "MATCH (a:Entity { project_id: $projectId })-[r:REL { project_id: $projectId }]->(b:Entity { project_id: $projectId }) RETURN a,b,r LIMIT 100",
                            );
                            setTimeout(() => runGraphQuery(), 100);
                          }}
                          className="px-2 py-1 rounded text-[11px]"
                          style={{
                            border: `1px solid ${C.primary}`,
                            background: "rgba(79,162,173,0.18)",
                            color: C.text,
                          }}
                        >
                          Load project subgraph
                        </button>
                      </div>
                      {graphViz.nodes.length === 0 && (
                        <div className="text-xs" style={{ opacity: 0.8, padding: "12px 0" }}>
                          No graph data loaded. Click "Load project subgraph" or run a Cypher query below.
                        </div>
                      )}

                      <div className="border-t pt-3" style={{ borderColor: C.border }}>
                        <div
                          className="text-xs font-semibold mb-2"
                          style={{ color: C.text }}
                        >
                          Knowledge Graph for this Project (Cypher)
                        </div>
                        <textarea
                          value={cypher}
                          onChange={(e) => setCypher(e.target.value)}
                          rows={4}
                          className="w-full text-xs resize-y"
                          style={{
                            background: C.bg,
                            border: `1px solid ${C.border}`,
                            borderRadius: 6,
                            padding: "8px 10px",
                            color: C.text,
                          }}
                        />
                        <div className="flex items-center gap-3 mt-2">
                          <button
                            onClick={runGraphQuery}
                            disabled={graphLoading}
                            className="px-3 py-1 text-xs rounded"
                            style={{
                              border: `1px solid ${C.border}`,
                              color: C.text,
                              background: graphLoading ? "rgba(255,255,255,0.06)" : "transparent",
                              opacity: graphLoading ? 0.7 : 1,
                            }}
                          >
                            {graphLoading ? "Running..." : "Run"}
                          </button>
                          <div className="text-[11px]" style={{ color: C.neutral }}>
                            Endpoint: /api/projects/{activeProject}/kg/query
                          </div>
                        </div>
                        {graphError && (
                          <div
                            className="mt-2 text-[11px]"
                            style={{ color: "#f87171" }}
                          >
                            {graphError}
                          </div>
                        )}
                        <pre
                          className="mt-2 text-[10px] max-h-48 overflow-auto rounded"
                          style={{
                            background: C.bg,
                            border: `1px solid ${C.border}`,
                            padding: "8px",
                            color: C.neutral,
                          }}
                        >
                          {graphResult.length ? JSON.stringify(graphResult, null, 2) : "Results will appear here"}
                        </pre>
                      </div>
                    </div>
                  )}

                  {tab === "Dashboard" && (
                    <div
                      className="grid"
                      style={{ gridTemplateColumns: "1fr 1fr", gap: 12 }}
                    >
                      <StatCard title="Plan items" value={plan.length.toString()} />
                      <StatCard title="Approved" value={approved.length.toString()} />
                      <StatCard title="Links" value={links.length.toString()} />
                      <StatCard title="Accepted" value={accepted.length.toString()} />
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
              {projectsError && (
                <div className="text-xs" style={{ color: C.neutral }}>
                  {projectsError}
                </div>
              )}
              {projects.map((project) => (
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

              {projects.length === 0 && !projectsError && (
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
