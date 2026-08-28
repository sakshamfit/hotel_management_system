import QRCode from 'qrcode';

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
