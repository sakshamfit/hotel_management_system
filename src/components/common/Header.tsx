import React, { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { isDemoMode } from '../../supabase/config';
import {
  Globe2,
  ArrowLeft,
  User,
  LogOut,
  FlaskConical,
} from 'lucide-react';

export const Header: React.FC = () => {
  const {
    user,
    hotel,
    activeExperience,
    setActiveExperience,
    switchHotelTenant,
    logout,
  } = useAuth();

  const [currentTime, setCurrentTime] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const timeString = currentTime.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: hotel?.timezone || 'America/New_York',
  });

  const isSuperAdmin = user?.role === 'super_admin';

  return (
    <header className="bg-canvas text-ink border-b border-hairline sticky top-0 z-40">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo and Hotel Branding */}
          <div className="flex items-center gap-4">
            <div
              className="flex items-center gap-3 cursor-pointer"
              onClick={() => {
                if (isSuperAdmin) {
                  setActiveExperience('super_admin');
                } else if (hotel) {
                  setActiveExperience('hotel_os');
                }
              }}
            >
              <div
                className="w-9 h-9 rounded-lg flex items-center justify-center text-on-primary font-bold text-base"
                style={{ backgroundColor: hotel?.branding?.primaryColor || '#1b1938' }}
              >
                {hotel?.name ? hotel.name.charAt(0) : 'N'}
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="t-heading-lg text-ink tracking-tight" style={{ fontSize: 16 }}>
                    {hotel ? hotel.name : 'NEXORA HOTEL OS'}
                  </span>
                  <span className="font-mono text-[10px] font-semibold uppercase tracking-wide bg-violet-tint text-primary-deep border border-violet-soft rounded px-1.5 py-0.5">
                    {isSuperAdmin ? 'Super Admin' : (hotel?.hotelCode || 'Hotel Admin')}
                  </span>
                </div>
                <p className="t-caption text-ink-mute" style={{ fontSize: 11 }}>
                  {hotel?.city ? `${hotel.city}, ${hotel.country}` : 'Cloud Multi-Tenant Hospitality Platform'}
                </p>
              </div>
            </div>

            {/* Back to Super Admin HQ (if super admin is inspecting a hotel) */}
            {isSuperAdmin && activeExperience === 'hotel_os' && (
              <button
                onClick={() => {
                  switchHotelTenant('');
                  setActiveExperience('super_admin');
                }}
                className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-canvas-soft hover:bg-[#f1efe9] text-ink border border-hairline text-xs font-semibold transition-colors ml-3"
              >
                <ArrowLeft className="w-3.5 h-3.5" /> Back to Super Admin HQ
              </button>
            )}
          </div>

          {/* Right: Timezone clock, profile, sign out */}
          <div className="flex items-center gap-3">
            {isDemoMode && (
              <span
                className="hidden md:inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-[11px] font-semibold"
                title="Running on the local demo backend. Add Supabase credentials in .env to go live."
              >
                <FlaskConical className="w-3.5 h-3.5" />
                Demo
              </span>
            )}
            {hotel && (
              <div className="hidden md:flex items-center gap-1.5 bg-canvas-soft border border-hairline px-3 py-1.5 rounded-lg text-xs font-mono text-ink">
                <Globe2 className="w-3.5 h-3.5 text-teal-mid" />
                <span>{timeString}</span>
                <span className="text-[10px] text-ink-faint font-sans uppercase">
                  ({hotel.timezone?.split('/')[1] || 'EST'})
                </span>
              </div>
            )}

            <div className="flex items-center gap-2 bg-canvas-soft border border-hairline px-3 py-1.5 rounded-lg">
              <div className="w-6 h-6 rounded-full bg-primary text-on-primary flex items-center justify-center text-[10px] font-bold">
                <User className="w-3.5 h-3.5" />
              </div>
              <div className="text-left hidden sm:block">
                <div className="text-[11px] font-bold text-ink leading-tight truncate max-w-[140px]">
                  {user?.name || user?.email}
                </div>
                <div className="text-[9px] text-ink-faint font-mono leading-none">
                  {user?.role === 'super_admin' ? 'super_admin' : 'hotel_admin'}
                </div>
              </div>
            </div>

            <button
              onClick={logout}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-hairline hover:border-hairline-dark text-xs font-semibold text-ink-mute hover:text-ink transition-colors"
              title="Sign Out"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Sign Out</span>
            </button>
          </div>
        </div>
      </div>
    </header>
  );
};
