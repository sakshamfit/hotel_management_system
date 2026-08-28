import React, { useState } from 'react';
import { Hotel } from '../../types';
import { api } from '../../services/api';
import {
  X,
  Building2,
  Sliders,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  Eye,
  Lock,
  Layers,
  Sparkles,
} from 'lucide-react';

interface Props {
  hotel: Hotel | null;
  isOpen: boolean;
  onClose: () => void;
  onUpdated: () => void;
  onOpenHotelOS: (hotelId: string) => void;
}

export const HotelDiagnosticsModal: React.FC<Props> = ({
  hotel,
  isOpen,
  onClose,
  onUpdated,
  onOpenHotelOS,
}) => {
  if (!isOpen || !hotel) return null;

  const [status, setStatus] = useState(hotel.status);
  const [modules, setModules] = useState({ ...hotel.modules });
  const [welcomeMessage, setWelcomeMessage] = useState(hotel.branding?.welcomeMessage || '');
  const [accentColor, setAccentColor] = useState(hotel.branding?.accentColor || '#d97706');
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const toggleModule = (key: keyof typeof modules) => {
    setModules((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const handleSave = async () => {
    try {
      setIsSaving(true);
      setMessage(null);
      await api.updateHotelTenant(hotel.id, {
        status,
        modules,
        branding: {
          ...hotel.branding,
          welcomeMessage,
          accentColor,
        },
      });
      setMessage('Tenant configuration updated successfully across the cluster.');
      onUpdated();
      setTimeout(() => setMessage(null), 3000);
    } catch (err: any) {
      setMessage(`Error: ${err.message}`);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs">
      <div className="bg-white border border-[#e8e4dd] text-[#292827] rounded-xl w-full max-w-3xl max-h-[90vh] flex flex-col airbnb-popover-shadow overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-[#e8e4dd] flex items-center justify-between bg-white">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-[#ece6fb] border border-[#c9b4fa] flex items-center justify-center text-[#1b1938]">
              <Sliders className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-[#292827] flex items-center gap-2">
                Tenant Diagnostics & Module Overrides
                <span className="text-[11px] font-mono px-2.5 py-0.5 rounded-full bg-[#fafaf8] border border-[#e8e4dd] text-[#292827] font-semibold">
                  {hotel.hotelCode}
                </span>
              </h2>
              <p className="text-xs text-[#73706d]">
                Tenant: <span className="text-[#292827] font-semibold">{hotel.name}</span> • ID:{' '}
                <span className="font-mono text-[11px]">{hotel.id}</span>
              </p>
            </div>
          </div>
          <button onClick={onClose} className="text-[#73706d] hover:text-[#292827] p-2 rounded-full hover:bg-[#fafaf8]">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6 overflow-y-auto flex-1 bg-white">
          {message && (
            <div
              className={`p-3.5 rounded-lg text-xs flex items-center gap-2 ${
                message.startsWith('Error')
                  ? 'bg-[#ece6fb] border border-[#c9b4fa] text-[#0e0c1f]'
                  : 'bg-[#e7efee] border border-[#c9dcd9] text-[#0e3030]'
              }`}
            >
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>{message}</span>
            </div>
          )}

          {/* Quick Actions Bar */}
          <div className="flex flex-wrap items-center justify-between gap-3 p-4 bg-[#fafaf8] rounded-lg border border-[#e8e4dd]">
            <div>
              <div className="text-xs font-semibold text-[#292827]">Direct Tenant Launch</div>
              <div className="text-[11px] text-[#73706d]">
                Switch environment directly to this hotel's isolated operations
              </div>
            </div>
            <button
              onClick={() => {
                onOpenHotelOS(hotel.id);
                onClose();
              }}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[#1b1938] hover:bg-[#0e0c1f] text-white text-xs font-semibold shadow-sm transition-colors"
            >
              <Eye className="w-4 h-4" /> Open Hotel OS Live View
            </button>
          </div>

          {/* Status & General Settings */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-[#292827] mb-1">Tenant Status</label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as any)}
                className="w-full bg-white border border-[#e8e4dd] rounded-xl px-3.5 py-2 text-sm text-[#292827] focus:outline-none focus:border-[#292827] shadow-sm font-medium"
              >
                <option value="ACTIVE">ACTIVE (Fully Operational)</option>
                <option value="TRIAL">TRIAL (Evaluation Mode)</option>
                <option value="SUSPENDED">SUSPENDED (Temporarily Locked)</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-[#292827] mb-1">Accent Highlight Color</label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={accentColor}
                  onChange={(e) => setAccentColor(e.target.value)}
                  className="w-9 h-9 rounded-lg cursor-pointer bg-transparent border-0"
                />
                <input
                  type="text"
                  value={accentColor}
                  onChange={(e) => setAccentColor(e.target.value)}
                  className="flex-1 bg-white border border-[#e8e4dd] rounded-xl px-3 py-2 text-xs font-mono"
                />
              </div>
            </div>
          </div>

          {/* Welcome Message Override */}
          <div>
            <label className="block text-xs font-semibold text-[#292827] mb-1">Guest Greeting Message</label>
            <textarea
              rows={2}
              value={welcomeMessage}
              onChange={(e) => setWelcomeMessage(e.target.value)}
              className="w-full bg-white border border-[#e8e4dd] rounded-xl px-3.5 py-2 text-xs text-[#292827] focus:outline-none focus:border-[#292827] shadow-sm"
            />
          </div>

          {/* Module Overrides Toggles */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="block text-xs font-semibold text-[#292827]">
                Active Modules for <span className="text-[#1b1938]">{hotel.name}</span>
              </label>
              <span className="text-[11px] text-[#73706d]">Zero-downtime hot toggles</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2.5">
              {[
                { key: 'guestQrSystem', label: 'Permanent QR System' },
                { key: 'roomService', label: 'Room Service Engine' },
                { key: 'foodAndBeverage', label: 'F&B Food Dining' },
                { key: 'housekeeping', label: 'Housekeeping Desk' },
                { key: 'toiletries', label: 'Toiletries & Water' },
                { key: 'laundry', label: 'Laundry & Pressing' },
                { key: 'maintenance', label: 'Maintenance & Repairs' },
                { key: 'receptionRequests', label: 'Front Desk Requests' },
                { key: 'spaAndWellness', label: 'Spa & Wellness Bookings' },
                { key: 'poolAndGym', label: 'Pool & Gym Access' },
                { key: 'guestFeedback', label: 'Post-service Feedback' },
                { key: 'dailyReports', label: '24h Daily Reports' },
                { key: 'autoDailyReset', label: 'Morning Menu Auto-Reset' },
                { key: 'requireCallConfirmation', label: 'Require Call Confirmation' },
              ].map((item) => {
                const isEnabled = (modules as any)[item.key];
                return (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => toggleModule(item.key as any)}
                    className={`p-3 rounded-lg border text-left flex items-center justify-between text-xs transition-colors ${
                      isEnabled
                        ? 'bg-[#ece6fb] border-[#c9b4fa] text-[#292827] font-semibold'
                        : 'bg-[#fafaf8] border-[#e8e4dd] text-[#73706d] hover:border-[#e8e4dd]'
                    }`}
                  >
                    <span>{item.label}</span>
                    <div
                      className={`w-5 h-5 rounded-full flex items-center justify-center ${
                        isEnabled ? 'bg-[#1b1938] text-white shadow-xs' : 'bg-[#e8e4dd] text-transparent'
                      }`}
                    >
                      {isEnabled && <CheckCircle2 className="w-3.5 h-3.5" />}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-[#e8e4dd] bg-white flex items-center justify-between">
          <button onClick={onClose} className="px-4 py-2 rounded-full text-xs font-semibold text-[#73706d] hover:text-[#292827] hover:bg-[#fafaf8] transition-colors">
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={isSaving}
            className="flex items-center gap-2 px-6 py-2.5 rounded-lg bg-[#1b1938] hover:bg-[#0e0c1f] shadow-sm transition-colors disabled:opacity-50"
          >
            {isSaving ? 'Applying Overrides...' : 'Save Tenant Settings'}
          </button>
        </div>
      </div>
    </div>
  );
};
