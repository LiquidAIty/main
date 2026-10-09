import { useEffect, useState } from 'react';

import {
  buildInputDictionarySelectedRows,
  parseCardListEditorText,
  toggleSavedToolAssignment,
  type InputDictionaryToolPage,
} from '../features/agentbuilder/cardConfigurationEditor';

const EMPTY_TOOL_PAGE: InputDictionaryToolPage = {
  references: [],
  selectedKnownReferences: [],
  unresolvedSelectedIds: [],
  namespaces: [],
  total: 0,
  offset: 0,
  limit: 100,
  hasMore: false,
};

export function useCardToolOptions({
  toolsText,
  setToolsText,
  markDraftDirty,
}: {
  toolsText: string;
  setToolsText: (value: string) => void;
  markDraftDirty: () => void;
}) {
  const [page, setPage] = useState<InputDictionaryToolPage>(EMPTY_TOOL_PAGE);
  const [query, setQuery] = useState('');
  const [namespace, setNamespace] = useState('');
  const [offset, setOffset] = useState(0);
  const [showSelectedOnly, setShowSelectedOnly] = useState(true);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState(false);
  const savedToolNames = parseCardListEditorText(toolsText);
  const selectedRows = buildInputDictionarySelectedRows(
    page.selectedKnownReferences,
    page.unresolvedSelectedIds,
  );
  const availableRows = page.references.filter((reference) =>
    !savedToolNames.includes(reference.canonicalId)
    && !showSelectedOnly,
  );

  useEffect(() => {
    const controller = new AbortController();
    setBusy(true);
    setError(false);
    const timer = window.setTimeout(() => {
      void (async () => {
        setBusy(true);
        try {
          const params = new URLSearchParams({
            query,
            offset: String(offset),
            limit: '100',
          });
          if (namespace) params.set('namespace', namespace);
          if (savedToolNames.length) params.set('selectedIds', savedToolNames.join(','));
          const response = await fetch(`/api/idd/tools?${params}`, {
            signal: controller.signal,
          });
          const payload = await response.json();
          if (!response.ok || !payload?.ok || !Array.isArray(payload.references)) {
            throw new Error('Tool options unavailable');
          }
          setPage({
            references: payload.references,
            selectedKnownReferences: Array.isArray(payload.selectedKnownReferences)
              ? payload.selectedKnownReferences : [],
            unresolvedSelectedIds: Array.isArray(payload.unresolvedSelectedIds)
              ? payload.unresolvedSelectedIds : [],
            namespaces: Array.isArray(payload.namespaces) ? payload.namespaces : [],
            total: Number.isFinite(payload.total) ? payload.total : 0,
            offset: Number.isFinite(payload.offset) ? payload.offset : offset,
            limit: Number.isFinite(payload.limit) ? payload.limit : 100,
            hasMore: payload.hasMore === true,
          });
        } catch (_error) {
          if (!controller.signal.aborted) {
            setError(true);
            setPage((current) => ({
              ...current,
              references: [],
              selectedKnownReferences: [],
              unresolvedSelectedIds: savedToolNames,
              total: 0,
              offset: 0,
              hasMore: false,
            }));
          }
        } finally {
          if (!controller.signal.aborted) setBusy(false);
        }
      })();
    }, 150);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [savedToolNames.join('\u0000'), namespace, offset, query]);

  return {
    page,
    query,
    namespace,
    offset,
    showSelectedOnly,
    busy,
    error,
    savedToolNames,
    selectedRows,
    availableRows,
    changeQuery(value: string) {
      setQuery(value);
      setOffset(0);
    },
    changeNamespace(value: string) {
      setNamespace(value);
      setOffset(0);
    },
    changeShowSelectedOnly: setShowSelectedOnly,
    clearSelectedTools() {
      setToolsText('');
      markDraftDirty();
    },
    toggleTool(name: string, checked: boolean) {
      setToolsText(toggleSavedToolAssignment(savedToolNames, name, checked).join('\n'));
      markDraftDirty();
    },
    showPreviousPage() {
      setOffset(Math.max(0, offset - 100));
    },
    showNextPage() {
      setOffset(page.offset + page.limit);
    },
  };
}
