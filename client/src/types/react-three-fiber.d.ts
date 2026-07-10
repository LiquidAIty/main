import type { ThreeElements } from '@react-three/fiber';

declare module 'react' {
  namespace JSX {
    // React's JSX augmentation must inherit the library's generated elements.
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type, @typescript-eslint/no-empty-interface
    interface IntrinsicElements extends ThreeElements {}
  }
}

export {};
