import { Handle, Position } from '@xyflow/react';

export default function AgentCardNode({ data, selected }: any) {
  return (
    <div
      className={`rounded-xl border p-3 min-w-[220px] bg-zinc-900 text-white ${
        selected ? 'ring-2 ring-cyan-400' : ''
      }`}
    >
      <Handle type="target" position={Position.Left} />

      <div className="text-sm font-semibold">{data.title}</div>

      {data.subtitle && <div className="text-xs opacity-70 mt-1">{data.subtitle}</div>}

      {data.status && <div className="text-[11px] mt-2 opacity-60">{data.status}</div>}

      <Handle type="source" position={Position.Right} />
    </div>
  );
}
