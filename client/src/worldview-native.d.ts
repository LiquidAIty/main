/**
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
