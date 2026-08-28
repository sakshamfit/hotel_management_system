import React, { useEffect, useRef, useState } from 'react';
import {
  UploadCloud,
  AlertCircle,
  RefreshCw,
  Trash2,
  ImageIcon,
  Loader2,
} from 'lucide-react';
import {
  validateImageFile,
  extensionForFile,
  uploadImage,
  deleteImageByUrl,
} from '../../services/storageService';

interface ImageUploaderProps {
  /** Field label shown above the control */
  label: string;
  /**
   * Current image URL stored in Firestore (already-uploaded image).
   * Controlled together with onUrlChange in immediate mode.
   */
  value?: string | null;
  /**
   * IMMEDIATE MODE (default): provide `storagePath` (folder WITHOUT file name,
   * e.g. "hotels/h1/menu/i1") — the file uploads as soon as it is selected and
   * onUrlChange fires with the download URL. Replacing overwrites the same
   * deterministic path; removing deletes the stored object.
   *
   * DEFERRED MODE: omit `storagePath` — the component only validates + previews
   * the file locally and reports it via onFileChange. The parent uploads once
   * the owning entity (hotel / menu item) has been created and has an ID.
   */
  storagePath?: string;
  onUrlChange?: (url: string | null) => void;
  onFileChange?: (file: File | null) => void;
  /** Optional helper text under the label */
  hint?: string;
  /** Thumbnail height class, e.g. "h-24" */
  thumbClass?: string;
  disabled?: boolean;
}

export const ImageUploader: React.FC<ImageUploaderProps> = ({
  label,
  value = '',
  storagePath,
  onUrlChange,
  onFileChange,
  hint,
  thumbClass = 'h-24',
  disabled = false,
}) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [localPreview, setLocalPreview] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const objectUrlRef = useRef<string | null>(null);

  // Release local object URLs on unmount / change
  useEffect(() => {
    return () => {
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    };
  }, []);

  const setPreviewFromFile = (file: File | null) => {
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    objectUrlRef.current = file ? URL.createObjectURL(file) : null;
    setLocalPreview(objectUrlRef.current);
  };

  const handleFile = async (file: File | null) => {
    if (!file) return;
    setError(null);

    const validationError = validateImageFile(file);
    if (validationError) {
      setError(validationError);
      return;
    }

    // DEFERRED MODE — validate + preview only; parent uploads after entity creation
    if (!storagePath) {
      setPreviewFromFile(file);
      onFileChange?.(file);
      return;
    }

    // IMMEDIATE MODE — upload straight away with progress
    setPreviewFromFile(file);
    setProgress(0);
    try {
      const ext = extensionForFile(file);
      const url = await uploadImage({
        file,
        path: `${storagePath}/image.${ext}`,
        onProgress: setProgress,
      });
      // Clean up the previous object (different extension / token) if there was one
      if (value && value !== url) {
        await deleteImageByUrl(value);
      }
      setPreviewFromFile(null);
      onUrlChange?.(url);
    } catch (err: any) {
      console.error('Image upload failed:', err);
      setError(err?.message || 'Upload failed. Please check your connection and try again.');
      setPreviewFromFile(null);
      onFileChange?.(null);
    } finally {
      setProgress(null);
    }
  };

  const handleRemove = async () => {
    setError(null);
    setPreviewFromFile(null);
    onFileChange?.(null);
    if (storagePath && value) {
      await deleteImageByUrl(value);
    }
    onUrlChange?.(null);
  };

  const openPicker = () => {
    setError(null);
    inputRef.current?.click();
  };

  const previewSrc = localPreview || value || null;
  const isUploading = progress !== null;

  return (
    <div className="space-y-1.5">
      <label className="block t-button-cap text-ink">{label}</label>

      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0] || null;
          e.target.value = ''; // allow re-selecting the same file
          if (file) handleFile(file);
        }}
      />

      {/* Preview / drop zone */}
      {previewSrc ? (
        <div className="flex items-start gap-3">
          <div className={`relative ${thumbClass} w-36 shrink-0 rounded-lg overflow-hidden border border-hairline bg-canvas-soft`}>
            <img src={previewSrc} alt={label} className="h-full w-full object-cover" />
            {isUploading && (
              <div className="absolute inset-0 bg-primary/60 flex flex-col items-center justify-center gap-1.5">
                <Loader2 className="w-5 h-5 text-on-primary animate-spin" />
                <span className="t-micro text-on-primary font-mono">{progress}%</span>
              </div>
            )}
          </div>

          <div className="flex flex-col gap-2 pt-0.5">
            {!isUploading && !disabled && (
              <>
                <button
                  type="button"
                  onClick={openPicker}
                  className="btn-secondary-outline px-3 py-1.5 text-xs"
                >
                  <RefreshCw className="w-3.5 h-3.5" /> Replace
                </button>
                <button
                  type="button"
                  onClick={handleRemove}
                  className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg border border-hairline text-xs font-semibold text-ink-mute hover:text-ink hover:border-hairline-dark transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5" /> Remove
                </button>
              </>
            )}
            {isUploading && (
              <span className="t-micro text-ink-mute">Uploading… {progress}%</span>
            )}
          </div>
        </div>
      ) : (
        <button
          type="button"
          disabled={disabled || isUploading}
          onClick={openPicker}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            const file = e.dataTransfer.files?.[0];
            if (file) handleFile(file);
          }}
          className={`w-full flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed px-4 py-6 text-center transition-colors disabled:opacity-50 ${
            dragOver
              ? 'border-violet-soft bg-violet-tint'
              : 'border-hairline bg-canvas-soft hover:border-hairline-dark'
          }`}
        >
          <div className="w-9 h-9 rounded-full bg-canvas border border-hairline flex items-center justify-center text-primary">
            <UploadCloud className="w-[18px] h-[18px]" />
          </div>
          <div className="t-caption text-ink">
            <span className="font-semibold underline decoration-hairline underline-offset-2">
              Click to upload
            </span>{' '}
            or drag &amp; drop
          </div>
          <div className="t-micro text-ink-faint flex items-center gap-1">
            <ImageIcon className="w-3 h-3" /> JPG, PNG or WebP · max 5MB
          </div>
        </button>
      )}

      {/* Progress bar while uploading from the empty state (edge case) */}
      {isUploading && previewSrc && (
        <div className="w-36">
          <div className="h-1 rounded-full bg-canvas-soft border border-hairline overflow-hidden">
            <div
              className="h-full bg-primary transition-all duration-200"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      )}

      {hint && !error && <p className="t-micro text-ink-faint">{hint}</p>}

      {error && (
        <div className="flex items-start gap-2 bg-violet-tint border border-violet-soft rounded-lg px-3 py-2 text-xs text-primary-deep">
          <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <span className="font-medium">{error}</span>
        </div>
      )}
    </div>
  );
};
