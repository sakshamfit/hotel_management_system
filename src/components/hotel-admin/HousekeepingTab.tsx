import React, { useState, useEffect } from 'react';
import { firestoreService } from '../../services/firestoreService';
import { Hotel, Room } from '../../types';
import {
  BedDouble,
  CheckCircle2,
  Clock,
  Search,
  Sparkles,
  Wrench,
  AlertTriangle,
} from 'lucide-react';

interface Props {
  hotel: Hotel;
}

export const HousekeepingTab: React.FC<Props> = ({ hotel }) => {
  const [tasks, setTasks] = useState<any[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    const unsubscribeRooms = firestoreService.subscribeRooms(
      hotel.id,
      (r) => setRooms(r),
      (err) => console.error('Failed to listen to rooms:', err)
    );
    return () => unsubscribeRooms();
  }, [hotel.id]);

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

  /**
   * Rooms are physical state only; the STAY lives on the booking. Check-out
   * moves a room to `cleaning`, and housekeeping is the step that clears it
   * back to `available` — without this the room would never return to the
   * front desk's sellable inventory.
   */
  const handleSetRoomStatus = async (room: Room, status: Room['status']) => {
    try {
      await firestoreService.updateRoom(hotel.id, room.id, { status });
    } catch (err: any) {
      alert(`Error updating room ${room.roomNumber}: ${err.message}`);
    }
  };

  const cleaningRooms = rooms.filter((r) => r.status === 'cleaning');
  const maintenanceRooms = rooms.filter((r) => r.status === 'maintenance');
  const readyRooms = rooms.filter((r) => r.status === 'available');

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
      <div className="bg-white border border-[#e8e4dd] p-6 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-4 shadow-xs">
        <div className="flex items-center gap-3.5">
          <div className="w-12 h-12 rounded-lg bg-[#ece6fb] border border-[#c9b4fa] flex items-center justify-center text-[#1b1938]">
            <BedDouble className="w-6 h-6" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="t-display-md">Housekeeping & Amenities Desk</h2>
              <span className="bg-[#ece6fb] text-[#1b1938] border border-[#c9b4fa] text-[10px] uppercase font-mono px-2.5 py-0.5 rounded-full font-bold">
                Staff Hub
              </span>
            </div>
            <p className="text-xs text-[#73706d]">
              Linen refresh • Towels & Water • Room Cleaning • Toiletries dispatch
            </p>
          </div>
        </div>
      </div>

      {/* Room Status Board — closes the check-out → cleaning → available loop */}
      <div className="bg-white border border-[#e8e4dd] p-6 rounded-xl shadow-xs space-y-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-[#ece6fb] border border-[#c9b4fa] flex items-center justify-center text-[#1b1938]">
            <Sparkles className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-[#292827]">Room Status Board</h3>
            <p className="text-xs text-[#73706d]">
              Rooms checked out today arrive here as <strong>cleaning</strong>. Clear them to make
              them sellable again.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <StatusColumn
            title="Needs Cleaning"
            icon={<Sparkles className="w-3.5 h-3.5" />}
            tone="amber"
            empty="Nothing to clean — every room is ready."
            rooms={cleaningRooms}
            actionLabel="Mark Clean & Available"
            onAction={(room) => handleSetRoomStatus(room, 'available')}
          />
          <StatusColumn
            title="Out of Service"
            icon={<Wrench className="w-3.5 h-3.5" />}
            tone="red"
            empty="No rooms under maintenance."
            rooms={maintenanceRooms}
            actionLabel="Return to Service"
            onAction={(room) => handleSetRoomStatus(room, 'available')}
          />
        </div>

        {readyRooms.length > 0 && (
          <div className="border-t border-[#e8e4dd] pt-3 flex flex-wrap gap-2">
            {readyRooms.map((room) => (
              <button
                key={room.id}
                onClick={() => handleSetRoomStatus(room, 'maintenance')}
                title="Take this room out of service"
                className="px-3 py-1.5 rounded-full border border-[#e8e4dd] text-[11px] font-semibold text-[#73706d] hover:border-[#c9b4fa] hover:text-[#1b1938] transition-colors"
              >
                Room {room.roomNumber} → Maintenance
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Request Summary Badges */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
        <div className="bg-white border border-[#e8e4dd] p-5 rounded-xl shadow-xs">
          <span className="text-xs text-[#73706d] font-medium">Pending Tasks</span>
          <div className="text-2xl font-bold text-[#1b1938] mt-1 font-mono">{activeTasks.length}</div>
        </div>
        <div className="bg-white border border-[#e8e4dd] p-5 rounded-xl shadow-xs">
          <span className="text-xs text-[#73706d] font-medium">Completed Tasks</span>
          <div className="text-2xl font-bold text-[#155555] mt-1 font-mono">{completedTasks.length}</div>
        </div>
        <div className="bg-white border border-[#e8e4dd] p-5 rounded-xl shadow-xs col-span-2 sm:col-span-1">
          <span className="text-xs text-[#73706d] font-medium">Total Housekeeping Logs</span>
          <div className="text-2xl font-bold text-[#292827] mt-1 font-mono">{tasks.length}</div>
        </div>
      </div>

      {/* Search Bar */}
      <div className="flex items-center justify-between bg-white p-3.5 rounded-lg border border-[#e8e4dd]">
        <div className="relative w-full sm:w-80">
          <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-[#73706d]" />
          <input
            type="text"
            placeholder="Search by Room or Request details..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-[#fafaf8] border border-[#e8e4dd] rounded-xl pl-9 pr-3.5 py-2 text-xs text-[#292827] focus:outline-none focus:border-[#292827]"
          />
        </div>
      </div>

      {/* Task List or Empty State */}
      {loading ? (
        <div className="bg-white border border-[#e8e4dd] rounded-xl p-12 text-center">
          <div className="w-8 h-8 border-2 border-[#1b1938] border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-xs text-[#73706d] mt-3">Loading housekeeping tasks...</p>
        </div>
      ) : filteredTasks.length === 0 ? (
        <div className="bg-white border border-[#e8e4dd] rounded-xl p-12 text-center space-y-3 shadow-xs">
          <div className="w-16 h-16 rounded-full bg-[#ece6fb] text-[#1b1938] border border-[#c9b4fa] flex items-center justify-center mx-auto">
            <BedDouble className="w-8 h-8" />
          </div>
          <div className="space-y-1 max-w-sm mx-auto">
            <h3 className="text-base font-bold text-[#292827]">
              {searchQuery ? 'No matching housekeeping tasks' : 'No Active Housekeeping Requests'}
            </h3>
            <p className="text-xs text-[#73706d]">
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
                className="bg-white border border-[#e8e4dd] hover:border-[#e8e4dd] rounded-xl p-5 shadow-xs flex flex-col justify-between"
              >
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-mono font-bold bg-[#fafaf8] border border-[#e8e4dd] px-2.5 py-1 rounded-xl text-[#292827]">
                      Room {task.roomNumber}
                    </span>
                    <span
                      className={`text-[10px] font-mono font-bold uppercase px-2.5 py-0.5 rounded-full ${
                        isCompleted
                          ? 'bg-[#e7efee] text-[#0e3030] border border-[#c9dcd9]'
                          : 'bg-[#ece6fb] text-[#1b1938] border border-[#c9b4fa]'
                      }`}
                    >
                      {task.status || 'PENDING'}
                    </span>
                  </div>

                  <div>
                    <div className="text-xs text-[#73706d]">Guest: <strong className="text-[#292827]">{task.guestName || 'Guest'}</strong></div>
                    {task.items && task.items.length > 0 && (
                      <div className="mt-2 space-y-1">
                        {task.items.map((it: any, idx: number) => (
                          <div key={idx} className="text-xs font-semibold text-[#292827]">
                            • {it.quantity || 1}x {it.name}
                          </div>
                        ))}
                      </div>
                    )}
                    {task.instructions && (
                      <p className="text-xs text-[#73706d] mt-2 bg-[#fafaf8] p-2.5 rounded-xl border border-[#e8e4dd]">
                        "{task.instructions}"
                      </p>
                    )}
                  </div>
                </div>

                <div className="mt-4 pt-3 border-t border-[#e8e4dd]">
                  {!isCompleted ? (
                    <button
                      onClick={() => handleUpdateStatus(task.id, 'COMPLETED')}
                      className="w-full py-2.5 px-3 rounded-lg bg-[#1b1938] hover:bg-[#0e0c1f] text-white text-xs font-bold shadow-sm transition-colors"
                    >
                      Mark Room Serviced
                    </button>
                  ) : (
                    <div className="text-xs text-[#155555] font-semibold flex items-center justify-center gap-1 py-1">
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

const StatusColumn: React.FC<{
  title: string;
  icon: React.ReactNode;
  tone: 'amber' | 'red';
  empty: string;
  rooms: Room[];
  actionLabel: string;
  onAction: (room: Room) => void;
}> = ({ title, icon, tone, empty, rooms, actionLabel, onAction }) => (
  <div
    className={`rounded-xl border p-4 ${
      tone === 'amber'
        ? 'bg-[#fdf8ed] border-[#f0e2c0]'
        : 'bg-[#fdf1f2] border-[#f2d4d8]'
    }`}
  >
    <div className="flex items-center justify-between mb-3">
      <span className={`text-xs font-bold uppercase tracking-wide flex items-center gap-1.5 ${tone === 'amber' ? 'text-[#92650a]' : 'text-[#a12534]'}`}>
        {icon} {title}
      </span>
      <span className="font-mono text-sm font-bold text-[#292827]">{rooms.length}</span>
    </div>

    {rooms.length === 0 ? (
      <p className="text-[11px] text-[#73706d]">{empty}</p>
    ) : (
      <div className="space-y-2">
        {rooms.map((room) => (
          <div
            key={room.id}
            className="bg-white border border-[#e8e4dd] rounded-lg p-3 flex items-center justify-between gap-2"
          >
            <div>
              <div className="text-xs font-bold text-[#292827]">Room {room.roomNumber}</div>
              <div className="text-[10px] text-[#73706d]">Floor {room.floor || 1}</div>
            </div>
            <button
              onClick={() => onAction(room)}
              className="px-3 py-1.5 rounded-lg bg-[#1b1938] hover:bg-[#0e0c1f] text-white text-[11px] font-bold transition-colors whitespace-nowrap"
            >
              {actionLabel}
            </button>
          </div>
        ))}
      </div>
    )}
  </div>
);
