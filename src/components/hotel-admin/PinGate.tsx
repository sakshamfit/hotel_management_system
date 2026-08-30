import React, { useEffect, useState } from 'react';
import { Hotel, StaffPins } from '../../types';
import { Lock, ShieldCheck } from 'lucide-react';

interface Props {
  hotel: Hotel;
  department: keyof StaffPins;
  label: string;
  children: React.ReactNode;
}

function sessionKey(hotelId: string, department: string): string {
  return `nexora_pin_unlocked_${hotelId}_${department}`;
}

/**
 * Shared-device PIN lock for one staff department tab. A hotel typically runs
 * one HOTEL_ADMIN login on a shared front-desk/kitchen tablet; this stops the
 * kitchen screen and the housekeeping desk from being one tap apart for
 * whoever is standing at the device. Unlock persists for the browser tab
 * (sessionStorage) so staff aren't re-prompted every navigation.
 */
export const PinGate: React.FC<Props> = ({ hotel, department, label, children }) => {
  const expectedPin = hotel.staffPins?.[department] || '1234';
  const [unlocked, setUnlocked] = useState(false);
  const [entered, setEntered] = useState('');
  const [error, setError] = useState(false);

  useEffect(() => {
    try {
      setUnlocked(window.sessionStorage.getItem(sessionKey(hotel.id, department)) === '1');
    } catch {
      setUnlocked(false);
    }
    setEntered('');
    setError(false);
  }, [hotel.id, department]);

  const handleDigit = (d: string) => {
    setError(false);
    setEntered((prev) => {
      const next = (prev + d).slice(0, 4);
      if (next.length === 4) {
        if (next === expectedPin) {
          try {
            window.sessionStorage.setItem(sessionKey(hotel.id, department), '1');
          } catch {
            /* ignore */
          }
          setTimeout(() => setUnlocked(true), 120);
        } else {
          setTimeout(() => {
            setError(true);
            setEntered('');
          }, 200);
        }
      }
      return next;
    });
  };

  if (unlocked) return <>{children}</>;

  return (
    <div className="max-w-sm mx-auto mt-10 bg-white border border-hairline rounded-xl p-8 text-center space-y-5 shadow-xs">
      <div className="w-14 h-14 rounded-full bg-accent-tint text-[#0066cc] border border-accent-soft flex items-center justify-center mx-auto">
        <Lock className="w-7 h-7" />
      </div>
      <div>
        <h3 className="text-base font-bold text-ink">{label} PIN Required</h3>
        <p className="text-xs text-ink-mute mt-1">
          Enter the 4-digit {label.toLowerCase()} PIN to open this screen on this device.
        </p>
      </div>

      <div className="flex items-center justify-center gap-3">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className={`w-3.5 h-3.5 rounded-full border-2 ${
              i < entered.length ? (error ? 'bg-[#e00b41] border-[#e00b41]' : 'bg-[#0066cc] border-[#0066cc]') : 'border-hairline'
            }`}
          />
        ))}
      </div>
      {error && <p className="text-[11px] text-[#a12534] font-semibold">Incorrect PIN — try again.</p>}

      <div className="grid grid-cols-3 gap-2 max-w-[220px] mx-auto">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
          <button
            key={d}
            type="button"
            onClick={() => handleDigit(d)}
            className="py-3 rounded-lg bg-canvas-soft hover:bg-hairline text-ink font-bold text-sm border border-hairline transition-colors"
          >
            {d}
          </button>
        ))}
        <div />
        <button
          type="button"
          onClick={() => handleDigit('0')}
          className="py-3 rounded-lg bg-canvas-soft hover:bg-hairline text-ink font-bold text-sm border border-hairline transition-colors"
        >
          0
        </button>
        <button
          type="button"
          onClick={() => setEntered((prev) => prev.slice(0, -1))}
          className="py-3 rounded-lg bg-white hover:bg-canvas-soft text-ink-mute font-semibold text-xs border border-hairline transition-colors"
        >
          ⌫
        </button>
      </div>

      <p className="text-[10px] text-ink-mute flex items-center justify-center gap-1">
        <ShieldCheck className="w-3 h-3" /> Set/change department PINs in Settings.
      </p>
    </div>
  );
};
