import React, { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import {
  Building2,
  ShieldCheck,
  Smartphone,
  LogOut,
  Globe2,
  ArrowLeft,
  User,
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
    <header className="bg-white text-[#222222] border-b border-[#ebebeb] sticky top-0 z-40 shadow-xs">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-18">
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
                className="w-10 h-10 rounded-2xl flex items-center justify-center shadow-sm text-white font-bold text-base transition-transform"
                style={{
                  backgroundColor: hotel?.branding?.primaryColor || '#ff385c',
                }}
              >
                {hotel?.name ? hotel.name.charAt(0) : 'N'}
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-bold tracking-tight text-base text-[#222222]">
                    {hotel ? hotel.name : 'NEXORA HOTEL OS'}
                  </span>
                  <span className="text-[10px] font-bold uppercase bg-[#fff0f3] text-[#ff385c] border border-[#ffd1da] px-2 py-0.5 rounded-full font-mono">
                    {isSuperAdmin ? 'Super Admin' : (hotel?.hotelCode || 'Hotel Admin')}
                  </span>
                </div>
                <p className="text-[11px] text-[#6a6a6a]">
                  {hotel?.city ? `${hotel.city}, ${hotel.country}` : 'Cloud Multi-Tenant Hospitality Platform'}
                </p>
              </div>
            </div>

            {/* Back to Super Admin HQ button (if super admin is inspecting a hotel) */}
            {isSuperAdmin && activeExperience === 'hotel_os' && (
              <button
                onClick={() => {
                  switchHotelTenant('');
                  setActiveExperience('super_admin');
                }}
                className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[#f7f7f7] hover:bg-[#ebebeb] text-[#222222] border border-[#dddddd] text-xs font-semibold transition-colors ml-3"
              >
                <ArrowLeft className="w-3.5 h-3.5" /> Back to Super Admin HQ
              </button>
            )}
          </div>

          {/* Right Section: Timezone Clock, User Profile & Logout */}
          <div className="flex items-center gap-3">
            {/* Live Clock with Timezone */}
            {hotel && (
              <div className="hidden md:flex items-center gap-1.5 bg-[#f7f7f7] border border-[#ebebeb] px-3 py-1.5 rounded-full text-xs font-mono text-[#3f3f3f]">
                <Globe2 className="w-3.5 h-3.5 text-[#ff385c]" />
                <span>{timeString}</span>
                <span className="text-[10px] text-[#6a6a6a] font-sans uppercase">
                  ({hotel.timezone?.split('/')[1] || 'EST'})
                </span>
              </div>
            )}

            {/* User Profile Info */}
            <div className="flex items-center gap-2 bg-[#f7f7f7] border border-[#ebebeb] px-3 py-1.5 rounded-full">
              <div className="w-6 h-6 rounded-full bg-[#222222] text-white flex items-center justify-center text-[10px] font-bold">
                <User className="w-3.5 h-3.5" />
              </div>
              <div className="text-left hidden sm:block">
                <div className="text-[11px] font-bold text-[#222222] leading-tight truncate max-w-[140px]">
                  {user?.name || user?.email}
                </div>
                <div className="text-[9px] text-[#6a6a6a] font-mono leading-none">
                  {user?.role === 'super_admin' ? 'super_admin' : 'hotel_admin'}
                </div>
              </div>
            </div>

            {/* Sign Out Button */}
            <button
              onClick={logout}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-full border border-[#dddddd] hover:border-[#222222] text-xs font-semibold text-[#6a6a6a] hover:text-[#222222] transition-colors"
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
