import React, { useCallback, useEffect, useRef, useState } from 'react';
import { firestoreService } from '../../services/firestoreService';
import { Hotel } from '../../types';
import {
  Bell,
  Volume2,
  VolumeX,
  X,
  List,
  ChevronDown,
  ChevronUp,
  Trash2,
  Home,
  RefreshCw,
} from 'lucide-react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface OrderLineItem {
  id?: string;
  name?: string;
  variantName?: string;
  quantity?: number;
  price?: number;
}

interface OrderAlert {
  id: string;
  hotelId: string;
  hotelName: string;
  roomNumber: string;
  guestName: string;
  type?: string;
  items: OrderLineItem[];
  instructions?: string;
  receivedAt: number;
}

// ---------------------------------------------------------------------------
// Web Audio API — programmatic siren/beep (no external audio file)
// ---------------------------------------------------------------------------

let audioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  const Ctor =
    (window as any).AudioContext ||
    (window as any).webkitAudioContext;
  if (!Ctor) return null;
  if (!audioCtx) audioCtx = new Ctor();
  return audioCtx;
}

function unlockAudio(): boolean {
  const ctx = getAudioContext();
  if (!ctx) return false;
  if (ctx.state === 'suspended') {
    ctx.resume().catch(() => {});
  }
  return true;
}

function playAlertSound(): void {
  const ctx = getAudioContext();
  if (!ctx) return;
  if (ctx.state === 'suspended') {
    ctx.resume().catch(() => {});
  }
  try {
    const now = ctx.currentTime + 0.02;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.connect(gain);
    gain.connect(ctx.destination);

    // Two-tone siren sweep repeated a few times
    const freqs = [880, 620, 880, 620, 880];
    const step = 0.3;
    freqs.forEach((freq, i) => {
      const t = now + i * step;
      osc.frequency.setValueAtTime(freq, t);
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.5, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + step - 0.02);
    });

    osc.start(now);
    osc.stop(now + freqs.length * step + 0.1);
  } catch (err) {
    // Audio is non-critical; never break the app
  }
}

// ---------------------------------------------------------------------------
// Web Speech API — voice announcement (Browser Text-to-Speech, no external API)
// ---------------------------------------------------------------------------

function speakText(text: string): void {
  if (typeof window === 'undefined') return;
  const synth = (window as any).speechSynthesis;
  if (!synth) return;
  try {
    synth.cancel();
    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = 'en-US';
    utter.rate = 1;
    utter.pitch = 1;
    utter.volume = 1;
    synth.speak(utter);
  } catch (err) {
    // Voice is non-critical; never break the app
  }
}

// Parse a createdAt value (ISO string, number, Date, or Firestore Timestamp) into ms.
function toEpochMs(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const t = new Date(value).getTime();
    return Number.isNaN(t) ? null : t;
  }
  if (value instanceof Date) return value.getTime();
  // Firestore Timestamp / server timestamp-like object
  if (typeof value === 'object' && (value as any).toDate) {
    const t = (value as any).toDate().getTime();
    return Number.isNaN(t) ? null : t;
  }
  if (typeof value === 'object' && typeof (value as any).seconds === 'number') {
    return (value as any).seconds * 1000;
  }
  return null;
}

// Build the spoken summary dynamically from the actual order document.
function buildSpokenMessage(alert: OrderAlert): string {
  const items = Array.isArray(alert.items) ? alert.items.filter((i) => i && i.name) : [];
  let msg = `New order received from Room ${alert.roomNumber}.`;
  if (alert.guestName && alert.guestName.trim() && alert.guestName.trim().toLowerCase() !== 'in-room guest') {
    msg += ` Guest ${alert.guestName.trim()}.`;
  }
  if (items.length > 0) {
    const list = items.map((i) => `${i.quantity || 1} ${i.name}`).join(', ');
    msg += ` They want: ${list}.`;
  }
  return msg;
}

// Build the on-screen summary the same way (room + items).
function buildDisplaySummary(alert: OrderAlert): string {
  const items = Array.isArray(alert.items) ? alert.items.filter((i) => i && i.name) : [];
  const list = items.map((i) => `${i.quantity || 1} ${i.name}`).join(', ');
  return list;
}

const SOUND_KEY = 'nexora_order_sound_enabled';

