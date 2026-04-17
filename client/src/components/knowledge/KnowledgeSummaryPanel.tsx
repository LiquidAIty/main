import type { KnowledgeEntity, KnowledgeRelationship } from '../../types/knowledge';

interface KnowledgeSummaryPanelProps {
  entities: KnowledgeEntity[];
  relationships: KnowledgeRelationship[];
  onSelectEntity: (entity: KnowledgeEntity) => void;
  onSelectRelationship: (relationship: KnowledgeRelationship) => void;
  colors: {
    bg: string;
    border: string;
    text: string;
    neutral: string;
    primary: string;
  };
}

export default function KnowledgeSummaryPanel({
  entities,
  relationships,
  onSelectEntity,
  onSelectRelationship,
  colors,
}: KnowledgeSummaryPanelProps) {
  const topEntities = entities
    .sort((a, b) => (b.degree || 0) - (a.degree || 0))
    .slice(0, 8);

  const keyRelationships = relationships
    .filter((r) => r.confidence && r.confidence > 0.6)
    .slice(0, 6);

  return (
    <div
      style={{
        display: 'grid',
        gap: 16,
        padding: '0 4px 0 0',
      }}
    >
      <div
        style={{
          border: `1px solid ${colors.border}`,
          borderRadius: 10,
          background: colors.bg,
          padding: '14px 16px',
        }}
      >
        <div
          style={{
            fontSize: 13,
            fontWeight: 700,
            color: colors.text,
            marginBottom: 12,
            letterSpacing: '0.02em',
          }}
        >
          Knowledge Summary
        </div>
        <div
          style={{
            fontSize: 12,
            color: colors.neutral,
            lineHeight: 1.6,
          }}
        >
          {entities.length} entities • {relationships.length} relationships
        </div>
      </div>

      <div
        style={{
          border: `1px solid ${colors.border}`,
          borderRadius: 10,
          background: colors.bg,
          padding: '14px 16px',
        }}
      >
        <div
          style={{
            fontSize: 12,
            fontWeight: 700,
            color: colors.text,
            marginBottom: 10,
            letterSpacing: '0.02em',
          }}
        >
          Top Entities
        </div>
        <div style={{ display: 'grid', gap: 6 }}>
          {topEntities.map((entity) => (
            <button
              key={entity.id}
              onClick={() => onSelectEntity(entity)}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '8px 10px',
                borderRadius: 6,
                border: `1px solid ${colors.border}`,
                background: 'rgba(255,255,255,0.02)',
                color: colors.text,
                fontSize: 11,
                textAlign: 'left',
                cursor: 'pointer',
                transition: 'all 0.15s ease',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'rgba(79,162,173,0.08)';
                e.currentTarget.style.borderColor = colors.primary;
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'rgba(255,255,255,0.02)';
                e.currentTarget.style.borderColor = colors.border;
              }}
            >
              <span style={{ fontWeight: 600 }}>{entity.label}</span>
              <span style={{ fontSize: 10, color: colors.neutral }}>
                {entity.type} • {entity.degree || 0}
              </span>
            </button>
          ))}
        </div>
      </div>

      <div
        style={{
          border: `1px solid ${colors.border}`,
          borderRadius: 10,
          background: colors.bg,
          padding: '14px 16px',
        }}
      >
        <div
          style={{
            fontSize: 12,
            fontWeight: 700,
            color: colors.text,
            marginBottom: 10,
            letterSpacing: '0.02em',
          }}
        >
          Key Relationships
        </div>
        <div style={{ display: 'grid', gap: 6 }}>
          {keyRelationships.map((rel) => {
            const fromEntity = entities.find((e) => e.id === rel.from);
            const toEntity = entities.find((e) => e.id === rel.to);
            return (
              <button
                key={rel.id}
                onClick={() => onSelectRelationship(rel)}
                style={{
                  padding: '8px 10px',
                  borderRadius: 6,
                  border: `1px solid ${colors.border}`,
                  background: 'rgba(255,255,255,0.02)',
                  color: colors.text,
                  fontSize: 11,
                  textAlign: 'left',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'rgba(79,162,173,0.08)';
                  e.currentTarget.style.borderColor = colors.primary;
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'rgba(255,255,255,0.02)';
                  e.currentTarget.style.borderColor = colors.border;
                }}
              >
                <div style={{ fontWeight: 600, marginBottom: 4 }}>
                  {fromEntity?.label || rel.from} → {toEntity?.label || rel.to}
                </div>
                <div style={{ fontSize: 10, color: colors.neutral }}>
                  {rel.type} • {Math.round((rel.confidence || 0) * 100)}% confidence
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
