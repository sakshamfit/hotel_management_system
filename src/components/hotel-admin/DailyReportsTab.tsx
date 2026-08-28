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

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white border border-[#ebebeb] p-6 rounded-3xl flex flex-col sm:flex-row sm:items-center justify-between gap-4 shadow-xs">
        <div className="flex items-center gap-3.5">
          <div className="w-12 h-12 rounded-2xl bg-[#fff0f3] border border-[#ffd1da] flex items-center justify-center text-[#ff385c]">
            <TrendingUp className="w-6 h-6" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-bold text-[#222222]">24-Hour Executive Operations Report</h2>
              <span className="bg-emerald-50 text-emerald-700 border border-emerald-200 text-[10px] uppercase font-mono px-2.5 py-0.5 rounded-full font-bold">
                Live Audit
              </span>
            </div>
            <p className="text-xs text-[#6a6a6a]">
              Real-time audit calculated strictly from verified guest transactions and orders in Firestore.
            </p>
          </div>
        </div>

        <button
          onClick={handlePrint}
          className="flex items-center gap-2 px-4 py-2.5 bg-white hover:bg-[#f7f7f7] text-[#222222] border border-[#dddddd] rounded-full text-xs font-semibold shadow-xs transition-colors self-start sm:self-auto"
        >
          <Printer className="w-3.5 h-3.5" /> Print / Export Audit
        </button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-[#ebebeb] p-5 rounded-3xl shadow-xs">
          <span className="text-xs text-[#6a6a6a] font-medium">Total Revenue</span>
          <div className="text-2xl font-bold text-[#222222] mt-1 font-mono">
            {hotel.currencySymbol || '$'}{totalRevenue.toLocaleString()}
          </div>
          <div className="text-[11px] text-emerald-600 mt-1 font-medium">
            From {orders.length} transactions
          </div>
        </div>

        <div className="bg-white border border-[#ebebeb] p-5 rounded-3xl shadow-xs">
          <span className="text-xs text-[#6a6a6a] font-medium">Orders Fulfilled</span>
          <div className="text-2xl font-bold text-emerald-600 mt-1 font-mono">
            {completedOrders.length}
          </div>
          <div className="text-[11px] text-[#6a6a6a] mt-1">Successfully delivered</div>
        </div>

        <div className="bg-white border border-[#ebebeb] p-5 rounded-3xl shadow-xs">
          <span className="text-xs text-[#6a6a6a] font-medium">Active In-Flight</span>
          <div className="text-2xl font-bold text-[#ff385c] mt-1 font-mono">
            {activeOrders.length}
          </div>
          <div className="text-[11px] text-[#6a6a6a] mt-1">Orders in preparation</div>
        </div>

        <div className="bg-white border border-[#ebebeb] p-5 rounded-3xl shadow-xs">
          <span className="text-xs text-[#6a6a6a] font-medium">Room Inventory</span>
          <div className="text-2xl font-bold text-[#222222] mt-1 font-mono">
            {rooms.length}
          </div>
          <div className="text-[11px] text-[#6a6a6a] mt-1">Managed property units</div>
        </div>
      </div>

      {/* Breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Top Ordered Items */}
        <div className="bg-white border border-[#ebebeb] p-6 rounded-3xl space-y-4 shadow-xs">
          <h3 className="font-bold text-sm text-[#222222]">Top Ordered Dishes & Services</h3>
          {topItems.length === 0 ? (
            <div className="text-xs text-[#6a6a6a] p-6 text-center bg-[#fafafa] rounded-2xl border border-[#ebebeb]">
              No items have been ordered yet.
            </div>
          ) : (
            <div className="space-y-2">
              {topItems.map((item, idx) => (
                <div
                  key={idx}
                  className="flex items-center justify-between p-3 rounded-2xl bg-[#fafafa] border border-[#ebebeb] text-xs"
                >
                  <span className="font-semibold text-[#222222]">
                    {idx + 1}. {item.name}
                  </span>
                  <div className="text-right">
                    <span className="font-mono font-bold text-[#222222]">{item.quantity} orders</span>
                    <span className="text-[#6a6a6a] ml-2">
                      ({hotel.currencySymbol || '$'}{item.revenue})
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Audit Meta */}
        <div className="bg-white border border-[#ebebeb] p-6 rounded-3xl space-y-3 shadow-xs">
          <h3 className="font-bold text-sm text-[#222222]">Audit Metadata</h3>
          <div className="bg-[#fafafa] p-4 rounded-2xl border border-[#ebebeb] text-xs space-y-2 text-[#6a6a6a]">
            <div className="flex justify-between">
              <span>Hotel Name:</span>
              <strong className="text-[#222222]">{hotel.name}</strong>
            </div>
            <div className="flex justify-between">
              <span>Hotel Code:</span>
              <span className="font-mono text-[#222222]">{hotel.hotelCode}</span>
            </div>
            <div className="flex justify-between">
              <span>Tenant Scope:</span>
              <span className="font-mono text-[#222222]">{hotel.id}</span>
            </div>
            <div className="flex justify-between">
              <span>Generated At:</span>
              <span>{new Date().toLocaleString()}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
