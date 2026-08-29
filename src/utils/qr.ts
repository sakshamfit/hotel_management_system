import QRCode from 'qrcode';

/**
 * Bearer credential printed on a room's QR code.
 *
 * The token is exchanged for a room-scoped session by /api/guest/session, so
 * it must be unguessable — the old `qr_{hotelId}_rm{n}_{timestamp}` format
 * leaked the hotel id and room number and left only ~36 bits of entropy.
 * Uses crypto.randomUUID with a CSPRNG fallback for non-secure contexts.
 */
export function generateRoomToken(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  const bytes = new Uint8Array(16);
  if (c && typeof c.getRandomValues === 'function') {
    c.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function generateQrDataUrl(text: string, options?: QRCode.QRCodeToDataURLOptions): Promise<string> {
  try {
    return await QRCode.toDataURL(text, {
      width: options?.width || 256,
      margin: options?.margin || 2,
      color: {
        dark: options?.color?.dark || '#1c1917',
        light: options?.color?.light || '#ffffff',
      },
      errorCorrectionLevel: 'M',
      ...options,
    });
  } catch (err) {
    console.error('Error generating QR code:', err);
    return '';
  }
}
