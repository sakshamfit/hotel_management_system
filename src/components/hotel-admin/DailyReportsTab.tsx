import React, { useState, useEffect } from 'react';
import { firestoreService } from '../../services/firestoreService';
import { Hotel, Room } from '../../types';
import {
  TrendingUp,
  DollarSign,
  Users,
  Clock,
  Printer,
  Share2,
  CheckCircle2,
  FileText,
  Star,
  BedDouble,
} from 'lucide-react';

interface Props {
  hotel: Hotel;
}

export const DailyReportsTab: React.FC<Props> = ({ hotel }) => {
  const [rooms, setRooms] = useState<Room[]>([]);
  const [orders, setOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const unsubRooms = firestoreService.subscribeRooms(hotel.id, (r) => setRooms(r));
    const unsubOrders = firestoreService.subscribeOrders(hotel.id, (o) => {
      setOrders(o);
      setLoading(false);
    });
    return () => {
      unsubRooms();
      unsubOrders();
    };
  }, [hotel.id]);

  const totalRevenue = orders.reduce((sum, o) => {
    if (o.status !== 'CANCELLED' && o.totalAmount) {
      return sum + (Number(o.totalAmount) || 0);
    }
    return sum;
  }, 0);

  const completedOrders = orders.filter((o) => ['COMPLETED', 'DELIVERED'].includes((o.status || '').toUpperCase()));
  const activeOrders = orders.filter((o) => !['COMPLETED', 'DELIVERED', 'CANCELLED'].includes((o.status || '').toUpperCase()));

  const itemCounts: Record<string, { name: string; quantity: number; revenue: number }> = {};
  orders.forEach((o) => {
    if (o.items && Array.isArray(o.items) && o.status !== 'CANCELLED') {
      o.items.forEach((it: any) => {
        const key = it.name || 'Item';
        if (!itemCounts[key]) {
          itemCounts[key] = { name: key, quantity: 0, revenue: 0 };
        }
        itemCounts[key].quantity += it.quantity || 1;
        itemCounts[key].revenue += (it.price || 0) * (it.quantity || 1);
      });
    }
  });

  const topItems = Object.values(itemCounts).sort((a, b) => b.quantity - a.quantity).slice(0, 5);

  // Revenue by F&B vs. services, and top-ordering rooms.
  const foodOrders = orders.filter((o) => o.type === 'food' && o.status !== 'CANCELLED');
  const foodRevenue = foodOrders.reduce((sum, o) => sum + (Number(o.totalAmount) || 0), 0);

  const roomCounts: Record<string, { room: string; orders: number; revenue: number }> = {};
  orders.forEach((o) => {
    if (o.status === 'CANCELLED' || !o.roomNumber) return;
    const key = String(o.roomNumber);
    if (!roomCounts[key]) roomCounts[key] = { room: key, orders: 0, revenue: 0 };
    roomCounts[key].orders += 1;
    roomCounts[key].revenue += Number(o.totalAmount) || 0;
  });
  const topRooms = Object.values(roomCounts).sort((a, b) => b.revenue - a.revenue).slice(0, 5);

  // Guest feedback analytics: average rating + latest room-by-room feed.
  const feedbackOrders = orders.filter((o) => o.guestFeedback && typeof o.guestFeedback.rating === 'number');
  const averageRating =
    feedbackOrders.length > 0
      ? feedbackOrders.reduce((sum, o) => sum + o.guestFeedback.rating, 0) / feedbackOrders.length
      : 0;
  const recentFeedback = [...feedbackOrders]
    .sort((a, b) => String(b.guestFeedback.submittedAt || '').localeCompare(String(a.guestFeedback.submittedAt || '')))
    .slice(0, 8);

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white border border-hairline p-6 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-4 shadow-xs">
        <div className="flex items-center gap-3.5">
          <div className="w-12 h-12 rounded-lg bg-accent-tint border border-accent-soft flex items-center justify-center text-[#0066cc]">
            <TrendingUp className="w-6 h-6" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="t-display-md">24-Hour Executive Operations Report</h2>
              <span className="bg-success-tint text-success-deep border border-success-line text-[10px] uppercase font-mono px-2.5 py-0.5 rounded-full font-bold">
                Live Audit
              </span>
            </div>
            <p className="text-xs text-ink-mute">
              Real-time audit calculated strictly from verified guest transactions and orders in Firestore.
            </p>
          </div>
        </div>

        <button
          onClick={handlePrint}
          className="flex items-center gap-2 px-4 py-2.5 bg-white hover:bg-canvas-soft text-ink border border-hairline rounded-full text-xs font-semibold shadow-xs transition-colors self-start sm:self-auto"
        >
          <Printer className="w-3.5 h-3.5" /> Print / Export Audit
        </button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-hairline p-5 rounded-xl shadow-xs">
          <span className="text-xs text-ink-mute font-medium">Total Revenue</span>
          <div className="text-2xl font-bold text-ink mt-1 font-mono">
            {hotel.currencySymbol || '$'}{totalRevenue.toLocaleString()}
          </div>
          <div className="text-[11px] text-success-mid mt-1 font-medium">
            From {orders.length} transactions
          </div>
        </div>

        <div className="bg-white border border-hairline p-5 rounded-xl shadow-xs">
          <span className="text-xs text-ink-mute font-medium">Orders Fulfilled</span>
          <div className="text-2xl font-bold text-success-mid mt-1 font-mono">
            {completedOrders.length}
          </div>
          <div className="text-[11px] text-ink-mute mt-1">Successfully delivered</div>
        </div>

        <div className="bg-white border border-hairline p-5 rounded-xl shadow-xs">
          <span className="text-xs text-ink-mute font-medium">Active In-Flight</span>
          <div className="text-2xl font-bold text-[#0066cc] mt-1 font-mono">
            {activeOrders.length}
          </div>
          <div className="text-[11px] text-ink-mute mt-1">Orders in preparation</div>
        </div>

        <div className="bg-white border border-hairline p-5 rounded-xl shadow-xs">
          <span className="text-xs text-ink-mute font-medium">Room Inventory</span>
          <div className="text-2xl font-bold text-ink mt-1 font-mono">
            {rooms.length}
          </div>
          <div className="text-[11px] text-ink-mute mt-1">Managed property units</div>
        </div>
      </div>

      {/* Breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Top Ordered Items */}
        <div className="bg-white border border-hairline p-6 rounded-xl space-y-4 shadow-xs">
          <h3 className="font-bold text-sm text-ink">Top Ordered Dishes & Services</h3>
          {topItems.length === 0 ? (
            <div className="text-xs text-ink-mute p-6 text-center bg-canvas-soft rounded-lg border border-hairline">
              No items have been ordered yet.
            </div>
          ) : (
            <div className="space-y-2">
              {topItems.map((item, idx) => (
                <div
                  key={idx}
                  className="flex items-center justify-between p-3 rounded-lg bg-canvas-soft border border-hairline text-xs"
                >
                  <span className="font-semibold text-ink">
                    {idx + 1}. {item.name}
                  </span>
                  <div className="text-right">
                    <span className="font-mono font-bold text-ink">{item.quantity} orders</span>
                    <span className="text-ink-mute ml-2">
                      ({hotel.currencySymbol || '$'}{item.revenue})
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Audit Meta */}
        <div className="bg-white border border-hairline p-6 rounded-xl space-y-3 shadow-xs">
          <h3 className="font-bold text-sm text-ink">Audit Metadata</h3>
          <div className="bg-canvas-soft p-4 rounded-lg border border-hairline text-xs space-y-2 text-ink-mute">
            <div className="flex justify-between">
              <span>Hotel Name:</span>
              <strong className="text-ink">{hotel.name}</strong>
            </div>
            <div className="flex justify-between">
              <span>Hotel Code:</span>
              <span className="font-mono text-ink">{hotel.hotelCode}</span>
            </div>
            <div className="flex justify-between">
              <span>Tenant Scope:</span>
              <span className="font-mono text-ink">{hotel.id}</span>
            </div>
            <div className="flex justify-between">
              <span>Generated At:</span>
              <span>{new Date().toLocaleString()}</span>
            </div>
            {hotel.gstPercent ? (
              <div className="flex justify-between">
                <span>GST Rate:</span>
                <span className="font-mono text-ink">{hotel.gstPercent}%</span>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {/* Revenue Breakdown + Top Rooms */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white border border-hairline p-6 rounded-xl space-y-4 shadow-xs">
          <h3 className="font-bold text-sm text-ink flex items-center gap-2">
            <DollarSign className="w-4 h-4 text-[#0066cc]" /> F&B Revenue
          </h3>
          <div className="bg-canvas-soft p-4 rounded-lg border border-hairline">
            <div className="text-2xl font-bold text-ink font-mono">
              {hotel.currencySymbol || '$'}
              {foodRevenue.toLocaleString()}
            </div>
            <div className="text-[11px] text-ink-mute mt-1">
              From {foodOrders.length} dining order{foodOrders.length === 1 ? '' : 's'}
            </div>
          </div>
        </div>

        <div className="bg-white border border-hairline p-6 rounded-xl space-y-4 shadow-xs">
          <h3 className="font-bold text-sm text-ink flex items-center gap-2">
            <BedDouble className="w-4 h-4 text-[#0066cc]" /> Top-Ordering Rooms
          </h3>
          {topRooms.length === 0 ? (
            <div className="text-xs text-ink-mute p-6 text-center bg-canvas-soft rounded-lg border border-hairline">
              No orders yet.
            </div>
          ) : (
            <div className="space-y-2">
              {topRooms.map((r) => (
                <div
                  key={r.room}
                  className="flex items-center justify-between p-3 rounded-lg bg-canvas-soft border border-hairline text-xs"
                >
                  <span className="font-semibold text-ink">Room {r.room}</span>
                  <div className="text-right">
                    <span className="font-mono font-bold text-ink">{r.orders} orders</span>
                    <span className="text-ink-mute ml-2">
                      ({hotel.currencySymbol || '$'}
                      {r.revenue})
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Guest Feedback Analytics */}
      <div className="bg-white border border-hairline p-6 rounded-xl shadow-xs space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <h3 className="font-bold text-sm text-ink flex items-center gap-2">
            <Star className="w-4 h-4 text-amber-500" /> Guest Feedback
          </h3>
          {feedbackOrders.length > 0 && (
            <div className="flex items-center gap-1.5">
              {[1, 2, 3, 4, 5].map((n) => (
                <Star
                  key={n}
                  className={`w-4 h-4 ${n <= Math.round(averageRating) ? 'fill-amber-400 text-amber-400' : 'text-hairline'}`}
                />
              ))}
              <span className="text-xs font-bold text-ink ml-1">
                {averageRating.toFixed(1)} / 5 · {feedbackOrders.length} review
                {feedbackOrders.length === 1 ? '' : 's'}
              </span>
            </div>
          )}
        </div>

        {recentFeedback.length === 0 ? (
          <div className="text-xs text-ink-mute p-6 text-center bg-canvas-soft rounded-lg border border-hairline">
            No guest feedback submitted yet.
          </div>
        ) : (
          <div className="space-y-2">
            {recentFeedback.map((o) => (
              <div key={o.id} className="p-3 rounded-lg bg-canvas-soft border border-hairline">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-ink">Room {o.roomNumber}</span>
                  <div className="flex items-center gap-0.5">
                    {[1, 2, 3, 4, 5].map((n) => (
                      <Star
                        key={n}
                        className={`w-3 h-3 ${n <= o.guestFeedback.rating ? 'fill-amber-400 text-amber-400' : 'text-hairline'}`}
                      />
                    ))}
                  </div>
                </div>
                {o.guestFeedback.comment && (
                  <p className="text-[11px] text-ink-mute italic mt-1">"{o.guestFeedback.comment}"</p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
