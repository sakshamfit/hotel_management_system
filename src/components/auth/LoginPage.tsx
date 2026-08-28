import React, { useRef, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import {
  Lock,
  Mail,
  Eye,
  EyeOff,
  ArrowRight,
  AlertCircle,
  Zap,
  Building2,
  BedDouble,
} from 'lucide-react';

export const LoginPage: React.FC = () => {
  const { loginWithCredentials, loginWithGoogle, loginAsDevRole } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isIdentityToolkitError, setIsIdentityToolkitError] = useState(false);
  const emailRef = useRef<HTMLInputElement>(null);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setIsIdentityToolkitError(false);
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

  return (
    <div className="min-h-screen bg-canvas text-ink flex flex-col">
      <div className="flex flex-col lg:flex-row flex-1">
        {/* ============ Indigo hero — half-bleed portrait + violet-sky atmosphere ============ */}
        <section className="atmosphere relative lg:w-[55%] overflow-hidden flex flex-col min-h-[420px] lg:min-h-screen">
          {/* Half-bleed portrait subject — edge-to-edge vertically, fading into the indigo on the left */}
          <div className="absolute inset-y-0 right-0 w-full lg:w-[58%] pointer-events-none">
            <img
              src="/hero-portrait.jpg"
              alt=""
              className="h-full w-full object-cover object-[70%_center] opacity-90"
            />
            <div className="absolute inset-0 bg-gradient-to-r from-[#1b1938] via-[#1b1938]/55 to-transparent lg:via-[#1b1938]/30" />
            <div className="absolute inset-0 bg-gradient-to-t from-[#0e0c1f]/70 via-transparent to-[#1b1938]/40" />
          </div>

          {/* Hero content — left column */}
          <div className="relative z-10 flex flex-col justify-between flex-1 p-6 sm:p-10 lg:p-14 xl:p-16 max-w-[640px]">
            {/* Wordmark */}
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-violet-soft text-primary flex items-center justify-center font-bold text-base">
                N
              </div>
              <div className="flex items-center gap-2.5">
                <span className="t-heading-lg text-on-primary tracking-tight" style={{ fontSize: 17 }}>
                  NEXORA
                </span>
                <span className="font-mono text-[10px] font-semibold uppercase tracking-wider text-on-dark-mute border border-hairline-dark rounded px-1.5 py-0.5">
                  Hotel OS
                </span>
              </div>
            </div>

            {/* Headline block */}
            <div className="py-10 lg:py-0 max-w-[520px]">
              <p className="t-micro uppercase tracking-[0.18em] text-violet-soft mb-4">
                Enterprise Hospitality Platform
              </p>
              <h1 className="t-display-xl text-on-primary">
                The quiet operating system behind exceptional stays.
              </h1>
              <p className="t-body-lg text-on-dark-mute mt-5 max-w-[440px]">
                Multi-tenant rooms, dining, housekeeping and guest requests — orchestrated from one
                considered console.
              </p>

              {/* Single CTA — the hero pill, pale violet */}
              <button
                onClick={() => emailRef.current?.focus()}
                className="btn-on-dark-pill mt-8"
              >
                Sign in to your property
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>

            {/* Hero footer stats */}
            <div className="flex items-center gap-6 text-on-dark-faint">
              <span className="t-micro uppercase tracking-wider">Cloud Multi-Tenant</span>
              <span className="hidden sm:inline t-micro uppercase tracking-wider">Firestore Isolated</span>
              <span className="inline-flex items-center gap-1.5 t-micro text-on-dark-mute">
                <span className="w-1.5 h-1.5 rounded-full bg-violet-soft animate-pulse" />
                Secured
              </span>
            </div>
          </div>
        </section>

        {/* ============ White canvas body — the form ============ */}
        <main className="flex-1 bg-canvas flex flex-col">
          <div className="flex-1 flex items-center justify-center p-6 sm:p-10 lg:p-12">
            <div className="w-full max-w-md space-y-8">
              {/* Section opener */}
              <div className="space-y-2">
                <h2 className="t-display-md tracking-tight">Welcome back</h2>
                <p className="t-caption text-ink-mute">
                  Sign in to access your isolated hotel OS or the master management console.
                </p>
              </div>

              {/* Identity Toolkit / IAM guidance */}
              {isIdentityToolkitError && (
                <div className="card-feature-row p-4 text-xs space-y-2.5 rounded-lg">
                  <div className="flex items-start gap-2 font-semibold text-ink">
                    <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-teal-mid" />
                    <span>Sandbox Cloud Environment Active</span>
                  </div>
                  <p className="t-caption text-ink-mute leading-relaxed">
                    The internal Google Cloud container project uses managed credentials. You do not
                    need to access the Google Cloud Console or configure IAM permissions. Use the{' '}
                    <strong>Instant Experience Launch</strong> buttons below to immediately manage
                    hotels, rooms, POS, and guest orders.
                  </p>
                </div>
              )}

              {/* Success banner — the first super admin is created automatically
                  on app startup; nothing to sync manually anymore. */}

              {/* Error banner */}
              {errorMessage && !isIdentityToolkitError && (
                <div className="bg-[#ece6fb] border border-violet-soft rounded-lg p-3.5 text-xs text-primary-deep flex items-start gap-2.5">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span className="font-medium">{errorMessage}</span>
                </div>
              )}

              {/* Login form */}
              <form onSubmit={handleLogin} className="space-y-4">
                <div>
                  <label className="block t-button-cap text-ink mb-1.5">Account Email</label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-ink-faint">
                      <Mail className="w-4 h-4" />
                    </div>
                    <input
                      ref={emailRef}
                      type="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="Admin email (or hotel admin email)"
                      className="input-super pl-9 pr-3 py-2.5"
                    />
                  </div>
                </div>

                <div>
                  <label className="block t-button-cap text-ink mb-1.5">Password</label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-ink-faint">
                      <Lock className="w-4 h-4" />
                    </div>
                    <input
                      type={showPassword ? 'text' : 'password'}
                      required
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="••••••••"
                      className="input-super pl-9 pr-10 py-2.5 font-mono"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute inset-y-0 right-0 pr-3 flex items-center text-ink-faint hover:text-ink"
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={loading || !email || !password}
                  className="btn-primary-dark w-full py-3"
                >
                  {loading ? (
                    <span>Authenticating with Firebase…</span>
                  ) : (
                    <>
                      <span>Sign In with Password</span>
                      <ArrowRight className="w-4 h-4" />
                    </>
                  )}
                </button>
              </form>

              {/* Divider */}
              <div className="relative flex items-center justify-center">
                <div className="border-t border-hairline w-full"></div>
                <span className="bg-canvas px-3 t-micro uppercase tracking-wider text-ink-faint">
                  Or Continue With
                </span>
              </div>

              {/* Google — secondary outline */}
              <button
                type="button"
                onClick={handleGoogleLogin}
                disabled={googleLoading}
                className="btn-secondary-outline w-full py-3"
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
                <span className="font-semibold">
                  {googleLoading ? 'Signing in with Google…' : 'Sign In with Google (Pre-Configured)'}
                </span>
              </button>

              {/* Instant preview — feature-row cards on warm off-white */}
              <div className="pt-6 border-t border-hairline space-y-3">
                <div className="flex items-center gap-1.5 t-button-cap text-ink">
                  <Zap className="w-3.5 h-3.5 text-teal-mid" />
                  <span>Instant Experience Launch</span>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => loginAsDevRole('super_admin')}
                    className="card-feature-row p-4 text-left transition-colors hover:bg-[#f1efe9] text-xs space-y-1"
                  >
                    <div className="font-bold text-ink flex items-center justify-between">
                      <span className="flex items-center gap-1.5">
                        <Building2 className="w-3.5 h-3.5 text-ink-mute" />
                        Super Admin
                      </span>
                      <ArrowRight className="w-3 h-3 text-ink-faint" />
                    </div>
                    <div className="t-caption text-ink-mute">Manage all hotels &amp; billing</div>
                  </button>

                  <button
                    type="button"
                    onClick={() => loginAsDevRole('hotel_admin')}
                    className="card-feature-row p-4 text-left transition-colors hover:bg-[#f1efe9] text-xs space-y-1"
                  >
                    <div className="font-bold text-ink flex items-center justify-between">
                      <span className="flex items-center gap-1.5">
                        <BedDouble className="w-3.5 h-3.5 text-ink-mute" />
                        Hotel Admin
                      </span>
                      <ArrowRight className="w-3 h-3 text-ink-faint" />
                    </div>
                    <div className="t-caption text-ink-mute">Rooms, POS &amp; Operations</div>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </main>
      </div>

      {/* ============ Closing deep-teal band — the resolving chord ============ */}
      <footer className="card-teal-band rounded-none px-6 sm:px-10 lg:px-16 py-10 sm:py-12">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6">
          <div className="space-y-1.5">
            <h3 className="t-display-lg text-on-primary">Every stay, quietly orchestrated.</h3>
            <p className="t-caption text-white/60">
              NEXORA HOTEL OS • Firebase Auth &amp; Multi-Tenant Firestore
            </p>
          </div>
          <button
            onClick={() => emailRef.current?.focus()}
            className="btn-on-teal shrink-0"
          >
            Begin at the sign in
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </footer>
    </div>
  );
};
