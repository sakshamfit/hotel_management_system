import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { firestoreService, BookingConflictError, RoomAvailability } from '../../services/firestoreService';
import { Hotel, Room, RoomTypeDefinition, Guest, Booking, BookingSource, Folio } from '../../types';
import { addDays, todayDateOnly, nightsBetween, isValidDateOnly } from '../../utils/dates';
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
  AlertCircle,
  CalendarPlus,
  Search,
  CreditCard,
  Ban,
} from 'lucide-react';

interface Props {
  hotel: Hotel;
}

/** A booking joined with the guest + room it points at (never stored). */
interface EnrichedBooking extends Booking {
  resolvedGuestName: string;
  resolvedGuestPhone: string;
  resolvedRoomNumber: string;
  resolvedRoomTypeName: string;
}

const SOURCES: BookingSource[] = ['walk-in', 'phone', 'ota'];

export const GuestCheckinTab: React.FC<Props> = ({ hotel }) => {
  const [rooms, setRooms] = useState<Room[]>([]);
  const [roomTypes, setRoomTypes] = useState<RoomTypeDefinition[]>([]);
  const [guests, setGuests] = useState<Guest[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);

  // ---- New booking modal state ----
  const [isBookingModalOpen, setIsBookingModalOpen] = useState(false);
  const [checkInDate, setCheckInDate] = useState(() => todayDateOnly(hotel.timezone));
  const [checkOutDate, setCheckOutDate] = useState(() => addDays(todayDateOnly(hotel.timezone), 1));
  const [availability, setAvailability] = useState<RoomAvailability[] | null>(null);
  const [checkingAvailability, setCheckingAvailability] = useState(false);
  const [selectedRoomId, setSelectedRoomId] = useState('');
  const [guestName, setGuestName] = useState('');
  const [guestPhone, setGuestPhone] = useState('');
  const [guestEmail, setGuestEmail] = useState('');
  const [idProofType, setIdProofType] = useState('');
  const [idProofNumber, setIdProofNumber] = useState('');
  const [numGuests, setNumGuests] = useState('1');
  const [source, setSource] = useState<BookingSource>('walk-in');
  const [agreedRate, setAgreedRate] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // ---- Check-out dialog state ----
  const [checkoutTarget, setCheckoutTarget] = useState<EnrichedBooking | null>(null);
  const [checkoutFolio, setCheckoutFolio] = useState<Folio | null>(null);
  const [isCheckingOut, setIsCheckingOut] = useState(false);

  // ---- List filter ----
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    setLoading(true);
    const unsubs = [
      firestoreService.subscribeRooms(hotel.id, setRooms, (err) => console.error('rooms', err)),
      firestoreService.subscribeRoomTypes(hotel.id, setRoomTypes, (err) => console.error('roomTypes', err)),
      firestoreService.subscribeGuests(hotel.id, setGuests, (err) => console.error('guests', err)),
      firestoreService.subscribeBookings(hotel.id, (b) => {
        setBookings(b);
        setLoading(false);
      }, (err) => {
        console.error('bookings', err);
        setLoading(false);
      }),
    ];
    return () => unsubs.forEach((u) => u());
  }, [hotel.id]);

  const guestById = useMemo(() => {
    const map = new Map<string, Guest>();
    guests.forEach((g) => map.set(g.id, g));
    return map;
  }, [guests]);

  const roomById = useMemo(() => {
    const map = new Map<string, Room>();
    rooms.forEach((r) => map.set(r.id, r));
    return map;
  }, [rooms]);

  const roomTypeById = useMemo(() => {
    const map = new Map<string, RoomTypeDefinition>();
    roomTypes.forEach((t) => map.set(t.id, t));
    return map;
  }, [roomTypes]);

  const enrich = useCallback(
    (booking: Booking): EnrichedBooking => ({
      ...booking,
      resolvedGuestName: guestById.get(booking.guestId)?.name || 'Guest',
      resolvedGuestPhone: guestById.get(booking.guestId)?.phone || '',
      resolvedRoomNumber: roomById.get(booking.roomId)?.roomNumber || '—',
      resolvedRoomTypeName: roomTypeById.get(booking.roomTypeId)?.name || '—',
    }),
    [guestById, roomById, roomTypeById]
  );

  const today = todayDateOnly(hotel.timezone);

  const { dueIn, inHouse, upcoming, recent } = useMemo(() => {
    const enriched = bookings.map(enrich);
    const matches = (b: EnrichedBooking) => {
      if (!searchQuery.trim()) return true;
      const q = searchQuery.trim().toLowerCase();
      return (
        b.resolvedGuestName.toLowerCase().includes(q) ||
        b.resolvedRoomNumber.toLowerCase().includes(q) ||
        (b.resolvedGuestPhone || '').includes(q)
      );
    };
    return {
      // Reserved and due to arrive today or already past due
      dueIn: enriched.filter((b) => b.status === 'RESERVED' && b.checkInDate <= today && matches(b)),
      inHouse: enriched.filter((b) => b.status === 'CHECKED_IN' && matches(b)),
      upcoming: enriched.filter((b) => b.status === 'RESERVED' && b.checkInDate > today && matches(b)),
      recent: enriched.filter((b) => b.status === 'CHECKED_OUT' && matches(b)).slice(0, 6),
    };
  }, [bookings, enrich, searchQuery, today]);

  // ---- Availability lookup whenever the stay window changes ----
  useEffect(() => {
    if (!isBookingModalOpen) return;
    if (!isValidDateOnly(checkInDate) || !isValidDateOnly(checkOutDate)) {
      setAvailability(null);
      return;
    }
    let cancelled = false;
    setCheckingAvailability(true);
    firestoreService
      .findAvailableRooms(hotel.id, checkInDate, checkOutDate)
      .then((result) => {
        if (cancelled) return;
        setAvailability(result);
        setCheckingAvailability(false);
      })
      .catch((err) => {
        if (cancelled) return;
        console.error('Availability lookup failed:', err);
        setAvailability([]);
        setCheckingAvailability(false);
      });
    return () => {
      cancelled = true;
    };
  }, [hotel.id, checkInDate, checkOutDate, isBookingModalOpen]);

  const availableRooms = availability?.filter((a) => a.available) || [];
  const selectedRoomType = selectedRoomId
    ? roomTypeById.get(roomById.get(selectedRoomId)?.roomTypeId || '')
    : undefined;

  const openBookingModal = () => {
    setError(null);
    setGuestName('');
    setGuestPhone('');
    setGuestEmail('');
    setIdProofType('');
    setIdProofNumber('');
    setNumGuests('1');
    setSource('walk-in');
    setSelectedRoomId('');
    setAgreedRate('');
    setCheckInDate(today);
    setCheckOutDate(addDays(today, 1));
    setIsBookingModalOpen(true);
  };

  const handleSelectRoom = (roomId: string) => {
    setSelectedRoomId(roomId);
    const type = roomTypeById.get(roomById.get(roomId)?.roomTypeId || '');
    setAgreedRate(type ? String(type.baseRate) : '');
  };

  const handleCreateBooking = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!selectedRoomId) return setError('Select an available room.');
    if (!guestName.trim()) return setError('Guest name is required.');
    if (!guestPhone.trim()) return setError('Guest phone is required.');

    const rate = parseFloat(agreedRate);
    if (!Number.isFinite(rate) || rate < 0) return setError('Enter a valid nightly rate.');

    setIsSubmitting(true);
    try {
      // The booking stores guestId only — guest PII lives in one place.
      const guestId = await firestoreService.createGuest(hotel.id, {
        name: guestName.trim(),
        phone: guestPhone.trim(),
        email: guestEmail.trim() || undefined,
        idProofType: idProofType.trim() || undefined,
        idProofNumber: idProofNumber.trim() || undefined,
      });

      await firestoreService.createBooking(hotel.id, {
        guestId,
        roomId: selectedRoomId,
        roomTypeId: roomById.get(selectedRoomId)?.roomTypeId || '',
        checkInDate,
        checkOutDate,
        agreedRate: rate,
        numGuests: parseInt(numGuests, 10) || 1,
        source,
      });

      setIsBookingModalOpen(false);
    } catch (err: any) {
      if (err instanceof BookingConflictError) {
        setError(err.message);
      } else {
        setError(err?.message || 'Could not create the booking.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCheckIn = async (booking: EnrichedBooking) => {
    try {
      await firestoreService.checkInGuest(hotel.id, booking.id, booking.roomId);
    } catch (err: any) {
      alert(`Error checking in: ${err.message}`);
    }
  };

  const openCheckoutDialog = async (booking: EnrichedBooking) => {
    setCheckoutTarget(booking);
    setCheckoutFolio(null);
    try {
      const folio = await firestoreService.getFolio(hotel.id, booking.id);
      setCheckoutFolio(folio);
    } catch (err) {
      console.warn('Could not load folio for checkout:', err);
    }
  };

  const confirmCheckOut = async () => {
    if (!checkoutTarget) return;
    setIsCheckingOut(true);
    try {
      await firestoreService.checkOutGuest(hotel.id, checkoutTarget.id, checkoutTarget.roomId);
      setCheckoutTarget(null);
      setCheckoutFolio(null);
    } catch (err: any) {
      alert(`Error during checkout: ${err.message}`);
    } finally {
      setIsCheckingOut(false);
    }
  };

  const handleCancelBooking = async (booking: EnrichedBooking) => {
    if (!window.confirm(`Cancel the reservation for ${booking.resolvedGuestName}? The nights will be released.`)) {
      return;
    }
    try {
      await firestoreService.cancelBooking(hotel.id, booking.id);
    } catch (err: any) {
      alert(`Error cancelling booking: ${err.message}`);
    }
  };

  const handleNoShow = async (booking: EnrichedBooking) => {
    if (!window.confirm(`Mark ${booking.resolvedGuestName} as a no-show? The nights will be released.`)) return;
    try {
      await firestoreService.markNoShow(hotel.id, booking.id);
    } catch (err: any) {
      alert(`Error marking no-show: ${err.message}`);
    }
  };

  const nightCount =
    isValidDateOnly(checkInDate) && isValidDateOnly(checkOutDate) ? nightsBetween(checkInDate, checkOutDate) : 0;

  const BookingCard: React.FC<{
    booking: EnrichedBooking;
    action?: React.ReactNode;
  }> = ({ booking, action }) => (
    <div className="bg-white border border-hairline rounded-xl p-5 shadow-xs flex flex-col justify-between">
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-mono font-bold bg-canvas-soft border border-hairline px-2.5 py-1 rounded-xl text-ink">
            Room {booking.resolvedRoomNumber}
          </span>
          <span className="text-[10px] font-mono font-bold uppercase bg-accent-tint text-[#004fa3] border border-accent-soft px-2.5 py-0.5 rounded-full">
            {booking.status.replace('_', ' ')}
          </span>
        </div>

        <div>
          <h4 className="font-bold text-sm text-ink">{booking.resolvedGuestName}</h4>
          <p className="text-xs text-ink-mute">
            {booking.resolvedRoomTypeName} • {booking.numGuests} guest{booking.numGuests === 1 ? '' : 's'} •{' '}
            {booking.source}
          </p>
        </div>

        <div className="space-y-1 text-xs text-ink-mute bg-canvas-soft p-3 rounded-lg border border-hairline">
          {booking.resolvedGuestPhone && (
            <div className="flex items-center gap-1.5">
              <Phone className="w-3.5 h-3.5 text-[#0066cc]" />
              <span>{booking.resolvedGuestPhone}</span>
            </div>
          )}
          <div className="flex items-center gap-1.5 text-[11px]">
            <Calendar className="w-3.5 h-3.5" />
            <span>
              In: {booking.checkInDate} • Out: {booking.checkOutDate} ({nightsBetween(booking.checkInDate, booking.checkOutDate)}N)
            </span>
          </div>
          <div className="flex items-center gap-1.5 text-[11px]">
            <CreditCard className="w-3.5 h-3.5" />
            <span>
              {hotel.currencySymbol || '$'}
              {booking.agreedRate}/night
            </span>
          </div>
        </div>
      </div>

      {action && <div className="mt-4 pt-3 border-t border-hairline">{action}</div>}
    </div>
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white border border-hairline p-6 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-4 shadow-xs">
        <div className="flex items-center gap-3.5">
          <div className="w-12 h-12 rounded-lg bg-accent-tint border border-accent-soft flex items-center justify-center text-[#0066cc]">
            <UserCheck className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-base font-bold text-ink">Front Desk & Reservations</h2>
            <p className="text-xs text-ink-mute">
              Reservations, arrivals, in-house guests and check-outs — stay data lives on the booking.
            </p>
          </div>
        </div>

        <button
          onClick={openBookingModal}
          className="flex items-center gap-2 px-5 py-2.5 bg-[#0066cc] hover:bg-[#004fa3] text-white rounded-lg text-xs font-bold shadow-sm transition-all"
        >
          <CalendarPlus className="w-4 h-4" /> New Reservation
        </button>
      </div>

      {/* Stats Summary */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <StatCard label="In House" value={inHouse.length} hint="Checked-in guests" />
        <StatCard label="Due Today" value={dueIn.length} hint="Arrivals not yet checked in" />
        <StatCard label="Future Reservations" value={upcoming.length} hint="Confirmed, arriving later" />
        <StatCard label="Total Inventory" value={rooms.length} hint={`${roomTypes.length} room type(s)`} />
      </div>

      {/* Search */}
      <div className="flex items-center justify-between bg-white p-3.5 rounded-lg border border-hairline">
        <div className="relative w-full sm:w-80">
          <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-mute" />
          <input
            type="text"
            placeholder="Search by guest, room or phone..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-canvas-soft border border-hairline rounded-xl pl-9 pr-3.5 py-2 text-xs text-ink focus:outline-none focus:border-ink"
          />
        </div>
      </div>

      {loading ? (
        <div className="bg-white border border-hairline rounded-xl p-12 text-center">
          <div className="w-8 h-8 border-2 border-[#0066cc] border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-xs text-ink-mute mt-3">Loading front desk data...</p>
        </div>
      ) : (
        <div className="space-y-6">
          <Section
            title={`Due to Arrive (${dueIn.length})`}
            empty="No arrivals due. Reservations with a check-in date of today or earlier appear here."
            icon={<UserCheck className="w-4 h-4" />}
          >
            {dueIn.map((b) => (
              <BookingCard
                key={b.id}
                booking={b}
                action={
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleCheckIn(b)}
                      className="flex-1 py-2.5 px-3 rounded-lg bg-[#0066cc] hover:bg-[#004fa3] text-white text-xs font-bold shadow-sm transition-colors"
                    >
                      Check In
                    </button>
                    <button
                      onClick={() => handleNoShow(b)}
                      title="Mark as no-show"
                      className="p-2.5 rounded-lg border border-hairline hover:border-accent-soft text-ink-mute hover:text-[#0066cc]"
                    >
                      <Ban className="w-3.5 h-3.5" />
                    </button>
                  </div>
                }
              />
            ))}
          </Section>

          <Section
            title={`In House (${inHouse.length})`}
            empty="No guests are currently checked in."
            icon={<BedDouble className="w-4 h-4" />}
          >
            {inHouse.map((b) => (
              <BookingCard
                key={b.id}
                booking={b}
                action={
                  <div className="flex gap-2">
                    <button
                      onClick={() => openCheckoutDialog(b)}
                      className="flex-1 py-2.5 px-3 rounded-full bg-white hover:bg-accent-tint text-[#0066cc] border border-accent-soft text-xs font-bold transition-colors flex items-center justify-center gap-1.5"
                    >
                      <LogOut className="w-3.5 h-3.5" /> Check Out
                    </button>
                  </div>
                }
              />
            ))}
          </Section>

          <Section
            title={`Upcoming Reservations (${upcoming.length})`}
            empty="No future reservations."
            icon={<Calendar className="w-4 h-4" />}
          >
            {upcoming.map((b) => (
              <BookingCard
                key={b.id}
                booking={b}
                action={
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleCheckIn(b)}
                      className="flex-1 py-2.5 px-3 rounded-lg bg-white border border-hairline hover:border-accent-soft text-ink text-xs font-bold transition-colors"
                    >
                      Early Check In
                    </button>
                    <button
                      onClick={() => handleCancelBooking(b)}
                      className="px-4 py-2.5 rounded-lg border border-hairline hover:border-accent-soft text-ink-mute hover:text-[#0066cc] text-xs font-bold transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                }
              />
            ))}
          </Section>

          {recent.length > 0 && (
            <Section title="Recently Checked Out" empty="" icon={<CheckCircle2 className="w-4 h-4" />}>
              {recent.map((b) => (
                <BookingCard key={b.id} booking={b} />
              ))}
            </Section>
          )}
        </div>
      )}

      {/* ===== New Reservation Modal ===== */}
      {isBookingModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs overflow-y-auto">
          <div className="bg-white rounded-xl w-full max-w-lg p-6 space-y-4 shadow-2xl border border-hairline my-8">
            <div className="flex items-center justify-between border-b border-hairline pb-3">
              <h3 className="text-base font-bold text-ink">New Reservation</h3>
              <button
                onClick={() => setIsBookingModalOpen(false)}
                className="p-1 rounded-full hover:bg-canvas-soft text-ink-mute"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateBooking} className="space-y-3.5">
              {/* Stay window */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-ink mb-1">Check-in *</label>
                  <input
                    type="date"
                    required
                    value={checkInDate}
                    min={today}
                    onChange={(e) => setCheckInDate(e.target.value)}
                    className="w-full bg-white border border-hairline rounded-xl px-3.5 py-2 text-sm text-ink"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-ink mb-1">Check-out *</label>
                  <input
                    type="date"
                    required
                    value={checkOutDate}
                    min={addDays(checkInDate, 1)}
                    onChange={(e) => setCheckOutDate(e.target.value)}
                    className="w-full bg-white border border-hairline rounded-xl px-3.5 py-2 text-sm text-ink"
                  />
                </div>
              </div>
              <p className="text-[11px] text-ink-mute -mt-1">
                {nightCount > 0
                  ? `${nightCount} night${nightCount === 1 ? '' : 's'} — the check-out day is not charged as a night.`
                  : 'Check-out must be at least one night after check-in.'}
              </p>

              {/* Room */}
              <div>
                <label className="block text-xs font-semibold text-ink mb-1">
                  Room * {checkingAvailability && <span className="text-ink-mute font-normal">(checking…)</span>}
                </label>
                <select
                  required
                  value={selectedRoomId}
                  onChange={(e) => handleSelectRoom(e.target.value)}
                  className="w-full bg-white border border-hairline rounded-xl px-3.5 py-2 text-sm text-ink"
                >
                  <option value="">-- Choose Available Room --</option>
                  {availableRooms.map((a) => {
                    const type = roomTypeById.get(a.room.roomTypeId);
                    return (
                      <option key={a.room.id} value={a.room.id}>
                        Room {a.room.roomNumber}
                        {type ? ` — ${type.name} (${hotel.currencySymbol || '$'}${type.baseRate}/nt)` : ''}
                        {a.room.status === 'cleaning' ? ' — needs cleaning' : ''}
                      </option>
                    );
                  })}
                </select>
                {availability && availableRooms.length === 0 && (
                  <p className="text-[11px] text-[#b45309] mt-1.5">
                    No rooms free for these dates ({availability.length} room(s) checked).
                  </p>
                )}
                {availability && availableRooms.length > 0 && (
                  <p className="text-[11px] text-success-mid mt-1.5">
                    {availableRooms.length} of {availability.length} room(s) available.
                  </p>
                )}
              </div>

              {/* Guest */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-ink mb-1">Guest Name *</label>
                  <input
                    type="text"
                    required
                    value={guestName}
                    onChange={(e) => setGuestName(e.target.value)}
                    placeholder="e.g. John Doe"
                    className="w-full bg-white border border-hairline rounded-xl px-3.5 py-2 text-sm text-ink"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-ink mb-1">Phone *</label>
                  <input
                    type="tel"
                    required
                    value={guestPhone}
                    onChange={(e) => setGuestPhone(e.target.value)}
                    placeholder="+91 555 0192"
                    className="w-full bg-white border border-hairline rounded-xl px-3.5 py-2 text-sm text-ink"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-ink mb-1">Email</label>
                  <input
                    type="email"
                    value={guestEmail}
                    onChange={(e) => setGuestEmail(e.target.value)}
                    placeholder="guest@example.com"
                    className="w-full bg-white border border-hairline rounded-xl px-3.5 py-2 text-sm text-ink"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-ink mb-1">Guests</label>
                  <input
                    type="number"
                    min="1"
                    max={selectedRoomType?.maxOccupancy || 20}
                    value={numGuests}
                    onChange={(e) => setNumGuests(e.target.value)}
                    className="w-full bg-white border border-hairline rounded-xl px-3.5 py-2 text-sm text-ink"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-ink mb-1">ID Proof Type</label>
                  <input
                    type="text"
                    value={idProofType}
                    onChange={(e) => setIdProofType(e.target.value)}
                    placeholder="Aadhaar / Passport"
                    className="w-full bg-white border border-hairline rounded-xl px-3.5 py-2 text-sm text-ink"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-ink mb-1">ID Number</label>
                  <input
                    type="text"
                    value={idProofNumber}
                    onChange={(e) => setIdProofNumber(e.target.value)}
                    className="w-full bg-white border border-hairline rounded-xl px-3.5 py-2 text-sm text-ink"
                  />
                </div>
              </div>

              {/* Commercials */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-ink mb-1">Agreed Rate / night *</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    required
                    value={agreedRate}
                    onChange={(e) => setAgreedRate(e.target.value)}
                    className="w-full bg-white border border-hairline rounded-xl px-3.5 py-2 text-sm text-ink"
                  />
                  <p className="text-[10px] text-ink-faint mt-1">
                    Snapshot at booking — later rate changes don’t move this stay.
                  </p>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-ink mb-1">Source</label>
                  <select
                    value={source}
                    onChange={(e) => setSource(e.target.value as BookingSource)}
                    className="w-full bg-white border border-hairline rounded-xl px-3.5 py-2 text-sm text-ink"
                  >
                    {SOURCES.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Stay total preview */}
              {nightCount > 0 && parseFloat(agreedRate) > 0 && (
                <div className="bg-canvas-soft border border-hairline rounded-lg p-3 text-xs flex items-center justify-between">
                  <span className="font-semibold text-ink-mute">
                    Room total · {nightCount} night{nightCount === 1 ? '' : 's'}
                  </span>
                  <span className="font-mono font-bold text-ink">
                    {hotel.currencySymbol || '$'}
                    {(nightCount * parseFloat(agreedRate)).toFixed(2)}
                  </span>
                </div>
              )}

              {error && (
                <div className="bg-accent-tint border border-accent-soft rounded-lg p-3.5 text-xs text-primary-deep flex items-start gap-2.5">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span className="font-medium">{error}</span>
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-hairline">
                <button
                  type="button"
                  onClick={() => setIsBookingModalOpen(false)}
                  className="px-4 py-2 rounded-full border border-hairline text-xs font-semibold text-ink-mute"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting || checkingAvailability || availableRooms.length === 0}
                  className="px-5 py-2 rounded-lg bg-[#0066cc] hover:bg-[#004fa3] text-xs font-bold text-white shadow-sm disabled:opacity-50"
                >
                  {isSubmitting ? 'Booking…' : 'Confirm Reservation'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ===== Check-out dialog ===== */}
      {checkoutTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
          <div className="bg-white rounded-xl w-full max-w-md p-6 space-y-4 shadow-2xl border border-hairline">
            <div className="flex items-center justify-between border-b border-hairline pb-3">
              <h3 className="text-base font-bold text-ink">Check Out</h3>
              <button
                onClick={() => setCheckoutTarget(null)}
                className="p-1 rounded-full hover:bg-canvas-soft text-ink-mute"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-2 text-sm">
              <p className="text-ink">
                <strong>{checkoutTarget.resolvedGuestName}</strong> — Room {checkoutTarget.resolvedRoomNumber}
              </p>
              <p className="text-xs text-ink-mute">
                {checkoutTarget.checkInDate} → {checkoutTarget.checkOutDate} (
                {nightsBetween(checkoutTarget.checkInDate, checkoutTarget.checkOutDate)} nights)
              </p>
            </div>

            <div className="bg-canvas-soft border border-hairline rounded-lg p-4 space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="text-ink-mute font-medium">Folio balance</span>
                <span className="font-mono font-bold text-[#0066cc]">
                  {checkoutFolio
                    ? `${hotel.currencySymbol || '$'}${Number(checkoutFolio.balance || 0).toFixed(2)}`
                    : '—'}
                </span>
              </div>
              <p className="text-[11px] text-ink-faint">
                {checkoutFolio
                  ? `Folio ${checkoutFolio.status}. Room-night charges are raised by night audit (not built yet).`
                  : 'No folio found for this booking.'}
              </p>
            </div>

            <p className="text-[11px] text-ink-mute">
              The room will be marked <strong>cleaning</strong> — housekeeping clears it back to available.
            </p>

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-hairline">
              <button
                type="button"
                onClick={() => setCheckoutTarget(null)}
                className="px-4 py-2 rounded-full border border-hairline text-xs font-semibold text-ink-mute"
              >
                Cancel
              </button>
              <button
                onClick={confirmCheckOut}
                disabled={isCheckingOut}
                className="px-5 py-2 rounded-lg bg-success-mid hover:bg-success-deep text-xs font-bold text-white shadow-sm disabled:opacity-50"
              >
                {isCheckingOut ? 'Checking out…' : 'Confirm Check-Out'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const StatCard: React.FC<{ label: string; value: number; hint: string }> = ({ label, value, hint }) => (
  <div className="bg-white border border-hairline p-5 rounded-xl shadow-xs">
    <span className="text-xs text-ink-mute font-medium">{label}</span>
    <div className="text-2xl font-bold text-[#0066cc] mt-1 font-mono">{value}</div>
    <div className="text-[11px] text-ink-mute mt-1">{hint}</div>
  </div>
);

const Section: React.FC<{
  title: string;
  empty: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}> = ({ title, empty, icon, children }) => {
  const count = React.Children.count(children);
  return (
    <div className="space-y-3">
      <h3 className="font-bold text-sm text-ink flex items-center gap-2">
        {icon} {title}
      </h3>
      {count === 0 ? (
        empty ? (
          <div className="bg-white border border-hairline rounded-xl p-8 text-center text-xs text-ink-mute">
            {empty}
          </div>
        ) : null
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">{children}</div>
      )}
    </div>
  );
};
