export function showCanvasWorkspaceInUrl(): void {
  const params = new URLSearchParams(window.location.search);
  params.delete('workspace');
  const nextQuery = params.toString();
  window.history.replaceState(
    {},
    '',
    nextQuery ? `${window.location.pathname}?${nextQuery}` : window.location.pathname,
  );
}

export function showKnowledgeWorkspaceInUrl(): void {
  const params = new URLSearchParams(window.location.search);
  params.set('workspace', 'knowledge');
  window.history.replaceState(
    {},
    '',
    `${window.location.pathname}?${params.toString()}`,
  );
}

export function showWorldViewWorkspaceInUrl(): void {
  const params = new URLSearchParams(window.location.search);
  params.set('workspace', 'worldview');
  window.history.replaceState(
    {},
    '',
    `${window.location.pathname}?${params.toString()}`,
  );
}
