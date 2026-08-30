import React, { useState } from 'react';
import { firestoreService } from '../../services/firestoreService';
import { Hotel, StaffPins } from '../../types';
import { playAlertSiren, unlockAlertAudio } from '../../utils/alertSound';
import {
  Settings as SettingsIcon,
  Save,
  MessageCircle,
  Percent,
  Clock,
  KeyRound,
  Volume2,
  CheckCircle2,
  Building2,
} from 'lucide-react';

interface Props {
  hotel: Hotel;
}

const DEPARTMENTS: { key: keyof StaffPins; label: string }[] = [
  { key: 'RECEPTION', label: 'Reception / Front Desk' },
  { key: 'KITCHEN', label: 'Kitchen' },
  { key: 'HOUSEKEEPING', label: 'Housekeeping' },
  { key: 'MAINTENANCE', label: 'Maintenance / Engineering' },
];

export const SettingsTab: React.FC<Props> = ({ hotel }) => {
  const [name, setName] = useState(hotel.name || '');
  const [phone, setPhone] = useState(hotel.phone || '');
  const [address, setAddress] = useState(hotel.address || '');
  const [ownerWhatsApp, setOwnerWhatsApp] = useState(hotel.ownerWhatsApp || '');
  const [gstPercent, setGstPercent] = useState(String(hotel.gstPercent ?? 0));
  const [openTime, setOpenTime] = useState(hotel.openTime || '00:00');
  const [closeTime, setCloseTime] = useState(hotel.closeTime || '23:59');
  const [pins, setPins] = useState<StaffPins>({
    RECEPTION: hotel.staffPins?.RECEPTION || '1234',
    KITCHEN: hotel.staffPins?.KITCHEN || '1234',
    HOUSEKEEPING: hotel.staffPins?.HOUSEKEEPING || '1234',
    MAINTENANCE: hotel.staffPins?.MAINTENANCE || '1234',
  });
  const [isSaving, setIsSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handlePinChange = (key: keyof StaffPins, value: string) => {
    const digits = value.replace(/\D/g, '').slice(0, 4);
    setPins((prev) => ({ ...prev, [key]: digits }));
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    for (const dep of DEPARTMENTS) {
      const pin = pins[dep.key] || '';
      if (pin.length !== 4) {
        setError(`${dep.label} PIN must be exactly 4 digits.`);
        return;
      }
    }
    const gst = parseFloat(gstPercent);
    if (Number.isNaN(gst) || gst < 0 || gst > 100) {
      setError('GST % must be a number between 0 and 100.');
      return;
    }

    setIsSaving(true);
    try {
      await firestoreService.updateHotelDoc(hotel.id, {
        name: name.trim(),
        phone: phone.trim(),
        address: address.trim(),
        ownerWhatsApp: ownerWhatsApp.trim(),
        gstPercent: gst,
        openTime,
        closeTime,
        staffPins: pins,
      });
      setSavedMsg('Settings saved.');
      setTimeout(() => setSavedMsg(null), 4000);
    } catch (err: any) {
      setError(err?.message || 'Failed to save settings.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleTestSiren = () => {
    unlockAlertAudio();
    playAlertSiren();
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white border border-hairline p-6 rounded-xl flex items-center justify-between gap-4 shadow-xs">
        <div className="flex items-center gap-3.5">
          <div className="w-12 h-12 rounded-lg bg-accent-tint border border-accent-soft flex items-center justify-center text-[#0066cc]">
            <SettingsIcon className="w-6 h-6" />
          </div>
          <div>
            <h2 className="t-display-md">Hotel Settings</h2>
            <p className="text-xs text-ink-mute">
              WhatsApp alert number, GST, operating hours, and department PINs for shared devices.
            </p>
          </div>
        </div>
      </div>

      {error && (
        <div className="bg-[#fdf1f2] border border-[#f2d4d8] text-[#a12534] px-4 py-3 rounded-lg text-xs font-semibold">
          {error}
        </div>
      )}
      {savedMsg && (
        <div className="bg-success-tint border border-success-line text-success-deep px-4 py-3 rounded-lg text-xs font-semibold flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4" /> {savedMsg}
        </div>
      )}

      <form onSubmit={handleSave} className="space-y-6">
        {/* Hotel Info */}
        <div className="bg-white border border-hairline p-6 rounded-xl shadow-xs space-y-4">
          <div className="flex items-center gap-2">
            <Building2 className="w-4 h-4 text-[#0066cc]" />
            <h3 className="text-sm font-bold text-ink">Hotel Info</h3>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-ink mb-1">Hotel Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full bg-white border border-hairline rounded-xl px-3.5 py-2 text-sm text-ink focus:outline-none focus:border-ink"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-ink mb-1">Front Desk Phone</label>
              <input
                type="text"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="w-full bg-white border border-hairline rounded-xl px-3.5 py-2 text-sm text-ink focus:outline-none focus:border-ink"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-ink mb-1">Address</label>
            <input
              type="text"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              className="w-full bg-white border border-hairline rounded-xl px-3.5 py-2 text-sm text-ink focus:outline-none focus:border-ink"
            />
          </div>
        </div>

        {/* WhatsApp + GST + Hours */}
        <div className="bg-white border border-hairline p-6 rounded-xl shadow-xs space-y-4">
          <div className="flex items-center gap-2">
            <MessageCircle className="w-4 h-4 text-[#0066cc]" />
            <h3 className="text-sm font-bold text-ink">Order Alerts & Billing</h3>
          </div>

          <div>
            <label className="block text-xs font-semibold text-ink mb-1">
              WhatsApp Number for Order Alerts
            </label>
            <input
              type="text"
              value={ownerWhatsApp}
              onChange={(e) => setOwnerWhatsApp(e.target.value)}
              placeholder="+91 98765 43210"
              className="w-full bg-white border border-hairline rounded-xl px-3.5 py-2 text-sm text-ink focus:outline-none focus:border-ink"
            />
            <p className="text-[11px] text-ink-mute mt-1">
              After placing an order, guests get a one-tap "Send to WhatsApp" button addressed to this
              number — a backup alert channel alongside the live dashboard and siren.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-semibold text-ink mb-1 flex items-center gap-1">
                <Percent className="w-3.5 h-3.5" /> GST / Tax %
              </label>
              <input
                type="number"
                min="0"
                max="100"
                step="0.5"
                value={gstPercent}
                onChange={(e) => setGstPercent(e.target.value)}
                className="w-full bg-white border border-hairline rounded-xl px-3.5 py-2 text-sm text-ink focus:outline-none focus:border-ink"
              />
              <p className="text-[11px] text-ink-mute mt-1">Applied to F&B orders in the guest checkout.</p>
            </div>
            <div>
              <label className="block text-xs font-semibold text-ink mb-1 flex items-center gap-1">
                <Clock className="w-3.5 h-3.5" /> Opens
              </label>
              <input
                type="time"
                value={openTime}
                onChange={(e) => setOpenTime(e.target.value)}
                className="w-full bg-white border border-hairline rounded-xl px-3.5 py-2 text-sm text-ink focus:outline-none focus:border-ink"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-ink mb-1 flex items-center gap-1">
                <Clock className="w-3.5 h-3.5" /> Closes
              </label>
              <input
                type="time"
                value={closeTime}
                onChange={(e) => setCloseTime(e.target.value)}
                className="w-full bg-white border border-hairline rounded-xl px-3.5 py-2 text-sm text-ink focus:outline-none focus:border-ink"
              />
            </div>
          </div>
        </div>

        {/* Department PINs */}
        <div className="bg-white border border-hairline p-6 rounded-xl shadow-xs space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <KeyRound className="w-4 h-4 text-[#0066cc]" />
              <h3 className="text-sm font-bold text-ink">Department PIN Lock</h3>
            </div>
            <button
              type="button"
              onClick={handleTestSiren}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-hairline text-xs font-semibold text-ink-mute hover:text-[#0066cc] hover:border-accent-soft transition-colors"
            >
              <Volume2 className="w-3.5 h-3.5" /> Test Siren
            </button>
          </div>
          <p className="text-[11px] text-ink-mute -mt-2">
            On a shared front-desk device, each staff tab can ask for its department's 4-digit PIN before
            opening. Default is <span className="font-mono font-bold">1234</span> — change it here.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {DEPARTMENTS.map((dep) => (
              <div key={dep.key}>
                <label className="block text-xs font-semibold text-ink mb-1">{dep.label}</label>
                <input
                  type="text"
                  inputMode="numeric"
                  maxLength={4}
                  value={pins[dep.key] || ''}
                  onChange={(e) => handlePinChange(dep.key, e.target.value)}
                  placeholder="1234"
                  className="w-full bg-white border border-hairline rounded-xl px-3.5 py-2 text-sm font-mono text-ink focus:outline-none focus:border-ink"
                />
              </div>
            ))}
          </div>
        </div>

        <div className="flex items-center justify-end">
          <button
            type="submit"
            disabled={isSaving}
            className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-[#0066cc] hover:bg-[#004fa3] text-white text-xs font-bold shadow-sm disabled:opacity-50"
          >
            <Save className="w-4 h-4" /> {isSaving ? 'Saving…' : 'Save Settings'}
          </button>
        </div>
      </form>
    </div>
  );
};
