import React, { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { firestoreService } from '../../services/firestoreService';
import { Hotel } from '../../types';
import { CreateHotelWizardModal } from './CreateHotelWizardModal';
import {
  Building2,
  Plus,
  Search,
  Sliders,
  Eye,
  ShieldCheck,
  Smartphone,
  Layers,
  QrCode,
  Globe2,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  LogOut,
  MapPin,
  Mail,
  Phone,
  Trash2,
} from 'lucide-react';

export const SuperAdminDashboard: React.FC = () => {
  const { user, allHotels, switchHotelTenant, setActiveExperience, setGuestRoomToken, logout } = useAuth();
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [isWizardOpen, setIsWizardOpen] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const filteredHotels = allHotels.filter((h) => {
    const matchesSearch =
      h.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (h.hotelCode && h.hotelCode.toLowerCase().includes(searchQuery.toLowerCase())) ||
      (h.city && h.city.toLowerCase().includes(searchQuery.toLowerCase())) ||
      (h.country && h.country.toLowerCase().includes(searchQuery.toLowerCase())) ||
      (h.email && h.email.toLowerCase().includes(searchQuery.toLowerCase()));

    const matchesStatus = statusFilter === 'ALL' || h.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const totalRooms = allHotels.reduce((acc, h) => acc + (h.roomsCount || 0), 0);
  const activeTenants = allHotels.filter((h) => h.status === 'active' || h.status === 'ACTIVE').length;

  const handleLaunchHotelOS = (hotelId: string) => {
    switchHotelTenant(hotelId);
    setActiveExperience('hotel_os');
  };

  const handleDeleteHotel = async (h: Hotel) => {
    if (!window.confirm(`Are you sure you want to delete ${h.name}? This will permanently delete the hotel document, subcollections, and associated admin user.`)) {
      return;
    }

    try {
      setDeletingId(h.id);
      await firestoreService.deleteHotelDoc(h.id);
      if (h.adminCredentials?.email || h.email) {
        await firestoreService.deleteHotelUserAuth(h.adminCredentials?.email || h.email || '');
      }
    } catch (err: any) {
      alert(err.message || 'Failed to delete hotel');
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="min-h-screen bg-[#fafafa] text-[#222222]">
      {/* Top Header Navbar */}
      <header className="bg-white border-b border-[#ebebeb] px-6 py-4 sticky top-0 z-30 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-[#ff385c] to-[#e00b41] flex items-center justify-center text-white font-bold text-base shadow-sm">
            N
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-bold tracking-tight text-base text-[#222222]">NEXORA</span>
              <span className="text-[10px] font-bold uppercase bg-[#fff0f3] text-[#ff385c] border border-[#ffd1da] px-2 py-0.5 rounded-full font-mono">
                SUPER ADMIN
              </span>
            </div>
            <span className="text-[11px] text-[#6a6a6a]">Global Multi-Tenant Control Hub</span>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="text-right hidden sm:block">
            <div className="text-xs font-bold text-[#222222]">{user?.name || 'Super Admin'}</div>
            <div className="text-[11px] text-[#6a6a6a] font-mono">{user?.email}</div>
          </div>

          <button
            onClick={logout}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-full border border-[#dddddd] hover:border-[#222222] text-xs font-semibold text-[#6a6a6a] hover:text-[#222222] transition-colors"
          >
            <LogOut className="w-3.5 h-3.5" /> Sign Out
          </button>
        </div>
      </header>

      <div className="p-4 sm:p-6 lg:p-8 space-y-6 max-w-7xl mx-auto">
        {/* Banner */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white border border-[#ebebeb] p-6 rounded-3xl shadow-sm">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-2xl bg-[#fff0f3] border border-[#ffd1da] flex items-center justify-center text-[#ff385c] shadow-sm shrink-0">
              <ShieldCheck className="w-8 h-8" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-[#222222]">
                  Hotel Tenants Management
                </h1>
                <span className="bg-emerald-50 text-emerald-700 border border-emerald-200 text-[10px] uppercase font-mono px-2 py-0.5 rounded-full font-bold">
                  Firestore Connected
                </span>
              </div>
              <p className="text-xs sm:text-sm text-[#6a6a6a] mt-0.5">
                Provision new hotel properties, configure custom admin logins, and manage tenant records.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => setIsWizardOpen(true)}
              className="flex items-center gap-2 px-5 py-3 bg-[#ff385c] hover:bg-[#e00b41] text-white rounded-full text-xs sm:text-sm font-semibold shadow-sm transition-all transform active:scale-95"
            >
              <Plus className="w-4 h-4" /> Provision New Hotel
            </button>
          </div>
        </div>

        {/* Metrics Grid */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-white border border-[#ebebeb] p-5 rounded-3xl shadow-xs">
            <div className="flex items-center justify-between">
              <span className="text-xs text-[#6a6a6a] font-medium">Hotel Tenants</span>
              <Building2 className="w-4 h-4 text-[#ff385c]" />
            </div>
            <div className="text-2xl font-bold text-[#222222] mt-2 font-mono">{allHotels.length}</div>
            <div className="text-[11px] text-emerald-600 flex items-center gap-1 mt-1 font-medium">
              <CheckCircle2 className="w-3 h-3" /> {activeTenants} active properties
            </div>
          </div>

          <div className="bg-white border border-[#ebebeb] p-5 rounded-3xl shadow-xs">
            <div className="flex items-center justify-between">
              <span className="text-xs text-[#6a6a6a] font-medium">Security Isolation</span>
              <ShieldCheck className="w-4 h-4 text-emerald-600" />
            </div>
            <div className="text-2xl font-bold text-[#222222] mt-2 font-mono">Enforced</div>
            <div className="text-[11px] text-[#6a6a6a] mt-1">Firestore Rules & Claims</div>
          </div>

          <div className="bg-white border border-[#ebebeb] p-5 rounded-3xl shadow-xs">
            <div className="flex items-center justify-between">
              <span className="text-xs text-[#6a6a6a] font-medium">Data Storage</span>
              <Layers className="w-4 h-4 text-[#ff385c]" />
            </div>
            <div className="text-2xl font-bold text-[#222222] mt-2 font-mono">Firestore</div>
            <div className="text-[11px] text-[#6a6a6a] mt-1">hotels/{'{hotelId}'} subcollections</div>
          </div>

          <div className="bg-white border border-[#ebebeb] p-5 rounded-3xl shadow-xs">
            <div className="flex items-center justify-between">
              <span className="text-xs text-[#6a6a6a] font-medium">Auth Provider</span>
              <Globe2 className="w-4 h-4 text-blue-600" />
            </div>
            <div className="text-2xl font-bold text-[#222222] mt-2 font-mono">Firebase Auth</div>
            <div className="text-[11px] text-[#6a6a6a] mt-1">Admin SDK Custom Claims</div>
          </div>
        </div>

        {/* Search & Filter Bar */}
        <div className="flex flex-col sm:flex-row gap-3 items-center justify-between bg-white p-3.5 rounded-2xl border border-[#ebebeb]">
          <div className="relative w-full sm:w-80">
            <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-[#6a6a6a]" />
            <input
              type="text"
              placeholder="Search by hotel name, code, or city..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-[#fafafa] border border-[#dddddd] rounded-xl pl-9 pr-3.5 py-2 text-xs text-[#222222] focus:outline-none focus:border-[#222222] transition-colors"
            />
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto">
            <button
              onClick={() => setStatusFilter('ALL')}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${
                statusFilter === 'ALL'
                  ? 'bg-[#222222] text-white'
                  : 'bg-[#fafafa] text-[#6a6a6a] hover:bg-[#ebebeb]'
              }`}
            >
              All Hotels ({allHotels.length})
            </button>
            <button
              onClick={() => setStatusFilter('active')}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${
                statusFilter === 'active'
                  ? 'bg-emerald-600 text-white'
                  : 'bg-[#fafafa] text-[#6a6a6a] hover:bg-[#ebebeb]'
              }`}
            >
              Active
            </button>
          </div>
        </div>

        {/* Hotel Cards Grid or Empty State */}
        {filteredHotels.length === 0 ? (
          <div className="bg-white border border-[#ebebeb] rounded-3xl p-12 text-center space-y-4 shadow-xs">
            <div className="w-16 h-16 rounded-full bg-[#fff0f3] text-[#ff385c] border border-[#ffd1da] flex items-center justify-center mx-auto">
              <Building2 className="w-8 h-8" />
            </div>
            <div className="space-y-1 max-w-md mx-auto">
              <h3 className="text-base font-bold text-[#222222]">
                {searchQuery ? 'No matching hotels found' : 'No Hotels Provisioned Yet'}
              </h3>
              <p className="text-xs text-[#6a6a6a] leading-relaxed">
                {searchQuery
                  ? 'Try searching with a different name or hotel code.'
                  : 'Get started by provisioning your first hotel tenant. You will configure the property details and generate hotel admin credentials.'}
              </p>
            </div>
            {!searchQuery && (
              <button
                onClick={() => setIsWizardOpen(true)}
                className="px-5 py-2.5 rounded-full bg-[#ff385c] hover:bg-[#e00b41] text-white text-xs font-bold shadow-sm inline-flex items-center gap-2"
              >
                <Plus className="w-4 h-4" /> Provision First Hotel
              </button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredHotels.map((h) => {
              return (
                <div
                  key={h.id}
                  className="bg-white border border-[#ebebeb] hover:border-[#dddddd] rounded-3xl overflow-hidden shadow-xs hover:shadow-md transition-all flex flex-col justify-between"
                >
                  <div>
                    {/* Cover or Header color */}
                    <div
                      className="h-28 bg-[#f5f5f5] relative flex items-center justify-center p-4"
                      style={{
                        backgroundColor: h.branding?.primaryColor ? `${h.branding.primaryColor}15` : '#fff0f3',
                      }}
                    >
                      <div className="flex items-center gap-3">
                        <div
                          className="w-12 h-12 rounded-2xl flex items-center justify-center font-bold text-white shadow-sm text-lg"
                          style={{
                            backgroundColor: h.branding?.primaryColor || '#ff385c',
                          }}
                        >
                          {h.name.charAt(0)}
                        </div>
                        <div>
                          <span className="text-[10px] font-mono font-bold uppercase tracking-wider bg-white/90 border border-black/10 px-2 py-0.5 rounded-full text-[#222222]">
                            {h.hotelCode || h.id}
                          </span>
                        </div>
                      </div>

                      <span className="absolute top-3 right-3 px-2.5 py-0.5 rounded-full text-[10px] font-bold font-mono uppercase bg-emerald-50 text-emerald-700 border border-emerald-200">
                        {h.status || 'Active'}
                      </span>
                    </div>

                    {/* Hotel Details */}
                    <div className="p-5 space-y-3">
                      <div>
                        <h3 className="font-bold text-base text-[#222222] tracking-tight">{h.name}</h3>
                        <div className="flex items-center gap-1.5 text-xs text-[#6a6a6a] mt-1">
                          <MapPin className="w-3.5 h-3.5 shrink-0 text-[#ff385c]" />
                          <span className="truncate">
                            {[h.address, h.city, h.country].filter(Boolean).join(', ') || 'Address not specified'}
                          </span>
                        </div>
                      </div>

                      {/* Hotel Admin Login Credentials Card */}
                      <div className="p-3 bg-[#fafafa] border border-[#ebebeb] rounded-2xl text-xs space-y-1.5">
                        <div className="text-[10px] font-bold text-[#6a6a6a] uppercase flex items-center justify-between">
                          <span>Admin Login Profile</span>
                          <span className="font-mono text-[#ff385c]">hotel_admin</span>
                        </div>
                        <div className="flex items-center justify-between text-[11px]">
                          <span className="text-[#6a6a6a]">Email:</span>
                          <span className="font-mono font-bold text-[#222222] truncate max-w-[180px]">
                            {h.adminCredentials?.email || h.email}
                          </span>
                        </div>
                        <div className="flex items-center justify-between text-[11px]">
                          <span className="text-[#6a6a6a]">Admin Name:</span>
                          <span className="font-semibold text-[#222222]">
                            {h.adminCredentials?.name || 'Hotel Admin'}
                          </span>
                        </div>
                      </div>

                      {/* Contact & Currency */}
                      <div className="text-[11px] text-[#6a6a6a] flex items-center justify-between pt-1">
                        <span>Currency: <strong className="text-[#222222]">{h.currency || 'USD'} ({h.currencySymbol || '$'})</strong></span>
                        <span>{h.timezone || 'America/New_York'}</span>
                      </div>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="p-4 border-t border-[#ebebeb] bg-[#fafafa] flex items-center gap-2">
                    <button
                      onClick={() => handleLaunchHotelOS(h.id)}
                      className="flex-1 flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-full bg-[#ff385c] hover:bg-[#e00b41] text-white text-xs font-bold shadow-sm transition-colors"
                    >
                      <Eye className="w-3.5 h-3.5" /> Launch Dashboard
                    </button>

                    <button
                      onClick={() => handleDeleteHotel(h)}
                      disabled={deletingId === h.id}
                      title="Delete Hotel"
                      className="p-2.5 rounded-full bg-white hover:bg-rose-50 text-[#6a6a6a] hover:text-rose-600 border border-[#dddddd] hover:border-rose-200 transition-colors disabled:opacity-50"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Provision Hotel Wizard Modal */}
      {isWizardOpen && (
        <CreateHotelWizardModal
          isOpen={isWizardOpen}
          onClose={() => setIsWizardOpen(false)}
          onSuccess={() => {
            setIsWizardOpen(false);
          }}
        />
      )}
    </div>
  );
};
