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
import { NewOrderAlertCenter } from '../common/NewOrderAlertCenter';
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
  ShieldCheck,
} from 'lucide-react';

export const HotelAdminLayout: React.FC = () => {
  const { hotel, user } = useAuth();
  const [activeTab, setActiveTab] = useState<string>('dashboard');

  if (!hotel) {
    return (
      <div className="min-h-screen bg-canvas text-ink flex items-center justify-center p-6">
        <div className="card-feature-light p-8 max-w-md text-center space-y-4 elev-1">
          <div className="w-14 h-14 rounded-xl bg-violet-tint border border-violet-soft flex items-center justify-center text-primary mx-auto">
            <Building2 className="w-7 h-7" />
          </div>
          <h2 className="t-display-md">No Active Hotel Selected</h2>
          <p className="t-caption text-ink-mute">
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
    <div className="min-h-screen bg-canvas text-ink flex flex-col md:flex-row">
      {/* Sidebar — indigo navy canvas (the dark register) */}
      <aside className="w-full md:w-64 bg-primary text-on-primary md:border-r border-hairline-dark flex flex-col justify-between shrink-0">
        <div className="p-4 space-y-5">
          {/* Hotel identity — nested chrome in lifted indigo */}
          <div className="bg-primary-deep/60 border border-hairline-dark p-3 rounded-xl flex items-center gap-3">
            {hotel.branding?.logoUrl ? (
              <img
                src={hotel.branding.logoUrl}
                alt={hotel.name}
                className="w-10 h-10 rounded-lg object-cover border border-hairline-dark bg-primary"
              />
            ) : (
              <div className="w-10 h-10 rounded-lg bg-violet-soft text-primary flex items-center justify-center font-bold border border-hairline-dark">
                {hotel.name.charAt(0)}
              </div>
            )}
            <div className="overflow-hidden">
              <h3 className="text-xs font-bold text-on-primary truncate leading-tight">{hotel.name}</h3>
              <div className="text-[10px] text-violet-soft font-mono font-semibold mt-0.5">{hotel.hotelCode}</div>
            </div>
          </div>

          {/* Navigation */}
          <nav className="space-y-1">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-lg text-xs transition-colors ${
                    isActive
                      ? 'bg-violet-soft text-primary font-bold'
                      : 'text-on-dark-mute hover:text-on-primary hover:bg-primary-deep/60 font-medium'
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
                          ? 'bg-primary text-violet-soft'
                          : 'bg-primary-deep text-violet-soft border border-hairline-dark'
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

        {/* Sidebar footer — tenant isolation */}
        <div className="p-4 border-t border-hairline-dark text-[11px] bg-primary-deep/50 space-y-1">
          <div className="flex items-center gap-1.5 text-teal-tint font-semibold">
            <ShieldCheck className="w-3.5 h-3.5" />
            <span>Isolated Tenant Scope</span>
          </div>
          <p className="text-[10px] text-on-dark-faint font-mono truncate">
            Hotel ID: {hotel.id}
          </p>
        </div>
      </aside>

      {/* Main content — the white canvas */}
      <main className="flex-1 p-4 sm:p-6 lg:p-8 overflow-y-auto bg-canvas">
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

      {/* Audio + voice new-order alerts (real-time) */}
      <NewOrderAlertCenter hotels={hotel ? [hotel] : []} />
    </div>
  );
};
