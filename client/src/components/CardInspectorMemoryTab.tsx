type HermesProfileStatus = 'idle' | 'loading' | 'ready' | 'failed';

export type CardInspectorMemoryTabModel = {
  profileStatus: HermesProfileStatus;
  profileError: string | null;
};

export function CardInspectorMemoryTab({ view }: { view: CardInspectorMemoryTabModel }) {
  return (
    <section
      data-testid="card-inspector-memory"
      style={{ display: 'grid', gap: 12, padding: 10, border: '1px solid #3A4A4F', borderRadius: 8, background: '#202827' }}
    >
      <div style={{ color: '#E0DED5', fontSize: 12, fontWeight: 600 }}>Memory</div>
      {view.profileStatus === 'failed' ? (
        <div role="alert" style={{ color: '#FFA2A2', fontSize: 11 }}>
          {view.profileError || 'Memory unavailable.'}
        </div>
      ) : null}
    </section>
  );
}
