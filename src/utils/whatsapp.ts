/**
 * WhatsApp backup alert channel.
 *
 * There is no paid WhatsApp Business API wired into this project, and a
 * browser cannot silently send a WhatsApp message. The honest version of
 * "auto-send order summary to the hotel's WhatsApp" is: open a pre-filled
 * wa.me chat addressed to the hotel's WhatsApp number the moment the guest
 * places an order/request, as a backup alongside the live dashboard + siren.
 */

export interface WhatsAppOrderSummaryInput {
  hotelName: string;
  roomNumber: string;
  guestName?: string;
  type: 'food' | 'service' | string;
  items: { name: string; quantity: number; price?: number }[];
  totalAmount?: number;
  currencySymbol?: string;
  instructions?: string;
}

/** Digits-only phone number for wa.me (strips +, spaces, dashes). */
function normalizePhone(raw: string): string {
  return raw.replace(/[^\d]/g, '');
}

export function buildWhatsAppOrderMessage(input: WhatsAppOrderSummaryInput): string {
  const lines: string[] = [];
  lines.push(`*New ${input.type === 'food' ? 'Dining Order' : 'Service Request'} — ${input.hotelName}*`);
  lines.push(`Room: ${input.roomNumber}`);
  if (input.guestName) lines.push(`Guest: ${input.guestName}`);
  lines.push('');
  input.items.forEach((it) => {
    const priceStr = it.price ? ` (${input.currencySymbol || ''}${it.price})` : '';
    lines.push(`• ${it.quantity}x ${it.name}${priceStr}`);
  });
  if (typeof input.totalAmount === 'number' && input.totalAmount > 0) {
    lines.push('');
    lines.push(`Total: ${input.currencySymbol || ''}${input.totalAmount}`);
  }
  if (input.instructions) {
    lines.push('');
    lines.push(`Note: ${input.instructions}`);
  }
  return lines.join('\n');
}

/** Returns null when the hotel has no WhatsApp number configured. */
export function buildWhatsAppOrderUrl(
  ownerWhatsApp: string | undefined,
  input: WhatsAppOrderSummaryInput
): string | null {
  const phone = normalizePhone(ownerWhatsApp || '');
  if (!phone) return null;
  const text = buildWhatsAppOrderMessage(input);
  return `https://wa.me/${phone}?text=${encodeURIComponent(text)}`;
}
