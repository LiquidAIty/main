'use client';

// Embed build shim for 'next/image'. Every in-app consumer already passes a
// passthrough loader with unoptimized=true (see components/ExternalImage.tsx),
// so the optimizer was never in play — only the <img> it renders.
// vite.embed.config.ts aliases 'next/image' here.

import React from 'react';

export type ImageLoaderProps = { src: string; width?: number; quality?: number };
export type ImageProps = React.ImgHTMLAttributes<HTMLImageElement> & {
  src: string;
  alt?: string;
  width?: number | string;
  height?: number | string;
  fill?: boolean;
  loader?: (props: ImageLoaderProps) => string;
  unoptimized?: boolean;
  priority?: boolean;
};

export default function Image({
  loader,
  unoptimized: _unoptimized,
  priority: _priority,
  fill,
  src,
  alt = '',
  style,
  ...rest
}: ImageProps) {
  const resolved = loader ? loader({ src, width: Number(rest.width) || undefined }) : src;
  const fillStyle: React.CSSProperties | undefined = fill
    ? { position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }
    : undefined;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={resolved} alt={alt} style={{ ...fillStyle, ...style }} {...rest} />;
}
