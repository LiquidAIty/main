import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent,
} from 'react';

export type ChatImageAttachment = {
  name: string;
  mediaType: string;
  dataUrl: string;
  kind: 'user-upload';
};

export const MAX_CHAT_IMAGES = 12;
export const CHAT_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
const MAX_CHAT_IMAGE_BYTES = 10 * 1024 * 1024;

function readChatImage(file: File): Promise<ChatImageAttachment> {
  if (!CHAT_IMAGE_TYPES.includes(file.type)) {
    return Promise.reject(new Error('Choose a PNG, JPEG, WebP or GIF image.'));
  }
  if (file.size < 1 || file.size > MAX_CHAT_IMAGE_BYTES) {
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

export default function useChatImageAttachments({
  disabled,
  resetKey,
}: {
  disabled: boolean;
  resetKey: string;
}) {
  const [images, setImages] = useState<ChatImageAttachment[]>([]);
  const [imageError, setImageError] = useState<string | null>(null);
  const [readingImages, setReadingImages] = useState(false);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const readEpochRef = useRef(0);
  const readingRef = useRef(false);

  useEffect(() => {
    readEpochRef.current += 1;
    readingRef.current = false;
    setReadingImages(false);
    setImages([]);
    setImageError(null);
  }, [resetKey]);

  const attachFiles = useCallback(async (files: File[]) => {
    if (!files.length || disabled || readingRef.current) return;
    if (files.length + images.length > MAX_CHAT_IMAGES) {
      setImageError(`A message can include at most ${MAX_CHAT_IMAGES} images.`);
      return;
    }
    const epoch = readEpochRef.current;
    readingRef.current = true;
    setReadingImages(true);
    setImageError(null);
    try {
      const loaded = await Promise.all(files.map(readChatImage));
      if (readEpochRef.current === epoch) setImages((current) => [...current, ...loaded]);
    } catch (error) {
      if (readEpochRef.current === epoch) {
        setImageError(error instanceof Error ? error.message : 'Could not attach the images.');
      }
    } finally {
      if (readEpochRef.current === epoch) {
        readingRef.current = false;
        setReadingImages(false);
      }
    }
  }, [disabled, images.length]);

  const selectFiles = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    event.target.value = '';
    void attachFiles(files);
  }, [attachFiles]);

  const pasteFiles = useCallback((event: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(event.clipboardData.items || [])
      .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
      .map((item) => item.getAsFile())
      .filter((file): file is File => file !== null);
    if (!files.length) return;
    event.preventDefault();
    void attachFiles(files);
  }, [attachFiles]);

  const removeImage = useCallback((index: number) => {
    setImages((current) => current.filter((_, currentIndex) => currentIndex !== index));
    setImageError(null);
  }, []);

  const clearImages = useCallback(() => {
    setImages([]);
    setImageError(null);
  }, []);

  return {
    clearImages,
    imageError,
    imageInputRef,
    images,
    pasteFiles,
    readingImages,
    removeImage,
    selectFiles,
  };
}
