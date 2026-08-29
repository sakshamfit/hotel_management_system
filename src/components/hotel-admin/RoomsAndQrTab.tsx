import React, { useState, useEffect } from 'react';
import { firestoreService } from '../../services/firestoreService';
import { deleteImageByUrl } from '../../services/storageService';
import { ImageUploader } from '../common/ImageUploader';
import { Hotel, Room, RoomTypeDefinition } from '../../types';
import { generateQrDataUrl } from '../../utils/qr';
import { generateRoomToken } from '../../utils/qr';
import { useAuth } from '../../context/AuthContext';
import {
  QrCode,
  Plus,
  Printer,
  Download,
  Eye,
  BedDouble,
  CheckCircle2,
  AlertCircle,
  Smartphone,
  Copy,
  Check,
  Trash2,
  X,
} from 'lucide-react';

interface Props {
  hotel: Hotel;
}

export const RoomsAndQrTab: React.FC<Props> = ({ hotel }) => {
  const { setGuestRoomToken, setActiveExperience } = useAuth();
  const [rooms, setRooms] = useState<Room[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedRoom, setSelectedRoom] = useState<Room | null>(null);
  const [selectedRoomQr, setSelectedRoomQr] = useState<string>('');
  const [isCreatingRooms, setIsCreatingRooms] = useState(false);
  const [startRoom, setStartRoom] = useState('101');
  const [countToCreate, setCountToCreate] = useState('5');
  const [roomTypes, setRoomTypes] = useState<RoomTypeDefinition[]>([]);
  const [roomTypeId, setRoomTypeId] = useState('');
  const [floor, setFloor] = useState('1');
  const [copiedToken, setCopiedToken] = useState<string | null>(null);
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
        console.error('Error fetching rooms:', err);
        setLoading(false);
      }
    );
    return () => unsubscribe();
  }, [hotel.id]);

  useEffect(() => {
    const unsubscribe = firestoreService.subscribeRoomTypes(
      hotel.id,
      (types) => {
        setRoomTypes(types);
        setRoomTypeId((current) => current || types[0]?.id || '');
      },
      (err) => console.error('Error fetching room types:', err)
    );
    return () => unsubscribe();
  }, [hotel.id]);

  const handleOpenRoomQr = async (room: Room) => {
    setSelectedRoom(room);
    const token = room.permanentToken || `room_${room.id}`;
    const guestUrl = `${window.location.origin}/?token=${token}`;
    const qrData = await generateQrDataUrl(guestUrl, { width: 300 });
    setSelectedRoomQr(qrData);
  };

  const handleTestInGuestPortal = (room: Room) => {
    const token = room.permanentToken || `room_${room.id}`;
    setGuestRoomToken(token);
    setActiveExperience('guest_experience');
  };

  const handleCreateBatchRooms = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      const startNum = parseInt(startRoom, 10) || 101;
      const numRooms = parseInt(countToCreate, 10) || 1;
      const floorNum = parseInt(floor, 10) || 1;
      if (!roomTypeId) {
        alert('Create a room type first — rooms must be linked to a rate.');
        return;
      }

      for (let i = 0; i < numRooms; i++) {
        const roomNum = (startNum + i).toString();
        // Unguessable token: the QR is a bearer credential for the room, and
        // /api/guest/session is the only thing standing between a guessed
        // token and a room-scoped session. Existing rooms keep their current
        // token so already-printed QR codes stay valid.
        const permanentToken = generateRoomToken();
        const typeName = roomTypes.find((t) => t.id === roomTypeId)?.name || 'Standard';
        await firestoreService.addRoom(hotel.id, {
          roomNumber: roomNum,
          floor: floorNum,
          roomTypeId,
          type: typeName,
          status: 'available',
          permanentToken,
        });
      }

      setIsCreatingRooms(false);
    } catch (err: any) {
      alert(`Error creating rooms: ${err.message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteRoom = async (room: Room) => {
    if (window.confirm(`Delete Room ${room.roomNumber}?`)) {
      try {
        await firestoreService.deleteRoom(hotel.id, room.id);
        // Cleanup: remove the uploaded room photo so Storage stays orphan-free
        await deleteImageByUrl(room.photoUrl);
      } catch (err: any) {
        alert(err.message || 'Failed to delete room');
      }
    }
  };

  const copyToClipboard = (token: string) => {
    navigator.clipboard.writeText(token);
    setCopiedToken(token);
    setTimeout(() => setCopiedToken(null), 2000);
  };

  return (
    <div className="space-y-6">
      {/* Top Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white border border-[#e8e4dd] p-6 rounded-xl shadow-xs">
        <div className="flex items-center gap-3.5">
          <div className="w-12 h-12 rounded-lg bg-[#ece6fb] text-[#1b1938] border border-[#c9b4fa] flex items-center justify-center font-bold">
            <QrCode className="w-6 h-6" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="t-display-md">Room QR Code Management</h2>
              <span className="bg-[#ece6fb] text-[#1b1938] border border-[#c9b4fa] text-[10px] uppercase font-mono px-2.5 py-0.5 rounded-full font-bold">
                Direct Room Link
              </span>
            </div>
            <p className="text-xs text-[#73706d]">
              Each room has a unique QR code. Guests scan to place food orders, room service, and housekeeping requests.
            </p>
          </div>
        </div>

        <button
          onClick={() => setIsCreatingRooms(true)}
          className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-[#1b1938] hover:bg-[#0e0c1f] text-white text-xs font-bold shadow-sm transition-all self-start sm:self-auto"
        >
          <Plus className="w-4 h-4" /> + Add Hotel Rooms
        </button>
      </div>

      {/* Rooms Grid or Empty State */}
      {loading ? (
        <div className="bg-white border border-[#e8e4dd] rounded-xl p-12 text-center">
          <div className="w-8 h-8 border-2 border-[#1b1938] border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-xs text-[#73706d] mt-3">Loading hotel rooms…</p>
        </div>
      ) : rooms.length === 0 ? (
        <div className="bg-white border border-[#e8e4dd] rounded-xl p-12 text-center space-y-4 shadow-xs">
          <div className="w-16 h-16 rounded-full bg-[#ece6fb] text-[#1b1938] border border-[#c9b4fa] flex items-center justify-center mx-auto">
            <BedDouble className="w-8 h-8" />
          </div>
          <div className="space-y-1 max-w-sm mx-auto">
            <h3 className="text-base font-bold text-[#292827]">No Rooms Added Yet</h3>
            <p className="text-xs text-[#73706d]">
              Add your rooms to generate permanent in-room QR codes for guest self-ordering and requests.
            </p>
          </div>
          <button
            onClick={() => setIsCreatingRooms(true)}
            className="px-5 py-2.5 rounded-lg bg-[#1b1938] hover:bg-[#0e0c1f] text-white text-xs font-bold shadow-sm inline-flex items-center gap-2"
          >
            <Plus className="w-4 h-4" /> Add First Rooms
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {rooms.map((room) => {
            const isOccupied = room.status === 'occupied';
            return (
              <div
                key={room.id}
                className="bg-white border border-[#e8e4dd] hover:border-[#e8e4dd] rounded-xl p-5 shadow-xs hover:shadow-md transition-all flex flex-col justify-between"
              >
                <div>
                  {room.photoUrl && (
                    <img
                      src={room.photoUrl}
                      alt={`Room ${room.roomNumber}`}
                      className="w-full h-28 object-cover rounded-lg border border-[#e8e4dd] mb-3"
                    />
                  )}
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-mono font-bold bg-[#fafaf8] border border-[#e8e4dd] px-2.5 py-1 rounded-xl text-[#292827]">
                      Room {room.roomNumber}
                    </span>
                    <span
                      className={`text-[10px] font-bold uppercase px-2.5 py-0.5 rounded-full ${
                        isOccupied
                          ? 'bg-[#ece6fb] text-[#0e0c1f] border border-[#c9b4fa]'
                          : 'bg-[#e7efee] text-[#0e3030] border border-[#c9dcd9]'
                      }`}
                    >
                      {room.status || 'available'}
                    </span>
                  </div>

                  <div className="mt-3 space-y-1">
                    <div className="text-sm font-bold text-[#292827]">
                      {roomTypes.find((t) => t.id === room.roomTypeId)?.name || room.type || 'Standard Room'}
                    </div>
                    <div className="text-xs text-[#73706d]">Floor {room.floor || 1}</div>
                    {!room.roomTypeId && (
                      <div className="text-[11px] text-[#b45309] font-semibold mt-1">
                        No room type linked — run the reservation migration.
                      </div>
                    )}
                  </div>
                </div>

                <div className="mt-4 pt-3 border-t border-[#e8e4dd] flex items-center gap-2">
                  <button
                    onClick={() => handleOpenRoomQr(room)}
                    className="flex-1 py-2 px-3 rounded-full bg-[#fafaf8] hover:bg-[#e8e4dd] text-[#292827] text-xs font-bold border border-[#e8e4dd] flex items-center justify-center gap-1.5 transition-colors"
                  >
                    <QrCode className="w-3.5 h-3.5 text-[#1b1938]" /> View QR
                  </button>

                  <button
                    onClick={() => handleDeleteRoom(room)}
                    title="Delete Room"
                    className="p-2 rounded-full bg-white hover:bg-[#ece6fb] text-[#73706d] hover:text-[#1b1938] border border-[#e8e4dd] hover:border-[#c9b4fa] transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Modal: Add Rooms */}
      {isCreatingRooms && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
          <div className="bg-white rounded-xl w-full max-w-md p-6 space-y-5 shadow-2xl border border-[#e8e4dd]">
            <div className="flex items-center justify-between border-b border-[#e8e4dd] pb-4">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-[#ece6fb] text-[#1b1938] flex items-center justify-center font-bold">
                  <BedDouble className="w-4 h-4" />
                </div>
                <h3 className="text-base font-bold text-[#292827]">Add Hotel Rooms</h3>
              </div>
              <button
                onClick={() => setIsCreatingRooms(false)}
                className="p-1.5 rounded-full hover:bg-[#fafaf8] text-[#73706d]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateBatchRooms} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-[#292827] mb-1">
                  Starting Room Number
                </label>
                <input
                  type="text"
                  required
                  value={startRoom}
                  onChange={(e) => setStartRoom(e.target.value)}
                  placeholder="e.g. 101"
                  className="w-full bg-white border border-[#e8e4dd] rounded-xl px-3.5 py-2 text-sm text-[#292827] focus:outline-none focus:border-[#292827]"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-[#292827] mb-1">
                    Number of Rooms
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="50"
                    required
                    value={countToCreate}
                    onChange={(e) => setCountToCreate(e.target.value)}
                    className="w-full bg-white border border-[#e8e4dd] rounded-xl px-3.5 py-2 text-sm text-[#292827] focus:outline-none focus:border-[#292827]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#292827] mb-1">
                    Floor Number
                  </label>
                  <input
                    type="number"
                    min="1"
                    required
                    value={floor}
                    onChange={(e) => setFloor(e.target.value)}
                    className="w-full bg-white border border-[#e8e4dd] rounded-xl px-3.5 py-2 text-sm text-[#292827] focus:outline-none focus:border-[#292827]"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#292827] mb-1">
                  Room Type (sets the nightly rate)
                </label>
                <select
                  required
                  value={roomTypeId}
                  onChange={(e) => setRoomTypeId(e.target.value)}
                  className="w-full bg-white border border-[#e8e4dd] rounded-xl px-3.5 py-2 text-sm text-[#292827] focus:outline-none focus:border-[#292827]"
                >
                  {roomTypes.length === 0 && <option value="">-- No room types yet --</option>}
                  {roomTypes.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name} — {hotel.currencySymbol || '$'}{t.baseRate}/nt · sleeps {t.maxOccupancy}
                    </option>
                  ))}
                </select>
              </div>

              <div className="bg-[#fafaf8] border border-[#e8e4dd] rounded-xl px-3.5 py-2.5 text-xs text-[#73706d]">
                The nightly rate now comes from the <strong>room type</strong>, not the room. Manage
                rates in the room type (base rate) and override per stay with the booking’s
                <em> agreed rate</em>.
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#e8e4dd]">
                <button
                  type="button"
                  onClick={() => setIsCreatingRooms(false)}
                  className="px-4 py-2 rounded-full border border-[#e8e4dd] text-xs font-semibold text-[#73706d]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-5 py-2 rounded-lg bg-[#1b1938] hover:bg-[#0e0c1f] text-xs font-bold text-white shadow-sm disabled:opacity-50"
                >
                  {isSubmitting ? 'Saving…' : 'Create Rooms'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Room QR Viewer */}
      {selectedRoom && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
          <div className="bg-white rounded-xl w-full max-w-sm p-6 text-center space-y-4 shadow-2xl border border-[#e8e4dd]">
            <div className="flex items-center justify-between border-b border-[#e8e4dd] pb-3">
              <span className="text-xs font-bold text-[#292827]">Room {selectedRoom.roomNumber} QR Code</span>
              <button
                onClick={() => setSelectedRoom(null)}
                className="p-1 rounded-full hover:bg-[#fafaf8] text-[#73706d]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 bg-white border border-[#e8e4dd] rounded-lg inline-block shadow-xs">
              {selectedRoomQr ? (
                <img src={selectedRoomQr} alt={`QR for Room ${selectedRoom.roomNumber}`} className="w-48 h-48 mx-auto" />
              ) : (
                <div className="w-48 h-48 flex items-center justify-center text-xs text-[#73706d]">Generating QR...</div>
              )}
            </div>

            <div className="text-xs text-[#73706d] space-y-1">
              <div className="font-semibold text-[#292827]">{hotel.name}</div>
              <div>Scan to open Room {selectedRoom.roomNumber} Guest Portal</div>
            </div>

            {/* Room photo — uploaded to hotels/{hotelId}/rooms/{roomId}/image.jpg */}
            <div className="pt-2 border-t border-[#e8e4dd] text-left">
              <ImageUploader
                label="Room Photo (Optional)"
                hint="Shown on the room card for front-desk reference."
                storagePath={`hotels/${hotel.id}/rooms/${selectedRoom.id}`}
                value={selectedRoom.photoUrl || ''}
                onUrlChange={async (url) => {
                  const photoUrl = url || '';
                  try {
                    await firestoreService.updateRoom(hotel.id, selectedRoom.id, { photoUrl } as any);
                    setSelectedRoom({ ...selectedRoom, photoUrl });
                  } catch (err: any) {
                    alert(err.message || 'Failed to save room photo');
                  }
                }}
                thumbClass="h-20"
              />
            </div>

            <div className="flex items-center justify-center gap-2 pt-2">
              <button
                onClick={() => {
                  const link = document.createElement('a');
                  link.download = `QR_Room_${selectedRoom.roomNumber}_${hotel.hotelCode}.png`;
                  link.href = selectedRoomQr;
                  link.click();
                }}
                className="flex-1 py-2 px-3 rounded-lg bg-[#1b1938] hover:bg-[#0e0c1f] text-white text-xs font-bold shadow-sm transition-colors flex items-center justify-center gap-1.5"
              >
                <Download className="w-3.5 h-3.5" /> Download QR
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
