import React, { useState, useEffect } from 'react';
import { firestoreService } from '../../services/firestoreService';
import { Hotel } from '../../types';
import {
  BedDouble,
  CheckCircle2,
  Clock,
  Search,
} from 'lucide-react';

interface Props {
  hotel: Hotel;
}

export const HousekeepingTab: React.FC<Props> = ({ hotel }) => {
  const [tasks, setTasks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    setLoading(true);
    const unsubscribe = firestoreService.subscribeOrders(
      hotel.id,
      (allOrders) => {
        // Filter housekeeping or service tasks
        const hkTasks = allOrders.filter(
          (o) =>
            o.type === 'service' ||
            o.type === 'amenity' ||
            /clean|towel|water|toiletr|linen|housekeep|pillow/i.test(o.instructions || '') ||
            (o.items && o.items.some((i: any) => /clean|towel|water|toiletr|linen|housekeep/i.test(i.name || '')))
        );
        setTasks(hkTasks);
        setLoading(false);
      },
      (err) => {
        console.error('Failed to listen to housekeeping tasks:', err);
        setLoading(false);
      }
    );
    return () => unsubscribe();
  }, [hotel.id]);

  const handleUpdateStatus = async (id: string, status: string) => {
    try {
      await firestoreService.updateOrderStatus(hotel.id, id, status);
    } catch (err: any) {
      alert(`Error updating task: ${err.message}`);
    }
  };

  const activeTasks = tasks.filter((r) => !['COMPLETED', 'DELIVERED', 'CANCELLED'].includes((r.status || '').toUpperCase()));
  const completedTasks = tasks.filter((r) => ['COMPLETED', 'DELIVERED'].includes((r.status || '').toUpperCase()));

  const filteredTasks = tasks.filter((t) => {
    const roomStr = (t.roomNumber || '').toString();
    const guestStr = (t.guestName || '').toLowerCase();
    const noteStr = (t.instructions || '').toLowerCase();
    return (
      roomStr.includes(searchQuery) ||
      guestStr.includes(searchQuery.toLowerCase()) ||
      noteStr.includes(searchQuery.toLowerCase())
    );
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white border border-[#ebebeb] p-6 rounded-3xl flex flex-col sm:flex-row sm:items-center justify-between gap-4 shadow-xs">
        <div className="flex items-center gap-3.5">
          <div className="w-12 h-12 rounded-2xl bg-[#fff0f3] border border-[#ffd1da] flex items-center justify-center text-[#ff385c]">
            <BedDouble className="w-6 h-6" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-bold text-[#222222]">Housekeeping & Amenities Desk</h2>
              <span className="bg-[#fff0f3] text-[#ff385c] border border-[#ffd1da] text-[10px] uppercase font-mono px-2.5 py-0.5 rounded-full font-bold">
                Staff Hub
              </span>
            </div>
            <p className="text-xs text-[#6a6a6a]">
              Linen refresh • Towels & Water • Room Cleaning • Toiletries dispatch
            </p>
          </div>
        </div>
      </div>

      {/* Task Summary Badges */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
        <div className="bg-white border border-[#ebebeb] p-5 rounded-3xl shadow-xs">
          <span className="text-xs text-[#6a6a6a] font-medium">Pending Tasks</span>
          <div className="text-2xl font-bold text-[#ff385c] mt-1 font-mono">{activeTasks.length}</div>
        </div>
        <div className="bg-white border border-[#ebebeb] p-5 rounded-3xl shadow-xs">
          <span className="text-xs text-[#6a6a6a] font-medium">Completed Tasks</span>
          <div className="text-2xl font-bold text-emerald-600 mt-1 font-mono">{completedTasks.length}</div>
        </div>
        <div className="bg-white border border-[#ebebeb] p-5 rounded-3xl shadow-xs col-span-2 sm:col-span-1">
          <span className="text-xs text-[#6a6a6a] font-medium">Total Housekeeping Logs</span>
          <div className="text-2xl font-bold text-[#222222] mt-1 font-mono">{tasks.length}</div>
        </div>
      </div>

      {/* Search Bar */}
      <div className="flex items-center justify-between bg-white p-3.5 rounded-2xl border border-[#ebebeb]">
        <div className="relative w-full sm:w-80">
          <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-[#6a6a6a]" />
          <input
            type="text"
            placeholder="Search by Room or Request details..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-[#fafafa] border border-[#dddddd] rounded-xl pl-9 pr-3.5 py-2 text-xs text-[#222222] focus:outline-none focus:border-[#222222]"
          />
        </div>
      </div>

      {/* Task List or Empty State */}
      {loading ? (
        <div className="bg-white border border-[#ebebeb] rounded-3xl p-12 text-center">
          <div className="w-8 h-8 border-2 border-[#ff385c] border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-xs text-[#6a6a6a] mt-3">Loading housekeeping tasks...</p>
        </div>
      ) : filteredTasks.length === 0 ? (
        <div className="bg-white border border-[#ebebeb] rounded-3xl p-12 text-center space-y-3 shadow-xs">
          <div className="w-16 h-16 rounded-full bg-[#fff0f3] text-[#ff385c] border border-[#ffd1da] flex items-center justify-center mx-auto">
            <BedDouble className="w-8 h-8" />
          </div>
          <div className="space-y-1 max-w-sm mx-auto">
            <h3 className="text-base font-bold text-[#222222]">
              {searchQuery ? 'No matching housekeeping tasks' : 'No Active Housekeeping Requests'}
            </h3>
            <p className="text-xs text-[#6a6a6a]">
              {searchQuery
                ? 'Try searching with another room number.'
                : 'When guests request room cleaning, extra towels, or amenities from their room QR portal, they will be queued here.'}
            </p>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredTasks.map((task) => {
            const isCompleted = ['COMPLETED', 'DELIVERED'].includes((task.status || '').toUpperCase());
            return (
              <div
                key={task.id}
                className="bg-white border border-[#ebebeb] hover:border-[#dddddd] rounded-3xl p-5 shadow-xs flex flex-col justify-between"
              >
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-mono font-bold bg-[#fafafa] border border-[#dddddd] px-2.5 py-1 rounded-xl text-[#222222]">
                      Room {task.roomNumber}
                    </span>
                    <span
                      className={`text-[10px] font-mono font-bold uppercase px-2.5 py-0.5 rounded-full ${
                        isCompleted
                          ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                          : 'bg-[#fff0f3] text-[#ff385c] border border-[#ffd1da]'
                      }`}
                    >
                      {task.status || 'PENDING'}
                    </span>
                  </div>

                  <div>
                    <div className="text-xs text-[#6a6a6a]">Guest: <strong className="text-[#222222]">{task.guestName || 'Guest'}</strong></div>
                    {task.items && task.items.length > 0 && (
                      <div className="mt-2 space-y-1">
                        {task.items.map((it: any, idx: number) => (
                          <div key={idx} className="text-xs font-semibold text-[#222222]">
                            • {it.quantity || 1}x {it.name}
                          </div>
                        ))}
                      </div>
                    )}
                    {task.instructions && (
                      <p className="text-xs text-[#6a6a6a] mt-2 bg-[#fafafa] p-2.5 rounded-xl border border-[#ebebeb]">
                        "{task.instructions}"
                      </p>
                    )}
                  </div>
                </div>

                <div className="mt-4 pt-3 border-t border-[#ebebeb]">
                  {!isCompleted ? (
                    <button
                      onClick={() => handleUpdateStatus(task.id, 'COMPLETED')}
                      className="w-full py-2.5 px-3 rounded-full bg-[#ff385c] hover:bg-[#e00b41] text-white text-xs font-bold shadow-sm transition-colors"
                    >
                      Mark Room Serviced
                    </button>
                  ) : (
                    <div className="text-xs text-emerald-600 font-semibold flex items-center justify-center gap-1 py-1">
                      <CheckCircle2 className="w-3.5 h-3.5" /> Service Completed
                    </div>
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
