/**
 * Graph + less = more: less code that does the same work as more code is more useful.
 * Entity names the feature; Relationship explains why this file belongs and what it contributes.
 * Use codebase-memory-mcp cli to search tags, trace structure both ways, check coverage, then read source.
 * Change the smallest existing path; remove what it replaces, never duplicate, and update tags when meaning changes.
 * Entity: WorldView
 * Relationship: Declares the production and test virtual-module contracts for scoped WorldView styles and the supervised one-Earth mount importer.
 */

declare module 'virtual:worldview-native-css' {
  const scopedStyles: string;
  export default scopedStyles;
}

declare module 'virtual:worldview-native-mount' {
  export const importNativeWorldViewMount: () => Promise<{
    mountWorldView: (
      root: HTMLElement,
      config: Record<string, unknown>,
    ) => Promise<import('./components/worldsignal/loadWorldViewNative').NativeWorldViewMount>;
  }>;
}
