import { useEffect, useRef } from 'react';
import { buildSimulation } from '../../../../Hermes/apps/desktop/src/app/starmap/simulation';
import { drawScene } from '../../../../Hermes/apps/desktop/src/app/starmap/render';
import { computePalette } from '../../../../Hermes/apps/desktop/src/app/starmap/color';
import { fitViewport, nodeRadius } from '../../../../Hermes/apps/desktop/src/app/starmap/geometry';
import { TILT } from '../../../../Hermes/apps/desktop/src/app/starmap/constants';
import type { Scene } from '../../../../Hermes/apps/desktop/src/app/starmap/render';
import type { NativeHermesCardView } from './nativeHermesCard';

export default function HermesSkillGraph({ graph, onOpenNode }: {
  graph: NativeHermesCardView['native']['learning']['graph'];
  profile: string;
  onOpenNode: (id: string) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const openNodeRef = useRef(onOpenNode);
  openNodeRef.current = onOpenNode;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !graph.nodes.length) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    let scene: Scene | undefined;
    let frame = 0;
    const draw = () => {
      frame = 0;
      if (scene) drawScene(scene);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(draw);
    };
    // The existing producer returns the Hermes graph unchanged. The renderer
    // and simulation are imported directly; this component only binds canvas events.
    const built = buildSimulation(graph, schedule);
    const adjacency = new Map<string, Set<string>>();
    for (const edge of graph.edges) {
      if (!adjacency.has(edge.source)) adjacency.set(edge.source, new Set());
      if (!adjacency.has(edge.target)) adjacency.set(edge.target, new Set());
      adjacency.get(edge.source)!.add(edge.target);
      adjacency.get(edge.target)!.add(edge.source);
    }
    const resize = () => {
      const { width: w, height: h } = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      scene = {
        ...built, ctx, dpr, adjacency, size: { w, h },
        vp: fitViewport(w, h, built.rings.at(-1)?.r),
        palette: computePalette(canvas), reveal: 1, snapMotion: true,
        focusId: null, hoverId: null, hoverLink: null, hoverRing: null, selectedRing: null,
        memById: new Map(graph.memory.map((card, i) => [`memory:${card.source}:${i}`, card])),
        fades: { appear: new Map(), labels: new Map(), links: new Map(), nodes: new Map(), rings: new Map() },
      };
      schedule();
    };
    const pick = (event: PointerEvent | MouseEvent) => {
      if (!scene) return null;
      const rect = canvas.getBoundingClientRect();
      const px = event.clientX - rect.left;
      const py = event.clientY - rect.top;
      return built.nodes.find((node) => Math.hypot(
        px - (scene!.vp.x + node.x * scene!.vp.k),
        py - (scene!.vp.y + node.y * scene!.vp.k * TILT),
      ) <= Math.max(8, nodeRadius(node) * scene!.vp.k))?.id || null;
    };
    const hover = (event: PointerEvent) => {
      if (!scene) return;
      scene.hoverId = pick(event);
      canvas.style.cursor = scene.hoverId ? 'pointer' : 'default';
      schedule();
    };
    const click = (event: MouseEvent) => {
      const id = pick(event);
      if (id) openNodeRef.current(id);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    canvas.addEventListener('pointermove', hover);
    canvas.addEventListener('click', click);
    resize();
    return () => {
      observer.disconnect();
      built.sim.stop();
      cancelAnimationFrame(frame);
      canvas.removeEventListener('pointermove', hover);
      canvas.removeEventListener('click', click);
    };
  }, [graph]);

  if (!graph.nodes.length) return null;
  return <canvas ref={canvasRef} aria-label="Skill graph"
    style={{ width: '100%', aspectRatio: '1.6', display: 'block', color: '#72D7C7' }} />;
}
