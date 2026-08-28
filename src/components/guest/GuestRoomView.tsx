import React, { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { firestoreService } from '../../services/firestoreService';
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
} from 'lucide-react';

interface CartItem {
  foodItem: FoodItem;
  price: number;
  quantity: number;
}

export const GuestRoomView: React.FC = () => {
  const { hotel: authHotel, guestRoomToken, allHotels } = useAuth();

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

  // Service Request State
  const [selectedService, setSelectedService] = useState<HotelService | null>(null);
  const [serviceNotes, setServiceNotes] = useState('');

  // 1. Resolve Hotel and Room
  useEffect(() => {
    let resolvedHotel = authHotel;
    if (!resolvedHotel && allHotels.length > 0) {
      resolvedHotel = allHotels[0];
    }
    setHotel(resolvedHotel);

    if (resolvedHotel) {
      // Subscribe to rooms to find room matching token or default to first
      const unsubRooms = firestoreService.subscribeRooms(resolvedHotel.id, (rooms) => {
        if (rooms.length > 0) {
          const matched = rooms.find((r) => r.permanentToken === guestRoomToken) || rooms[0];
          setRoom(matched);
        }
      });

      // Subscribe to food items
      const unsubFood = firestoreService.subscribeFoodItems(resolvedHotel.id, (items) => {
        setFoodItems(items);
      });

      // Subscribe to services
      const unsubServices = firestoreService.subscribeServices(resolvedHotel.id, (srvs) => {
        setServices(srvs);
      });

      // Subscribe to orders
      const unsubOrders = firestoreService.subscribeOrders(resolvedHotel.id, (ords) => {
        setGuestOrders(ords);
        setLoading(false);
      });

      return () => {
        unsubRooms();
        unsubFood();
        unsubServices();
        unsubOrders();
      };
    } else {
      setLoading(false);
    }
  }, [authHotel, allHotels, guestRoomToken]);

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

  const cartTotal = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const cartItemCount = cart.reduce((sum, item) => sum + item.quantity, 0);

  // Submit Food Order
  const handlePlaceOrder = async () => {
    if (!hotel || cart.length === 0) return;
    setIsSubmittingOrder(true);

    try {
      const roomNum = room?.roomNumber || '101';
      const guestName = room?.guestName || 'In-Room Guest';

      await firestoreService.addOrder(hotel.id, {
        roomNumber: roomNum,
        guestName,
        type: 'food',
        status: 'PENDING',
        items: cart.map((c) => ({
          name: c.foodItem.name,
          quantity: c.quantity,
          price: c.price,
        })),
        totalAmount: cartTotal,
        instructions: specialInstructions.trim() || undefined,
        createdAt: new Date().toISOString(),
      });

      setCart([]);
      setIsCartOpen(false);
      setSpecialInstructions('');
      setOrderSuccessMsg('Your dining order has been sent directly to the kitchen!');
      setActiveTab('orders');
      setTimeout(() => setOrderSuccessMsg(null), 5000);
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
      const guestName = room?.guestName || 'In-Room Guest';

      await firestoreService.addOrder(hotel.id, {
        roomNumber: roomNum,
        guestName,
        type: 'service',
        status: 'PENDING',
        items: [
          {
            name: selectedService.name,
            quantity: 1,
            price: selectedService.price || 0,
          },
        ],
        totalAmount: selectedService.price || 0,
        instructions: serviceNotes.trim() || undefined,
        createdAt: new Date().toISOString(),
      });

      setSelectedService(null);
      setServiceNotes('');
      setOrderSuccessMsg(`Request for "${selectedService.name}" dispatched to housekeeping/front desk!`);
      setActiveTab('orders');
      setTimeout(() => setOrderSuccessMsg(null), 5000);
    } catch (err: any) {
      alert(`Error submitting request: ${err.message}`);
    } finally {
      setIsSubmittingOrder(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#fafafa] flex items-center justify-center p-6">
        <div className="text-center space-y-3">
          <div className="w-10 h-10 border-3 border-[#ff385c] border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-xs font-semibold text-[#6a6a6a]">Connecting to room experience...</p>
        </div>
      </div>
    );
  }

  if (!hotel) {
    return (
      <div className="min-h-screen bg-[#fafafa] flex items-center justify-center p-6">
        <div className="bg-white border border-[#ebebeb] p-8 rounded-3xl max-w-sm text-center space-y-3 shadow-xs">
          <BedDouble className="w-10 h-10 text-[#ff385c] mx-auto" />
          <h3 className="text-base font-bold text-[#222222]">No Hotel Configured</h3>
          <p className="text-xs text-[#6a6a6a]">
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
    <div className="min-h-screen bg-[#fafafa] pb-24 text-[#222222]">
      {/* Hotel & In-Room Header */}
      <div className="bg-white border-b border-[#ebebeb] px-4 py-5 sticky top-18 z-20 shadow-xs">
        <div className="max-w-3xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div
              className="w-11 h-11 rounded-2xl flex items-center justify-center text-white font-bold text-base shadow-sm"
              style={{ backgroundColor: hotel.branding?.primaryColor || '#ff385c' }}
            >
              {hotel.name.charAt(0)}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-base font-bold text-[#222222]">{hotel.name}</h1>
                <span className="bg-[#222222] text-white font-mono text-[10px] font-bold px-2 py-0.5 rounded-md">
                  Room {room?.roomNumber || '101'}
                </span>
              </div>
              <p className="text-xs text-[#6a6a6a]">
                Welcome{room?.guestName ? `, ${room.guestName}` : ''} • Tap items to order to your room
              </p>
            </div>
          </div>

          {/* Cart Trigger */}
          <button
            onClick={() => setIsCartOpen(true)}
            className="relative flex items-center gap-2 px-4 py-2 bg-[#ff385c] hover:bg-[#e00b41] text-white rounded-full text-xs font-bold shadow-sm transition-all"
          >
            <ShoppingBag className="w-4 h-4" />
            <span className="hidden sm:inline">Tray</span>
            {cartItemCount > 0 && (
              <span className="bg-white text-[#ff385c] text-[10px] font-extrabold w-5 h-5 rounded-full flex items-center justify-center">
                {cartItemCount}
              </span>
            )}
          </button>
        </div>
      </div>

      {/* Success Notification Banner */}
      {orderSuccessMsg && (
        <div className="max-w-3xl mx-auto px-4 pt-4">
          <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 px-4 py-3 rounded-2xl text-xs font-semibold flex items-center gap-2 shadow-xs">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>{orderSuccessMsg}</span>
          </div>
        </div>
      )}

      {/* Experience Sub-tabs: Dining vs Services vs Orders */}
      <div className="max-w-3xl mx-auto px-4 pt-4">
        <div className="flex items-center gap-2 bg-white p-1.5 rounded-2xl border border-[#ebebeb]">
          <button
            onClick={() => setActiveTab('dining')}
            className={`flex-1 py-2 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-all ${
              activeTab === 'dining'
                ? 'bg-[#ff385c] text-white shadow-xs'
                : 'text-[#6a6a6a] hover:text-[#222222]'
            }`}
          >
            <Utensils className="w-3.5 h-3.5" /> In-Room Dining ({foodItems.length})
          </button>
          <button
            onClick={() => setActiveTab('services')}
            className={`flex-1 py-2 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-all ${
              activeTab === 'services'
                ? 'bg-[#ff385c] text-white shadow-xs'
                : 'text-[#6a6a6a] hover:text-[#222222]'
            }`}
          >
            <Layers className="w-3.5 h-3.5" /> Room Services ({services.length})
          </button>
          <button
            onClick={() => setActiveTab('orders')}
            className={`flex-1 py-2 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-all ${
              activeTab === 'orders'
                ? 'bg-[#ff385c] text-white shadow-xs'
                : 'text-[#6a6a6a] hover:text-[#222222]'
            }`}
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
                className={`px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-colors ${
                  selectedFoodCategory === 'ALL'
                    ? 'bg-[#222222] text-white'
                    : 'bg-white text-[#6a6a6a] border border-[#dddddd]'
                }`}
              >
                All Menu
              </button>
              {categories.map((cat) => (
                <button
                  key={cat}
                  onClick={() => setSelectedFoodCategory(cat)}
                  className={`px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-colors ${
                    selectedFoodCategory === cat
                      ? 'bg-[#222222] text-white'
                      : 'bg-white text-[#6a6a6a] border border-[#dddddd]'
                  }`}
                >
                  {cat}
                </button>
              ))}

              <div className="h-4 w-px bg-[#dddddd] mx-1 shrink-0" />

              <button
                onClick={() => setDietFilter(dietFilter === 'VEG' ? 'ALL' : 'VEG')}
                className={`px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap flex items-center gap-1 transition-colors ${
                  dietFilter === 'VEG'
                    ? 'bg-emerald-600 text-white'
                    : 'bg-white text-emerald-700 border border-emerald-200'
                }`}
              >
                <Leaf className="w-3 h-3" /> Veg Only
              </button>
            </div>

            {/* Food Menu Items List or Empty State */}
            {filteredFood.length === 0 ? (
              <div className="bg-white border border-[#ebebeb] rounded-3xl p-10 text-center space-y-2 shadow-xs">
                <Utensils className="w-8 h-8 text-[#ff385c] mx-auto opacity-60" />
                <h3 className="font-bold text-sm text-[#222222]">No Menu Items Listed</h3>
                <p className="text-xs text-[#6a6a6a]">
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
                      className="bg-white border border-[#ebebeb] rounded-3xl p-4 shadow-xs flex flex-col justify-between"
                    >
                      <div>
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <div className="flex items-center gap-1.5">
                              <h3 className="font-bold text-sm text-[#222222]">{item.name}</h3>
                              {isVeg && (
                                <span className="p-0.5 rounded-full bg-emerald-50 text-emerald-600 border border-emerald-200 text-[10px]">
                                  <Leaf className="w-3 h-3" />
                                </span>
                              )}
                            </div>
                            <span className="text-[10px] font-mono text-[#6a6a6a] uppercase bg-[#fafafa] px-2 py-0.5 rounded-md mt-1 inline-block">
                              {item.category || 'Dining'}
                            </span>
                          </div>

                          <div className="font-bold text-sm text-[#222222]">
                            {hotel.currencySymbol || '$'}
                            {price}
                          </div>
                        </div>

                        {item.description && (
                          <p className="text-xs text-[#6a6a6a] mt-2 line-clamp-2">{item.description}</p>
                        )}
                      </div>

                      <div className="mt-4 pt-3 border-t border-[#ebebeb] flex items-center justify-between">
                        <span className="text-[11px] text-[#6a6a6a]">
                          ~{item.preparationTimeMinutes || 15} mins
                        </span>

                        {!item.isAvailable ? (
                          <span className="text-xs font-semibold text-rose-500 bg-rose-50 px-2.5 py-1 rounded-full">
                            Out of Stock
                          </span>
                        ) : inCartItem ? (
                          <div className="flex items-center gap-2 bg-[#f7f7f7] border border-[#dddddd] px-2 py-1 rounded-full">
                            <button
                              onClick={() => updateQuantity(item.id, -1)}
                              className="w-5 h-5 rounded-full bg-white flex items-center justify-center text-[#222222] font-bold shadow-xs hover:bg-[#ebebeb]"
                            >
                              -
                            </button>
                            <span className="text-xs font-mono font-bold">{inCartItem.quantity}</span>
                            <button
                              onClick={() => updateQuantity(item.id, 1)}
                              className="w-5 h-5 rounded-full bg-white flex items-center justify-center text-[#222222] font-bold shadow-xs hover:bg-[#ebebeb]"
                            >
                              +
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => addToCart(item)}
                            className="px-3.5 py-1.5 rounded-full bg-[#ff385c] hover:bg-[#e00b41] text-white text-xs font-bold shadow-xs transition-colors"
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
              <div className="bg-white border border-[#ebebeb] rounded-3xl p-10 text-center space-y-2 shadow-xs">
                <Layers className="w-8 h-8 text-[#ff385c] mx-auto opacity-60" />
                <h3 className="font-bold text-sm text-[#222222]">No Services Listed</h3>
                <p className="text-xs text-[#6a6a6a]">
                  The hotel has not configured any instant housekeeping or concierge services yet.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                {services.map((service) => (
                  <div
                    key={service.id}
                    className="bg-white border border-[#ebebeb] rounded-3xl p-4 shadow-xs flex flex-col justify-between"
                  >
                    <div>
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <h3 className="font-bold text-sm text-[#222222]">{service.name}</h3>
                          <span className="text-[10px] font-mono text-[#6a6a6a] uppercase bg-[#fafafa] px-2 py-0.5 rounded-md mt-1 inline-block">
                            {service.categoryId || 'Service'}
                          </span>
                        </div>
                        <span className="font-bold text-xs text-[#222222]">
                          {service.price > 0 ? `${hotel.currencySymbol || '$'}${service.price}` : 'Complimentary'}
                        </span>
                      </div>

                      {service.description && (
                        <p className="text-xs text-[#6a6a6a] mt-2">{service.description}</p>
                      )}
                    </div>

                    <div className="mt-4 pt-3 border-t border-[#ebebeb] flex items-center justify-between">
                      <span className="text-[11px] text-[#6a6a6a]">
                        ~{service.slaMinutes || service.estimatedTimeMinutes || 15} mins SLA
                      </span>

                      <button
                        onClick={() => setSelectedService(service)}
                        className="px-3.5 py-1.5 rounded-full bg-[#ff385c] hover:bg-[#e00b41] text-white text-xs font-bold shadow-xs transition-colors"
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
              <div className="bg-white border border-[#ebebeb] rounded-3xl p-10 text-center space-y-2 shadow-xs">
                <Clock className="w-8 h-8 text-[#ff385c] mx-auto opacity-60" />
                <h3 className="font-bold text-sm text-[#222222]">No Active Room Orders</h3>
                <p className="text-xs text-[#6a6a6a]">
                  When you order food or request services, track their real-time progress right here.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {guestOrders.map((ord) => (
                  <div
                    key={ord.id}
                    className="bg-white border border-[#ebebeb] rounded-3xl p-4 shadow-xs space-y-2.5"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-[#222222] capitalize">
                        {ord.type || 'Order'} Request
                      </span>
                      <span
                        className={`text-[10px] font-mono font-bold uppercase px-2.5 py-0.5 rounded-full ${
                          ['COMPLETED', 'DELIVERED'].includes((ord.status || '').toUpperCase())
                            ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                            : 'bg-[#fff0f3] text-[#ff385c] border border-[#ffd1da]'
                        }`}
                      >
                        {ord.status || 'PENDING'}
                      </span>
                    </div>

                    {ord.items && (
                      <div className="bg-[#fafafa] p-3 rounded-2xl text-xs space-y-1 border border-[#ebebeb]">
                        {ord.items.map((i: any, idx: number) => (
                          <div key={idx} className="flex justify-between">
                            <span>
                              {i.quantity || 1}x {i.name}
                            </span>
                            <span className="font-mono text-[#222222]">
                              {hotel.currencySymbol || '$'}
                              {(i.price || 0) * (i.quantity || 1)}
                            </span>
                          </div>
                        ))}
                        {ord.totalAmount > 0 && (
                          <div className="flex justify-between font-bold pt-1 border-t border-[#ebebeb]">
                            <span>Total:</span>
                            <span className="text-[#ff385c]">
                              {hotel.currencySymbol || '$'}
                              {ord.totalAmount}
                            </span>
                          </div>
                        )}
                      </div>
                    )}

                    {ord.instructions && (
                      <p className="text-xs text-[#6a6a6a] italic">Note: "{ord.instructions}"</p>
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
          <div className="bg-white rounded-t-3xl sm:rounded-3xl w-full max-w-md p-6 space-y-4 shadow-2xl border border-[#ebebeb] max-h-[85vh] flex flex-col justify-between">
            <div className="flex items-center justify-between border-b border-[#ebebeb] pb-3">
              <div className="flex items-center gap-2">
                <ShoppingBag className="w-5 h-5 text-[#ff385c]" />
                <h3 className="text-base font-bold text-[#222222]">In-Room Order Tray</h3>
              </div>
              <button
                onClick={() => setIsCartOpen(false)}
                className="p-1 rounded-full hover:bg-[#f7f7f7] text-[#6a6a6a]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="overflow-y-auto space-y-3 flex-1">
              {cart.length === 0 ? (
                <div className="text-center py-8 text-xs text-[#6a6a6a]">Your tray is empty.</div>
              ) : (
                cart.map((item) => (
                  <div
                    key={item.foodItem.id}
                    className="flex items-center justify-between p-3 rounded-2xl bg-[#fafafa] border border-[#ebebeb]"
                  >
                    <div>
                      <div className="text-xs font-bold text-[#222222]">{item.foodItem.name}</div>
                      <div className="text-[11px] text-[#6a6a6a]">
                        {hotel.currencySymbol || '$'}
                        {item.price} each
                      </div>
                    </div>

                    <div className="flex items-center gap-2 bg-white border border-[#dddddd] px-2 py-1 rounded-full">
                      <button
                        onClick={() => updateQuantity(item.foodItem.id, -1)}
                        className="w-5 h-5 rounded-full flex items-center justify-center font-bold text-xs text-[#222222] hover:bg-[#f7f7f7]"
                      >
                        -
                      </button>
                      <span className="text-xs font-mono font-bold">{item.quantity}</span>
                      <button
                        onClick={() => updateQuantity(item.foodItem.id, 1)}
                        className="w-5 h-5 rounded-full flex items-center justify-center font-bold text-xs text-[#222222] hover:bg-[#f7f7f7]"
                      >
                        +
                      </button>
                    </div>
                  </div>
                ))
              )}

              {cart.length > 0 && (
                <div>
                  <label className="block text-xs font-semibold text-[#222222] mb-1">
                    Special Kitchen Instructions
                  </label>
                  <textarea
                    rows={2}
                    value={specialInstructions}
                    onChange={(e) => setSpecialInstructions(e.target.value)}
                    placeholder="e.g. Extra spicy, no onions, bring cutlery..."
                    className="w-full bg-white border border-[#dddddd] rounded-xl p-2.5 text-xs text-[#222222] focus:outline-none focus:border-[#222222]"
                  />
                </div>
              )}
            </div>

            {cart.length > 0 && (
              <div className="border-t border-[#ebebeb] pt-3 space-y-3">
                <div className="flex items-center justify-between font-bold text-sm text-[#222222]">
                  <span>Total Amount:</span>
                  <span className="text-[#ff385c] font-mono">
                    {hotel.currencySymbol || '$'}
                    {cartTotal}
                  </span>
                </div>

                <button
                  onClick={handlePlaceOrder}
                  disabled={isSubmittingOrder}
                  className="w-full py-3 rounded-full bg-[#ff385c] hover:bg-[#e00b41] text-white text-xs font-bold shadow-sm transition-all disabled:opacity-50"
                >
                  {isSubmittingOrder ? 'Sending to Kitchen...' : `Place Room Order • Room ${room?.roomNumber || '101'}`}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Service Request Confirmation Modal */}
      {selectedService && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
          <div className="bg-white rounded-3xl w-full max-w-md p-6 space-y-4 shadow-2xl border border-[#ebebeb]">
            <div className="flex items-center justify-between border-b border-[#ebebeb] pb-3">
              <h3 className="text-base font-bold text-[#222222]">Request: {selectedService.name}</h3>
              <button
                onClick={() => setSelectedService(null)}
                className="p-1 rounded-full hover:bg-[#f7f7f7] text-[#6a6a6a]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3">
              <p className="text-xs text-[#6a6a6a]">{selectedService.description}</p>
              <div>
                <label className="block text-xs font-semibold text-[#222222] mb-1">
                  Specific Requests or Notes
                </label>
                <textarea
                  rows={2}
                  value={serviceNotes}
                  onChange={(e) => setServiceNotes(e.target.value)}
                  placeholder="e.g. Please deliver 2 extra towels to the bathroom..."
                  className="w-full bg-white border border-[#dddddd] rounded-xl p-2.5 text-xs text-[#222222] focus:outline-none focus:border-[#222222]"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-[#ebebeb]">
              <button
                type="button"
                onClick={() => setSelectedService(null)}
                className="px-4 py-2 rounded-full border border-[#dddddd] text-xs font-semibold text-[#6a6a6a]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleRequestService}
                disabled={isSubmittingOrder}
                className="px-5 py-2 rounded-full bg-[#ff385c] hover:bg-[#e00b41] text-xs font-bold text-white shadow-sm disabled:opacity-50"
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
