import React, { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { HotelDashboardTab } from './HotelDashboardTab';
import { LiveRequestsTab } from './LiveRequestsTab';
import { KitchenDisplayTab } from './KitchenDisplayTab';
import { HousekeepingTab } from './HousekeepingTab';
import { RoomsAndQrTab } from './RoomsAndQrTab';
import { GuestCheckinTab } from './GuestCheckinTab';
import { FoodMenuTab } from './FoodMenuTab';
import { ServicesTab } from './ServicesTab';
import { DailyReportsTab } from './DailyReportsTab';
import {
  LayoutDashboard,
  Clock,
  UtensilsCrossed,
  BedDouble,
  QrCode,
  UserCheck,
  Coffee,
  Layers,
  TrendingUp,
  Building2,
  ChevronRight,
  ShieldCheck,
} from 'lucide-react';

export const HotelAdminLayout: React.FC = () => {
  const { hotel, user } = useAuth();
  const [activeTab, setActiveTab] = useState<string>('dashboard');

  if (!hotel) {
    return (
      <div className="min-h-screen bg-white text-[#222222] flex items-center justify-center p-6">
        <div className="bg-white border border-[#ebebeb] p-8 rounded-3xl max-w-md text-center space-y-4 airbnb-card-shadow">
          <div className="w-14 h-14 rounded-2xl bg-[#fff0f3] border border-[#ffd1da] flex items-center justify-center text-[#ff385c] mx-auto">
            <Building2 className="w-7 h-7" />
          </div>
          <h2 className="text-lg font-bold text-[#222222]">No Active Hotel Selected</h2>
          <p className="text-xs text-[#6a6a6a]">
            Please switch or select a hotel tenant from the header selector or Super Admin HQ to access Hotel OS.
          </p>
        </div>
      </div>
    );
  }

  const tabs = [
    { id: 'dashboard', label: 'Dashboard & KPIs', icon: LayoutDashboard },
    { id: 'live_requests', label: 'Live Requests Hub', icon: Clock, badge: 'Live' },
    { id: 'kitchen_kds', label: 'Kitchen KDS', icon: UtensilsCrossed },
    { id: 'housekeeping', label: 'Housekeeping Desk', icon: BedDouble },
    { id: 'rooms_qr', label: 'Rooms & Permanent QR', icon: QrCode },
    { id: 'checkin', label: 'Front Desk / Check-In', icon: UserCheck },
    { id: 'food_menu', label: 'F&B Food Menu', icon: Coffee },
    { id: 'services', label: 'Services Catalog', icon: Layers },
    { id: 'daily_reports', label: '24h Daily Reports', icon: TrendingUp },
  ];

  return (
    <div className="min-h-screen bg-white text-[#222222] flex flex-col md:flex-row">
      {/* Sidebar Navigation */}
      <aside className="w-full md:w-64 bg-white border-b md:border-b-0 md:border-r border-[#ebebeb] flex flex-col justify-between shrink-0">
        <div className="p-4 space-y-4">
          {/* Hotel Identity Card in Sidebar */}
          <div className="bg-[#f7f7f7] border border-[#ebebeb] p-3 rounded-2xl flex items-center gap-3">
            <img
              src={hotel.branding?.logoUrl || 'https://images.unsplash.com/photo-1566073771259-6a8506099945?w=100'}
              alt={hotel.name}
              className="w-10 h-10 rounded-xl object-cover border border-[#dddddd] shadow-xs"
            />
            <div className="overflow-hidden">
              <h3 className="text-xs font-bold text-[#222222] truncate leading-tight">{hotel.name}</h3>
              <div className="text-[10px] text-[#ff385c] font-mono font-semibold mt-0.5">{hotel.hotelCode}</div>
            </div>
          </div>

          {/* Navigation Links */}
          <nav className="space-y-1">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-full text-xs font-medium transition-all ${
                    isActive
                      ? 'bg-[#ff385c] text-white font-semibold shadow-sm'
                      : 'text-[#6a6a6a] hover:text-[#222222] hover:bg-[#f7f7f7]'
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <Icon className="w-4 h-4" />
                    <span>{tab.label}</span>
                  </div>
                  {tab.badge && (
                    <span
                      className={`text-[9px] uppercase font-bold px-2 py-0.5 rounded-full ${
                        isActive
                          ? 'bg-white text-[#ff385c]'
                          : 'bg-[#fff0f3] text-[#ff385c] border border-[#ffd1da]'
                      }`}
                    >
                      {tab.badge}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>
        </div>

        {/* Sidebar Footer: Tenant Isolation Status */}
        <div className="p-4 border-t border-[#ebebeb] text-[11px] text-[#6a6a6a] bg-[#f7f7f7] space-y-1">
          <div className="flex items-center gap-1.5 text-emerald-600 font-semibold">
            <ShieldCheck className="w-3.5 h-3.5" />
            <span>Isolated Tenant Scope</span>
          </div>
          <p className="text-[10px] text-[#6a6a6a] font-mono truncate">
            Hotel ID: {hotel.id}
          </p>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 p-4 sm:p-6 lg:p-8 overflow-y-auto bg-white">
        {activeTab === 'dashboard' && <HotelDashboardTab hotel={hotel} onNavigateTab={setActiveTab} />}
        {activeTab === 'live_requests' && <LiveRequestsTab hotel={hotel} />}
        {activeTab === 'kitchen_kds' && <KitchenDisplayTab hotel={hotel} />}
        {activeTab === 'housekeeping' && <HousekeepingTab hotel={hotel} />}
        {activeTab === 'rooms_qr' && <RoomsAndQrTab hotel={hotel} />}
        {activeTab === 'checkin' && <GuestCheckinTab hotel={hotel} />}
        {activeTab === 'food_menu' && <FoodMenuTab hotel={hotel} />}
        {activeTab === 'services' && <ServicesTab hotel={hotel} />}
        {activeTab === 'daily_reports' && <DailyReportsTab hotel={hotel} />}
      </main>
    </div>
  );
};
