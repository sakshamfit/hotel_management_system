import React, { useState, useEffect } from 'react';
import { firestoreService } from '../../services/firestoreService';
import { Hotel, Room } from '../../types';
import {
  UserCheck,
  UserPlus,
  LogOut,
  BedDouble,
  CheckCircle2,
  Calendar,
  Phone,
  Mail,
  X,
} from 'lucide-react';

interface Props {
  hotel: Hotel;
}

export const GuestCheckinTab: React.FC<Props> = ({ hotel }) => {
  const [rooms, setRooms] = useState<Room[]>([]);
  const [loading, setLoading] = useState(true);
  const [isCheckinModalOpen, setIsCheckinModalOpen] = useState(false);
  const [selectedRoomId, setSelectedRoomId] = useState('');
  const [guestName, setGuestName] = useState('');
  const [guestPhone, setGuestPhone] = useState('');
  const [guestEmail, setGuestEmail] = useState('');
  const [checkoutDate, setCheckoutDate] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    setLoading(true);
    const unsubscribe = firestoreService.subscribeRooms(
      hotel.id,
      (fetchedRooms) => {
        setRooms(fetchedRooms);
        setLoading(false);
      },
      (err) => {
        console.error('Failed to load rooms for check-in', err);
        setLoading(false);
      }
    );
    return () => unsubscribe();
  }, [hotel.id]);

  const handleCheckIn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedRoomId || !guestName) {
      alert('Please select a room and enter guest name');
      return;
    }

    setIsSubmitting(true);
    try {
      await firestoreService.updateRoom(hotel.id, selectedRoomId, {
        status: 'occupied',
        guestName: guestName.trim(),
        guestPhone: guestPhone.trim(),
        guestEmail: guestEmail.trim(),
        checkedInAt: new Date().toISOString(),
        expectedCheckout: checkoutDate || '',
      });

      setIsCheckinModalOpen(false);
      setGuestName('');
      setGuestPhone('');
      setGuestEmail('');
      setSelectedRoomId('');
    } catch (err: any) {
      alert(`Error checking in guest: ${err.message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCheckOut = async (room: Room) => {
    if (
      !window.confirm(
        `Confirm check-out for ${room.guestName || 'Guest'} in Room ${room.roomNumber}? This will release the room as available.`
      )
    ) {
      return;
    }

    try {
      await firestoreService.updateRoom(hotel.id, room.id, {
        status: 'available',
        guestName: '',
        guestPhone: '',
        guestEmail: '',
        lastCheckedOutAt: new Date().toISOString(),
      });
    } catch (err: any) {
      alert(`Error during checkout: ${err.message}`);
    }
  };

  const vacantRooms = rooms.filter((r) => r.status === 'available' || r.status === 'vacant' || r.status === 'VACANT');
  const occupiedRooms = rooms.filter((r) => r.status === 'occupied' || r.status === 'OCCUPIED');

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white border border-[#e8e4dd] p-6 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-4 shadow-xs">
        <div className="flex items-center gap-3.5">
          <div className="w-12 h-12 rounded-lg bg-[#ece6fb] border border-[#c9b4fa] flex items-center justify-center text-[#1b1938]">
            <UserCheck className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-base font-bold text-[#292827]">Guest Front Desk & Check-In Desk</h2>
            <p className="text-xs text-[#73706d]">
              Manage guest check-ins, active in-room occupancies, and instant check-outs.
            </p>
          </div>
        </div>

        <button
          onClick={() => setIsCheckinModalOpen(true)}
          disabled={vacantRooms.length === 0}
          className="flex items-center gap-2 px-5 py-2.5 bg-[#1b1938] hover:bg-[#0e0c1f] disabled:opacity-50 text-white rounded-lg text-xs font-bold shadow-sm transition-all"
        >
          <UserPlus className="w-4 h-4" /> Check-In New Guest
        </button>
      </div>

      {/* Stats Summary */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
        <div className="bg-white border border-[#e8e4dd] p-5 rounded-xl shadow-xs">
          <span className="text-xs text-[#73706d] font-medium">Currently Occupied</span>
          <div className="text-2xl font-bold text-[#1b1938] mt-1 font-mono">{occupiedRooms.length}</div>
          <div className="text-[11px] text-[#73706d] mt-1">Active guests in property</div>
        </div>

        <div className="bg-white border border-[#e8e4dd] p-5 rounded-xl shadow-xs">
          <span className="text-xs text-[#73706d] font-medium">Available Vacant Rooms</span>
          <div className="text-2xl font-bold text-[#155555] mt-1 font-mono">{vacantRooms.length}</div>
          <div className="text-[11px] text-[#73706d] mt-1">Ready for check-in</div>
        </div>

        <div className="bg-white border border-[#e8e4dd] p-5 rounded-xl shadow-xs col-span-2 sm:col-span-1">
          <span className="text-xs text-[#73706d] font-medium">Total Inventory</span>
          <div className="text-2xl font-bold text-[#292827] mt-1 font-mono">{rooms.length}</div>
          <div className="text-[11px] text-[#73706d] mt-1">Configured hotel rooms</div>
        </div>
      </div>

      {/* Main Content */}
      {loading ? (
        <div className="bg-white border border-[#e8e4dd] rounded-xl p-12 text-center">
          <div className="w-8 h-8 border-2 border-[#1b1938] border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-xs text-[#73706d] mt-3">Loading front desk data...</p>
        </div>
      ) : rooms.length === 0 ? (
        <div className="bg-white border border-[#e8e4dd] rounded-xl p-12 text-center space-y-3 shadow-xs">
          <div className="w-16 h-16 rounded-full bg-[#ece6fb] text-[#1b1938] border border-[#c9b4fa] flex items-center justify-center mx-auto">
            <BedDouble className="w-8 h-8" />
          </div>
          <div className="space-y-1 max-w-sm mx-auto">
            <h3 className="text-base font-bold text-[#292827]">No Rooms Configured</h3>
            <p className="text-xs text-[#73706d]">
              Please add rooms under the "Rooms & Permanent QR" tab before checking in guests.
            </p>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <h3 className="font-bold text-sm text-[#292827]">Currently Checked-In Guests ({occupiedRooms.length})</h3>

          {occupiedRooms.length === 0 ? (
            <div className="bg-white border border-[#e8e4dd] rounded-xl p-8 text-center text-xs text-[#73706d]">
              No rooms are currently occupied. Click "Check-In New Guest" above to assign an arriving guest.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {occupiedRooms.map((room) => (
                <div
                  key={room.id}
                  className="bg-white border border-[#e8e4dd] hover:border-[#e8e4dd] rounded-xl p-5 shadow-xs flex flex-col justify-between"
                >
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-mono font-bold bg-[#fafaf8] border border-[#e8e4dd] px-2.5 py-1 rounded-xl text-[#292827]">
                        Room {room.roomNumber}
                      </span>
                      <span className="text-[10px] font-mono font-bold uppercase bg-[#ece6fb] text-[#0e0c1f] border border-[#c9b4fa] px-2.5 py-0.5 rounded-full">
                        Occupied
                      </span>
                    </div>

                    <div>
                      <h4 className="font-bold text-sm text-[#292827]">{room.guestName}</h4>
                      <p className="text-xs text-[#73706d]">{room.type || 'Standard Room'}</p>
                    </div>

                    <div className="space-y-1 text-xs text-[#73706d] bg-[#fafaf8] p-3 rounded-lg border border-[#e8e4dd]">
                      {room.guestPhone && (
                        <div className="flex items-center gap-1.5">
                          <Phone className="w-3.5 h-3.5 text-[#1b1938]" />
                          <span>{room.guestPhone}</span>
                        </div>
                      )}
                      {room.guestEmail && (
                        <div className="flex items-center gap-1.5">
                          <Mail className="w-3.5 h-3.5 text-[#1b1938]" />
                          <span className="truncate">{room.guestEmail}</span>
                        </div>
                      )}
                      {room.checkedInAt && (
                        <div className="flex items-center gap-1.5 text-[11px] text-[#73706d]">
                          <Calendar className="w-3.5 h-3.5" />
                          <span>In: {new Date(room.checkedInAt).toLocaleDateString()}</span>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="mt-4 pt-3 border-t border-[#e8e4dd]">
                    <button
                      onClick={() => handleCheckOut(room)}
                      className="w-full py-2.5 px-3 rounded-full bg-white hover:bg-[#ece6fb] text-[#1b1938] border border-[#c9b4fa] text-xs font-bold transition-colors flex items-center justify-center gap-1.5"
                    >
                      <LogOut className="w-3.5 h-3.5" /> Check Out Guest
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Check-In Modal */}
      {isCheckinModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
          <div className="bg-white rounded-xl w-full max-w-md p-6 space-y-4 shadow-2xl border border-[#e8e4dd]">
            <div className="flex items-center justify-between border-b border-[#e8e4dd] pb-3">
              <h3 className="text-base font-bold text-[#292827]">Check-In Arriving Guest</h3>
              <button
                onClick={() => setIsCheckinModalOpen(false)}
                className="p-1 rounded-full hover:bg-[#fafaf8] text-[#73706d]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCheckIn} className="space-y-3.5">
              <div>
                <label className="block text-xs font-semibold text-[#292827] mb-1">
                  Select Room <span className="text-[#1b1938]">*</span>
                </label>
                <select
                  required
                  value={selectedRoomId}
                  onChange={(e) => setSelectedRoomId(e.target.value)}
                  className="w-full bg-white border border-[#e8e4dd] rounded-xl px-3.5 py-2 text-sm text-[#292827] focus:outline-none focus:border-[#292827]"
                >
                  <option value="">-- Choose Available Room --</option>
                  {vacantRooms.map((r) => (
                    <option key={r.id} value={r.id}>
                      Room {r.roomNumber} ({r.type || 'Standard'}, Floor {r.floor || 1})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#292827] mb-1">
                  Guest Full Name <span className="text-[#1b1938]">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={guestName}
                  onChange={(e) => setGuestName(e.target.value)}
                  placeholder="e.g. John Doe"
                  className="w-full bg-white border border-[#e8e4dd] rounded-xl px-3.5 py-2 text-sm text-[#292827] focus:outline-none focus:border-[#292827]"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-[#292827] mb-1">Phone Number</label>
                  <input
                    type="tel"
                    value={guestPhone}
                    onChange={(e) => setGuestPhone(e.target.value)}
                    placeholder="+1 555 0192"
                    className="w-full bg-white border border-[#e8e4dd] rounded-xl px-3.5 py-2 text-sm text-[#292827] focus:outline-none focus:border-[#292827]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#292827] mb-1">Email</label>
                  <input
                    type="email"
                    value={guestEmail}
                    onChange={(e) => setGuestEmail(e.target.value)}
                    placeholder="guest@example.com"
                    className="w-full bg-white border border-[#e8e4dd] rounded-xl px-3.5 py-2 text-sm text-[#292827] focus:outline-none focus:border-[#292827]"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#292827] mb-1">Expected Check-out Date</label>
                <input
                  type="date"
                  value={checkoutDate}
                  onChange={(e) => setCheckoutDate(e.target.value)}
                  className="w-full bg-white border border-[#e8e4dd] rounded-xl px-3.5 py-2 text-sm text-[#292827] focus:outline-none focus:border-[#292827]"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-[#e8e4dd]">
                <button
                  type="button"
                  onClick={() => setIsCheckinModalOpen(false)}
                  className="px-4 py-2 rounded-full border border-[#e8e4dd] text-xs font-semibold text-[#73706d]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-5 py-2 rounded-lg bg-[#1b1938] hover:bg-[#0e0c1f] text-xs font-bold text-white shadow-sm disabled:opacity-50"
                >
                  {isSubmitting ? 'Checking In...' : 'Confirm Check-In'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
