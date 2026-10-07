declare module 'virtual:worldview-runtime-css' {
  const scopedStyles: string;
  export default scopedStyles;
}

declare module 'virtual:worldview-runtime-mount' {
  export const importWorldViewMount: () => Promise<{
    mountWorldView: (
      root: HTMLElement,
      config: Record<string, unknown>,
    ) => Promise<any>;
  }>;
}
