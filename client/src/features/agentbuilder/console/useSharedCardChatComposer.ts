import {
  useCallback, useEffect, useLayoutEffect, useRef, useState,
  type ChangeEvent, type ClipboardEvent, type KeyboardEvent,
} from 'react';

import type { DirectChatTarget } from './sharedChatClient';
import {
  MAX_SHARED_CARD_CHAT_IMAGES,
  type SharedCardRunInput,
} from './sharedChatTranscript';

type ComposerImage = {
  name: string;
  mediaType: string;
  dataUrl: string;
  kind: 'user-upload';
};

const COMPOSER_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
const MAX_COMPOSER_IMAGE_BYTES = 10 * 1024 * 1024;

function readComposerImage(file: File): Promise<ComposerImage> {
  if (!COMPOSER_IMAGE_TYPES.includes(file.type)) {
    return Promise.reject(new Error('Choose a PNG, JPEG, WebP or GIF image.'));
  }
  if (file.size < 1 || file.size > MAX_COMPOSER_IMAGE_BYTES) {
    return Promise.reject(new Error('Each image must be between 1 byte and 10 MB.'));
  }
  const name = (file.name || 'image.png').trim();
  if (name.length > 200 || /[\\/]/.test(name)) {
    return Promise.reject(new Error(
      'The image filename must be at most 200 characters without path separators.',
    ));
  }
  if (!/\.(png|jpe?g|webp|gif)$/i.test(name)) {
    return Promise.reject(new Error('Use a PNG, JPEG, WebP or GIF filename.'));
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`Could not read ${name}.`));
    reader.onload = () => {
      if (typeof reader.result !== 'string') {
        reject(new Error(`Could not read ${name}.`));
        return;
      }
      resolve({ name, mediaType: file.type, dataUrl: reader.result, kind: 'user-upload' });
    };
    reader.readAsDataURL(file);
  });
}

type ComposerInteractionProps = {
  directChatTargets: DirectChatTarget[];
  onSend: (text: string, runInput?: SharedCardRunInput) => void;
  busy: boolean;
  connecting: boolean;
  knowledgeProjectId: string;
  draft?: string;
  onDraftChange?: (value: string) => void;
};

