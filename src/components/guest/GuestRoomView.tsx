import React, { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { firestoreService } from '../../services/firestoreService';
import { buildWhatsAppOrderUrl } from '../../utils/whatsapp';
import {
  Hotel,
  Room,
  FoodItem,
  HotelService,
} from '../../types';
import {
  Utensils,
  Clock,
  ShoppingBag,
  CheckCircle2,
  Plus,
  Minus,
  BedDouble,
  Coffee,
  X,
  Leaf,
  Layers,
  AlertCircle,
  MessageCircle,
  Star,
} from 'lucide-react';

interface CartItem {
  foodItem: FoodItem;
  price: number;
  quantity: number;
}

export const GuestRoomView: React.FC = () => {
  const { hotel: authHotel, guestRoomToken, allHotels, guestSession, guestSessionError, user } = useAuth();

  const [hotel, setHotel] = useState<Hotel | null>(authHotel);
  const [room, setRoom] = useState<Room | null>(null);
  const [foodItems, setFoodItems] = useState<FoodItem[]>([]);
  const [services, setServices] = useState<HotelService[]>([]);
  const [guestOrders, setGuestOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // Guest UI State
  const [activeTab, setActiveTab] = useState<'dining' | 'services' | 'orders'>('dining');
  const [selectedFoodCategory, setSelectedFoodCategory] = useState<string>('ALL');
  const [dietFilter, setDietFilter] = useState<'ALL' | 'VEG'>('ALL');
  const [cart, setCart] = useState<CartItem[]>([]);
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [specialInstructions, setSpecialInstructions] = useState('');
  const [isSubmittingOrder, setIsSubmittingOrder] = useState(false);
  const [orderSuccessMsg, setOrderSuccessMsg] = useState<string | null>(null);
  const [lastWhatsAppUrl, setLastWhatsAppUrl] = useState<string | null>(null);
  const [feedbackSubmittingId, setFeedbackSubmittingId] = useState<string | null>(null);

  // Service Request State
  const [selectedService, setSelectedService] = useState<HotelService | null>(null);
  const [serviceNotes, setServiceNotes] = useState('');
  const [servicePriority, setServicePriority] = useState<'NORMAL' | 'URGENT'>('NORMAL');

  /**
   * 1. Resolve the hotel, the room, and this guest's orders.
   *
   * Two distinct paths:
   *   A) Anonymous guest with a room-scoped session (real QR scan). Everything
   *      is read through the tenant/room scope the server granted: one hotel
   *      doc, one room doc, and only this guest's own orders.
   *   B) A signed-in staff member previewing the portal from Rooms & QR. They
   *      keep their own credentials, so they read with their existing
   *      hotel_admin / super_admin privileges.
   */
  useEffect(() => {
    let cancelled = false;
    const unsubs: Array<() => void> = [];

    const subscribeCatalogue = (hotelId: string) => {
      unsubs.push(firestoreService.subscribeFoodItems(hotelId, (items) => setFoodItems(items)));
      unsubs.push(firestoreService.subscribeServices(hotelId, (srvs) => setServices(srvs)));
    };

    // Path A — anonymous, room-scoped guest session
    if (guestSession) {
      (async () => {
        const hotelDoc = await firestoreService.getHotel(guestSession.hotelId).catch(() => null);
        if (cancelled) return;
        setHotel(hotelDoc);
        if (!hotelDoc) {
          setLoading(false);
          return;
        }

        unsubs.push(
          firestoreService.subscribeRoom(guestSession.hotelId, guestSession.roomId, (r) => setRoom(r))
        );
        unsubs.push(
          firestoreService.subscribeGuestOrders(
            guestSession.hotelId,
            guestSession.uid,
            (ords) => {
              setGuestOrders(ords);
              setLoading(false);
            },
            (err) => {
              console.error('Failed to listen to guest orders:', err);
              setLoading(false);
            }
          )
        );
        subscribeCatalogue(guestSession.hotelId);
      })();

      return () => {
        cancelled = true;
        unsubs.forEach((u) => u());
      };
    }

    // A room token is present but the anonymous session has not resolved yet
    // (or failed). Hold the loading state — do not flash "no hotel".
    if (user?.role === 'guest' || (guestRoomToken && !user)) {
      return () => {
        cancelled = true;
        unsubs.forEach((u) => u());
      };
    }

    // Path B — staff preview
    let resolvedHotel = authHotel;
    if (!resolvedHotel && allHotels.length > 0) {
      resolvedHotel = allHotels[0];
    }
    setHotel(resolvedHotel);

    if (resolvedHotel) {
      // Subscribe to rooms to find room matching token or default to first
      unsubs.push(
        firestoreService.subscribeRooms(resolvedHotel.id, (rooms) => {
          if (rooms.length > 0) {
            const matched = rooms.find((r) => r.permanentToken === guestRoomToken) || rooms[0];
            setRoom(matched);
          }
        })
      );
      subscribeCatalogue(resolvedHotel.id);
      unsubs.push(
        firestoreService.subscribeOrders(resolvedHotel.id, (ords) => {
          setGuestOrders(ords);
          setLoading(false);
        })
      );
    } else {
      setLoading(false);
    }

    return () => {
      cancelled = true;
      unsubs.forEach((u) => u());
    };
  }, [authHotel, allHotels, guestRoomToken, guestSession, user?.role]);

  // Cart operations
  const addToCart = (item: FoodItem) => {
    if (!item.isAvailable) return;
    const price = item.basePrice || (item as any).price || 0;

    setCart((prev) => {
      const existingIdx = prev.findIndex((c) => c.foodItem.id === item.id);
      if (existingIdx > -1) {
        const updated = [...prev];
        updated[existingIdx].quantity += 1;
        return updated;
      }
      return [...prev, { foodItem: item, price, quantity: 1 }];
    });
  };

  const updateQuantity = (itemId: string, delta: number) => {
    setCart((prev) => {
      return prev
        .map((c) => {
          if (c.foodItem.id === itemId) {
            const newQty = c.quantity + delta;
            return newQty > 0 ? { ...c, quantity: newQty } : null;
          }
          return c;
        })
        .filter(Boolean) as CartItem[];
    });
  };

  const cartSubtotal = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const gstPercent = hotel?.gstPercent || 0;
  const cartGstAmount = Math.round(cartSubtotal * (gstPercent / 100) * 100) / 100;
  const cartTotal = Math.round((cartSubtotal + cartGstAmount) * 100) / 100;
  const cartItemCount = cart.reduce((sum, item) => sum + item.quantity, 0);

  // Submit Food Order
  const handlePlaceOrder = async () => {
    if (!hotel || cart.length === 0) return;
    setIsSubmittingOrder(true);

    try {
      const roomNum = room?.roomNumber || '101';
      const guestName = guestSession?.guestName || 'In-Room Guest';
      const orderItems = cart.map((c) => ({
        name: c.foodItem.name,
        quantity: c.quantity,
        price: c.price,
      }));

      // NOTE: keep this payload to exactly the fields the `orders` create rule
      // allows for guests, and never send `undefined` (the Firestore SDK
      // rejects it) — omit optional fields instead.
      const notes = specialInstructions.trim();
      const foodOrderId = await firestoreService.addOrder(hotel.id, {
        roomId: room?.id || guestSession?.roomId || '',
        roomNumber: roomNum,
        guestUid: user?.id || guestSession?.uid || '',
        guestName,
        type: 'food',
        status: 'PENDING',
        items: orderItems,
        totalAmount: cartTotal,
        ...(notes ? { instructions: notes } : {}),
        createdAt: new Date().toISOString(),
      });

      // Folio linkage: if this room has an active CHECKED_IN booking, the
      // server posts a FOOD charge to that booking's folio. Folios are
      // staff-only, so the write happens via the Admin SDK. Purely additive —
      // the guest's order is already placed and must never be blocked by it.
      if (foodOrderId) {
        void firestoreService
          .linkOrderCharge(foodOrderId)
          .then((r) => {
            if (!r.linked) console.warn('[folio] charge not linked:', r.reason);
          });
      }

      setLastWhatsAppUrl(
        buildWhatsAppOrderUrl(hotel.ownerWhatsApp, {
          hotelName: hotel.name,
          roomNumber: roomNum,
          guestName,
          type: 'food',
          items: orderItems,
          totalAmount: cartTotal,
          currencySymbol: hotel.currencySymbol,
          instructions: notes,
        })
      );

      setCart([]);
      setIsCartOpen(false);
      setSpecialInstructions('');
      setOrderSuccessMsg('Your dining order has been sent directly to the kitchen!');
      setActiveTab('orders');
      setTimeout(() => setOrderSuccessMsg(null), 8000);
    } catch (err: any) {
      alert(`Error submitting order: ${err.message}`);
    } finally {
      setIsSubmittingOrder(false);
    }
  };

  // Submit Service Request
  const handleRequestService = async () => {
    if (!hotel || !selectedService) return;
    setIsSubmittingOrder(true);

    try {
      const roomNum = room?.roomNumber || '101';
      const guestName = guestSession?.guestName || 'In-Room Guest';
      const notes = serviceNotes.trim();

      const serviceOrderId = await firestoreService.addOrder(hotel.id, {
        roomId: room?.id || guestSession?.roomId || '',
        roomNumber: roomNum,
        guestUid: user?.id || guestSession?.uid || '',
        guestName,
        type: 'service',
        status: 'PENDING',
        priority: servicePriority,
        ...(selectedService.department ? { department: selectedService.department } : {}),
        items: [
          {
            name: selectedService.name,
            quantity: 1,
            price: selectedService.price || 0,
          },
        ],
        totalAmount: selectedService.price || 0,
        ...(notes ? { instructions: notes } : {}),
        createdAt: new Date().toISOString(),
      });

      // Folio linkage — SERVICE charge on the active booking's folio (see the
      // dining order above for why this is server-side and best-effort).
      if (serviceOrderId) {
        void firestoreService
          .linkOrderCharge(serviceOrderId)
          .then((r) => {
            if (!r.linked) console.warn('[folio] charge not linked:', r.reason);
          });
      }

      setLastWhatsAppUrl(
        buildWhatsAppOrderUrl(hotel.ownerWhatsApp, {
          hotelName: hotel.name,
          roomNumber: roomNum,
          guestName,
          type: 'service',
          items: [{ name: selectedService.name, quantity: 1, price: selectedService.price || 0 }],
          totalAmount: selectedService.price || 0,
          currencySymbol: hotel.currencySymbol,
          instructions: notes,
        })
      );

      setSelectedService(null);
      setServiceNotes('');
      setServicePriority('NORMAL');
      setOrderSuccessMsg(`Request for "${selectedService.name}" dispatched to housekeeping/front desk!`);
      setActiveTab('orders');
      setTimeout(() => setOrderSuccessMsg(null), 8000);
    } catch (err: any) {
      alert(`Error submitting request: ${err.message}`);
    } finally {
      setIsSubmittingOrder(false);
    }
  };

  // Guest feedback (5-star + comment) on a completed order
  const handleSubmitFeedback = async (orderId: string, rating: number, comment: string) => {
    setFeedbackSubmittingId(orderId);
    try {
      const result = await firestoreService.submitGuestOrderFeedback(orderId, rating, comment);
      if (!result.ok) {
        alert(`Could not submit feedback: ${result.reason || 'unknown error'}`);
      }
    } catch (err: any) {
      alert(`Could not submit feedback: ${err.message}`);
    } finally {
      setFeedbackSubmittingId(null);
    }
  };

  if (guestSessionError) {
    return (
      <div className="min-h-screen bg-canvas-soft flex items-center justify-center p-6">
        <div className="bg-white border border-hairline p-8 rounded-xl max-w-sm text-center space-y-3 shadow-xs">
          <AlertCircle className="w-10 h-10 text-[#b45309] mx-auto" />
          <h3 className="text-base font-bold text-ink">This room link can’t be opened</h3>
          <p className="text-xs text-ink-mute">{guestSessionError}</p>
          <p className="text-[11px] text-ink-faint">
            Ask the front desk to re-issue the QR code for this room.
          </p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-canvas-soft flex items-center justify-center p-6">
        <div className="text-center space-y-3">
          <div className="w-10 h-10 border-3 border-[#0066cc] border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-xs font-semibold text-ink-mute">Connecting to room experience...</p>
        </div>
      </div>
    );
  }

  if (!hotel) {
    return (
      <div className="min-h-screen bg-canvas-soft flex items-center justify-center p-6">
        <div className="bg-white border border-hairline p-8 rounded-xl max-w-sm text-center space-y-3 shadow-xs">
          <BedDouble className="w-10 h-10 text-[#0066cc] mx-auto" />
          <h3 className="text-base font-bold text-ink">No Hotel Configured</h3>
          <p className="text-xs text-ink-mute">
            Please provision a hotel from the Super Admin panel to test the guest room experience.
          </p>
        </div>
      </div>
    );
  }

  const categories = Array.from(new Set(foodItems.map((i) => i.category || 'General')));

  const filteredFood = foodItems.filter((i) => {
    const matchesCategory = selectedFoodCategory === 'ALL' || i.category === selectedFoodCategory;
    const isVeg = i.isVegetarian || (i as any).isVeg;
    const matchesDiet = dietFilter === 'ALL' || (dietFilter === 'VEG' && isVeg);
    return matchesCategory && matchesDiet;
  });

  return (
    <div className="min-h-screen bg-canvas-soft pb-24 text-ink">
      {/* Hotel & In-Room Header — near-black hero band, single accent color */}
      <div className="atmosphere relative px-4 py-7 sm:py-9 sticky top-16 z-20 overflow-hidden">
        <div className="max-w-3xl mx-auto flex items-center justify-between relative">
          <div className="flex items-center gap-3.5">
            <div
              className="w-11 h-11 rounded-lg flex items-center justify-center text-on-primary font-bold text-base"
              style={{ backgroundColor: hotel.branding?.primaryColor || '#cfe6ff', color: hotel.branding?.primaryColor ? '#ffffff' : '#0066cc' }}
            >
              {hotel.name.charAt(0)}
            </div>
            <div>
              <div className="flex items-center gap-2.5">
                <h1 className="t-display-md text-on-primary">{hotel.name}</h1>
                <span className="font-mono text-[10px] font-semibold uppercase text-on-dark-mute border border-hairline-dark rounded px-1.5 py-0.5">
                  Room {room?.roomNumber || '101'}
                </span>
              </div>
              <p className="t-caption text-on-dark-mute" style={{ fontSize: 12 }}>
                Welcome{guestSession?.guestName ? `, ${guestSession.guestName}` : ''} • Tap items to order to your room
              </p>
            </div>
          </div>

          {/* Tray trigger — the hero's violet pill */}
          <button
            onClick={() => setIsCartOpen(true)}
            className="btn-on-dark-pill relative px-4 py-2.5 text-xs"
          >
            <ShoppingBag className="w-4 h-4" />
            <span className="hidden sm:inline">Tray</span>
            {cartItemCount > 0 && (
              <span className="bg-on-primary text-primary text-[10px] font-extrabold w-5 h-5 rounded-full flex items-center justify-center">
                {cartItemCount}
              </span>
            )}
          </button>
        </div>
      </div>

      {/* Success Notification Banner */}
      {orderSuccessMsg && (
        <div className="max-w-3xl mx-auto px-4 pt-4">
          <div className="bg-success-tint border border-success-line text-success-deep px-4 py-3 rounded-lg text-xs font-semibold flex items-center justify-between gap-3 shadow-xs flex-wrap">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-success-mid shrink-0" />
              <span>{orderSuccessMsg}</span>
            </div>
            {lastWhatsAppUrl && (
              <a
                href={lastWhatsAppUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[#25D366] hover:bg-[#1ebe5a] text-white text-[11px] font-bold shadow-xs transition-colors shrink-0"
              >
                <MessageCircle className="w-3.5 h-3.5" /> Also notify on WhatsApp
              </a>
            )}
          </div>
        </div>
      )}

      {/* Experience Sub-tabs: pill-tab picker */}
      <div className="max-w-3xl mx-auto px-4 pt-5">
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => setActiveTab('dining')}
            data-active={activeTab === 'dining'}
            className="pill-tab-light"
          >
            <Utensils className="w-3.5 h-3.5" /> In-Room Dining ({foodItems.length})
          </button>
          <button
            onClick={() => setActiveTab('services')}
            data-active={activeTab === 'services'}
            className="pill-tab-light"
          >
            <Layers className="w-3.5 h-3.5" /> Room Services ({services.length})
          </button>
          <button
            onClick={() => setActiveTab('orders')}
            data-active={activeTab === 'orders'}
            className="pill-tab-light"
          >
            <Clock className="w-3.5 h-3.5" /> My Requests ({guestOrders.length})
          </button>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-4 pt-4 space-y-4">
        {/* DINING TAB */}
        {activeTab === 'dining' && (
          <div className="space-y-4">
            {/* Category Filter Pills */}
            <div className="flex items-center gap-2 overflow-x-auto pb-1">
              <button
                onClick={() => setSelectedFoodCategory('ALL')}
                data-active={selectedFoodCategory === 'ALL'}
                className="pill-tab-light whitespace-nowrap"
              >
                All Menu
              </button>
              {categories.map((cat) => (
                <button
                  key={cat}
                  onClick={() => setSelectedFoodCategory(cat)}
                  data-active={selectedFoodCategory === cat}
                  className="pill-tab-light whitespace-nowrap"
                >
                  {cat}
                </button>
              ))}

              <div className="h-4 w-px bg-hairline mx-1 shrink-0" />

              <button
                onClick={() => setDietFilter(dietFilter === 'VEG' ? 'ALL' : 'VEG')}
                className={`px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap flex items-center gap-1 transition-colors ${
                  dietFilter === 'VEG'
                    ? 'bg-success-mid text-white'
                    : 'bg-white text-success-deep border border-success-line'
                }`}
              >
                <Leaf className="w-3 h-3" /> Veg Only
              </button>
            </div>

            {/* Food Menu Items List or Empty State */}
            {filteredFood.length === 0 ? (
              <div className="bg-white border border-hairline rounded-xl p-10 text-center space-y-2 shadow-xs">
                <Utensils className="w-8 h-8 text-[#0066cc] mx-auto opacity-60" />
                <h3 className="font-bold text-sm text-ink">No Menu Items Listed</h3>
                <p className="text-xs text-ink-mute">
                  The hotel kitchen has not added any food items to the dining menu yet.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                {filteredFood.map((item) => {
                  const price = item.basePrice || (item as any).price || 0;
                  const inCartItem = cart.find((c) => c.foodItem.id === item.id);
                  const isVeg = item.isVegetarian || (item as any).isVeg;

                  return (
                    <div
                      key={item.id}
                      className="bg-white border border-hairline rounded-xl p-4 shadow-xs flex flex-col justify-between"
                    >
                      <div>
                        {item.imageUrl && (
                          <img
                            src={item.imageUrl}
                            alt={item.name}
                            className="w-full h-28 object-cover rounded-lg border border-hairline mb-3"
                          />
                        )}
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <div className="flex items-center gap-1.5">
                              <h3 className="font-bold text-sm text-ink">{item.name}</h3>
                              {isVeg && (
                                <span className="p-0.5 rounded-full bg-success-tint text-success-mid border border-success-line text-[10px]">
                                  <Leaf className="w-3 h-3" />
                                </span>
                              )}
                            </div>
                            <span className="text-[10px] font-mono text-ink-mute uppercase bg-canvas-soft px-2 py-0.5 rounded-md mt-1 inline-block">
                              {item.category || 'Dining'}
                            </span>
                          </div>

                          <div className="font-bold text-sm text-ink">
                            {hotel.currencySymbol || '$'}
                            {price}
                          </div>
                        </div>

                        {item.description && (
                          <p className="text-xs text-ink-mute mt-2 line-clamp-2">{item.description}</p>
                        )}
                      </div>

                      <div className="mt-4 pt-3 border-t border-hairline flex items-center justify-between">
                        <span className="text-[11px] text-ink-mute">
                          ~{item.preparationTimeMinutes || 15} mins
                        </span>

                        {!item.isAvailable ? (
                          <span className="text-xs font-semibold text-primary bg-accent-tint px-2.5 py-1 rounded-full">
                            Out of Stock
                          </span>
                        ) : inCartItem ? (
                          <div className="flex items-center gap-2 bg-canvas-soft border border-hairline px-2 py-1 rounded-full">
                            <button
                              onClick={() => updateQuantity(item.id, -1)}
                              className="w-5 h-5 rounded-full bg-white flex items-center justify-center text-ink font-bold shadow-xs hover:bg-hairline"
                            >
                              -
                            </button>
                            <span className="text-xs font-mono font-bold">{inCartItem.quantity}</span>
                            <button
                              onClick={() => updateQuantity(item.id, 1)}
                              className="w-5 h-5 rounded-full bg-white flex items-center justify-center text-ink font-bold shadow-xs hover:bg-hairline"
                            >
                              +
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => addToCart(item)}
                            className="px-3.5 py-1.5 rounded-lg bg-[#0066cc] hover:bg-[#004fa3] text-white text-xs font-bold shadow-xs transition-colors"
                          >
                            + Add to Tray
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* SERVICES TAB */}
        {activeTab === 'services' && (
          <div className="space-y-4">
            {services.length === 0 ? (
              <div className="bg-white border border-hairline rounded-xl p-10 text-center space-y-2 shadow-xs">
                <Layers className="w-8 h-8 text-[#0066cc] mx-auto opacity-60" />
                <h3 className="font-bold text-sm text-ink">No Services Listed</h3>
                <p className="text-xs text-ink-mute">
                  The hotel has not configured any instant housekeeping or concierge services yet.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                {services.map((service) => (
                  <div
                    key={service.id}
                    className="bg-white border border-hairline rounded-xl p-4 shadow-xs flex flex-col justify-between"
                  >
                    <div>
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <h3 className="font-bold text-sm text-ink">{service.name}</h3>
                          <span className="text-[10px] font-mono text-ink-mute uppercase bg-canvas-soft px-2 py-0.5 rounded-md mt-1 inline-block">
                            {service.categoryId || 'Service'}
                          </span>
                        </div>
                        <span className="font-bold text-xs text-ink">
                          {service.price > 0 ? `${hotel.currencySymbol || '$'}${service.price}` : 'Complimentary'}
                        </span>
                      </div>

                      {service.description && (
                        <p className="text-xs text-ink-mute mt-2">{service.description}</p>
                      )}
                    </div>

                    <div className="mt-4 pt-3 border-t border-hairline flex items-center justify-between">
                      <span className="text-[11px] text-ink-mute">
                        ~{service.slaMinutes || service.estimatedTimeMinutes || 15} mins SLA
                      </span>

                      <button
                        onClick={() => setSelectedService(service)}
                        className="px-3.5 py-1.5 rounded-lg bg-[#0066cc] hover:bg-[#004fa3] text-white text-xs font-bold shadow-xs transition-colors"
                      >
                        Request Service
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* MY ORDERS TAB */}
        {activeTab === 'orders' && (
          <div className="space-y-4">
            {guestOrders.length === 0 ? (
              <div className="bg-white border border-hairline rounded-xl p-10 text-center space-y-2 shadow-xs">
                <Clock className="w-8 h-8 text-[#0066cc] mx-auto opacity-60" />
                <h3 className="font-bold text-sm text-ink">No Active Room Orders</h3>
                <p className="text-xs text-ink-mute">
                  When you order food or request services, track their real-time progress right here.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {guestOrders.map((ord) => (
                  <div
                    key={ord.id}
                    className="bg-white border border-hairline rounded-xl p-4 shadow-xs space-y-2.5"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-ink capitalize">
                        {ord.type || 'Order'} Request
                      </span>
                      <span
                        className={`text-[10px] font-mono font-bold uppercase px-2.5 py-0.5 rounded-full ${
                          ['COMPLETED', 'DELIVERED'].includes((ord.status || '').toUpperCase())
                            ? 'bg-success-tint text-success-deep border border-success-line'
                            : 'bg-accent-tint text-[#0066cc] border border-accent-soft'
                        }`}
                      >
                        {ord.status || 'PENDING'}
                      </span>
                    </div>

                    {ord.items && (
                      <div className="bg-canvas-soft p-3 rounded-lg text-xs space-y-1 border border-hairline">
                        {ord.items.map((i: any, idx: number) => (
                          <div key={idx} className="flex justify-between">
                            <span>
                              {i.quantity || 1}x {i.name}
                            </span>
                            <span className="font-mono text-ink">
                              {hotel.currencySymbol || '$'}
                              {(i.price || 0) * (i.quantity || 1)}
                            </span>
                          </div>
                        ))}
                        {ord.totalAmount > 0 && (
                          <div className="flex justify-between font-bold pt-1 border-t border-hairline">
                            <span>Total:</span>
                            <span className="text-[#0066cc]">
                              {hotel.currencySymbol || '$'}
                              {ord.totalAmount}
                            </span>
                          </div>
                        )}
                      </div>
                    )}

                    {ord.instructions && (
                      <p className="text-xs text-ink-mute italic">Note: "{ord.instructions}"</p>
                    )}

                    {['COMPLETED', 'DELIVERED'].includes((ord.status || '').toUpperCase()) && (
                      <OrderFeedback
                        order={ord}
                        submitting={feedbackSubmittingId === ord.id}
                        onSubmit={(rating, comment) => handleSubmitFeedback(ord.id, rating, comment)}
                      />
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Cart Drawer Modal */}
      {isCartOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/60 backdrop-blur-xs">
          <div className="bg-white rounded-t-xl sm:rounded-xl w-full max-w-md p-6 space-y-4 shadow-2xl border border-hairline max-h-[85vh] flex flex-col justify-between">
            <div className="flex items-center justify-between border-b border-hairline pb-3">
              <div className="flex items-center gap-2">
                <ShoppingBag className="w-5 h-5 text-[#0066cc]" />
                <h3 className="text-base font-bold text-ink">In-Room Order Tray</h3>
              </div>
              <button
                onClick={() => setIsCartOpen(false)}
                className="p-1 rounded-full hover:bg-canvas-soft text-ink-mute"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="overflow-y-auto space-y-3 flex-1">
              {cart.length === 0 ? (
                <div className="text-center py-8 text-xs text-ink-mute">Your tray is empty.</div>
              ) : (
                cart.map((item) => (
                  <div
                    key={item.foodItem.id}
                    className="flex items-center justify-between p-3 rounded-lg bg-canvas-soft border border-hairline"
                  >
                    <div>
                      <div className="text-xs font-bold text-ink">{item.foodItem.name}</div>
                      <div className="text-[11px] text-ink-mute">
                        {hotel.currencySymbol || '$'}
                        {item.price} each
                      </div>
                    </div>

                    <div className="flex items-center gap-2 bg-white border border-hairline px-2 py-1 rounded-full">
                      <button
                        onClick={() => updateQuantity(item.foodItem.id, -1)}
                        className="w-5 h-5 rounded-full flex items-center justify-center font-bold text-xs text-ink hover:bg-canvas-soft"
                      >
                        -
                      </button>
                      <span className="text-xs font-mono font-bold">{item.quantity}</span>
                      <button
                        onClick={() => updateQuantity(item.foodItem.id, 1)}
                        className="w-5 h-5 rounded-full flex items-center justify-center font-bold text-xs text-ink hover:bg-canvas-soft"
                      >
                        +
                      </button>
                    </div>
                  </div>
                ))
              )}

              {cart.length > 0 && (
                <div>
                  <label className="block text-xs font-semibold text-ink mb-1">
                    Special Kitchen Instructions
                  </label>
                  <textarea
                    rows={2}
                    value={specialInstructions}
                    onChange={(e) => setSpecialInstructions(e.target.value)}
                    placeholder="e.g. Extra spicy, no onions, bring cutlery..."
                    className="w-full bg-white border border-hairline rounded-xl p-2.5 text-xs text-ink focus:outline-none focus:border-ink"
                  />
                </div>
              )}
            </div>

            {cart.length > 0 && (
              /* The teal resolving band — the order's closing chord */
              <div className="card-teal-band p-4 space-y-2">
                <div className="flex items-center justify-between text-xs text-on-dark-mute">
                  <span>Subtotal:</span>
                  <span className="font-mono">
                    {hotel.currencySymbol || '$'}
                    {cartSubtotal}
                  </span>
                </div>
                {gstPercent > 0 && (
                  <div className="flex items-center justify-between text-xs text-on-dark-mute">
                    <span>GST ({gstPercent}%):</span>
                    <span className="font-mono">
                      {hotel.currencySymbol || '$'}
                      {cartGstAmount}
                    </span>
                  </div>
                )}
                <div className="flex items-center justify-between t-body-md font-bold text-on-primary pt-1 border-t border-hairline-dark">
                  <span>Total Amount:</span>
                  <span className="font-mono">
                    {hotel.currencySymbol || '$'}
                    {cartTotal}
                  </span>
                </div>

                <button
                  onClick={handlePlaceOrder}
                  disabled={isSubmittingOrder}
                  className="btn-on-teal w-full py-3 disabled:opacity-50"
                >
                  {isSubmittingOrder ? 'Sending to Kitchen…' : `Place Room Order • Room ${room?.roomNumber || '101'}`}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Service Request Confirmation Modal */}
      {selectedService && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
          <div className="bg-white rounded-xl w-full max-w-md p-6 space-y-4 shadow-2xl border border-hairline">
            <div className="flex items-center justify-between border-b border-hairline pb-3">
              <h3 className="text-base font-bold text-ink">Request: {selectedService.name}</h3>
              <button
                onClick={() => setSelectedService(null)}
                className="p-1 rounded-full hover:bg-canvas-soft text-ink-mute"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3">
              <p className="text-xs text-ink-mute">{selectedService.description}</p>
              <div>
                <label className="block text-xs font-semibold text-ink mb-1">
                  Specific Requests or Notes
                </label>
                <textarea
                  rows={2}
                  value={serviceNotes}
                  onChange={(e) => setServiceNotes(e.target.value)}
                  placeholder="e.g. Please deliver 2 extra towels to the bathroom..."
                  className="w-full bg-white border border-hairline rounded-xl p-2.5 text-xs text-ink focus:outline-none focus:border-ink"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-ink mb-1">How urgent is this?</label>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setServicePriority('NORMAL')}
                    className={`flex-1 py-2 rounded-lg text-xs font-bold border transition-colors ${
                      servicePriority === 'NORMAL'
                        ? 'bg-[#0066cc] text-white border-[#0066cc]'
                        : 'bg-white text-ink-mute border-hairline'
                    }`}
                  >
                    Normal
                  </button>
                  <button
                    type="button"
                    onClick={() => setServicePriority('URGENT')}
                    className={`flex-1 py-2 rounded-lg text-xs font-bold border transition-colors ${
                      servicePriority === 'URGENT'
                        ? 'bg-[#e00b41] text-white border-[#e00b41]'
                        : 'bg-white text-ink-mute border-hairline'
                    }`}
                  >
                    Urgent
                  </button>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-hairline">
              <button
                type="button"
                onClick={() => setSelectedService(null)}
                className="px-4 py-2 rounded-full border border-hairline text-xs font-semibold text-ink-mute"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleRequestService}
                disabled={isSubmittingOrder}
                className="px-5 py-2 rounded-lg bg-[#0066cc] hover:bg-[#004fa3] text-xs font-bold text-white shadow-sm disabled:opacity-50"
              >
                {isSubmittingOrder ? 'Dispatching...' : 'Confirm Request'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

/** 5-star rating + optional comment for a completed order. Submits once. */
const OrderFeedback: React.FC<{
  order: any;
  submitting: boolean;
  onSubmit: (rating: number, comment: string) => void;
}> = ({ order, submitting, onSubmit }) => {
  const existing = order.guestFeedback;
  const [rating, setRating] = useState<number>(existing?.rating || 0);
  const [comment, setComment] = useState<string>(existing?.comment || '');
  const [hover, setHover] = useState<number>(0);

  if (existing?.rating) {
    return (
      <div className="pt-2 border-t border-hairline flex items-center gap-1.5">
        {[1, 2, 3, 4, 5].map((n) => (
          <Star
            key={n}
            className={`w-3.5 h-3.5 ${n <= existing.rating ? 'fill-amber-400 text-amber-400' : 'text-hairline'}`}
          />
        ))}
        <span className="text-[11px] text-ink-mute ml-1">Thanks for the feedback!</span>
      </div>
    );
  }

  return (
    <div className="pt-2 border-t border-hairline space-y-2">
      <div className="flex items-center gap-1">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => setRating(n)}
            onMouseEnter={() => setHover(n)}
            onMouseLeave={() => setHover(0)}
            className="p-0.5"
            aria-label={`Rate ${n} star${n > 1 ? 's' : ''}`}
          >
            <Star
              className={`w-4.5 h-4.5 ${
                n <= (hover || rating) ? 'fill-amber-400 text-amber-400' : 'text-hairline'
              }`}
            />
          </button>
        ))}
        <span className="text-[11px] text-ink-mute ml-1">Rate this order</span>
      </div>
      {rating > 0 && (
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Optional comment..."
            className="flex-1 bg-canvas-soft border border-hairline rounded-lg px-2.5 py-1.5 text-xs text-ink focus:outline-none focus:border-ink"
          />
          <button
            type="button"
            onClick={() => onSubmit(rating, comment)}
            disabled={submitting}
            className="px-3 py-1.5 rounded-lg bg-[#0066cc] hover:bg-[#004fa3] text-white text-[11px] font-bold disabled:opacity-50 shrink-0"
          >
            {submitting ? 'Sending…' : 'Submit'}
          </button>
        </div>
      )}
    </div>
  );
};
