import { ref, uploadBytesResumable, getDownloadURL, deleteObject, listAll } from 'firebase/storage';
import { storage } from '../firebase/config';

/** Max upload size: 5MB */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/** Only real image formats are accepted (checked by MIME type AND extension) */
export const ALLOWED_IMAGE_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

/**
 * Validates a candidate upload file.
 * Returns an error message string, or null when the file is acceptable.
 */
export function validateImageFile(file: File): string | null {
  const mime = (file.type || '').toLowerCase();
  if (!ALLOWED_IMAGE_MIME[mime]) {
    return 'Unsupported file type. Only JPG, PNG or WebP images can be uploaded.';
  }
  if (file.size > MAX_IMAGE_BYTES) {
    const mb = (file.size / (1024 * 1024)).toFixed(1);
    return `Image is ${mb}MB — the maximum allowed size is 5MB.`;
  }
  if (file.size === 0) {
    return 'The selected file is empty. Please choose a valid image.';
  }
  return null;
}

/** Maps a validated MIME type to a canonical file extension (jpg/png/webp). */
export function extensionForFile(file: File): string {
  return ALLOWED_IMAGE_MIME[(file.type || '').toLowerCase()] || 'jpg';
}

export interface UploadOptions {
  file: File;
  /** Full Storage path INCLUDING the file name, e.g. hotels/h1/menu/i1/image.jpg */
  path: string;
  onProgress?: (percent: number) => void;
}

/**
 * Uploads an image to Firebase Storage with a resumable task and progress reporting.
 * Returns the long-lived download URL from getDownloadURL().
 */
export function uploadImage({ file, path, onProgress }: UploadOptions): Promise<string> {
  const validationError = validateImageFile(file);
  if (validationError) {
    return Promise.reject(new Error(validationError));
  }

  return new Promise((resolve, reject) => {
    const storageRef = ref(storage, path);
    const task = uploadBytesResumable(storageRef, file, {
      contentType: file.type,
    });

    task.on(
      'state_changed',
      (snapshot) => {
        const pct = snapshot.totalBytes > 0
          ? Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100)
          : 0;
        onProgress?.(pct);
      },
      (err) => reject(err),
      async () => {
        try {
          const url = await getDownloadURL(task.snapshot.ref);
          onProgress?.(100);
          resolve(url);
        } catch (err) {
          reject(err);
        }
      }
    );
  });
}

function isFirebaseStorageUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      parsed.host.endsWith('firebasestorage.app') ||
      parsed.host.endsWith('firebasestorage.googleapis.com') ||
      parsed.host.endsWith('storage.googleapis.com') ||
      parsed.host.includes('firebasestorage')
    );
  } catch {
    return false;
  }
}

/**
 * Deletes a Storage object given its download URL.
 * Silently ignores files that are missing, already deleted, or hosted elsewhere
 * (e.g. legacy external URLs) so callers never need to handle cleanup errors.
 */
export async function deleteImageByUrl(url?: string | null): Promise<void> {
  if (!url || !isFirebaseStorageUrl(url)) return;
  try {
    await deleteObject(ref(storage, url));
  } catch (err: any) {
    const code = err?.code || '';
    if (!code.includes('object-not-found')) {
      console.warn('Storage cleanup skipped:', code || err?.message);
    }
  }
}

/**
 * Recursively deletes every object under a Storage folder prefix
 * (used when a whole hotel tenant is deleted).
 */
export async function deleteFolder(pathPrefix: string): Promise<void> {
  try {
    const folderRef = ref(storage, pathPrefix);
    const listing = await listAll(folderRef);
    await Promise.all([
      ...listing.items.map((item) => deleteObject(item).catch(() => undefined)),
      ...listing.prefixes.map((sub) => deleteFolder(sub.fullPath)),
    ]);
  } catch (err: any) {
    console.warn('Storage folder cleanup skipped:', err?.code || err?.message);
  }
}
