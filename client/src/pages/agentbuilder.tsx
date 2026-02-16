import React, { useCallback, useEffect, useRef, useState } from "react";

import type { AgentCard } from "../types/agentBuilder";
import { callBossAgent, solRun } from "../lib/api";
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
const V2_PROJECTS_API = "/api/v2/projects";

async function safeJson(res: Response): Promise<any | null> {
  if (res.status === 204 || res.status === 304) return null;
  let text = '';
  try {
    text = await res.text();
  } catch (err) {
    console.warn('[safeJson] failed to read body', { status: res.status, url: res.url });
    return null;
  }
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (err: any) {
    console.warn('[safeJson] invalid JSON', { status: res.status, url: res.url, error: err?.message || err });
    return null;
  }
}

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
type AgentTypeKey = "agent_builder" | "llm_chat" | "kg_ingest";
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
  const edgeSet = new Set<string>();

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

  const addNodeById = (id: unknown, label?: unknown) => {
    const sid = String(id ?? "").trim();
    if (!sid || nodeMap.has(sid)) return;
    nodeMap.set(sid, {
      id: sid,
      label: typeof label === "string" && label.trim() ? label.trim() : sid.slice(0, 12),
    });
  };

  const addEdge = (aId: string, bId: string) => {
    if (!aId || !bId) return;
    const key = `${aId}->${bId}`;
    if (edgeSet.has(key)) return;
    edgeSet.add(key);
    edges.push({ a: aId, b: bId });
  };

  const parseRow = (raw: any) => {
    if (typeof raw === "string") {
      try {
        return JSON.parse(raw);
      } catch {
        return null;
      }
    }
    return raw;
  };

  rows.forEach((rawRow) => {
    const row = parseRow(rawRow);
    if (!row || typeof row !== "object") return;

    // Shape emitted by the default KG subgraph query.
    if (row.a_id != null && row.b_id != null) {
      const aId = String(row.a_id);
      const bId = String(row.b_id);
      addNodeById(aId, row.a_name);
      addNodeById(bId, row.b_name);
      addEdge(aId, bId);
      return;
    }

    // Handle common AGE return shapes
    if (row.n) addNode(row.n);
    if (row.a && row.b) {
      addNode(row.a);
      addNode(row.b);
      const aId = extractNodeId(row.a);
      const bId = extractNodeId(row.b);
      addEdge(aId, bId);
    }
    if (Array.isArray(row)) {
      row.forEach((cell) => {
        if (cell && typeof cell === "object") {
          if (cell.start && cell.end) {
            const aId = extractNodeId(cell.start);
            const bId = extractNodeId(cell.end);
            addNode(cell.start);
            addNode(cell.end);
            addEdge(aId, bId);
          } else {
            addNode(cell);
          }
        }
      });
    }

    // Single-node rows such as RETURN n
    if (row.id || row._id || row.vid) {
      addNode(row);
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
  const [selectedAgentType, setSelectedAgentType] = useState<AgentTypeKey>("llm_chat");
  const [assistProjectId, setAssistProjectId] = useState<string>("");
  const [projectsLoaded, setProjectsLoaded] = useState(false);
  const messagesByScopeRef = useRef<Record<string, { role: "assistant" | "user"; text: string }[]>>({});
  const [projectLoading, setProjectLoading] = useState(false);
  const [projectSaveStatus, setProjectSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [projectSaveError, setProjectSaveError] = useState<string | null>(null);
  const [kgStatus, setKgStatus] = useState<{
    totals: { chunks: number; entities: number; rels: number };
    last_ingest: {
      ts?: string | null;
      last_ts?: string | null;
      ok: boolean;
      error_code?: string | null;
      error_message?: string | null;
      chunks: number;
      entities: number;
      rels: number;
    };
  } | null>(null);
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
  const activeTabs = mode === "assist" ? ["Knowledge"] : tabs;

  const [tab, setTab] = useState<string>("Knowledge");
  
  // Force tab by mode
  useEffect(() => {
    if (mode === "agents") setTab("Plan");
    if (mode === "assist") setTab("Knowledge");
  }, [mode]);
  useEffect(() => {
    if (mode === "agents") setSelectedAgentType("llm_chat");
  }, [mode]);
  useEffect(() => {
    const stored = localStorage.getItem("last_assist_project_id") || "";
    if (stored) {
      setAssistProjectId(stored);
    }
  }, []);
  useEffect(() => {
    if (mode === "assist" && activeProject) {
      localStorage.setItem("last_assist_project_id", activeProject);
      setAssistProjectId(activeProject);
    }
  }, [mode, activeProject]);
  const [openDrawer, setOpenDrawer] = useState<
    null | "project" | "apps" | "settings" | "admin"
  >(null);
  const [sending, setSending] = useState(false);

  // agent builder state
  const [projects, setProjects] = useState<any[]>([]);
  const refreshInFlight = useRef(false);
  const refreshSeq = useRef(0);
  const autoCreatedAssistRef = useRef(false);
  const loggedProjectRef = useRef<string | null>(null);
  const [projectsError, setProjectsError] = useState<string | null>(null);
  const [agentPrompt, setAgentPrompt] = useState<AgentPrompt>({
    role: "",
    context: "",
    objectives: "",
    style: "",
  });
  useEffect(() => {
    if (mode !== "agents" || !activeProject) return;
    const match = (Array.isArray(projects) ? projects : []).find((p) => p.id === activeProject);
    if (!match) return;
    const code = String(match.code || "").toLowerCase();
    if (code === "kg-ingest" || code === "kg_ingest") setSelectedAgentType("kg_ingest");
    else if (code === "agent-builder" || code === "agent_builder") setSelectedAgentType("agent_builder");
    else setSelectedAgentType("llm_chat");
  }, [mode, activeProject, projects]);

  // Boss agent prompt configuration (per project)
  const [bossPromptConfig, setBossPromptConfig] = useState({
    role: "You are Sol, the primary assistant inside LiquidAIty.\nYou talk with the user to help them build their system.\nYou are direct and practical.\nYou do not invent features that don't exist.\nWhen something is broken, you help debug it using the UI and logs.\nYou remember project facts only when they appear in retrieved context (KG/RAG).\nIf no retrieved context is provided, you do not pretend to remember.",
    goal: "Help the user make progress building LiquidAIty.\nPriorities:\n- Keep Assist chat working reliably.\n- Capture durable facts into knowledge (through the KG ingest pipeline).\n- Use retrieved knowledge to answer with better continuity and less repetition.\n- Keep solutions minimal and avoid UI bloat.",
    constraints: "- Do not claim something works unless it is wired and verified.\n- Prefer the smallest change that restores functionality.\n- When diagnosing errors, ask for the exact error message or stack trace.\n- Do not suggest new UI controls unless required for the core loop.\n- When referring to acronyms, expand them the first time (e.g., KG (Knowledge Graph), RAG (Retrieval-Augmented Generation)).",
    ioSchema: "Input: user message text + optional retrieved context block.\nOutput: normal conversational text.\nIf you need structured output, ask before switching formats.",
    memoryPolicy: "No hidden memory.\nOnly use:\n- the visible chat history in this session, and\n- any explicit retrieved context provided from KG/RAG.\nIf context is missing, say so plainly.",
    model: "gpt-5-nano",
    temperature: 0.7,
  });
  const refreshProjects = useCallback(async (preferredId?: string, filterType?: 'assist' | 'agent', reason?: string) => {
    if (refreshInFlight.current) return;
    refreshInFlight.current = true;
    const seq = ++refreshSeq.current;

    try {
      setProjectsError(null);
      const projectType = filterType || (mode === 'assist' ? 'assist' : 'agent');
      
      console.debug('[refreshProjects]', { reason: reason || 'unknown', mode, project_type_filter: projectType, seq });
      
      const response = await fetch(`${V2_PROJECTS_API}?project_type=${encodeURIComponent(projectType)}`);
      const data = await safeJson(response);
      
      if (seq !== refreshSeq.current) return;
      if (!data) {
        console.warn('[refreshProjects] empty response', { status: response.status, url: response.url });
        if (response.status !== 304 && response.status !== 204) {
          setProjectsError(`Error loading projects (HTTP ${response.status})`);
          setProjects([]);
        }
        return;
      }

      let cards = Array.isArray(data?.projects) ? data.projects : [];
      
      // Pin canonical agent decks to top in agent mode
      if (projectType === 'agent') {
        const PINNED_CODES = ['main-chat', 'kg-ingest'];
        const pinned = cards.filter((c: any) => PINNED_CODES.includes(c.code));
        const others = cards.filter((c: any) => !PINNED_CODES.includes(c.code));
        pinned.sort((a: any, b: any) => PINNED_CODES.indexOf(a.code) - PINNED_CODES.indexOf(b.code));
        cards = [...pinned, ...others];
      }
      
      if (cards.length === 0 && projectType === 'assist' && !autoCreatedAssistRef.current) {
        autoCreatedAssistRef.current = true;
        try {
          const createRes = await fetch(V2_PROJECTS_API, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              name: 'Default Project',
              project_type: 'assist',
            }),
          });
          const created = await safeJson(createRes);
          const newId = created?.id || '';
          if (newId) {
            const reloadRes = await fetch(`${V2_PROJECTS_API}?project_type=${encodeURIComponent(projectType)}`);
            const reload = await safeJson(reloadRes);
            if (seq !== refreshSeq.current) return;
            cards = Array.isArray(reload?.projects) ? reload.projects : [];
            setProjects(cards);
            setActiveProjectWithUrl(newId);
            return;
          }
        } catch (err: any) {
          console.error('[refreshProjects] auto-create failed:', err?.message || err);
        }
      }

      setProjects(cards);
      const search = new URLSearchParams(window.location.search);
      const urlId = search.get("projectId") || "";
      const urlIdValid = urlId && cards.some((c: any) => c.id === urlId);
      
      const current = preferredId || activeProject || "";
      const hasCurrent = current && cards.some((c: any) => c.id === current);
      
      // In Agent mode, prefer main-chat or kg-ingest
      const isAgents = projectType === "agent";
      const main = isAgents ? cards.find((c: any) => c.code === "main-chat") : null;
      const kg = isAgents ? cards.find((c: any) => c.code === "kg-ingest") : null;
      const fallbackPinned = main?.id || kg?.id || "";
      
      const nextId = urlIdValid ? urlId : (hasCurrent ? current : "") || fallbackPinned || cards[0]?.id || "";
      if (nextId) {
        setActiveProjectWithUrl(nextId);
      }
    } catch (err: any) {
      console.error("Error loading projects:", err);
      if (seq !== refreshSeq.current) return;
      setProjectsError(err?.message || 'Error loading projects');
    } finally {
      if (seq === refreshSeq.current) refreshInFlight.current = false;
    }
  }, [setActiveProjectWithUrl, mode]);

  useEffect(() => {
    // Prevent stale list when switching modes
    setProjects([]);
    setActiveProject('');
  }, [mode]);

  useEffect(() => {
    if (activeProject && loggedProjectRef.current !== activeProject) {
      console.log('[AgentBuilder] selected projectId=%s', activeProject);
      loggedProjectRef.current = activeProject;
    }
  }, [activeProject]);

  // chat state
  const [messages, setMessages] = useState<
    { role: "assistant" | "user"; text: string }[]
  >(() => loadProjectState(activeProject, mode).messages);

  // Enforce panel visibility by mode
  useEffect(() => {
    if (!panelOpen) {
      setPanelOpen(true);
    }
  }, [mode, panelOpen]);


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
  const [kgStatusPolledAt, setKgStatusPolledAt] = useState<Date | null>(null);
  const scopeKey = `${mode}:${activeProject || ""}`;

  useEffect(() => {
    if (!activeProject) {
      setKgStatus(null);
      return;
    }
    let cancelled = false;
    let timer: number | null = null;

    const poll = async () => {
      try {
        const res = await fetch(`/api/v2/projects/${activeProject}/kg/status`);
        const data = await res.json().catch(() => null);
        if (!cancelled && res.ok && data?.ok) {
          setKgStatus({
            totals: data.totals || { chunks: 0, entities: 0, rels: 0 },
            last_ingest: data.last_ingest || { ts: null, last_ts: null, ok: false, error_code: null, error_message: null, chunks: 0, entities: 0, rels: 0 },
          });
          setKgStatusPolledAt(new Date());
        }
      } catch {
        if (!cancelled) {
          setKgStatus(null);
        }
      }
    };

    void poll();
    timer = window.setInterval(poll, 3000);

    return () => {
      cancelled = true;
      if (timer) window.clearInterval(timer);
    };
  }, [activeProject]);

  const runGraphQuery = useCallback(async (query?: string) => {
    const q = (query ?? cypher).trim();
    if (!q) {
      setGraphError("Enter a Cypher query first.");
      return;
    }
    setGraphError(null);
    setGraphLoading(true);
    try {
      const res = await fetch(`/api/v2/projects/${activeProject}/kg/query`, {
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
  }, [activeProject, cypher]);

  // When switching projects, reload all per-project state from storage
    useEffect(() => {
      if (!activeProject) return;
      setStateLoaded(false);
      fetch(`${V2_PROJECTS_API}/${activeProject}/state`)
        .then((r) => safeJson(r))
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

  // Load projects on mount ONLY
  useEffect(() => {
    const search = new URLSearchParams(window.location.search);
    const urlId = search.get("projectId") || "";
    if (urlId) {
      setActiveProjectWithUrl(urlId);
    }
    void refreshProjects(undefined, mode === "assist" ? "assist" : "agent", 'mount');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  
  // Mode is user-chosen via Assist/Agent toggle - do not auto-switch based on project

  const loadProjectSubgraph = useCallback(() => {
    const q = [
      "MATCH (a { project_id: $projectId })-[r { project_id: $projectId }]->(b { project_id: $projectId })",
      "RETURN {a_id: id(a), a_name: a.name, b_id: id(b), b_name: b.name, r_type: r.rtype} AS row",
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
          const res = await fetch(`${V2_PROJECTS_API}/${activeProject}/kg/last-trace`);
          const data = await safeJson(res);
          if (data?.ok && data.trace) {
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
      // Simple payload - let backend pick runtime model
      const runtimeMode = mode === "agents" ? "agent" : "assist";
      const payload: any = { 
        goal: userText, 
        projectId: activeProject,
        mode: runtimeMode,
        agentConfig: {
          role: bossPromptConfig.role,
          goal: bossPromptConfig.goal,
          constraints: bossPromptConfig.constraints,
          ioSchema: bossPromptConfig.ioSchema,
          memoryPolicy: bossPromptConfig.memoryPolicy,
          // Don't send model - let backend pick from its registry
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
      if (mode === "assist" && activeProject && userText && assistantText) {
        void (async () => {
          try {
            await fetch(`/api/v2/projects/${activeProject}/kg/ingest_chat_turn`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                user_text: userText,
                assistant_text: assistantText,
                src: "chat.auto",
                mode: runtimeMode,
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
  const selectedAgentLabel =
    selectedAgentType === "agent_builder"
      ? "Agent Builder"
      : selectedAgentType === "kg_ingest"
        ? "KG Ingest"
        : "Main Chat";

  const createProjectPrompt = async () => {
    const name = window.prompt("New project name?");
    if (!name || !name.trim()) return;
    let code = window.prompt("Project code (optional)") || "";
    code = code.trim();
    if (!code) {
      code = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
    }
    
    const projectType = mode === 'assist' ? 'assist' : 'agent';
    
    try {
      const res = await fetch(V2_PROJECTS_API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          name: name.trim(), 
          code,
          project_type: projectType
        }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(text || `HTTP ${res.status}`);
      }
      const data = await res.json().catch(() => null);
      const newId = (data && data.id) || "";
      
      // Refresh projects with the correct type filter
      await refreshProjects(newId, projectType, 'after-create');
      
      // Set mode based on project type
      if (projectType === 'assist') {
        setMode('assist');
      } else {
        setMode('agents');
      }
      
      // Select the new project
      if (newId) {
        setActiveProjectWithUrl(newId);
      }
    } catch (err: any) {
      console.error("Create project failed", err);
      setProjectsError(`Failed to create project: ${err?.message || 'Unknown error'}`);
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
                {mode === "agents" && (
                  <>
                    {tab === "Plan" && (
                      <div className="space-y-3">
                        {activeProject ? (
                          <div className="space-y-4">
                            <div>
                              <div style={{ color: C.primary, fontWeight: 600, marginBottom: 6 }}>
                                {selectedAgentLabel}
                              </div>
                              <AgentManager
                                key={`${activeProject}:${selectedAgentType}`}
                                projectId={activeProject}
                                agentType={selectedAgentType}
                                activeTab={tab}
                                workspaceProjectId={assistProjectId || undefined}
                                onGraphRefresh={() => {
                                  // no-op
                                }}
                              />
                            </div>
                          </div>
                        ) : (
                          <div
                            style={{
                              padding: '16px',
                              border: `1px dashed ${C.border}`,
                              borderRadius: '8px',
                              color: C.neutral,
                              background: '#1a1a1a',
                            }}
                          >
                            Select a project to edit its agent configuration.
                          </div>
                        )}
                      </div>
                    )}

                    {tab === "Links" && (
                      <div className="space-y-3">
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
                )}

                {/* Knowledge tab - available in both modes */}
                {tab === "Knowledge" && (
                  <div className="space-y-3">
                    {activeProject && (
                      <div
                        className="text-xs p-3 rounded"
                        style={{
                          background: C.bg,
                          border: `1px solid ${C.border}`,
                          color: C.neutral,
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                          <div style={{ color: C.primary, fontWeight: 600 }}>KG Status</div>
                          <div
                            style={{
                              fontSize: 10,
                              color: C.neutral,
                              border: `1px solid ${C.border}`,
                              borderRadius: 999,
                              padding: '2px 8px',
                              background: '#141414',
                            }}
                          >
                            {kgStatusPolledAt ? `refreshed ${kgStatusPolledAt.toLocaleTimeString()}` : 'refreshing…'}
                          </div>
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 8 }}>
                          <div>Chunks: {kgStatus?.totals?.chunks ?? 0}</div>
                          <div>Entities: {kgStatus?.totals?.entities ?? 0}</div>
                          <div>Rels: {kgStatus?.totals?.rels ?? 0}</div>
                        </div>
                        {kgStatus?.totals && kgStatus.totals.chunks === 0 && kgStatus.totals.entities === 0 && kgStatus.totals.rels === 0 && (
                          <div style={{ marginBottom: 8, fontStyle: 'italic' }}>No data yet.</div>
                        )}
                        {kgStatus?.last_ingest ? (
                          <div>
                            <div>Last: {kgStatus.last_ingest.ts || kgStatus.last_ingest.last_ts ? new Date((kgStatus.last_ingest.ts || kgStatus.last_ingest.last_ts) as string).toLocaleString() : 'never'}</div>
                            <div>
                              Status: {kgStatus.last_ingest.ok ? 'ok' : 'error'}{' '}
                              {kgStatus.last_ingest.ok ? '' : (kgStatus.last_ingest.error_code || 'unknown')}
                            </div>
                            {!kgStatus.last_ingest.ok && kgStatus.last_ingest.error_message && (
                              <div style={{ marginTop: 4 }}>{kgStatus.last_ingest.error_message}</div>
                            )}
                          </div>
                        ) : (
                          <div>Last: never</div>
                        )}
                      </div>
                    )}
                    {/* Force-directed graph visualization */}
                    {graphError && (
                      <div className="text-xs" style={{ color: C.warn }}>
                        Graph query error: {graphError}
                      </div>
                    )}
                    <div style={{ display: "flex", justifyContent: "center" }}>
                      <MiniForce nodes={graphViz.nodes} edges={graphViz.edges} />
                    </div>
                  </div>
                )}
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
            {/* Mode Selector */}
            <div className="flex gap-2 mb-3">
              <button
                onClick={() => {
                  setMode('assist');
                  refreshProjects(undefined, 'assist', 'mode-change');
                }}
                className="flex-1 px-3 py-2 rounded text-sm font-medium transition-colors"
                style={{
                  background: mode === 'assist' ? C.primary : 'transparent',
                  color: mode === 'assist' ? '#0B0C0E' : C.text,
                  border: `1px solid ${mode === 'assist' ? C.primary : C.border}`,
                }}
              >
                Assist
              </button>
              <button
                onClick={() => {
                  setMode('agents');
                  refreshProjects(undefined, 'agent', 'mode-change');
                }}
                className="flex-1 px-3 py-2 rounded text-sm font-medium transition-colors"
                style={{
                  background: mode === 'agents' ? C.primary : 'transparent',
                  color: mode === 'agents' ? '#0B0C0E' : C.text,
                  border: `1px solid ${mode === 'agents' ? C.primary : C.border}`,
                }}
              >
                Agent
              </button>
            </div>
            
            <div
              className="text-xs uppercase mb-2 flex items-center justify-between"
              style={{ color: C.neutral }}
            >
              <span>{mode === 'assist' ? 'Assist Projects' : 'Agent Projects'}</span>
              <button
                onClick={createProjectPrompt}
                className="text-[11px] px-2 py-1 rounded"
                style={{ border: `1px solid ${C.border}`, color: C.text }}
              >
                {mode === 'assist' ? 'New Project' : 'New Agent'}
              </button>
            </div>
            <div className="space-y-2" style={{ maxHeight: '400px', overflowY: 'auto' }}>
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
              {Array.from(
                new Map(
                  (Array.isArray(projects) ? projects : []).map((p) => {
                    const codeKey = String(p.code || '').toLowerCase();
                    const key = codeKey ? `code:${codeKey}` : `id:${p.id}`;
                    return [key, p];
                  }),
                ).values(),
              ).map((project) => {
                return (
                  <React.Fragment key={project.id}>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => {
                          setActiveProjectWithUrl(project.id);
                          if (mode === 'agents') {
                            const code = String(project.code || '').toLowerCase();
                            if (code === 'kg-ingest' || code === 'kg_ingest') setSelectedAgentType('kg_ingest');
                            else if (code === 'agent-builder' || code === 'agent_builder') setSelectedAgentType('agent_builder');
                            else setSelectedAgentType('llm_chat');
                          }
                          setOpenDrawer(null);
                        }}
                        className="flex-1 text-left p-3 rounded"
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
                            {project.code && (
                              <div className="opacity-60 text-xs">
                                {project.code}
                              </div>
                            )}
                          </div>
                        </div>
                      </button>
                      <button
                        onClick={async (e) => {
                          e.stopPropagation();
                          const PROTECTED_AGENT_CODES = new Set(["main-chat", "kg-ingest"]);
                          const isProtectedAgent = mode === "agents" && PROTECTED_AGENT_CODES.has(project.code);
                          if (isProtectedAgent) {
                            alert("Main Chat and KG Ingest are protected system decks.");
                            return;
                          }
                          if (!confirm(`Delete project "${project.name}"? This cannot be undone.`)) return;
                          try {
                            const res = await fetch(`${V2_PROJECTS_API}/${project.id}`, { method: 'DELETE' });
                            if (!res.ok) throw new Error(`HTTP ${res.status}`);
                            await refreshProjects(undefined, undefined, 'after-delete');
                            if (activeProject === project.id) {
                              const remaining = projects.filter(p => p.id !== project.id);
                              if (remaining.length > 0) {
                                setActiveProjectWithUrl(remaining[0].id);
                              } else {
                                setActiveProject('');
                              }
                            }
                          } catch (err: any) {
                            alert(`Failed to delete project: ${err.message}`);
                          }
                        }}
                        className="p-2 rounded"
                        style={{
                          background: 'transparent',
                          border: `1px solid ${C.border}`,
                          color: C.warn,
                        }}
                        title="Delete project"
                      >
                        ×
                      </button>
                    </div>
                  </React.Fragment>
                );
              })}

              {Array.isArray(projects) && projects.length === 0 && !projectsError && (
                <div className="text-xs" style={{ color: C.neutral }}>
                  No projects available.
                </div>
              )}
            </div>
            <div className="text-xs mt-4" style={{ color: C.neutral }}>
              {mode === 'assist' ? 'Assist projects are shipped product workspaces.' : 'Agent projects are builder/expert workspaces.'}
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
          <div className="text-sm" style={{ color: C.text }}>
            Admin controls placeholder.
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
