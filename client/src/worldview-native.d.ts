declare module 'virtual:worldview-native-css' {
  const scopedStyles: string;
  export default scopedStyles;
}

declare module 'virtual:worldview-native-mount' {
  export const importNativeWorldViewMount: () => Promise<{
    mountWorldView: (
      root: HTMLElement,
      config: Record<string, unknown>,
    ) => Promise<any>;
  }>;
}