export function useSharedCardChatComposer({
  directChatTargets, onSend, busy, connecting, knowledgeProjectId, draft, onDraftChange,
}: ComposerInteractionProps) {
  const [localDraft, setLocalDraft] = useState('');
  const [selectedAddressIndex, setSelectedAddressIndex] = useState(0);
  const [images, setImages] = useState<ComposerImage[]>([]);
  const [imageError, setImageError] = useState<string | null>(null);
  const [readingImages, setReadingImages] = useState(false);
  const composerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const imageReadRef = useRef(false);
  const imageReadEpochRef = useRef(0);
  const interactionDisabled = busy || connecting;
  const value = draft === undefined ? localDraft : draft;

  useEffect(() => {
    imageReadEpochRef.current += 1;
    imageReadRef.current = false;
    setReadingImages(false);
    setImages([]);
    setImageError(null);
  }, [knowledgeProjectId]);

  const attachImages = useCallback(async (files: File[]) => {
    if (!files.length || interactionDisabled || imageReadRef.current) return;
    if (files.length + images.length > MAX_SHARED_CARD_CHAT_IMAGES) {
      setImageError(`A message can include at most ${MAX_SHARED_CARD_CHAT_IMAGES} images.`);
      return;
    }
    const epoch = imageReadEpochRef.current;
    imageReadRef.current = true;
    setReadingImages(true);
    setImageError(null);
    try {
      const loaded = await Promise.all(files.map(readComposerImage));
      if (imageReadEpochRef.current === epoch) {
        setImages((current) => [...current, ...loaded]);
      }
    } catch (reason) {
      if (imageReadEpochRef.current === epoch) {
        setImageError(reason instanceof Error ? reason.message : 'Could not attach the images.');
      }
    } finally {
      if (imageReadEpochRef.current === epoch) {
        imageReadRef.current = false;
        setReadingImages(false);
      }
    }
  }, [images.length, interactionDisabled]);

  const resizeComposer = useCallback(() => {
    const input = inputRef.current;
    if (!input) return;
    input.style.height = '0px';
    const maximumHeight = Math.max(40, Math.min(240, window.innerHeight * 0.35));
    const height = Math.min(maximumHeight, Math.max(40, input.scrollHeight));
    input.style.height = `${height}px`;
    input.style.overflowY = input.scrollHeight > height ? 'auto' : 'hidden';
  }, []);
  useLayoutEffect(resizeComposer, [resizeComposer, value]);
  useEffect(() => {
    const composer = composerRef.current;
    if (!composer) return;
    let previousWidth = composer.clientWidth;
    const observer = typeof ResizeObserver === 'function'
      ? new ResizeObserver(() => {
          const width = composer.clientWidth;
          if (width === previousWidth) return;
          previousWidth = width;
          resizeComposer();
        })
      : null;
    observer?.observe(composer);
    window.addEventListener('resize', resizeComposer);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', resizeComposer);
    };
  }, [resizeComposer]);

  const setValue = useCallback((next: string) => {
    if (draft === undefined) setLocalDraft(next);
    onDraftChange?.(next);
  }, [draft, onDraftChange]);
  const addressMatch = /^@([a-z0-9_-]*)$/i.exec(value);
  const addressPrefix = addressMatch?.[1]?.toLowerCase() ?? null;
  const addressSuggestions = addressPrefix === null ? [] : directChatTargets.filter((agent) => (
    Boolean(agent.address)
    && agent.aliases.some((alias) => alias.toLowerCase().startsWith(addressPrefix))
  ));
  const boundedAddressIndex = addressSuggestions.length > 0
    ? Math.min(selectedAddressIndex, addressSuggestions.length - 1)
    : 0;
  useEffect(() => setSelectedAddressIndex(0), [addressPrefix]);

  const completeAddress = useCallback((index = boundedAddressIndex) => {
    const agent = addressSuggestions[index];
    if (!agent?.address) return;
    setValue(`@${agent.address} `);
    setSelectedAddressIndex(0);
  }, [addressSuggestions, boundedAddressIndex, setValue]);
  const send = useCallback(() => {
    if (!value.trim() || interactionDisabled || imageReadRef.current) return;
    if (images.length) onSend(value, { images });
    else onSend(value);
    setImages([]);
    setImageError(null);
    setValue('');
  }, [images, interactionDisabled, onSend, setValue, value]);
  const removeImage = useCallback((index: number) => {
    setImages((current) => current.filter((_, itemIndex) => itemIndex !== index));
    setImageError(null);
  }, []);
  const selectImageFiles = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    event.target.value = '';
    void attachImages(files);
  }, [attachImages]);
  const pasteImages = useCallback((event: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(event.clipboardData.items || [])
      .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
      .map((item) => item.getAsFile())
      .filter((file): file is File => file !== null);
    if (!files.length) return;
    event.preventDefault();
    void attachImages(files);
  }, [attachImages]);
  const handleKeyDown = useCallback((event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Tab' && addressSuggestions.length > 0) {
      event.preventDefault();
      completeAddress();
    } else if (event.key === 'ArrowDown' && addressSuggestions.length > 1) {
      event.preventDefault();
      setSelectedAddressIndex((current) => (current + 1) % addressSuggestions.length);
    } else if (event.key === 'ArrowUp' && addressSuggestions.length > 1) {
      event.preventDefault();
      setSelectedAddressIndex((current) => (
        (current - 1 + addressSuggestions.length) % addressSuggestions.length
      ));
    } else if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      send();
    }
  }, [addressSuggestions.length, completeAddress, send]);

  return {
    addressSuggestions, boundedAddressIndex, completeAddress, composerRef, handleKeyDown,
    imageError, imageInputRef, images, imageTypes: COMPOSER_IMAGE_TYPES,
    inputRef, interactionDisabled, pasteImages, readingImages,
    removeImage, selectImageFiles, send, setValue, value,
  };
}
