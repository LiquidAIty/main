import type { HermesCardProfileView } from '../features/agentbuilder/hermesCardProfile';

type HermesProfileStatus = 'idle' | 'loading' | 'ready' | 'failed';

export type CardInspectorSkillsTabModel = {
  skillsText: string;
  profile: {
    state: HermesCardProfileView | null;
    status: HermesProfileStatus;
    error: string | null;
  };
  learning: {
    detail: {
      kind: 'memory' | 'skill';
      id: string;
      label: string;
      content: string;
    } | null;
    draft: string;
    status: 'idle' | 'loading' | 'ready' | 'failed';
    error: string | null;
  };
};

export type CardInspectorSkillsTabActions = {
  changeSkillGrants(value: string): void;
  openLearningNode(nodeId: string): void | Promise<void>;
  changeLearningDraft(value: string): void;
};

export function CardInspectorSkillsTab({
  view,
  actions,
}: {
  view: CardInspectorSkillsTabModel;
  actions: CardInspectorSkillsTabActions;
}) {
  return (
    <section
      data-testid="card-inspector-skills"
      style={{ display: 'grid', gap: 12, padding: 10, border: '1px solid #3A4A4F', borderRadius: 8, background: '#202827' }}
    >
      <div style={{ color: '#E0DED5', fontSize: 12, fontWeight: 600 }}>Skills</div>
      <textarea
        aria-label="Card skill grants"
        value={view.skillsText}
        onChange={(event) => actions.changeSkillGrants(event.target.value)}
        placeholder="One skill ID per line"
        rows={5}
      />
      {view.profile.status === 'failed' ? (
        <div role="alert" style={{ color: '#FFA2A2', fontSize: 11 }}>
          {view.profile.error || 'Skills unavailable.'}
        </div>
      ) : view.profile.state ? (
        <>
          <details data-testid="effective-hermes-skills">
            <summary style={{ cursor: 'pointer', color: '#D5E4E8', fontSize: 11.5 }}>
              Loaded
            </summary>
            <div style={{ display: 'grid', gap: 5, marginTop: 8 }}>
              {view.profile.state.profile.skills.map((skill) => (
                <div key={skill.name} style={{ color: '#B8C8CD', fontSize: 11 }}>
                  {skill.name} · {skill.enabled ? 'enabled' : 'disabled'}
                </div>
              ))}
            </div>
          </details>
          {view.profile.state.profile.learning.buckets.some((bucket) => bucket.nodes.length > 0) ? (
            <section aria-label="Learning" style={{ display: 'grid', gap: 7 }}>
              <div style={{ color: '#D5E4E8', fontSize: 11.5, fontWeight: 600 }}>Learning</div>
              {view.profile.state.profile.learning.buckets.map((bucket) => (
                bucket.nodes.length ? (
                  <div key={`${bucket.index}:${bucket.date}`} style={{ display: 'grid', gap: 5 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 7, color: '#80969F', fontSize: 10.5 }}>
                      <span aria-hidden="true" style={{ width: 5, height: 5, borderRadius: '50%', background: bucket.color || '#80969F' }} />
                      <span>{bucket.label || bucket.date}</span>
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                      {bucket.nodes.map((node) => (
                        <button
                          key={node.id}
                          type="button"
                          aria-label={`Open ${node.fullLabel || node.label}`}
                          title={node.meta || node.fullLabel || node.label}
                          onClick={() => void actions.openLearningNode(node.id)}
                          style={{
                            minWidth: 0,
                            padding: '4px 7px',
                            border: '1px solid #3A4A4F',
                            borderRadius: 999,
                            background: '#18201F',
                            color: '#B8C8CD',
                            fontSize: 10.5,
                            cursor: 'pointer',
                          }}
                        >
                          {node.glyph ? `${node.glyph} ` : ''}{node.label}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null
              ))}
            </section>
          ) : null}
          {view.learning.status === 'loading' ? <div style={{ color: '#80969F' }}>Opening…</div> : null}
          {view.learning.status === 'failed' ? (
            <div role="alert" style={{ color: '#FFA2A2' }}>{view.learning.error}</div>
          ) : null}
          {view.learning.detail ? (
            <section style={{ display: 'grid', gap: 6, padding: 8, border: '1px solid #42565C', borderRadius: 6 }}>
              <strong>{view.learning.detail.kind}: {view.learning.detail.label}</strong>
              <textarea
                aria-label="Learning"
                value={view.learning.draft}
                onChange={(event) => actions.changeLearningDraft(event.target.value)}
                rows={10}
                style={{ width: '100%', minWidth: 0, padding: 10, background: '#161A1B', color: '#D5E4E8', border: '1px solid #42565C', borderRadius: 6, fontFamily: 'monospace', fontSize: 12, resize: 'vertical' }}
              />
            </section>
          ) : null}
        </>
      ) : (
        <div role="status" style={{ color: '#80969F', fontSize: 11 }}>Loading…</div>
      )}
    </section>
  );
}



