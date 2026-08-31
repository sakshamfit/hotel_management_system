import { supabase, supabaseProjectUrl } from '../supabase/config';
import { isLocalMode, localUploadMedia, localDeleteMediaByUrl, localDeleteMediaFolder, isLocalMediaUrl } from './local/localApi';

/**
 * Image uploads — Supabase Storage, bucket `hotel-media`.
 * Public read (the app uses plain public URLs); writes restricted to staff by
 * storage RLS. Object paths mirror the old Firebase layout:
 *   hotels/{hotelId}/rooms/{roomId}.jpg
 *   hotels/{hotelId}/menu/{itemId}.jpg
 */

export const BUCKET = 'hotel-media';

/** Max upload size: 5MB */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/** Only real image formats are accepted (MIME type AND extension). */
export const ALLOWED_IMAGE_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

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

export function extensionForFile(file: File): string {
  return ALLOWED_IMAGE_MIME[(file.type || '').toLowerCase()] || 'jpg';
}

export interface UploadOptions {
  file: File;
  /** Full Storage path INCLUDING file name, e.g. hotels/h1/menu/i1/image.jpg */
  path: string;
  onProgress?: (percent: number) => void;
}

/**
 * Uploads an image and returns its public URL. Uses XHR for progress reporting
 * (supabase-js v2 does not expose upload progress directly).
 */
export async function uploadImage({ file, path, onProgress }: UploadOptions): Promise<string> {
  const validationError = validateImageFile(file);
  if (validationError) throw new Error(validationError);

  // Desktop edition: the image is stored next to the local database.
  if (isLocalMode()) {
    const url = await localUploadMedia(file, path);
    onProgress?.(100);
    return url;
  }

  const {
    data: { session },
  } = await supabase.auth.getSession();
  const token = session?.access_token;

  const { data: urlData } = supabase.storage.from(BUCKET).getPublicUrl(path);
  const publicUrl = urlData.publicUrl;

  const cleanPath = path.replace(/^\/+/, '');

  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${supabaseProjectUrl}/storage/v1/object/${BUCKET}/${cleanPath}`);
    xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
    xhr.setRequestHeader('x-upsert', 'true');
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress?.(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress?.(100);
        resolve();
      } else {
        reject(new Error(`Upload failed (HTTP ${xhr.status}).`));
      }
    };
    xhr.onerror = () => reject(new Error('Upload failed — network error.'));
    xhr.send(file);
  });

  return publicUrl;
}

/** True when a URL points at this Supabase Storage bucket. */
function isSupabaseStorageUrl(url: string): boolean {
  try {
    const parsed = new URL(url, window.location.origin);
    return (
      parsed.href.includes('/storage/v1/object/') ||
      (!!supabaseProjectUrl && parsed.host === new URL(supabaseProjectUrl).host)
    );
  } catch {
    return false;
  }
}

/** Extracts the object path within the bucket from a public/rendered URL. */
function objectPathFromUrl(url: string): string | null {
  try {
    const parsed = new URL(url, window.location.origin);
    const markers = [`/storage/v1/object/public/${BUCKET}/`, `/storage/v1/object/${BUCKET}/`];
    for (const marker of markers) {
      const idx = parsed.pathname.indexOf(marker);
      if (idx !== -1) return decodeURIComponent(parsed.pathname.slice(idx + marker.length));
    }
    return null;
  } catch {
    return null;
  }
}

/** Deletes a Storage object given its URL. Best effort — never throws. */
export async function deleteImageByUrl(url?: string | null): Promise<void> {
  if (isLocalMode()) {
    if (!url || !isLocalMediaUrl(url)) return;
    try {
      await localDeleteMediaByUrl(url);
    } catch (err: any) {
      console.warn('Storage cleanup skipped:', err?.message || err);
    }
    return;
  }
  if (!url || !isSupabaseStorageUrl(url)) return;
  const path = objectPathFromUrl(url);
  if (!path) return;
  try {
    await supabase.storage.from(BUCKET).remove([path]);
  } catch (err: any) {
    console.warn('Storage cleanup skipped:', err?.message || err);
  }
}

/** Recursively deletes every object under a prefix (used on hotel deletion). */
export async function deleteFolder(pathPrefix: string): Promise<void> {
  if (isLocalMode()) {
    try {
      await localDeleteMediaFolder(pathPrefix.replace(/^\/+|\/+$/g, ''));
    } catch (err: any) {
      console.warn('Storage folder cleanup skipped:', err?.message || err);
    }
    return;
  }
  const prefix = pathPrefix.replace(/^\/+|\/+$/g, '');
  try {
    const { data: list, error } = await supabase.storage.from(BUCKET).list(prefix, { limit: 1000 });
    if (error) throw error;
    if (!list) return;

    const files = list.filter((i) => i.id).map((i) => `${prefix}/${i.name}`);
    const prefixes = list.filter((i) => !i.id).map((i) => i.name);

    if (files.length) {
      await supabase.storage.from(BUCKET).remove(files);
    }
    await Promise.all(prefixes.map((p) => deleteFolder(`${prefix}/${p}`)));
  } catch (err: any) {
    console.warn('Storage folder cleanup skipped:', err?.message || err);
  }
}
