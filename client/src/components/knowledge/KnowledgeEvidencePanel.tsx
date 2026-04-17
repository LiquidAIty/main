import type { KnowledgeRelationship, KnowledgeEntity } from '../../types/knowledge';

interface KnowledgeEvidencePanelProps {
  relationship: KnowledgeRelationship;
  fromEntity: KnowledgeEntity | null;
  toEntity: KnowledgeEntity | null;
  onClose: () => void;
  colors: {
    bg: string;
    border: string;
    text: string;
    neutral: string;
    primary: string;
    warn: string;
  };
}

export default function KnowledgeEvidencePanel({
  relationship,
  fromEntity,
  toEntity,
  onClose,
  colors,
}: KnowledgeEvidencePanelProps) {
  const evidenceChunks = relationship.evidence_chunk_ids || [];
  const sourceDocuments = relationship.source_document_ids || [];

  return (
    <div
      style={{
        position: 'fixed',
        right: 0,
        top: 0,
        bottom: 0,
        width: 420,
        background: colors.bg,
        borderLeft: `1px solid ${colors.border}`,
        padding: '20px',
        overflowY: 'auto',
        zIndex: 100,
      }}
    >
      <div style={{ marginBottom: 20 }}>
        <button
          onClick={onClose}
          style={{
            padding: '6px 12px',
            borderRadius: 6,
            border: `1px solid ${colors.border}`,
            background: 'rgba(255,255,255,0.03)',
            color: colors.text,
            fontSize: 11,
            cursor: 'pointer',
          }}
        >
          ← Back
        </button>
      </div>

      <div style={{ marginBottom: 24 }}>
        <div
          style={{
            fontSize: 18,
            fontWeight: 700,
            color: colors.text,
            marginBottom: 8,
          }}
        >
          {fromEntity?.label || relationship.from} → {toEntity?.label || relationship.to}
        </div>
        <div style={{ fontSize: 12, color: colors.neutral }}>
          {relationship.type} • {Math.round((relationship.confidence || 0) * 100)}% confidence
        </div>
      </div>

      {relationship.summary && (
        <div
          style={{
            border: `1px solid ${colors.border}`,
            borderRadius: 10,
            background: 'rgba(255,255,255,0.02)',
            padding: '14px 16px',
            marginBottom: 20,
          }}
        >
          <div
            style={{
              fontSize: 12,
              fontWeight: 700,
              color: colors.text,
              marginBottom: 8,
            }}
          >
            Summary
          </div>
          <div
            style={{
              fontSize: 12,
              color: colors.neutral,
              lineHeight: 1.6,
            }}
          >
            {relationship.summary}
          </div>
        </div>
      )}

      {evidenceChunks.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <div
            style={{
              fontSize: 13,
              fontWeight: 700,
              color: colors.text,
              marginBottom: 12,
            }}
          >
            Evidence ({evidenceChunks.length})
          </div>
          <div style={{ display: 'grid', gap: 10 }}>
            {evidenceChunks.slice(0, 3).map((chunkId, idx) => (
              <div
                key={chunkId}
                style={{
                  border: `1px solid ${colors.border}`,
                  borderRadius: 8,
                  background: 'rgba(255,255,255,0.02)',
                  padding: '12px 14px',
                }}
              >
                <div
                  style={{
                    fontSize: 11,
                    color: colors.neutral,
                    lineHeight: 1.5,
                  }}
                >
                  Evidence chunk {idx + 1}: {chunkId.substring(0, 40)}...
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {sourceDocuments.length > 0 && (
        <div>
          <div
            style={{
              fontSize: 13,
              fontWeight: 700,
              color: colors.text,
              marginBottom: 12,
            }}
          >
            Sources ({sourceDocuments.length})
          </div>
          <div style={{ display: 'grid', gap: 8 }}>
            {sourceDocuments.map((docId) => (
              <button
                key={docId}
                onClick={() => {
                  console.log('Open source:', docId);
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '10px 12px',
                  borderRadius: 8,
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
                <span style={{ fontWeight: 600 }}>{docId.substring(0, 50)}...</span>
                <span style={{ fontSize: 10, color: colors.primary }}>Open →</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