// raw pref: '' = never chosen, '1' = enabled, '0' = explicitly muted
function getSoundPref(): string {
  try {
    return window.localStorage.getItem(SOUND_KEY) || '';
  } catch {
    return '';
  }
}

function loadSoundEnabled(): boolean {
  return getSoundPref() === '1';
}

function saveSoundPref(enabled: boolean): void {
  try {
    window.localStorage.setItem(SOUND_KEY, enabled ? '1' : '0');
  } catch {
    // ignore
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface NewOrderAlertCenterProps {
  hotels: Hotel[];
}

export const NewOrderAlertCenter: React.FC<NewOrderAlertCenterProps> = ({ hotels }) => {
  const [soundEnabled, setSoundEnabled] = useState<boolean>(() => loadSoundEnabled());
  const [toasts, setToasts] = useState<OrderAlert[]>([]);
  const [queue, setQueue] = useState<OrderAlert[]>([]);
  const [queueOpen, setQueueOpen] = useState<boolean>(false);

  const soundEnabledRef = useRef<boolean>(false);
  const hotelsRef = useRef<Hotel[]>(hotels);

  // Keep the hotel list fresh without re-subscribing on every render
  hotelsRef.current = hotels;

  const soundEnabledSet = useCallback((enabled: boolean) => {
    soundEnabledRef.current = enabled;
    setSoundEnabled(enabled);
    saveSoundPref(enabled);
  }, []);

  // Enable sound + unlock the AudioContext (must happen after a user gesture)
  const enableSound = useCallback(() => {
    unlockAudio();
    const ctx = getAudioContext();
    if (ctx && ctx.state === 'suspended') {
      ctx.resume()
        .then(() => {
          if (getAudioContext()?.state === 'running') {
            soundEnabledSet(true);
          }
        })
        .catch(() => {});
    } else {
      soundEnabledSet(true);
    }
  }, [soundEnabledSet]);

  const disableSound = useCallback(() => {
    const ctx = getAudioContext();
    if (ctx) {
      try {
        ctx.suspend();
      } catch {
        // ignore
      }
    }
    soundEnabledSet(false);
    setQueueOpen(true);
  }, [soundEnabledSet]);

  // Seed the saved preference
  useEffect(() => {
    soundEnabledSet(loadSoundEnabled());
  }, [soundEnabledSet]);

  // Auto-unlock sound on the first real user interaction, since browsers block
  // playAudio/speech until then. This makes the opt-in button self-clearing.
  // Respect an explicit "muted" preference ('0'); do not auto-enable over it.
  useEffect(() => {
    const attemptUnlock = () => {
      if (soundEnabledRef.current) return;
      if (getSoundPref() === '0') return;
      const ctx = getAudioContext();
      if (!ctx) return;
      if (ctx.state === 'running') {
        enableSound();
        cleanup();
        return;
      }
      ctx.resume().then(() => {
        if (ctx.state === 'running' && !soundEnabledRef.current) {
          enableSound();
        }
        cleanup();
      }).catch(() => {});
    };
    const cleanup = () => {
      window.removeEventListener('pointerdown', attemptUnlock);
      window.removeEventListener('keydown', attemptUnlock);
    };
    // Only attach the auto-unlock listeners when the user hasn't explicitly muted.
    if (getSoundPref() !== '0') {
      window.addEventListener('pointerdown', attemptUnlock);
      window.addEventListener('keydown', attemptUnlock);
    }
    return () => {
      cleanup();
    };
  }, [enableSound]);

  const pushAlert = useCallback(
    (alert: OrderAlert) => {
      // Always record it in the queue so staff can review without sound
      setQueue((prev) => [alert, ...prev].slice(0, 60));
      setToasts((prev) => [alert, ...prev].slice(0, 3));

      // Auto-dismiss the toast after a few seconds (manual dismiss also available)
      window.setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== alert.id));
      }, 10000);
      // No need to clear the timeout individually; it only filters the toast list.

      if (soundEnabledRef.current) {
        playAlertSound();
        // Brief delay so the beep starts before the voice announces
        window.setTimeout(() => speakText(buildSpokenMessage(alert)), 400);
      }
    },
    []
  );

  // Subscribe to real-time order doc changes for the given hotels.
  useEffect(() => {
    const unsubs: Array<() => void> = [];
    const ids = hotelsRef.current.map((h) => h.id);

    ids.forEach((hotelId) => {
      const listenStartTs = Date.now();
      // `isFirst` lets us skip the initial snapshot of pre-existing orders
      // (docChanges reports existing docs as "added" on the first read).
      const unsub = firestoreService.subscribeOrderChanges(
        hotelId,
        (added, isFirst) => {
          if (isFirst) return;
          const now = Date.now();
          added.forEach((change) => {
            const data = change.data || {};
            const createdAtTs = toEpochMs(data.createdAt) ?? now;

            // Timestamp guard: only treat as genuinely NEW if it was created at
            // or after we started listening (with a small buffer for clock skew).
            if (createdAtTs < listenStartTs - 5000) return;

            const hotel = hotelsRef.current.find((h) => h.id === hotelId);
            const alert: OrderAlert = {
              id: change.id,
              hotelId,
              hotelName: hotel?.name || hotel?.hotelCode || 'Hotel',
              roomNumber:
                data.roomNumber || data.roomId || data.room || '—',
              guestName: data.guestName || '',
              type: data.type,
              items: Array.isArray(data.items) ? data.items : [],
              instructions: data.instructions,
              receivedAt: now,
            };
            // Skip malformed docs without any room — nothing meaningful to alert on.
            if (!alert.roomNumber || alert.roomNumber === '—') return;
            pushAlert(alert);
          });
        },
        (err) => console.warn(`Order alert listener error for ${hotelId}:`, err)
      );
      unsubs.push(unsub);
    });

    return () => {
      unsubs.forEach((unsub) => unsub());
    };
  }, [hotels.map((h) => h.id).join(','), pushAlert]);

  if (hotels.length === 0) return null;

  const dismissToast = (id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  const dismissQueueItem = (id: string) => {
    setQueue((prev) => prev.filter((t) => t.id !== id));
  };

  const clearQueue = () => {
    setQueue([]);
  };

  return (
    <>
      {/* ---- Toast stack (top-right) ---- */}
      <div className="fixed top-20 right-4 z-[80] space-y-3 w-[340px] max-w-[calc(100vw-2rem)] pointer-events-none">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className="pointer-events-auto bg-[#1b1b1f]/95 backdrop-blur border border-[#ff385c]/40 text-white rounded-2xl shadow-2xl overflow-hidden"
            style={{ animation: 'navOrderIn 0.25s ease-out' }}
          >
            {/* Red alert bar */}
            <div className="h-1.5 bg-gradient-to-r from-[#ff385c] to-[#e00b41] w-full" />
            <div className="p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-xl bg-[#ff385c] text-white flex items-center justify-center shrink-0">
                    <Bell className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="text-[11px] font-bold uppercase tracking-wider text-[#ffb3c2]">
                      New Order
                    </div>
                    <div className="text-xs text-[#c9c9cf] truncate max-w-[180px]">
                      {toast.hotelName}
                    </div>
                  </div>
                </div>
                <button
                  onClick={() => dismissToast(toast.id)}
                  className="p-1.5 rounded-full hover:bg-white/10 text-white/70 hover:text-white transition-colors"
                  aria-label="Dismiss notification"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="mt-3 flex items-center gap-2 text-sm font-bold">
                <Home className="w-4 h-4 text-[#ff385c]" />
                <span>Room {toast.roomNumber}</span>
              </div>

              {toast.guestName && toast.guestName.trim() && toast.guestName.trim().toLowerCase() !== 'in-room guest' && (
                <div className="mt-1 text-xs text-white/70">
                  Guest: {toast.guestName}
                </div>
              )}

              <div className="mt-2 bg-white/5 border border-white/10 rounded-xl p-2.5 text-xs text-white/90">
                {buildDisplaySummary(toast) ? (
                  <span className="font-medium">{buildDisplaySummary(toast)}</span>
                ) : (
                  <span className="text-white/60">
                    {toast.type ? `${toast.type} request` : 'Request'}
                  </span>
                )}
              </div>

              {toast.instructions && (
                <div className="mt-2 text-[11px] italic text-amber-200/80">
                  “{toast.instructions}”
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* ---- Queue / Controls (bottom-right) ---- */}
      <div className="fixed bottom-4 right-4 z-[80] flex flex-col items-end gap-2">
        {/* Sound opt-in / toggle */}
        <div className="flex items-center gap-2">
          {!soundEnabled && (
            <button
              onClick={enableSound}
              className="flex items-center gap-1.5 px-3 py-2 rounded-full bg-[#ff385c] hover:bg-[#e00b41] text-white text-xs font-bold shadow-lg shadow-[#ff385c]/20 transition-all"
            >
              <Volume2 className="w-3.5 h-3.5" />
              Enable notification sound
            </button>
          )}
          {soundEnabled && (
            <div className="flex items-center gap-1.5 px-3 py-2 rounded-full bg-[#f7f7f7] border border-[#dddddd] text-[#222222] text-xs font-semibold shadow-sm">
              <Volume2 className="w-3.5 h-3.5 text-emerald-600" />
              <span>Sound on</span>
              <button
                onClick={disableSound}
                className="ml-1 p-1 rounded-full hover:bg-[#ebebeb] text-[#6a6a6a] hover:text-[#222222] transition-colors"
                aria-label="Mute notifications"
                title="Mute"
              >
                <VolumeX className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>

        {/* Queue toggle */}
        <button
          onClick={() => setQueueOpen((o) => !o)}
          className="flex items-center gap-2 px-4 py-2.5 rounded-2xl bg-[#222222] hover:bg-black text-white text-xs font-bold shadow-xl transition-all"
        >
          {queueOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
          <List className="w-4 h-4" />
          <span>New Orders</span>
          {queue.length > 0 && (
            <span className="bg-[#ff385c] text-white text-[10px] font-extrabold min-w-5 h-5 px-1 rounded-full flex items-center justify-center">
              {queue.length}
            </span>
          )}
        </button>
      </div>

      {/* ---- Queue panel ---- */}
      {queueOpen && (
        <div className="fixed bottom-16 right-4 z-[80] w-[360px] max-w-[calc(100vw-2rem)] bg-white border border-[#ebebeb] rounded-3xl shadow-2xl overflow-hidden flex flex-col">
          <div className="flex items-center justify-between px-4 py-3 bg-[#fafafa] border-b border-[#ebebeb]">
            <div className="flex items-center gap-2 text-xs font-bold text-[#222222]">
              <Bell className="w-4 h-4 text-[#ff385c]" />
              <span>New Orders Queue</span>
              <span className="bg-[#fff0f3] text-[#ff385c] text-[10px] font-extrabold px-2 py-0.5 rounded-full">
                {queue.length}
              </span>
            </div>
            <div className="flex items-center gap-1">
              {queue.length > 0 && (
                <button
                  onClick={clearQueue}
                  className="p-1.5 rounded-full hover:bg-[#ebebeb] text-[#6a6a6a] hover:text-[#222222] transition-colors"
                  title="Clear all"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
              <button
                onClick={() => setQueueOpen(false)}
                className="p-1.5 rounded-full hover:bg-[#ebebeb] text-[#6a6a6a] hover:text-[#222222] transition-colors"
                aria-label="Close queue"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto max-h-[45vh] p-2">
            {queue.length === 0 ? (
              <div className="py-10 text-center text-xs text-[#6a6a6a]">
                <RefreshCw className="w-6 h-6 mx-auto mb-2 text-[#c9c9cf]" />
                No new orders yet.
                <div className="text-[10px] text-[#a0a0a0] mt-1">
                  New guest orders will appear here instantly.
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                {queue.map((item) => (
                  <div
                    key={item.id}
                    className="border border-[#ebebeb] hover:border-[#dddddd] rounded-2xl p-3 bg-white transition-colors"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="text-xs font-bold text-[#222222] flex items-center gap-1.5">
                          <Home className="w-3.5 h-3.5 text-[#ff385c]" />
                          Room {item.roomNumber}
                        </div>
                        <div className="text-[10px] text-[#6a6a6a] mt-0.5">
                          {item.hotelName}
                          {item.type ? ` • ${item.type}` : ''}
                        </div>
                      </div>
                      <button
                        onClick={() => dismissQueueItem(item.id)}
                        className="p-1 rounded-full hover:bg-[#f7f7f7] text-[#a0a0a0] hover:text-[#ff385c] transition-colors"
                        aria-label="Remove from list"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    <div className="mt-1.5 text-xs text-[#6a6a6a]">
                      {buildDisplaySummary(item) || `${item.type || 'Request'} (no items)`}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
};
