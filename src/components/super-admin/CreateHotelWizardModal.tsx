import React, { useState } from 'react';
import { firestoreService } from '../../services/firestoreService';
import { uploadImage, extensionForFile, deleteFolder } from '../../services/storageService';
import { ImageUploader } from '../common/ImageUploader';
import {
  X,
  Building2,
  Palette,
  CheckCircle2,
  UserPlus,
  Layers,
  ArrowRight,
  ArrowLeft,
  AlertCircle,
  Lock,
  Mail,
  User,
  Phone,
  MapPin,
  Globe,
  Sparkles,
  Copy,
  Check,
} from 'lucide-react';
import confetti from 'canvas-confetti';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export const CreateHotelWizardModal: React.FC<Props> = ({ isOpen, onClose, onSuccess }) => {
  const [step, setStep] = useState<number>(1);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Step 1: Hotel Information (No fake placeholder defaults - real input required)
  const [hotelName, setHotelName] = useState('');
  const [legalName, setLegalName] = useState('');
  const [hotelCode, setHotelCode] = useState('');
  const [address, setAddress] = useState('');
  const [city, setCity] = useState('');
  const [state, setState] = useState('');
  const [country, setCountry] = useState('');
  const [postalCode, setPostalCode] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [currency, setCurrency] = useState('USD');
  const [timezone, setTimezone] = useState('America/New_York');

  // Step 2: Branding & Appearance (images upload to Storage after the hotel doc is created)
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [primaryColor, setPrimaryColor] = useState('#1b1938');
  const [welcomeMessage, setWelcomeMessage] = useState('Welcome to our hotel. Explore amenities, place room service orders, and request assistance.');

  // Step 3: Modules Configuration
  const [modules, setModules] = useState({
    guestQrSystem: true,
    roomService: true,
    foodAndBeverage: true,
    housekeeping: true,
    toiletries: true,
    laundry: true,
    maintenance: true,
    receptionRequests: true,
    spaAndWellness: false,
    poolAndGym: false,
    concierge: true,
    guestFeedback: true,
    notifications: true,
    analytics: true,
    dailyReports: true,
    autoDailyReset: true,
    requireCallConfirmation: false,
  });

  // Step 4: Hotel Admin Account (Email & Password for login).
  // The password is ONLY ever sent to Firebase Auth (via the server endpoint)
  // — it is never written to Firestore. It is shown to the super admin exactly
  // once right after creation, then discarded from memory.
  const [adminName, setAdminName] = useState('');
  const [adminEmail, setAdminEmail] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [adminPhone, setAdminPhone] = useState('');

  // One-time credentials reveal after successful creation
  const [revealedCredentials, setRevealedCredentials] = useState<{
    hotelName: string;
    email: string;
    password: string;
  } | null>(null);
  const [passwordCopied, setPasswordCopied] = useState(false);

  if (!isOpen) return null;


  const validateStep1 = () => {
    if (!hotelName.trim()) return 'Hotel Name is required.';
    if (!hotelCode.trim()) return 'Unique Hotel Code/ID is required.';
    if (!address.trim()) return 'Hotel Address is required.';
    if (!city.trim()) return 'City is required.';
    if (!country.trim()) return 'Country is required.';
    if (!phone.trim()) return 'Hotel Contact Phone is required.';
    if (!email.trim()) return 'Hotel Contact Email is required.';
    return null;
  };

  const validateStep4 = () => {
    if (!adminName.trim()) return 'Hotel Admin Name is required.';
    if (!adminEmail.trim()) return 'Hotel Admin Login Email is required.';
    if (!adminPassword || adminPassword.length < 6) return 'Password must be at least 6 characters long.';
    return null;
  };

  const handleNext = () => {
    setError(null);
    if (step === 1) {
      const err = validateStep1();
      if (err) {
        setError(err);
        return;
      }
      if (!adminEmail) {
        setAdminEmail(email || `admin@${hotelCode.toLowerCase().replace(/[^a-z0-9]/g, '')}.com`);
      }
      if (!adminName) {
        setAdminName(`${hotelName} Manager`);
      }
    }
    setStep((prev) => Math.min(4, prev + 1));
  };

  const handleBack = () => {
    setError(null);
    setStep((prev) => Math.max(1, prev - 1));
  };

  const handleSubmit = async () => {
    const errStep1 = validateStep1();
    if (errStep1) {
      setError(errStep1);
      setStep(1);
      return;
    }

    const errStep4 = validateStep4();
    if (errStep4) {
      setError(errStep4);
      setStep(4);
      return;
    }

    try {
      setIsSubmitting(true);
      setError(null);

      const currencySymbol =
        currency === 'USD' ? '$' : currency === 'EUR' ? '€' : currency === 'AED' ? 'AED ' : currency === 'GBP' ? '£' : '₹';

      // Generate the tenant id. Must be a UUID: hotels.id (and every FK
      // hotel_id / profile.hotel_id) is a `uuid` column in Postgres.
      const hotelId = crypto.randomUUID();

      // 1. Save hotel document to Firestore (hotels/{hotelId})
      await firestoreService.createHotelDoc(hotelId, {
        name: hotelName.trim(),
        legalName: legalName.trim() || hotelName.trim(),
        hotelCode: hotelCode.toUpperCase().trim(),
        address: address.trim(),
        city: city.trim(),
        state: state.trim(),
        country: country.trim(),
        postalCode: postalCode.trim(),
        phone: phone.trim(),
        email: email.trim(),
        currency,
        currencySymbol,
        timezone,
        status: 'active',
        // loginEmail is stored for reference in the admin panel; the password
        // is deliberately NOT persisted anywhere in Firestore.
        loginEmail: adminEmail.trim(),
        branding: {
          logoUrl: '',
          coverImageUrl: '',
          primaryColor,
          secondaryColor: '#292827',
          accentColor: primaryColor,
          fontFamily: 'Inter, sans-serif',
          welcomeMessage,
        },
        modules,
        adminCredentials: {
          name: adminName.trim(),
          email: adminEmail.trim(),
        },
        roomsCount: 0,
      });

      // 1b. Upload branding images to Storage under hotels/{hotelId}/branding/
      //     and save the download URLs back onto the hotel document.
      let uploadedLogoUrl = '';
      let uploadedCoverUrl = '';
      try {
        if (logoFile) {
          uploadedLogoUrl = await uploadImage({
            file: logoFile,
            path: `hotels/${hotelId}/branding/logo.${extensionForFile(logoFile)}`,
          });
        }
        if (coverFile) {
          uploadedCoverUrl = await uploadImage({
            file: coverFile,
            path: `hotels/${hotelId}/branding/cover.${extensionForFile(coverFile)}`,
          });
        }
        if (uploadedLogoUrl || uploadedCoverUrl) {
          await firestoreService.updateHotelDoc(hotelId, {
            branding: {
              logoUrl: uploadedLogoUrl,
              coverImageUrl: uploadedCoverUrl,
              primaryColor,
              secondaryColor: '#292827',
              accentColor: primaryColor,
              fontFamily: 'Inter, sans-serif',
              welcomeMessage,
            },
          });
        }
      } catch (imgErr: any) {
        // The hotel itself was created successfully — images are non-critical.
        console.warn('Branding image upload failed (hotel was still created):', imgErr?.message);
      }

      // 2. Create Firebase Auth user for hotel_admin (secondary app instance so
      //    the Super Admin's session is unaffected) and store the role in users/{uid}
      try {
        await firestoreService.createHotelLogin(
          hotelId,
          hotelName.trim(),
          adminEmail.trim(),
          adminPassword.trim(),
          adminName.trim(),
          adminPhone.trim()
        );
      } catch (authErr: any) {
        // Auth user creation failing must not orphan the hotel document
        await firestoreService.deleteHotelDoc(hotelId).catch(() => undefined);
        await deleteFolder(`hotels/${hotelId}`).catch(() => undefined);
        throw authErr;
      }

      try {
        confetti({
          particleCount: 80,
          spread: 70,
          origin: { y: 0.6 },
        });
      } catch (e) {
        // Confetti optional
      }

      // Show the generated credentials exactly ONCE — the password lives only
      // in this component's memory and is cleared when the admin closes this.
      setRevealedCredentials({
        hotelName: hotelName.trim(),
        email: adminEmail.trim(),
        password: adminPassword,
      });
    } catch (err: any) {
      console.error('Error creating hotel:', err);
      setError(err.message || 'Failed to provision hotel. Please check details and try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleFinishReveal = () => {
    // Discard the password from memory — it is not retrievable anywhere after this.
    setRevealedCredentials(null);
    setPasswordCopied(false);
    onSuccess();
    onClose();
  };

  const handleCopyPassword = async () => {
    if (!revealedCredentials) return;
    try {
      await navigator.clipboard.writeText(revealedCredentials.password);
      setPasswordCopied(true);
      setTimeout(() => setPasswordCopied(false), 2000);
    } catch {
      // Clipboard API unavailable — admin can still select the text manually
    }
  };

  // One-time credentials reveal — replaces the wizard immediately after the
  // hotel account is created. The password exists only in this screen.
  if (revealedCredentials) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
        <div className="bg-canvas rounded-xl w-full max-w-md p-6 space-y-5 shadow-2xl border border-hairline">
          <div className="text-center space-y-3">
            <div className="w-14 h-14 rounded-xl bg-teal-tint border border-teal-line text-teal-deep flex items-center justify-center mx-auto">
              <CheckCircle2 className="w-7 h-7" />
            </div>
            <h2 className="t-display-md">{revealedCredentials.hotelName} is live</h2>
            <p className="t-caption text-ink-mute">
              The hotel admin account was created in Supabase Auth. Save the password now — it will
              not be shown again.
            </p>
          </div>

          <div className="card-feature-row p-4 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <span className="t-caption text-ink-mute shrink-0">Login Email</span>
              <span className="font-mono font-semibold text-ink text-xs truncate">
                {revealedCredentials.email}
              </span>
            </div>

            <div className="space-y-1.5">
              <span className="t-caption text-ink-mute">Password</span>
              <div className="flex items-center gap-2">
                <code className="flex-1 bg-canvas border border-hairline rounded-lg px-3 py-2.5 font-mono text-sm text-ink select-all truncate">
                  {revealedCredentials.password}
                </code>
                <button
                  type="button"
                  onClick={handleCopyPassword}
                  className="btn-primary-dark px-3.5 py-2.5 text-xs shrink-0"
                >
                  {passwordCopied ? (
                    <>
                      <Check className="w-3.5 h-3.5" /> Copied
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" /> Copy
                    </>
                  )}
                </button>
              </div>
            </div>

            <p className="t-micro text-ink-faint flex items-center gap-1.5">
              <Lock className="w-3 h-3" />
              Stored only in Supabase Auth — never in the database.
            </p>
          </div>

          <div className="bg-violet-tint border border-violet-soft rounded-lg px-3.5 py-2.5 text-xs text-primary-deep flex items-start gap-2 font-medium">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>Save this password now — it will not be shown again.</span>
          </div>

          <button type="button" onClick={handleFinishReveal} className="btn-primary-dark w-full py-3">
            I&rsquo;ve Saved It — Done
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-fadeIn">
      <div className="bg-white rounded-xl w-full max-w-2xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden border border-[#e8e4dd]">
        {/* Modal Header */}
        <div className="p-6 border-b border-[#e8e4dd] flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-[#ece6fb] text-[#1b1938] border border-[#c9b4fa] flex items-center justify-center font-bold">
              <Building2 className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-[#292827]">Add New Hotel Property</h2>
              <p className="text-xs text-[#73706d]">Step {step} of 4 • Provision isolated multi-tenant hotel</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-full hover:bg-[#fafaf8] text-[#73706d] hover:text-[#292827] transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Step Indicators */}
        <div className="px-6 pt-4 pb-2 border-b border-[#e8e4dd] bg-[#fafaf8]">
          <div className="flex items-center justify-between">
            {[
              { num: 1, label: 'Hotel Profile', icon: Building2 },
              { num: 2, label: 'Branding', icon: Palette },
              { num: 3, label: 'Modules', icon: Layers },
              { num: 4, label: 'Admin Login', icon: UserPlus },
            ].map((s) => {
              const Icon = s.icon;
              const isCurrent = step === s.num;
              const isPast = step > s.num;
              return (
                <div key={s.num} className="flex items-center gap-2">
                  <div
                    className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-all ${
                      isPast
                        ? 'bg-[#155555] text-white'
                        : isCurrent
                        ? 'bg-[#1b1938] text-white ring-2 ring-[#c9b4fa]'
                        : 'bg-[#e8e4dd] text-[#73706d]'
                    }`}
                  >
                    {isPast ? <CheckCircle2 className="w-4 h-4" /> : s.num}
                  </div>
                  <span
                    className={`text-xs font-semibold hidden sm:inline ${
                      isCurrent ? 'text-[#292827]' : 'text-[#73706d]'
                    }`}
                  >
                    {s.label}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Modal Body */}
        <div className="p-6 overflow-y-auto flex-1 space-y-4">
          {error && (
            <div className="p-3.5 bg-[#ece6fb] border border-[#c9b4fa] rounded-lg text-xs text-[#1b1938] flex items-start gap-2.5">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {/* STEP 1: Hotel Profile Information */}
          {step === 1 && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="sm:col-span-2">
                  <label className="block text-xs font-semibold text-[#292827] mb-1">
                    Hotel Property Name <span className="text-[#1b1938]">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={hotelName}
                    onChange={(e) => setHotelName(e.target.value)}
                    placeholder="e.g. Royal Grand Resort & Spa"
                    className="w-full bg-white border border-[#e8e4dd] rounded-xl px-3.5 py-2.5 text-sm text-[#292827] focus:outline-none focus:border-[#292827]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#292827] mb-1">
                    Unique Hotel Code/ID <span className="text-[#1b1938]">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={hotelCode}
                    onChange={(e) => setHotelCode(e.target.value.toUpperCase())}
                    placeholder="e.g. RGR-001"
                    className="w-full bg-white border border-[#e8e4dd] rounded-xl px-3.5 py-2.5 text-sm text-[#292827] font-mono uppercase focus:outline-none focus:border-[#292827]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#292827] mb-1">
                    Legal / Business Name
                  </label>
                  <input
                    type="text"
                    value={legalName}
                    onChange={(e) => setLegalName(e.target.value)}
                    placeholder="e.g. Royal Hospitality Ltd"
                    className="w-full bg-white border border-[#e8e4dd] rounded-xl px-3.5 py-2.5 text-sm text-[#292827] focus:outline-none focus:border-[#292827]"
                  />
                </div>

                <div className="sm:col-span-2">
                  <label className="block text-xs font-semibold text-[#292827] mb-1">
                    Street Address <span className="text-[#1b1938]">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    placeholder="e.g. 104 Ocean View Boulevard"
                    className="w-full bg-white border border-[#e8e4dd] rounded-xl px-3.5 py-2.5 text-sm text-[#292827] focus:outline-none focus:border-[#292827]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#292827] mb-1">
                    City <span className="text-[#1b1938]">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={city}
                    onChange={(e) => setCity(e.target.value)}
                    placeholder="e.g. Miami"
                    className="w-full bg-white border border-[#e8e4dd] rounded-xl px-3.5 py-2.5 text-sm text-[#292827] focus:outline-none focus:border-[#292827]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#292827] mb-1">
                    Country <span className="text-[#1b1938]">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={country}
                    onChange={(e) => setCountry(e.target.value)}
                    placeholder="e.g. United States"
                    className="w-full bg-white border border-[#e8e4dd] rounded-xl px-3.5 py-2.5 text-sm text-[#292827] focus:outline-none focus:border-[#292827]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#292827] mb-1">
                    Hotel Contact Phone <span className="text-[#1b1938]">*</span>
                  </label>
                  <input
                    type="tel"
                    required
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="e.g. +1 305 555 0199"
                    className="w-full bg-white border border-[#e8e4dd] rounded-xl px-3.5 py-2.5 text-sm text-[#292827] focus:outline-none focus:border-[#292827]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#292827] mb-1">
                    Hotel Official Email <span className="text-[#1b1938]">*</span>
                  </label>
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="e.g. info@royalgrand.com"
                    className="w-full bg-white border border-[#e8e4dd] rounded-xl px-3.5 py-2.5 text-sm text-[#292827] focus:outline-none focus:border-[#292827]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#292827] mb-1">
                    Operating Currency <span className="text-[#1b1938]">*</span>
                  </label>
                  <select
                    value={currency}
                    onChange={(e) => setCurrency(e.target.value)}
                    className="w-full bg-white border border-[#e8e4dd] rounded-xl px-3.5 py-2.5 text-sm text-[#292827] focus:outline-none focus:border-[#292827]"
                  >
                    <option value="USD">USD ($)</option>
                    <option value="EUR">EUR (€)</option>
                    <option value="GBP">GBP (£)</option>
                    <option value="AED">AED (AED)</option>
                    <option value="INR">INR (₹)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#292827] mb-1">
                    Hotel Timezone <span className="text-[#1b1938]">*</span>
                  </label>
                  <select
                    value={timezone}
                    onChange={(e) => setTimezone(e.target.value)}
                    className="w-full bg-white border border-[#e8e4dd] rounded-xl px-3.5 py-2.5 text-sm text-[#292827] focus:outline-none focus:border-[#292827]"
                  >
                    <option value="America/New_York">America/New_York (EST)</option>
                    <option value="America/Chicago">America/Chicago (CST)</option>
                    <option value="America/Los_Angeles">America/Los_Angeles (PST)</option>
                    <option value="Europe/London">Europe/London (GMT)</option>
                    <option value="Europe/Paris">Europe/Paris (CET)</option>
                    <option value="Asia/Dubai">Asia/Dubai (GST)</option>
                    <option value="Asia/Kolkata">Asia/Kolkata (IST)</option>
                    <option value="Asia/Singapore">Asia/Singapore (SGT)</option>
                    <option value="Asia/Tokyo">Asia/Tokyo (JST)</option>
                  </select>
                </div>
              </div>
            </div>
          )}

          {/* STEP 2: Branding & Appearance */}
          {step === 2 && (
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-[#292827] mb-1">
                  Brand Theme Color
                </label>
                <div className="flex items-center gap-3">
                  <input
                    type="color"
                    value={primaryColor}
                    onChange={(e) => setPrimaryColor(e.target.value)}
                    className="w-10 h-10 rounded-xl cursor-pointer border border-[#e8e4dd] p-1"
                  />
                  <input
                    type="text"
                    value={primaryColor}
                    onChange={(e) => setPrimaryColor(e.target.value)}
                    className="bg-white border border-[#e8e4dd] rounded-xl px-3 py-2 text-xs font-mono text-[#292827]"
                  />
                </div>
              </div>

              <ImageUploader
                label="Hotel Logo (Optional)"
                hint="Square logo shown in the sidebar and guest portal header."
                onFileChange={setLogoFile}
                thumbClass="h-20"
              />

              <ImageUploader
                label="Cover Banner Image (Optional)"
                hint="Wide banner photo of the property, shown on the hotel profile."
                onFileChange={setCoverFile}
                thumbClass="h-20"
              />

              <div>
                <label className="block text-xs font-semibold text-[#292827] mb-1">
                  In-Room Guest Welcome Message
                </label>
                <textarea
                  rows={3}
                  value={welcomeMessage}
                  onChange={(e) => setWelcomeMessage(e.target.value)}
                  placeholder="Welcome to our hotel..."
                  className="w-full bg-white border border-[#e8e4dd] rounded-xl p-3 text-sm text-[#292827] focus:outline-none focus:border-[#292827]"
                />
              </div>
            </div>
          )}

          {/* STEP 3: Modules Configuration */}
          {step === 3 && (
            <div className="space-y-3">
              <p className="text-xs text-[#73706d]">
                Enable or disable specific operational modules for this hotel property:
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {[
                  { key: 'guestQrSystem', label: 'Room QR In-Room Portal' },
                  { key: 'foodAndBeverage', label: 'Food & Beverage / Restaurant' },
                  { key: 'roomService', label: 'In-Room Dining Orders' },
                  { key: 'housekeeping', label: 'Housekeeping & Turndown' },
                  { key: 'laundry', label: 'Laundry Service' },
                  { key: 'toiletries', label: 'Amenities & Toiletries' },
                  { key: 'maintenance', label: 'Engineering & Maintenance' },
                  { key: 'receptionRequests', label: 'Front Desk Requests' },
                  { key: 'concierge', label: 'Concierge & Travel Desk' },
                  { key: 'guestFeedback', label: 'Guest Feedback & Reviews' },
                  { key: 'dailyReports', label: 'Operational Daily Analytics' },
                ].map((item) => (
                  <label
                    key={item.key}
                    className="flex items-center justify-between p-3 rounded-lg border border-[#e8e4dd] hover:border-[#e8e4dd] cursor-pointer bg-white"
                  >
                    <span className="text-xs font-medium text-[#292827]">{item.label}</span>
                    <input
                      type="checkbox"
                      checked={(modules as any)[item.key]}
                      onChange={(e) =>
                        setModules((prev) => ({
                          ...prev,
                          [item.key]: e.target.checked,
                        }))
                      }
                      className="w-4 h-4 rounded text-[#1b1938] focus:ring-[#1b1938]"
                    />
                  </label>
                ))}
              </div>
            </div>
          )}

          {/* STEP 4: Hotel Admin Account Credentials */}
          {step === 4 && (
            <div className="space-y-4">
              <div className="p-3.5 bg-[#e7efee] border border-[#c9dcd9] rounded-lg text-xs text-[#0e3030] space-y-1">
                <div className="font-bold flex items-center gap-1.5 text-[#0e3030]">
                  <CheckCircle2 className="w-4 h-4 text-[#155555]" />
                  <span>Secure Admin User Creation</span>
                </div>
                <p>
                  This will provision a Firebase Auth user with custom claim <code className="bg-[#dce7e5] px-1 py-0.5 rounded font-mono text-[11px]">{`{ role: "hotel_admin", hotelId }`}</code> using Firebase Admin SDK.
                </p>
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#292827] mb-1">
                  Hotel Admin Full Name <span className="text-[#1b1938]">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={adminName}
                  onChange={(e) => setAdminName(e.target.value)}
                  placeholder="e.g. Sarah Jenkins"
                  className="w-full bg-white border border-[#e8e4dd] rounded-xl px-3.5 py-2.5 text-sm text-[#292827] focus:outline-none focus:border-[#292827]"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#292827] mb-1">
                  Hotel Admin Login Email <span className="text-[#1b1938]">*</span>
                </label>
                <input
                  type="email"
                  required
                  value={adminEmail}
                  onChange={(e) => setAdminEmail(e.target.value)}
                  placeholder="e.g. admin@royalgrand.com"
                  className="w-full bg-white border border-[#e8e4dd] rounded-xl px-3.5 py-2.5 text-sm text-[#292827] focus:outline-none focus:border-[#292827]"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#292827] mb-1">
                  Login Password (minimum 6 chars) <span className="text-[#1b1938]">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={adminPassword}
                  onChange={(e) => setAdminPassword(e.target.value)}
                  placeholder="e.g. hotelPass123"
                  className="w-full bg-white border border-[#e8e4dd] rounded-xl px-3.5 py-2.5 text-sm text-[#292827] font-mono focus:outline-none focus:border-[#292827]"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#292827] mb-1">
                  Admin Phone Number
                </label>
                <input
                  type="tel"
                  value={adminPhone}
                  onChange={(e) => setAdminPhone(e.target.value)}
                  placeholder="e.g. +1 305 555 0123"
                  className="w-full bg-white border border-[#e8e4dd] rounded-xl px-3.5 py-2.5 text-sm text-[#292827] focus:outline-none focus:border-[#292827]"
                />
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer Controls */}
        <div className="p-6 border-t border-[#e8e4dd] bg-[#fafaf8] flex items-center justify-between">
          {step > 1 ? (
            <button
              type="button"
              onClick={handleBack}
              disabled={isSubmitting}
              className="px-4 py-2.5 rounded-full border border-[#e8e4dd] text-xs font-semibold text-[#292827] hover:bg-white transition-colors flex items-center gap-1.5"
            >
              <ArrowLeft className="w-3.5 h-3.5" /> Back
            </button>
          ) : (
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 rounded-full border border-[#e8e4dd] text-xs font-semibold text-[#73706d] hover:bg-white transition-colors"
            >
              Cancel
            </button>
          )}

          {step < 4 ? (
            <button
              type="button"
              onClick={handleNext}
              className="px-6 py-2.5 rounded-full bg-[#292827] hover:bg-black text-xs font-bold text-white transition-colors flex items-center gap-1.5"
            >
              Next Step <ArrowRight className="w-3.5 h-3.5" />
            </button>
          ) : (
            <button
              type="button"
              onClick={handleSubmit}
              disabled={isSubmitting}
              className="px-6 py-2.5 rounded-lg bg-[#1b1938] hover:bg-[#0e0c1f] text-xs font-bold text-white transition-colors flex items-center gap-2 shadow-sm disabled:opacity-50"
            >
              {isSubmitting ? (
                <>
                  <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  <span>Provisioning Hotel & Auth...</span>
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4" />
                  <span>Create Hotel & Admin Account</span>
                </>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
