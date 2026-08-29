import React, { useState, useEffect } from 'react';
import { firestoreService } from '../../services/firestoreService';
import { Hotel, Room } from '../../types';
import {
  TrendingUp,
  DollarSign,
  Users,
  Clock,
  CheckCircle2,
  AlertCircle,
  Utensils,
  BedDouble,
  QrCode,
  Layers,
  Coffee,
} from 'lucide-react';

interface Props {
  hotel: Hotel;
  onNavigateTab: (tabId: string) => void;
}

export const HotelDashboardTab: React.FC<Props> = ({ hotel, onNavigateTab }) => {
  const [rooms, setRooms] = useState<Room[]>([]);
  const [orders, setOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const unsubRooms = firestoreService.subscribeRooms(hotel.id, (r) => {
      setRooms(r);
    });

    const unsubOrders = firestoreService.subscribeOrders(hotel.id, (o) => {
      setOrders(o);
      setLoading(false);
    });

    return () => {
      unsubRooms();
      unsubOrders();
    };
  }, [hotel.id]);

  const totalRooms = rooms.length;
  const occupiedRooms = rooms.filter(
    (r) => r.status === 'occupied'
  ).length;
  const occupancyRate = totalRooms > 0 ? Math.round((occupiedRooms / totalRooms) * 100) : 0;

  const activeOrders = orders.filter(
    (o) => !['COMPLETED', 'DELIVERED', 'CANCELLED'].includes((o.status || '').toUpperCase())
  );
  const completedOrders = orders.filter(
    (o) => ['COMPLETED', 'DELIVERED'].includes((o.status || '').toUpperCase())
  );

  const totalRevenue = orders.reduce((sum, o) => {
    if (o.status !== 'CANCELLED' && o.totalAmount) {
      return sum + (Number(o.totalAmount) || 0);
    }
    return sum;
  }, 0);

  const recentOrders = [...orders].slice(0, 5);

  return (
    <div className="space-y-6">
      {/* Welcome & Live Hotel Status Header */}
      <div className="card-feature-light p-6 flex flex-col md:flex-row md:items-center justify-between gap-4 elev-1">
        <div>
          <div className="flex items-center gap-2.5">
            <span className="t-micro uppercase tracking-[0.14em] text-primary">
              Property Dashboard
            </span>
            <span className="w-1.5 h-1.5 rounded-full bg-teal-mid animate-pulse" />
            <span className="text-[11px] text-teal-deep font-mono font-medium">
              Firestore Multi-Tenant Scoped
            </span>
          </div>
          <h1 className="t-display-lg mt-1.5">
            {hotel.name}
          </h1>
          <p className="t-caption text-ink-mute mt-1">
            {[hotel.address, hotel.city, hotel.country].filter(Boolean).join(', ') || 'Hotel Address'} • Currency: {hotel.currency || 'USD'} ({hotel.currencySymbol || '$'})
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            onClick={() => onNavigateTab('rooms_qr')}
            className="btn-secondary-outline px-4 py-2.5 text-xs"
          >
            <QrCode className="w-3.5 h-3.5 text-primary" /> Manage Rooms ({totalRooms})
          </button>
          <button
            onClick={() => onNavigateTab('food_menu')}
            className="btn-secondary-outline px-4 py-2.5 text-xs"
          >
            <Coffee className="w-3.5 h-3.5 text-primary" /> Dining Menu
          </button>
          <button
            onClick={() => onNavigateTab('live_requests')}
            className="btn-primary-dark px-4 py-2.5 text-xs"
          >
            <Clock className="w-3.5 h-3.5" /> Active Orders ({activeOrders.length})
          </button>
        </div>
      </div>

      {/* KPI Metric Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Total Revenue */}
        <div className="bg-white border border-[#e8e4dd] p-5 rounded-xl shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-[#73706d]">Total Orders Revenue</span>
            <div className="w-8 h-8 rounded-xl bg-[#e7efee] text-[#155555] border border-[#dce7e5] flex items-center justify-center">
              <DollarSign className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3">
            <div className="text-2xl font-bold text-[#292827] font-mono">
              {hotel.currencySymbol || '$'}
              {totalRevenue.toLocaleString()}
            </div>
            <div className="text-[11px] text-[#73706d] mt-1 font-medium">
              From real guest orders
            </div>
          </div>
        </div>

        {/* Occupancy Rate */}
        <div className="bg-white border border-[#e8e4dd] p-5 rounded-xl shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-[#73706d]">Occupancy</span>
            <div className="w-8 h-8 rounded-xl bg-blue-50 text-[#155555] border border-blue-100 flex items-center justify-center">
              <BedDouble className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3">
            <div className="text-2xl font-bold text-[#292827] font-mono">
              {occupancyRate}%
            </div>
            <div className="text-[11px] text-[#73706d] mt-1 font-medium">
              {occupiedRooms} of {totalRooms} rooms occupied
            </div>
          </div>
        </div>

        {/* Active Orders */}
        <div className="bg-white border border-[#e8e4dd] p-5 rounded-xl shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-[#73706d]">Active Requests</span>
            <div className="w-8 h-8 rounded-xl bg-[#ece6fb] text-[#1b1938] border border-[#c9b4fa] flex items-center justify-center">
              <Clock className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3">
            <div className="text-2xl font-bold text-[#1b1938] font-mono">
              {activeOrders.length}
            </div>
            <div className="text-[11px] text-[#73706d] mt-1 font-medium">
              Awaiting fulfillment
            </div>
          </div>
        </div>

        {/* Completed Requests */}
        <div className="bg-white border border-[#e8e4dd] p-5 rounded-xl shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-[#73706d]">Completed Orders</span>
            <div className="w-8 h-8 rounded-xl bg-[#e7efee] text-[#155555] border border-[#dce7e5] flex items-center justify-center">
              <CheckCircle2 className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3">
            <div className="text-2xl font-bold text-[#155555] font-mono">
              {completedOrders.length}
            </div>
            <div className="text-[11px] text-[#73706d] mt-1 font-medium">
              Fulfilled guest requests
            </div>
          </div>
        </div>
      </div>

      {/* Quick Setup Actions & Recent Activity Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Quick Launch Panel */}
        <div className="bg-white border border-[#e8e4dd] p-6 rounded-xl space-y-4 shadow-xs">
          <h3 className="font-bold text-sm text-[#292827]">Hotel Setup & Operations</h3>
          <div className="space-y-2.5">
            <button
              onClick={() => onNavigateTab('rooms_qr')}
              className="w-full flex items-center justify-between p-3.5 rounded-lg bg-[#fafaf8] hover:bg-[#fafaf8] border border-[#e8e4dd] text-left transition-colors"
            >
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-xl bg-[#ece6fb] text-[#1b1938] flex items-center justify-center">
                  <QrCode className="w-4 h-4" />
                </div>
                <div>
                  <div className="text-xs font-bold text-[#292827]">Rooms & QR Codes</div>
                  <div className="text-[11px] text-[#73706d]">Add rooms and generate QR stickers</div>
                </div>
              </div>
              <span className="text-xs font-mono font-bold text-[#292827]">{totalRooms} Rooms</span>
            </button>

            <button
              onClick={() => onNavigateTab('food_menu')}
              className="w-full flex items-center justify-between p-3.5 rounded-lg bg-[#fafaf8] hover:bg-[#fafaf8] border border-[#e8e4dd] text-left transition-colors"
            >
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-xl bg-orange-50 text-orange-600 flex items-center justify-center">
                  <Coffee className="w-4 h-4" />
                </div>
                <div>
                  <div className="text-xs font-bold text-[#292827]">Food & Dining Menu</div>
                  <div className="text-[11px] text-[#73706d]">Configure restaurant offerings</div>
                </div>
              </div>
              <span className="text-xs font-bold text-[#1b1938]">Manage →</span>
            </button>

            <button
              onClick={() => onNavigateTab('services')}
              className="w-full flex items-center justify-between p-3.5 rounded-lg bg-[#fafaf8] hover:bg-[#fafaf8] border border-[#e8e4dd] text-left transition-colors"
            >
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-xl bg-purple-50 text-purple-600 flex items-center justify-center">
                  <Layers className="w-4 h-4" />
                </div>
                <div>
                  <div className="text-xs font-bold text-[#292827]">Services Catalog</div>
                  <div className="text-[11px] text-[#73706d]">Housekeeping, towels, amenities</div>
                </div>
              </div>
              <span className="text-xs font-bold text-[#1b1938]">Manage →</span>
            </button>

            <button
              onClick={() => onNavigateTab('checkin')}
              className="w-full flex items-center justify-between p-3.5 rounded-lg bg-[#fafaf8] hover:bg-[#fafaf8] border border-[#e8e4dd] text-left transition-colors"
            >
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-xl bg-blue-50 text-[#155555] flex items-center justify-center">
                  <Users className="w-4 h-4" />
                </div>
                <div>
                  <div className="text-xs font-bold text-[#292827]">Front Desk Check-In</div>
                  <div className="text-[11px] text-[#73706d]">Assign arriving guests to rooms</div>
                </div>
              </div>
              <span className="text-xs font-mono font-bold text-[#292827]">{occupiedRooms} In-House</span>
            </button>
          </div>
        </div>

        {/* Live Orders Feed */}
        <div className="bg-white border border-[#e8e4dd] p-6 rounded-xl space-y-4 shadow-xs lg:col-span-2">
          <div className="flex items-center justify-between">
            <h3 className="font-bold text-sm text-[#292827]">Live Guest Activity</h3>
            <button
              onClick={() => onNavigateTab('live_requests')}
              className="text-xs font-bold text-[#1b1938] hover:underline"
            >
              View All Orders ({orders.length}) →
            </button>
          </div>

          {recentOrders.length === 0 ? (
            <div className="p-8 text-center bg-[#fafaf8] rounded-lg border border-[#e8e4dd] space-y-2">
              <Clock className="w-8 h-8 text-[#1b1938] mx-auto opacity-70" />
              <div className="text-xs font-bold text-[#292827]">No Recent Orders or Requests</div>
              <p className="text-[11px] text-[#73706d] max-w-xs mx-auto">
                When guests scan their room QR codes and place orders, live tickets will update here automatically.
              </p>
            </div>
          ) : (
            <div className="space-y-2.5">
              {recentOrders.map((order) => (
                <div
                  key={order.id}
                  className="flex items-center justify-between p-3.5 rounded-lg bg-[#fafaf8] border border-[#e8e4dd]"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-xl bg-[#292827] text-white flex items-center justify-center font-mono font-bold text-xs">
                      {order.roomNumber}
                    </div>
                    <div>
                      <div className="text-xs font-bold text-[#292827]">
                        {order.guestName || 'Guest'}
                      </div>
                      <div className="text-[11px] text-[#73706d]">
                        {order.items && order.items.length > 0
                          ? order.items.map((i: any) => `${i.quantity || 1}x ${i.name}`).join(', ')
                          : order.instructions || 'Service Request'}
                      </div>
                    </div>
                  </div>

                  <div className="text-right">
                    <span
                      className={`text-[10px] font-mono font-bold uppercase px-2.5 py-0.5 rounded-full ${
                        ['COMPLETED', 'DELIVERED'].includes((order.status || '').toUpperCase())
                          ? 'bg-[#e7efee] text-[#0e3030] border border-[#c9dcd9]'
                          : 'bg-[#ece6fb] text-[#1b1938] border border-[#c9b4fa]'
                      }`}
                    >
                      {order.status || 'PENDING'}
                    </span>
                    {order.totalAmount > 0 && (
                      <div className="text-xs font-mono font-bold text-[#292827] mt-0.5">
                        {hotel.currencySymbol || '$'}
                        {order.totalAmount}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
