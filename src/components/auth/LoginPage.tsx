import React, { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { firestoreService } from '../../services/firestoreService';
import {
  Building2,
  Lock,
  Mail,
  ShieldCheck,
  Eye,
  EyeOff,
  ArrowRight,
  AlertCircle,
  Sparkles,
  KeyRound,
  CheckCircle2,
  ExternalLink,
  Zap,
} from 'lucide-react';

export const LoginPage: React.FC = () => {
  const { loginWithCredentials, loginWithGoogle, loginAsDevRole } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [bootstrapLoading, setBootstrapLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isIdentityToolkitError, setIsIdentityToolkitError] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setIsIdentityToolkitError(false);
    setSuccessMessage(null);
    setLoading(true);

    try {
      await loginWithCredentials(email.trim(), password.trim());
    } catch (err: any) {
      console.error('Login error:', err);
      let msg = err.message || 'Invalid email or password. Please check your credentials.';
      if (
        msg.includes('identitytoolkit.googleapis.com') ||
        msg.includes('Identity Toolkit API') ||
        err.code === 'auth/configuration-not-found' ||
        err.code === 'auth/operation-not-allowed'
      ) {
        setIsIdentityToolkitError(true);
        msg = 'Firebase Identity Toolkit API is pending activation on Google Cloud project 268701568128. Enable it or use Instant Preview below.';
      } else if (err.code === 'auth/user-not-found' || err.code === 'auth/wrong-password' || err.code === 'auth/invalid-credential') {
        msg = 'Invalid email or password. If this is a newly created hotel, please verify the exact email and password set by the Super Admin.';
      } else if (err.code === 'auth/too-many-requests') {
        msg = 'Too many failed login attempts. Please wait a moment and try again.';
      }
      setErrorMessage(msg);
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleLogin = async () => {
    setGoogleLoading(true);
    setErrorMessage(null);
    setIsIdentityToolkitError(false);
    try {
      await loginWithGoogle();
    } catch (err: any) {
      console.error('Google sign-in error:', err);
      let msg = err.message || 'Google Sign-In failed';
      if (msg.includes('identitytoolkit.googleapis.com') || msg.includes('Identity Toolkit API')) {
        setIsIdentityToolkitError(true);
      }
      setErrorMessage(msg);
    } finally {
      setGoogleLoading(false);
    }
  };

  // Helper for initial Super Admin setup
  const handleSetupSuperAdmin = async () => {
    setBootstrapLoading(true);
    setErrorMessage(null);
    setIsIdentityToolkitError(false);
    setSuccessMessage(null);
    try {
      await firestoreService.bootstrapSuperAdmin('admin@raees.com', 'admin123');
      setEmail('admin@raees.com');
      setPassword('admin123');
      setSuccessMessage('Super Admin initialized! Click "Sign In" to access the Super Admin Panel.');
    } catch (err: any) {
      let msg = err.message || 'Failed to initialize Super Admin account.';
      if (msg.includes('identitytoolkit.googleapis.com') || msg.includes('Identity Toolkit API')) {
        setIsIdentityToolkitError(true);
      }
      setErrorMessage(msg);
    } finally {
      setBootstrapLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#fafafa] flex flex-col justify-between text-[#222222]">
      {/* Top Header */}
      <header className="bg-white border-b border-[#ebebeb] px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-[#ff385c] to-[#e00b41] flex items-center justify-center text-white font-bold text-base shadow-sm">
            N
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-bold tracking-tight text-base text-[#222222]">NEXORA</span>
              <span className="text-[10px] font-bold uppercase bg-[#fff0f3] text-[#ff385c] border border-[#ffd1da] px-2 py-0.5 rounded-full font-mono">
                HOTEL OS
              </span>
            </div>
            <span className="text-[11px] text-[#6a6a6a]">Multi-Tenant Cloud Hospitality Platform</span>
          </div>
        </div>

        <div className="text-xs text-[#6a6a6a] flex items-center gap-2">
          <span className="inline-block w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
          <span>Firebase Cloud Secured</span>
        </div>
      </header>

      {/* Main Single Shared Login Form */}
      <main className="flex-1 flex items-center justify-center p-4 sm:p-6 lg:p-8">
        <div className="w-full max-w-md bg-white border border-[#ebebeb] rounded-3xl p-6 sm:p-8 shadow-sm space-y-6">
          {/* Header */}
          <div className="text-center space-y-2">
            <div className="w-12 h-12 rounded-2xl bg-[#fff0f3] border border-[#ffd1da] flex items-center justify-center text-[#ff385c] mx-auto shadow-xs">
              <Building2 className="w-6 h-6" />
            </div>
            <h1 className="text-xl font-bold text-[#222222] tracking-tight">Nexora Hotel Management</h1>
            <p className="text-xs text-[#6a6a6a] max-w-sm mx-auto">
              Sign in to access your isolated hotel OS or master management console.
            </p>
          </div>

          {/* Identity Toolkit / IAM Guidance Banner */}
          {isIdentityToolkitError && (
            <div className="bg-[#fff9db] border border-[#ffe066] rounded-2xl p-4 text-xs text-[#7c5e10] space-y-2.5">
              <div className="flex items-start gap-2 font-semibold text-[#5c4308]">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-[#d48806]" />
                <span>Sandbox Cloud Environment Active</span>
              </div>
              <p className="text-[11px] leading-relaxed text-[#7c5e10]">
                The internal Google Cloud container project uses managed credentials. You do not need to access the Google Cloud Console or configure IAM permissions. Use the <strong>Instant Experience Launch</strong> buttons below to immediately manage hotels, rooms, POS, and guest orders.
              </p>
            </div>
          )}

          {/* Success Banner */}
          {successMessage && (
            <div className="bg-[#f0fdf4] border border-[#bbf7d0] rounded-2xl p-3.5 text-xs text-emerald-700 flex items-start gap-2.5">
              <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-emerald-600" />
              <span>{successMessage}</span>
            </div>
          )}

          {/* Error Banner */}
          {errorMessage && !isIdentityToolkitError && (
            <div className="bg-[#fff0f3] border border-[#ffd1da] rounded-2xl p-3.5 text-xs text-[#ff385c] flex items-start gap-2.5">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{errorMessage}</span>
            </div>
          )}

          {/* Login Form */}
          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-[#222222] mb-1.5">
                Account Email
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-[#6a6a6a]">
                  <Mail className="w-4 h-4" />
                </div>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="admin@raees.com or hotel admin email"
                  className="w-full bg-white border border-[#dddddd] rounded-2xl pl-10 pr-4 py-3 text-sm text-[#222222] placeholder-[#a0a0a0] focus:outline-none focus:border-[#222222] focus:ring-1 focus:ring-[#222222] transition-colors"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-[#222222] mb-1.5">
                Password
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-[#6a6a6a]">
                  <Lock className="w-4 h-4" />
                </div>
                <input
                  type={showPassword ? 'text' : 'password'}
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full bg-white border border-[#dddddd] rounded-2xl pl-10 pr-11 py-3 text-sm text-[#222222] placeholder-[#a0a0a0] focus:outline-none focus:border-[#222222] focus:ring-1 focus:ring-[#222222] transition-colors font-mono"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute inset-y-0 right-0 pr-3.5 flex items-center text-[#6a6a6a] hover:text-[#222222]"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading || !email || !password}
              className="w-full py-3.5 rounded-2xl text-xs sm:text-sm font-bold text-white bg-[#ff385c] hover:bg-[#e00b41] shadow-sm transition-all flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {loading ? (
                <span>Authenticating with Firebase...</span>
              ) : (
                <>
                  <span>Sign In with Password</span>
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </form>

          {/* Google Sign In Button */}
          <div className="space-y-3">
            <div className="relative flex items-center justify-center">
              <div className="border-t border-[#ebebeb] w-full"></div>
              <span className="bg-white px-3 text-[11px] font-medium text-[#888888] uppercase tracking-wider">
                Or Continue With
              </span>
            </div>

            <button
              type="button"
              onClick={handleGoogleLogin}
              disabled={googleLoading}
              className="w-full py-3 bg-white border border-[#dddddd] hover:border-[#222222] rounded-2xl text-xs font-semibold text-[#222222] transition-colors flex items-center justify-center gap-2.5 shadow-2xs"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24">
                <path
                  fill="#4285F4"
                  d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.66-5.17 3.66-9.17z"
                />
                <path
                  fill="#34A853"
                  d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.25v3.15C3.26 21.36 7.34 24 12 24z"
                />
                <path
                  fill="#FBBC05"
                  d="M5.28 14.27c-.25-.72-.38-1.49-.38-2.27s.13-1.55.38-2.27V6.58H1.25C.45 8.18 0 10.03 0 12s.45 3.82 1.25 5.42l4.03-3.15z"
                />
                <path
                  fill="#EA4335"
                  d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.34 0 3.26 2.64 1.25 6.58l4.03 3.15c.95-2.83 3.6-4.98 6.72-4.98z"
                />
              </svg>
              <span>{googleLoading ? 'Signing in with Google...' : 'Sign In with Google (Pre-Configured)'}</span>
            </button>
          </div>

          {/* Instant Interactive Preview & Role Access */}
          <div className="pt-4 border-t border-[#ebebeb] space-y-3">
            <div className="flex items-center gap-1.5 text-xs font-bold text-[#222222]">
              <Zap className="w-3.5 h-3.5 text-amber-500" />
              <span>Instant Experience Launch</span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => loginAsDevRole('super_admin')}
                className="p-3 bg-[#f7f7f7] hover:bg-[#ebebeb] border border-[#dddddd] rounded-xl text-left transition-colors text-xs space-y-0.5"
              >
                <div className="font-bold text-[#222222] flex items-center justify-between">
                  <span>Super Admin</span>
                  <ArrowRight className="w-3 h-3 text-[#6a6a6a]" />
                </div>
                <div className="text-[11px] text-[#6a6a6a]">Manage all hotels & billing</div>
              </button>

              <button
                type="button"
                onClick={() => loginAsDevRole('hotel_admin')}
                className="p-3 bg-[#f7f7f7] hover:bg-[#ebebeb] border border-[#dddddd] rounded-xl text-left transition-colors text-xs space-y-0.5"
              >
                <div className="font-bold text-[#222222] flex items-center justify-between">
                  <span>Hotel Admin</span>
                  <ArrowRight className="w-3 h-3 text-[#6a6a6a]" />
                </div>
                <div className="text-[11px] text-[#6a6a6a]">Rooms, POS & Operations</div>
              </button>
            </div>

            <div className="flex items-center justify-between text-[11px] font-semibold text-[#6a6a6a] pt-1">
              <span>Cloud Admin Bootstrap:</span>
              <button
                type="button"
                onClick={handleSetupSuperAdmin}
                disabled={bootstrapLoading}
                className="text-[#ff385c] hover:underline font-bold inline-flex items-center gap-1"
              >
                <KeyRound className="w-3 h-3" />
                {bootstrapLoading ? 'Initializing...' : 'Sync admin@raees.com'}
              </button>
            </div>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="py-4 text-center text-xs text-[#6a6a6a] border-t border-[#ebebeb] bg-white">
        Nexora Global Hospitality Platform • Firebase Auth & Multi-Tenant Firestore
      </footer>
    </div>
  );
};
