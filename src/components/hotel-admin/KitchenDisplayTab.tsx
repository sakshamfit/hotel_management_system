import React, { useState, useEffect } from 'react';
import { firestoreService } from '../../services/firestoreService';
import { Hotel } from '../../types';
import {
  Utensils,
  Clock,
  CheckCircle2,
  Flame,
  Volume2,
  VolumeX,
} from 'lucide-react';

interface Props {
  hotel: Hotel;
}

export const KitchenDisplayTab: React.FC<Props> = ({ hotel }) => {
  const [orders, setOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [soundEnabled, setSoundEnabled] = useState(true);

  useEffect(() => {
    setLoading(true);
    const unsubscribe = firestoreService.subscribeOrders(
      hotel.id,
      (allOrders) => {
        // Filter food tickets that are active
        const kitchenOrders = allOrders.filter(
          (o) =>
            o.type === 'food' ||
            (o.items && o.items.length > 0 && ['PENDING', 'NEW', 'ACCEPTED', 'IN_PROGRESS', 'PREPARING', 'READY'].includes((o.status || '').toUpperCase()))
        );
        setOrders(kitchenOrders);
        setLoading(false);
      },
      (err) => {
        console.error('Failed to listen to KDS orders:', err);
        setLoading(false);
      }
    );
    return () => unsubscribe();
  }, [hotel.id]);

  const handleUpdate = async (id: string, status: string) => {
    try {
      await firestoreService.updateOrderStatus(hotel.id, id, status);
    } catch (err: any) {
      alert(`Error updating ticket: ${err.message}`);
    }
  };

  return (
    <div className="space-y-6">
      {/* KDS Header */}
      <div className="bg-white border border-hairline p-6 rounded-xl flex items-center justify-between shadow-xs">
        <div className="flex items-center gap-3.5">
          <div className="w-12 h-12 rounded-lg bg-accent-tint border border-accent-soft flex items-center justify-center text-[#0066cc]">
            <Flame className="w-6 h-6" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="t-display-md">Kitchen Display System (KDS)</h2>
              <span className="bg-accent-tint text-[#0066cc] border border-accent-soft text-[10px] uppercase font-mono px-2.5 py-0.5 rounded-full font-bold">
                Chef Screen
              </span>
            </div>
            <p className="text-xs text-ink-mute">
              Real-time kitchen order queue • {orders.length} active tickets
            </p>
          </div>
        </div>

        <button
          onClick={() => setSoundEnabled(!soundEnabled)}
          className={`p-2.5 rounded-full border transition-colors ${
            soundEnabled
              ? 'bg-accent-tint border-accent-soft text-[#0066cc]'
              : 'bg-canvas-soft border-hairline text-ink-mute'
          }`}
          title="Toggle incoming chime"
        >
          {soundEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
        </button>
      </div>

      {/* Orders or Empty State */}
      {loading ? (
        <div className="bg-white border border-hairline rounded-xl p-12 text-center">
          <div className="w-8 h-8 border-2 border-[#0066cc] border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-xs text-ink-mute mt-3">Listening for kitchen orders...</p>
        </div>
      ) : orders.length === 0 ? (
        <div className="bg-white border border-hairline rounded-xl p-12 text-center space-y-3 shadow-xs">
          <div className="w-16 h-16 rounded-full bg-accent-tint text-[#0066cc] border border-accent-soft flex items-center justify-center mx-auto">
            <Utensils className="w-8 h-8" />
          </div>
          <div className="space-y-1 max-w-sm mx-auto">
            <h3 className="text-base font-bold text-ink">Kitchen Order Queue Clear</h3>
            <p className="text-xs text-ink-mute">
              All dining tickets have been completed. New guest food orders will appear here in real time.
            </p>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {orders.map((ticket) => {
            const status = (ticket.status || 'PENDING').toUpperCase();
            return (
              <div
                key={ticket.id}
                className="bg-white border-2 border-hairline rounded-xl p-5 shadow-xs flex flex-col justify-between"
              >
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-mono font-bold bg-ink text-white px-3 py-1 rounded-xl">
                      Room {ticket.roomNumber}
                    </span>
                    <span className="text-xs font-mono font-bold text-[#0066cc]">
                      {ticket.guestName || 'Guest'}
                    </span>
                  </div>

                  {/* Items List */}
                  <div className="bg-canvas-soft border border-hairline p-3 rounded-lg space-y-2">
                    {ticket.items &&
                      ticket.items.map((it: any, idx: number) => (
                        <div key={idx} className="flex items-center justify-between text-xs">
                          <span className="font-semibold text-ink">
                            {it.quantity}x {it.name}
                          </span>
                        </div>
                      ))}
                  </div>

                  {ticket.instructions && (
                    <div className="text-xs text-ink-mute italic bg-canvas-soft p-2 rounded-xl border border-hairline">
                      Chef Note: {ticket.instructions}
                    </div>
                  )}
                </div>

                <div className="mt-4 pt-3 border-t border-hairline flex items-center gap-2">
                  {status !== 'READY' && status !== 'COMPLETED' ? (
                    <button
                      onClick={() => handleUpdate(ticket.id, 'READY')}
                      className="flex-1 py-2.5 px-3 rounded-lg bg-[#0066cc] hover:bg-[#004fa3] text-white text-xs font-bold shadow-sm transition-colors"
                    >
                      Mark Food Ready
                    </button>
                  ) : (
                    <button
                      onClick={() => handleUpdate(ticket.id, 'COMPLETED')}
                      className="flex-1 py-2.5 px-3 rounded-full bg-success-mid hover:bg-success-deep text-white text-xs font-bold shadow-sm transition-colors"
                    >
                      Delivered to Room
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
