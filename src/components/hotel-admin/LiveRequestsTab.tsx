import React, { useState, useEffect } from 'react';
import { firestoreService } from '../../services/firestoreService';
import { Hotel } from '../../types';
import {
  Clock,
  CheckCircle2,
  AlertCircle,
  Phone,
  User,
  Utensils,
  BedDouble,
  Search,
  Check,
  X,
  Layers,
} from 'lucide-react';

interface Props {
  hotel: Hotel;
}

export const LiveRequestsTab: React.FC<Props> = ({ hotel }) => {
  const [orders, setOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>('ACTIVE_ONLY');
  const [searchQuery, setSearchQuery] = useState('');
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    const unsubscribe = firestoreService.subscribeOrders(
      hotel.id,
      (fetchedOrders) => {
        setOrders(fetchedOrders);
        setLoading(false);
      },
      (err) => {
        console.error('Error fetching live requests:', err);
        setLoading(false);
      }
    );
    return () => unsubscribe();
  }, [hotel.id]);

  const handleUpdateStatus = async (orderId: string, newStatus: string) => {
    try {
      setUpdatingId(orderId);
      await firestoreService.updateOrderStatus(hotel.id, orderId, newStatus);
    } catch (err: any) {
      alert(`Error updating request: ${err.message}`);
    } finally {
      setUpdatingId(null);
    }
  };

  const filteredOrders = orders.filter((order) => {
    const roomStr = (order.roomNumber || '').toString();
    const guestStr = (order.guestName || '').toLowerCase();
    const matchesSearch =
      roomStr.includes(searchQuery) ||
      guestStr.includes(searchQuery.toLowerCase()) ||
      (order.items && order.items.some((i: any) => i.name.toLowerCase().includes(searchQuery.toLowerCase())));

    let matchesStatus = true;
    const status = (order.status || '').toUpperCase();
    if (statusFilter === 'ACTIVE_ONLY') {
      matchesStatus = !['COMPLETED', 'DELIVERED', 'CANCELLED'].includes(status);
    } else if (statusFilter !== 'ALL') {
      matchesStatus = status === statusFilter;
    }

    return matchesSearch && matchesStatus;
  });

  const getStatusBadge = (status: string) => {
    const s = (status || 'PENDING').toUpperCase();
    switch (s) {
      case 'PENDING':
      case 'NEW':
        return 'bg-[#ece6fb] text-[#1b1938] border-[#c9b4fa] animate-pulse';
      case 'ACCEPTED':
      case 'IN_PROGRESS':
      case 'PREPARING':
        return 'bg-blue-50 text-blue-700 border-blue-200';
      case 'READY':
        return 'bg-purple-50 text-purple-700 border-purple-200';
      case 'COMPLETED':
      case 'DELIVERED':
        return 'bg-[#e7efee] text-[#0e3030] border-[#c9dcd9]';
      case 'CANCELLED':
        return 'bg-zinc-100 text-zinc-600 border-zinc-200';
      default:
        return 'bg-zinc-50 text-zinc-600 border-zinc-200';
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white border border-[#e8e4dd] p-6 rounded-xl shadow-xs">
        <div className="flex items-center gap-3.5">
          <div className="w-12 h-12 rounded-lg bg-[#ece6fb] text-[#1b1938] border border-[#c9b4fa] flex items-center justify-center font-bold">
            <Clock className="w-6 h-6" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="t-display-md">Live Guest Requests & Orders</h2>
              <span className="bg-[#e7efee] text-[#0e3030] border border-[#c9dcd9] text-[10px] uppercase font-mono px-2.5 py-0.5 rounded-full font-bold">
                Real-Time Firestore
              </span>
            </div>
            <p className="text-xs text-[#73706d]">
              Monitor and fulfill live room service orders, housekeeping requests, and front desk calls in real time.
            </p>
          </div>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-col sm:flex-row gap-3 items-center justify-between bg-white p-3.5 rounded-lg border border-[#e8e4dd]">
        <div className="relative w-full sm:w-80">
          <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-[#73706d]" />
          <input
            type="text"
            placeholder="Search by Room number or Guest..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-[#fafaf8] border border-[#e8e4dd] rounded-xl pl-9 pr-3.5 py-2 text-xs text-[#292827] focus:outline-none focus:border-[#292827]"
          />
        </div>

        <div className="flex items-center gap-2 overflow-x-auto w-full sm:w-auto pb-1 sm:pb-0">
          <button
            onClick={() => setStatusFilter('ACTIVE_ONLY')}
            className={`px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-colors ${
              statusFilter === 'ACTIVE_ONLY'
                ? 'bg-[#1b1938] text-white'
                : 'bg-[#fafaf8] text-[#73706d] hover:bg-[#e8e4dd]'
            }`}
          >
            Active Only
          </button>
          <button
            onClick={() => setStatusFilter('ALL')}
            className={`px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-colors ${
              statusFilter === 'ALL'
                ? 'bg-[#292827] text-white'
                : 'bg-[#fafaf8] text-[#73706d] hover:bg-[#e8e4dd]'
            }`}
          >
            All History ({orders.length})
          </button>
          <button
            onClick={() => setStatusFilter('COMPLETED')}
            className={`px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-colors ${
              statusFilter === 'COMPLETED'
                ? 'bg-[#155555] text-white'
                : 'bg-[#fafaf8] text-[#73706d] hover:bg-[#e8e4dd]'
            }`}
          >
            Completed
          </button>
        </div>
      </div>

      {/* Requests List or Empty State */}
      {loading ? (
        <div className="bg-white border border-[#e8e4dd] rounded-xl p-12 text-center">
          <div className="w-8 h-8 border-2 border-[#1b1938] border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-xs text-[#73706d] mt-3">Listening for incoming guest requests...</p>
        </div>
      ) : filteredOrders.length === 0 ? (
        <div className="bg-white border border-[#e8e4dd] rounded-xl p-12 text-center space-y-3 shadow-xs">
          <div className="w-16 h-16 rounded-full bg-[#ece6fb] text-[#1b1938] border border-[#c9b4fa] flex items-center justify-center mx-auto">
            <Clock className="w-8 h-8" />
          </div>
          <div className="space-y-1 max-w-sm mx-auto">
            <h3 className="text-base font-bold text-[#292827]">
              {searchQuery ? 'No matching requests' : 'No Active Guest Requests'}
            </h3>
            <p className="text-xs text-[#73706d]">
              {searchQuery
                ? 'Try searching with a different room number.'
                : 'When guests order food or request services from their in-room QR code portal, orders arrive here instantly.'}
            </p>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredOrders.map((order) => {
            const status = (order.status || 'PENDING').toUpperCase();
            return (
              <div
                key={order.id}
                className="bg-white border border-[#e8e4dd] hover:border-[#e8e4dd] rounded-xl p-5 shadow-xs hover:shadow-md transition-all flex flex-col justify-between"
              >
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-mono font-bold bg-[#fafaf8] border border-[#e8e4dd] px-2.5 py-1 rounded-xl text-[#292827]">
                      Room {order.roomNumber}
                    </span>
                    <span
                      className={`text-[10px] font-mono font-bold uppercase px-2.5 py-0.5 rounded-full border ${getStatusBadge(
                        status
                      )}`}
                    >
                      {status}
                    </span>
                  </div>

                  <div>
                    <div className="flex items-center gap-1.5 text-xs text-[#73706d]">
                      <User className="w-3.5 h-3.5" />
                      <span className="font-semibold text-[#292827]">{order.guestName || 'Guest'}</span>
                    </div>
                    {order.type && (
                      <span className="text-[10px] font-mono text-[#73706d] uppercase bg-[#fafaf8] px-2 py-0.5 rounded-md mt-1 inline-block">
                        {order.type}
                      </span>
                    )}
                  </div>

                  {/* Items or Notes */}
                  {order.items && order.items.length > 0 && (
                    <div className="bg-[#fafaf8] border border-[#e8e4dd] p-3 rounded-lg text-xs space-y-1.5">
                      <div className="text-[10px] font-bold text-[#73706d] uppercase">Order Items:</div>
                      {order.items.map((it: any, idx: number) => (
                        <div key={idx} className="flex items-center justify-between text-xs">
                          <span>
                            {it.quantity}x {it.name}
                          </span>
                          <span className="font-mono text-[#292827]">
                            {hotel.currencySymbol || '$'}
                            {(it.price || 0) * (it.quantity || 1)}
                          </span>
                        </div>
                      ))}
                      {order.totalAmount > 0 && (
                        <div className="flex items-center justify-between font-bold text-xs pt-1 border-t border-[#e8e4dd]">
                          <span>Total:</span>
                          <span className="text-[#1b1938]">
                            {hotel.currencySymbol || '$'}
                            {order.totalAmount}
                          </span>
                        </div>
                      )}
                    </div>
                  )}

                  {order.instructions && (
                    <p className="text-xs text-[#73706d] italic bg-[#fafaf8]/60 p-2.5 rounded-xl border border-[#e8e4dd]">
                      Note: "{order.instructions}"
                    </p>
                  )}
                </div>

                {/* Status Action Buttons */}
                <div className="mt-4 pt-3 border-t border-[#e8e4dd] flex items-center gap-2">
                  {status === 'PENDING' || status === 'NEW' ? (
                    <button
                      onClick={() => handleUpdateStatus(order.id, 'IN_PROGRESS')}
                      disabled={updatingId === order.id}
                      className="flex-1 py-2 px-3 rounded-lg bg-[#1b1938] hover:bg-[#0e0c1f] text-white text-xs font-bold shadow-sm transition-colors"
                    >
                      Accept & Prepare
                    </button>
                  ) : status === 'IN_PROGRESS' || status === 'ACCEPTED' ? (
                    <button
                      onClick={() => handleUpdateStatus(order.id, 'COMPLETED')}
                      disabled={updatingId === order.id}
                      className="flex-1 py-2 px-3 rounded-full bg-[#155555] hover:bg-[#0e3030] text-white text-xs font-bold shadow-sm transition-colors"
                    >
                      Mark Completed
                    </button>
                  ) : (
                    <div className="text-xs text-[#155555] font-semibold flex items-center gap-1">
                      <CheckCircle2 className="w-3.5 h-3.5" /> Fulfilled
                    </div>
                  )}

                  {status !== 'COMPLETED' && status !== 'CANCELLED' && (
                    <button
                      onClick={() => handleUpdateStatus(order.id, 'CANCELLED')}
                      disabled={updatingId === order.id}
                      className="p-2 rounded-full hover:bg-[#ece6fb] text-[#73706d] hover:text-[#1b1938] border border-[#e8e4dd] hover:border-[#c9b4fa] transition-colors"
                      title="Cancel Request"
                    >
                      <X className="w-3.5 h-3.5" />
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
