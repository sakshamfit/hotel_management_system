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
    (r) => r.status === 'occupied' || r.status === 'OCCUPIED'
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
      <div className="bg-white border border-[#ebebeb] p-6 rounded-3xl flex flex-col md:flex-row md:items-center justify-between gap-4 shadow-xs">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-[#ff385c]">
              Property Dashboard
            </span>
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-[11px] text-emerald-700 font-mono font-medium">
              Firestore Multi-Tenant Scoped
            </span>
          </div>
          <h1 className="text-xl sm:text-2xl font-bold text-[#222222] mt-1">
            {hotel.name}
          </h1>
          <p className="text-xs text-[#6a6a6a] mt-0.5">
            {[hotel.address, hotel.city, hotel.country].filter(Boolean).join(', ') || 'Hotel Address'} • Currency: {hotel.currency || 'USD'} ({hotel.currencySymbol || '$'})
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            onClick={() => onNavigateTab('rooms_qr')}
            className="flex items-center gap-2 px-4 py-2.5 bg-white hover:bg-[#f7f7f7] text-[#222222] border border-[#dddddd] rounded-full text-xs font-semibold shadow-xs transition-colors"
          >
            <QrCode className="w-3.5 h-3.5 text-[#ff385c]" /> Manage Rooms ({totalRooms})
          </button>
          <button
            onClick={() => onNavigateTab('food_menu')}
            className="flex items-center gap-2 px-4 py-2.5 bg-white hover:bg-[#f7f7f7] text-[#222222] border border-[#dddddd] rounded-full text-xs font-semibold shadow-xs transition-colors"
          >
            <Coffee className="w-3.5 h-3.5 text-[#ff385c]" /> Dining Menu
          </button>
          <button
            onClick={() => onNavigateTab('live_requests')}
            className="flex items-center gap-2 px-4 py-2.5 bg-[#ff385c] hover:bg-[#e00b41] text-white rounded-full text-xs font-bold shadow-sm transition-colors"
          >
            <Clock className="w-3.5 h-3.5" /> Active Orders ({activeOrders.length})
          </button>
        </div>
      </div>

      {/* KPI Metric Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Total Revenue */}
        <div className="bg-white border border-[#ebebeb] p-5 rounded-3xl shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-[#6a6a6a]">Total Orders Revenue</span>
            <div className="w-8 h-8 rounded-xl bg-emerald-50 text-emerald-600 border border-emerald-100 flex items-center justify-center">
              <DollarSign className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3">
            <div className="text-2xl font-bold text-[#222222] font-mono">
              {hotel.currencySymbol || '$'}
              {totalRevenue.toLocaleString()}
            </div>
            <div className="text-[11px] text-[#6a6a6a] mt-1 font-medium">
              From real guest orders
            </div>
          </div>
        </div>

        {/* Occupancy Rate */}
        <div className="bg-white border border-[#ebebeb] p-5 rounded-3xl shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-[#6a6a6a]">Occupancy</span>
            <div className="w-8 h-8 rounded-xl bg-blue-50 text-blue-600 border border-blue-100 flex items-center justify-center">
              <BedDouble className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3">
            <div className="text-2xl font-bold text-[#222222] font-mono">
              {occupancyRate}%
            </div>
            <div className="text-[11px] text-[#6a6a6a] mt-1 font-medium">
              {occupiedRooms} of {totalRooms} rooms occupied
            </div>
          </div>
        </div>

        {/* Active Orders */}
        <div className="bg-white border border-[#ebebeb] p-5 rounded-3xl shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-[#6a6a6a]">Active Requests</span>
            <div className="w-8 h-8 rounded-xl bg-[#fff0f3] text-[#ff385c] border border-[#ffd1da] flex items-center justify-center">
              <Clock className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3">
            <div className="text-2xl font-bold text-[#ff385c] font-mono">
              {activeOrders.length}
            </div>
            <div className="text-[11px] text-[#6a6a6a] mt-1 font-medium">
              Awaiting fulfillment
            </div>
          </div>
        </div>

        {/* Completed Requests */}
        <div className="bg-white border border-[#ebebeb] p-5 rounded-3xl shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-[#6a6a6a]">Completed Orders</span>
            <div className="w-8 h-8 rounded-xl bg-emerald-50 text-emerald-600 border border-emerald-100 flex items-center justify-center">
              <CheckCircle2 className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3">
            <div className="text-2xl font-bold text-emerald-600 font-mono">
              {completedOrders.length}
            </div>
            <div className="text-[11px] text-[#6a6a6a] mt-1 font-medium">
              Fulfilled guest requests
            </div>
          </div>
        </div>
      </div>

      {/* Quick Setup Actions & Recent Activity Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Quick Launch Panel */}
        <div className="bg-white border border-[#ebebeb] p-6 rounded-3xl space-y-4 shadow-xs">
          <h3 className="font-bold text-sm text-[#222222]">Hotel Setup & Operations</h3>
          <div className="space-y-2.5">
            <button
              onClick={() => onNavigateTab('rooms_qr')}
              className="w-full flex items-center justify-between p-3.5 rounded-2xl bg-[#fafafa] hover:bg-[#f0f0f0] border border-[#ebebeb] text-left transition-colors"
            >
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-xl bg-[#fff0f3] text-[#ff385c] flex items-center justify-center">
                  <QrCode className="w-4 h-4" />
                </div>
                <div>
                  <div className="text-xs font-bold text-[#222222]">Rooms & QR Codes</div>
                  <div className="text-[11px] text-[#6a6a6a]">Add rooms and generate QR stickers</div>
                </div>
              </div>
              <span className="text-xs font-mono font-bold text-[#222222]">{totalRooms} Rooms</span>
            </button>

            <button
              onClick={() => onNavigateTab('food_menu')}
              className="w-full flex items-center justify-between p-3.5 rounded-2xl bg-[#fafafa] hover:bg-[#f0f0f0] border border-[#ebebeb] text-left transition-colors"
            >
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-xl bg-orange-50 text-orange-600 flex items-center justify-center">
                  <Coffee className="w-4 h-4" />
                </div>
                <div>
                  <div className="text-xs font-bold text-[#222222]">Food & Dining Menu</div>
                  <div className="text-[11px] text-[#6a6a6a]">Configure restaurant offerings</div>
                </div>
              </div>
              <span className="text-xs font-bold text-[#ff385c]">Manage →</span>
            </button>

            <button
              onClick={() => onNavigateTab('services')}
              className="w-full flex items-center justify-between p-3.5 rounded-2xl bg-[#fafafa] hover:bg-[#f0f0f0] border border-[#ebebeb] text-left transition-colors"
            >
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-xl bg-purple-50 text-purple-600 flex items-center justify-center">
                  <Layers className="w-4 h-4" />
                </div>
                <div>
                  <div className="text-xs font-bold text-[#222222]">Services Catalog</div>
                  <div className="text-[11px] text-[#6a6a6a]">Housekeeping, towels, amenities</div>
                </div>
              </div>
              <span className="text-xs font-bold text-[#ff385c]">Manage →</span>
            </button>

            <button
              onClick={() => onNavigateTab('checkin')}
              className="w-full flex items-center justify-between p-3.5 rounded-2xl bg-[#fafafa] hover:bg-[#f0f0f0] border border-[#ebebeb] text-left transition-colors"
            >
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center">
                  <Users className="w-4 h-4" />
                </div>
                <div>
                  <div className="text-xs font-bold text-[#222222]">Front Desk Check-In</div>
                  <div className="text-[11px] text-[#6a6a6a]">Assign arriving guests to rooms</div>
                </div>
              </div>
              <span className="text-xs font-mono font-bold text-[#222222]">{occupiedRooms} In-House</span>
            </button>
          </div>
        </div>

        {/* Live Orders Feed */}
        <div className="bg-white border border-[#ebebeb] p-6 rounded-3xl space-y-4 shadow-xs lg:col-span-2">
          <div className="flex items-center justify-between">
            <h3 className="font-bold text-sm text-[#222222]">Live Guest Activity</h3>
            <button
              onClick={() => onNavigateTab('live_requests')}
              className="text-xs font-bold text-[#ff385c] hover:underline"
            >
              View All Orders ({orders.length}) →
            </button>
          </div>

          {recentOrders.length === 0 ? (
            <div className="p-8 text-center bg-[#fafafa] rounded-2xl border border-[#ebebeb] space-y-2">
              <Clock className="w-8 h-8 text-[#ff385c] mx-auto opacity-70" />
              <div className="text-xs font-bold text-[#222222]">No Recent Orders or Requests</div>
              <p className="text-[11px] text-[#6a6a6a] max-w-xs mx-auto">
                When guests scan their room QR codes and place orders, live tickets will update here automatically.
              </p>
            </div>
          ) : (
            <div className="space-y-2.5">
              {recentOrders.map((order) => (
                <div
                  key={order.id}
                  className="flex items-center justify-between p-3.5 rounded-2xl bg-[#fafafa] border border-[#ebebeb]"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-xl bg-[#222222] text-white flex items-center justify-center font-mono font-bold text-xs">
                      {order.roomNumber}
                    </div>
                    <div>
                      <div className="text-xs font-bold text-[#222222]">
                        {order.guestName || 'Guest'}
                      </div>
                      <div className="text-[11px] text-[#6a6a6a]">
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
                          ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                          : 'bg-[#fff0f3] text-[#ff385c] border border-[#ffd1da]'
                      }`}
                    >
                      {order.status || 'PENDING'}
                    </span>
                    {order.totalAmount > 0 && (
                      <div className="text-xs font-mono font-bold text-[#222222] mt-0.5">
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
