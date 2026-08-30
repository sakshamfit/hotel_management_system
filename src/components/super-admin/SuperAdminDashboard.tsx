import React, { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { firestoreService } from '../../services/firestoreService';
import { deleteFolder } from '../../services/storageService';
import { Hotel } from '../../types';
import { CreateHotelWizardModal } from './CreateHotelWizardModal';
import { NewOrderAlertCenter } from '../common/NewOrderAlertCenter';
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
  KeyRound,
} from 'lucide-react';

export const SuperAdminDashboard: React.FC = () => {
  const { user, allHotels, switchHotelTenant, setActiveExperience, setGuestRoomToken, logout } = useAuth();
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [isWizardOpen, setIsWizardOpen] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [resettingId, setResettingId] = useState<string | null>(null);

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

  // Forgot-password flow: email a Supabase reset link to the hotel admin.
  // (The app never stores or knows the password — only Supabase Auth can reset it.)
  const handleResetPassword = async (h: Hotel) => {
    const email = h.loginEmail || h.adminCredentials?.email || h.email;
    if (!email) {
      alert('No login email is set for this hotel.');
      return;
    }
    if (!window.confirm(`Send a password reset email to ${email}?`)) return;

    try {
      setResettingId(h.id);
      await firestoreService.sendHotelPasswordReset(email);
      alert(`Password reset email sent to ${email}. The hotel admin can set a new password from that link.`);
    } catch (err: any) {
      alert(err?.message || 'Failed to send the reset email. Please try again.');
    } finally {
      setResettingId(null);
    }
  };

  const handleDeleteHotel = async (h: Hotel) => {
    if (!window.confirm(`Are you sure you want to delete ${h.name}? This will permanently delete the hotel record, all related data, and the associated admin user.`)) {
      return;
    }

    try {
      setDeletingId(h.id);
      await firestoreService.deleteHotelDoc(h.id);
      if (h.adminCredentials?.email || h.email) {
        await firestoreService.deleteHotelUserAuth(h.adminCredentials?.email || h.email || '');
      }
      // Cleanup: purge all uploaded images under hotels/{hotelId}/ in Storage
      await deleteFolder(`hotels/${h.id}`);
    } catch (err: any) {
      alert(err.message || 'Failed to delete hotel');
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="min-h-screen bg-canvas-soft text-ink">
      {/* Top Header Navbar */}
      <header className="bg-canvas border-b border-hairline px-6 py-4 sticky top-0 z-30 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-primary flex items-center justify-center text-on-primary font-bold text-base">
            N
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="t-heading-lg text-ink tracking-tight" style={{ fontSize: 16 }}>NEXORA</span>
              <span className="font-mono text-[10px] font-semibold uppercase tracking-wide bg-accent-tint text-primary-deep border border-accent-soft rounded px-1.5 py-0.5">
                Super Admin
              </span>
            </div>
            <span className="t-caption text-ink-mute" style={{ fontSize: 11 }}>Global Multi-Tenant Control Hub</span>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="text-right hidden sm:block">
            <div className="text-xs font-bold text-ink">{user?.name || 'Super Admin'}</div>
            <div className="text-[11px] text-ink-mute font-mono">{user?.email}</div>
          </div>

          <button
            onClick={logout}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-hairline hover:border-hairline-dark text-xs font-semibold text-ink-mute hover:text-ink transition-colors"
          >
            <LogOut className="w-3.5 h-3.5" /> Sign Out
          </button>
        </div>
      </header>

      <div className="p-4 sm:p-6 lg:p-8 space-y-6 max-w-7xl mx-auto">
        {/* Banner */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 card-feature-light p-6 elev-1">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-xl bg-accent-tint border border-accent-soft flex items-center justify-center text-primary shrink-0">
              <ShieldCheck className="w-8 h-8" />
            </div>
            <div>
              <div className="flex items-center gap-2.5 flex-wrap">
                <h1 className="t-display-lg tracking-tight">
                  Hotel Tenants Management
                </h1>
                <span className="bg-success-tint text-success-deep border border-success-line font-mono text-[10px] uppercase px-2 py-0.5 rounded font-semibold">
                  Supabase Connected
                </span>
              </div>
              <p className="t-caption text-ink-mute mt-1">
                Provision new hotel properties, configure custom admin logins, and manage tenant records.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => setIsWizardOpen(true)}
              className="flex items-center gap-2 px-5 py-3 bg-[#0066cc] hover:bg-[#004fa3] text-white rounded-lg text-xs sm:text-sm font-semibold shadow-sm transition-all transform active:scale-95"
            >
              <Plus className="w-4 h-4" /> Provision New Hotel
            </button>
          </div>
        </div>

        {/* Metrics Grid */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-white border border-hairline p-5 rounded-xl shadow-xs">
            <div className="flex items-center justify-between">
              <span className="text-xs text-ink-mute font-medium">Hotel Tenants</span>
              <Building2 className="w-4 h-4 text-[#0066cc]" />
            </div>
            <div className="text-2xl font-bold text-ink mt-2 font-mono">{allHotels.length}</div>
            <div className="text-[11px] text-success-mid flex items-center gap-1 mt-1 font-medium">
              <CheckCircle2 className="w-3 h-3" /> {activeTenants} active properties
            </div>
          </div>

          <div className="bg-white border border-hairline p-5 rounded-xl shadow-xs">
            <div className="flex items-center justify-between">
              <span className="text-xs text-ink-mute font-medium">Security Isolation</span>
              <ShieldCheck className="w-4 h-4 text-success-mid" />
            </div>
            <div className="text-2xl font-bold text-ink mt-2 font-mono">Enforced</div>
            <div className="text-[11px] text-ink-mute mt-1">Row Level Security</div>
          </div>

          <div className="bg-white border border-hairline p-5 rounded-xl shadow-xs">
            <div className="flex items-center justify-between">
              <span className="text-xs text-ink-mute font-medium">Data Storage</span>
              <Layers className="w-4 h-4 text-[#0066cc]" />
            </div>
            <div className="text-2xl font-bold text-ink mt-2 font-mono">Postgres</div>
            <div className="text-[11px] text-ink-mute mt-1">Row-scoped by hotel_id</div>
          </div>

          <div className="bg-white border border-hairline p-5 rounded-xl shadow-xs">
            <div className="flex items-center justify-between">
              <span className="text-xs text-ink-mute font-medium">Auth Provider</span>
              <Globe2 className="w-4 h-4 text-success-mid" />
            </div>
            <div className="text-2xl font-bold text-ink mt-2 font-mono">Supabase Auth</div>
            <div className="text-[11px] text-ink-mute mt-1">profiles row scoped per hotel</div>
          </div>
        </div>

        {/* Search & Filter Bar */}
        <div className="flex flex-col sm:flex-row gap-3 items-center justify-between bg-white p-3.5 rounded-lg border border-hairline">
          <div className="relative w-full sm:w-80">
            <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-mute" />
            <input
              type="text"
              placeholder="Search by hotel name, code, or city..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-canvas-soft border border-hairline rounded-xl pl-9 pr-3.5 py-2 text-xs text-ink focus:outline-none focus:border-ink transition-colors"
            />
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto">
            <button
              onClick={() => setStatusFilter('ALL')}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${
                statusFilter === 'ALL'
                  ? 'bg-ink text-white'
                  : 'bg-canvas-soft text-ink-mute hover:bg-hairline'
              }`}
            >
              All Hotels ({allHotels.length})
            </button>
            <button
              onClick={() => setStatusFilter('active')}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${
                statusFilter === 'active'
                  ? 'bg-success-mid text-white'
                  : 'bg-canvas-soft text-ink-mute hover:bg-hairline'
              }`}
            >
              Active
            </button>
          </div>
        </div>

        {/* Hotel Cards Grid or Empty State */}
        {filteredHotels.length === 0 ? (
          <div className="bg-white border border-hairline rounded-xl p-12 text-center space-y-4 shadow-xs">
            <div className="w-16 h-16 rounded-full bg-accent-tint text-[#0066cc] border border-accent-soft flex items-center justify-center mx-auto">
              <Building2 className="w-8 h-8" />
            </div>
            <div className="space-y-1 max-w-md mx-auto">
              <h3 className="text-base font-bold text-ink">
                {searchQuery ? 'No matching hotels found' : 'No Hotels Provisioned Yet'}
              </h3>
              <p className="text-xs text-ink-mute leading-relaxed">
                {searchQuery
                  ? 'Try searching with a different name or hotel code.'
                  : 'Get started by provisioning your first hotel tenant. You will configure the property details and generate hotel admin credentials.'}
              </p>
            </div>
            {!searchQuery && (
              <button
                onClick={() => setIsWizardOpen(true)}
                className="px-5 py-2.5 rounded-lg bg-[#0066cc] hover:bg-[#004fa3] text-white text-xs font-bold shadow-sm inline-flex items-center gap-2"
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
                  className="bg-white border border-hairline hover:border-hairline rounded-xl overflow-hidden shadow-xs hover:shadow-md transition-all flex flex-col justify-between"
                >
                  <div>
                    {/* Cover banner (uploaded to Storage) or brand color */}
                    <div
                      className="h-28 relative flex items-center justify-center p-4 overflow-hidden"
                      style={{
                        backgroundColor: h.branding?.primaryColor ? `${h.branding.primaryColor}15` : '#ece6fb',
                      }}
                    >
                      {h.branding?.coverImageUrl && (
                        <img
                          src={h.branding.coverImageUrl}
                          alt=""
                          className="absolute inset-0 w-full h-full object-cover"
                        />
                      )}
                      <div className={`flex items-center gap-3 ${h.branding?.coverImageUrl ? 'relative' : ''}`}>
                        <div
                          className="w-12 h-12 rounded-lg flex items-center justify-center font-bold text-white shadow-sm text-lg"
                          style={{
                            backgroundColor: h.branding?.primaryColor || '#0066cc',
                          }}
                        >
                          {h.name.charAt(0)}
                        </div>
                        <div>
                          <span className="text-[10px] font-mono font-bold uppercase tracking-wider bg-white/90 border border-black/10 px-2 py-0.5 rounded-full text-ink">
                            {h.hotelCode || h.id}
                          </span>
                        </div>
                      </div>

                      <span className="absolute top-3 right-3 px-2.5 py-0.5 rounded-full text-[10px] font-bold font-mono uppercase bg-success-tint text-success-deep border border-success-line">
                        {h.status || 'Active'}
                      </span>
                    </div>

                    {/* Hotel Details */}
                    <div className="p-5 space-y-3">
                      <div>
                        <h3 className="font-bold text-base text-ink tracking-tight">{h.name}</h3>
                        <div className="flex items-center gap-1.5 text-xs text-ink-mute mt-1">
                          <MapPin className="w-3.5 h-3.5 shrink-0 text-[#0066cc]" />
                          <span className="truncate">
                            {[h.address, h.city, h.country].filter(Boolean).join(', ') || 'Address not specified'}
                          </span>
                        </div>
                      </div>

                      {/* Hotel Admin Login Credentials Card (email only — the password lives exclusively in Supabase Auth) */}
                      <div className="p-3 bg-canvas-soft border border-hairline rounded-lg text-xs space-y-1.5">
                        <div className="text-[10px] font-bold text-ink-mute uppercase flex items-center justify-between">
                          <span>Admin Login Profile</span>
                          <span className="font-mono text-[#0066cc]">hotel_admin</span>
                        </div>
                        <div className="flex items-center justify-between text-[11px]">
                          <span className="text-ink-mute">Email:</span>
                          <span className="font-mono font-bold text-ink truncate max-w-[180px]">
                            {h.loginEmail || h.adminCredentials?.email || h.email}
                          </span>
                        </div>
                        <div className="flex items-center justify-between text-[11px]">
                          <span className="text-ink-mute">Admin Name:</span>
                          <span className="font-semibold text-ink">
                            {h.adminCredentials?.name || 'Hotel Admin'}
                          </span>
                        </div>
                      </div>

                      {/* Contact & Currency */}
                      <div className="text-[11px] text-ink-mute flex items-center justify-between pt-1">
                        <span>Currency: <strong className="text-ink">{h.currency || 'USD'} ({h.currencySymbol || '$'})</strong></span>
                        <span>{h.timezone || 'America/New_York'}</span>
                      </div>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="p-4 border-t border-hairline bg-canvas-soft flex items-center gap-2">
                    <button
                      onClick={() => handleLaunchHotelOS(h.id)}
                      className="flex-1 flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-lg bg-[#0066cc] hover:bg-[#004fa3] text-white text-xs font-bold shadow-sm transition-colors"
                    >
                      <Eye className="w-3.5 h-3.5" /> Launch Dashboard
                    </button>

                    <button
                      onClick={() => handleResetPassword(h)}
                      disabled={resettingId === h.id}
                      title="Reset Password (emails a reset link to the hotel admin)"
                      className="p-2.5 rounded-full bg-white hover:bg-accent-tint text-ink-mute hover:text-[#0066cc] border border-hairline hover:border-accent-soft transition-colors disabled:opacity-50"
                    >
                      <KeyRound className="w-4 h-4" />
                    </button>

                    <button
                      onClick={() => handleDeleteHotel(h)}
                      disabled={deletingId === h.id}
                      title="Delete Hotel"
                      className="p-2.5 rounded-full bg-white hover:bg-accent-tint text-ink-mute hover:text-[#0066cc] border border-hairline hover:border-accent-soft transition-colors disabled:opacity-50"
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

      {/* Audio + voice new-order alerts (real-time, across all hotels) */}
      <NewOrderAlertCenter hotels={allHotels} />
    </div>
  );
};
