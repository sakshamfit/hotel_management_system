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
        // Prefer the explicit `department` set by Services & Amenities Catalog;
        // fall back to the old free-text sniff for requests placed before a
        // service was routed (or when department was left unset).
        const hkTasks = allOrders.filter((o: any) => {
          if (o.department) return o.department === 'HOUSEKEEPING' || o.department === 'AMENITIES' || o.department === 'WATER_BEVERAGES';
          return (
            o.type === 'service' ||
            o.type === 'amenity' ||
            /clean|towel|water|toiletr|linen|housekeep|pillow/i.test(o.instructions || '') ||
            (o.items && o.items.some((i: any) => /clean|towel|water|toiletr|linen|housekeep/i.test(i.name || '')))
          );
        });
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

  const [maintenanceTickets, setMaintenanceTickets] = useState<any[]>([]);
  useEffect(() => {
    const unsubscribe = firestoreService.subscribeOrders(
      hotel.id,
      (allOrders) => {
        setMaintenanceTickets(allOrders.filter((o: any) => o.department === 'MAINTENANCE'));
      },
      (err) => console.error('Failed to listen to maintenance tickets:', err)
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

  const filteredTasks = tasks
    .filter((t) => {
      const roomStr = (t.roomNumber || '').toString();
      const guestStr = (t.guestName || '').toLowerCase();
      const noteStr = (t.instructions || '').toLowerCase();
      return (
        roomStr.includes(searchQuery) ||
        guestStr.includes(searchQuery.toLowerCase()) ||
        noteStr.includes(searchQuery.toLowerCase())
      );
    })
    .sort((a, b) => (b.priority === 'URGENT' ? 1 : 0) - (a.priority === 'URGENT' ? 1 : 0));

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white border border-hairline p-6 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-4 shadow-xs">
        <div className="flex items-center gap-3.5">
          <div className="w-12 h-12 rounded-lg bg-accent-tint border border-accent-soft flex items-center justify-center text-[#0066cc]">
            <BedDouble className="w-6 h-6" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="t-display-md">Housekeeping & Amenities Desk</h2>
              <span className="bg-accent-tint text-[#0066cc] border border-accent-soft text-[10px] uppercase font-mono px-2.5 py-0.5 rounded-full font-bold">
                Staff Hub
              </span>
            </div>
            <p className="text-xs text-ink-mute">
              Linen refresh • Towels & Water • Room Cleaning • Toiletries dispatch
            </p>
          </div>
        </div>
      </div>

      {/* Room Status Board — closes the check-out → cleaning → available loop */}
      <div className="bg-white border border-hairline p-6 rounded-xl shadow-xs space-y-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-accent-tint border border-accent-soft flex items-center justify-center text-[#0066cc]">
            <Sparkles className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-ink">Room Status Board</h3>
            <p className="text-xs text-ink-mute">
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
          <div className="border-t border-hairline pt-3 flex flex-wrap gap-2">
            {readyRooms.map((room) => (
              <button
                key={room.id}
                onClick={() => handleSetRoomStatus(room, 'maintenance')}
                title="Take this room out of service"
                className="px-3 py-1.5 rounded-full border border-hairline text-[11px] font-semibold text-ink-mute hover:border-accent-soft hover:text-[#0066cc] transition-colors"
              >
                Room {room.roomNumber} → Maintenance
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Maintenance / Engineering Tickets — Reported → Technician In Room → Repaired */}
      <div className="bg-white border border-hairline p-6 rounded-xl shadow-xs space-y-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-[#fdf1f2] border border-[#f2d4d8] flex items-center justify-center text-[#a12534]">
            <Wrench className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-ink">Maintenance & Engineering Tickets</h3>
            <p className="text-xs text-ink-mute">
              AC / TV / geyser / WiFi issues raised from the guest portal, routed by department.
            </p>
          </div>
        </div>

        {maintenanceTickets.length === 0 ? (
          <div className="text-xs text-ink-mute p-6 text-center bg-canvas-soft rounded-lg border border-hairline">
            No open maintenance tickets.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {maintenanceTickets.map((ticket) => {
              const status = (ticket.status || 'PENDING').toUpperCase();
              const isCompleted = ['COMPLETED', 'DELIVERED'].includes(status);
              const isInProgress = ['IN_PROGRESS', 'ACCEPTED'].includes(status);
              return (
                <div key={ticket.id} className="border border-hairline rounded-xl p-3.5 bg-canvas-soft space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-mono font-bold bg-white border border-hairline px-2 py-0.5 rounded-lg text-ink">
                      Room {ticket.roomNumber}
                    </span>
                    <span
                      className={`text-[10px] font-mono font-bold uppercase px-2 py-0.5 rounded-full ${
                        isCompleted
                          ? 'bg-success-tint text-success-deep border border-success-line'
                          : isInProgress
                            ? 'bg-blue-50 text-blue-700 border border-blue-200'
                            : 'bg-[#fdf1f2] text-[#a12534] border border-[#f2d4d8]'
                      }`}
                    >
                      {isCompleted ? 'Repaired' : isInProgress ? 'Technician In Room' : 'Reported'}
                    </span>
                  </div>
                  {ticket.items?.[0]?.name && (
                    <div className="text-xs font-semibold text-ink">{ticket.items[0].name}</div>
                  )}
                  {ticket.instructions && (
                    <p className="text-[11px] text-ink-mute italic">"{ticket.instructions}"</p>
                  )}
                  {!isCompleted && (
                    <button
                      onClick={() => handleUpdateStatus(ticket.id, isInProgress ? 'COMPLETED' : 'IN_PROGRESS')}
                      className="w-full py-1.5 rounded-lg bg-[#a12534] hover:bg-[#8a1f2c] text-white text-[11px] font-bold transition-colors"
                    >
                      {isInProgress ? 'Mark Repaired' : 'Technician Dispatched'}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Request Summary Badges */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
        <div className="bg-white border border-hairline p-5 rounded-xl shadow-xs">
          <span className="text-xs text-ink-mute font-medium">Pending Tasks</span>
          <div className="text-2xl font-bold text-[#0066cc] mt-1 font-mono">{activeTasks.length}</div>
        </div>
        <div className="bg-white border border-hairline p-5 rounded-xl shadow-xs">
          <span className="text-xs text-ink-mute font-medium">Completed Tasks</span>
          <div className="text-2xl font-bold text-success-mid mt-1 font-mono">{completedTasks.length}</div>
        </div>
        <div className="bg-white border border-hairline p-5 rounded-xl shadow-xs col-span-2 sm:col-span-1">
          <span className="text-xs text-ink-mute font-medium">Total Housekeeping Logs</span>
          <div className="text-2xl font-bold text-ink mt-1 font-mono">{tasks.length}</div>
        </div>
      </div>

      {/* Search Bar */}
      <div className="flex items-center justify-between bg-white p-3.5 rounded-lg border border-hairline">
        <div className="relative w-full sm:w-80">
          <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-mute" />
          <input
            type="text"
            placeholder="Search by Room or Request details..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-canvas-soft border border-hairline rounded-xl pl-9 pr-3.5 py-2 text-xs text-ink focus:outline-none focus:border-ink"
          />
        </div>
      </div>

      {/* Task List or Empty State */}
      {loading ? (
        <div className="bg-white border border-hairline rounded-xl p-12 text-center">
          <div className="w-8 h-8 border-2 border-[#0066cc] border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-xs text-ink-mute mt-3">Loading housekeeping tasks...</p>
        </div>
      ) : filteredTasks.length === 0 ? (
        <div className="bg-white border border-hairline rounded-xl p-12 text-center space-y-3 shadow-xs">
          <div className="w-16 h-16 rounded-full bg-accent-tint text-[#0066cc] border border-accent-soft flex items-center justify-center mx-auto">
            <BedDouble className="w-8 h-8" />
          </div>
          <div className="space-y-1 max-w-sm mx-auto">
            <h3 className="text-base font-bold text-ink">
              {searchQuery ? 'No matching housekeeping tasks' : 'No Active Housekeeping Requests'}
            </h3>
            <p className="text-xs text-ink-mute">
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
                className={`bg-white border rounded-xl p-5 shadow-xs flex flex-col justify-between ${
                  task.priority === 'URGENT' && !isCompleted ? 'border-[#e00b41]' : 'border-hairline hover:border-hairline'
                }`}
              >
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <span className="text-xs font-mono font-bold bg-canvas-soft border border-hairline px-2.5 py-1 rounded-xl text-ink">
                      Room {task.roomNumber}
                    </span>
                    <div className="flex items-center gap-1.5">
                      {task.priority === 'URGENT' && !isCompleted && (
                        <span className="text-[10px] font-mono font-bold uppercase px-2 py-0.5 rounded-full bg-[#fdf1f2] text-[#a12534] border border-[#f2d4d8] animate-pulse">
                          Urgent
                        </span>
                      )}
                      <span
                        className={`text-[10px] font-mono font-bold uppercase px-2.5 py-0.5 rounded-full ${
                          isCompleted
                            ? 'bg-success-tint text-success-deep border border-success-line'
                            : 'bg-accent-tint text-[#0066cc] border border-accent-soft'
                        }`}
                      >
                        {task.status || 'PENDING'}
                      </span>
                    </div>
                  </div>

                  <div>
                    <div className="text-xs text-ink-mute">Guest: <strong className="text-ink">{task.guestName || 'Guest'}</strong></div>
                    {task.items && task.items.length > 0 && (
                      <div className="mt-2 space-y-1">
                        {task.items.map((it: any, idx: number) => (
                          <div key={idx} className="text-xs font-semibold text-ink">
                            • {it.quantity || 1}x {it.name}
                          </div>
                        ))}
                      </div>
                    )}
                    {task.instructions && (
                      <p className="text-xs text-ink-mute mt-2 bg-canvas-soft p-2.5 rounded-xl border border-hairline">
                        "{task.instructions}"
                      </p>
                    )}
                  </div>
                </div>

                <div className="mt-4 pt-3 border-t border-hairline">
                  {!isCompleted ? (
                    <button
                      onClick={() => handleUpdateStatus(task.id, 'COMPLETED')}
                      className="w-full py-2.5 px-3 rounded-lg bg-[#0066cc] hover:bg-[#004fa3] text-white text-xs font-bold shadow-sm transition-colors"
                    >
                      Mark Room Serviced
                    </button>
                  ) : (
                    <div className="text-xs text-success-mid font-semibold flex items-center justify-center gap-1 py-1">
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
      <span className="font-mono text-sm font-bold text-ink">{rooms.length}</span>
    </div>

    {rooms.length === 0 ? (
      <p className="text-[11px] text-ink-mute">{empty}</p>
    ) : (
      <div className="space-y-2">
        {rooms.map((room) => (
          <div
            key={room.id}
            className="bg-white border border-hairline rounded-lg p-3 flex items-center justify-between gap-2"
          >
            <div>
              <div className="text-xs font-bold text-ink">Room {room.roomNumber}</div>
              <div className="text-[10px] text-ink-mute">Floor {room.floor || 1}</div>
            </div>
            <button
              onClick={() => onAction(room)}
              className="px-3 py-1.5 rounded-lg bg-[#0066cc] hover:bg-[#004fa3] text-white text-[11px] font-bold transition-colors whitespace-nowrap"
            >
              {actionLabel}
            </button>
          </div>
        ))}
      </div>
    )}
  </div>
);
