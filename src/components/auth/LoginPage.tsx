import React, { useRef, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { Lock, Mail, Eye, EyeOff, ArrowRight, AlertCircle } from 'lucide-react';

export const LoginPage: React.FC = () => {
  const { loginWithCredentials } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const emailRef = useRef<HTMLInputElement>(null);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setLoading(true);

    try {
      await loginWithCredentials(email.trim(), password.trim());
    } catch (err: any) {
      console.error('Login error:', err);
      let msg = err.message || 'Invalid email or password. Please check your credentials.';
      if (
        err.code === 'auth/user-not-found' ||
        err.code === 'auth/wrong-password' ||
        err.code === 'auth/invalid-credential' ||
        err.code === 'invalid_credentials' ||
        err.message?.includes('Invalid login credentials')
      ) {
        msg = 'Invalid email or password. Please double-check your credentials and try again.';
      } else if (err.code === 'auth/too-many-requests' || err.code === 'over_email_send_rate_limit') {
        msg = 'Too many failed login attempts. Please wait a moment and try again.';
      }
      setErrorMessage(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-canvas text-ink flex flex-col">
      <div className="flex flex-col lg:flex-row flex-1">
        {/* ============ Near-black hero canvas — photography-first ============ */}
        <section className="atmosphere relative lg:w-[52%] overflow-hidden flex flex-col min-h-[420px] lg:min-h-screen">
          <div className="absolute inset-y-0 right-0 w-full lg:w-[58%] pointer-events-none">
            <img
              src="/hero-portrait.jpg"
              alt=""
              className="h-full w-full object-cover object-[70%_center] opacity-90"
            />
          </div>

          {/* Hero content */}
          <div className="relative z-10 flex flex-col justify-between flex-1 p-6 sm:p-10 lg:p-14 xl:p-16 max-w-[640px]">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-primary text-on-primary flex items-center justify-center font-bold text-base">
                N
              </div>
              <span className="t-heading-lg text-on-primary tracking-tight" style={{ fontSize: 17 }}>
                NEXORA
              </span>
            </div>

            <div className="py-10 lg:py-0 max-w-[520px]">
              <p className="t-micro uppercase tracking-[0.18em] text-primary-on-dark mb-4">
                Hotel Operations Platform
              </p>
              <h1 className="t-display-xxl text-on-primary">
                One console for every stay.
              </h1>
              <p className="t-body-lg text-on-dark-mute mt-5 max-w-[440px]" style={{ fontWeight: 300 }}>
                Rooms, dining, housekeeping and guest requests — orchestrated from a single,
                considered console.
              </p>

              <button onClick={() => emailRef.current?.focus()} className="btn-on-dark-pill mt-8">
                Sign in to your property
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>

            <div className="flex items-center gap-6 text-on-dark-faint">
              <span className="t-micro uppercase tracking-wider">Cloud Multi-Tenant</span>
              <span className="inline-flex items-center gap-1.5 t-micro text-on-dark-mute">
                <span className="w-1.5 h-1.5 rounded-full bg-primary-on-dark" />
                Secured
              </span>
            </div>
          </div>
        </section>

        {/* ============ White canvas — the form ============ */}
        <main className="flex-1 bg-canvas flex flex-col">
          <div className="flex-1 flex items-center justify-center p-6 sm:p-10 lg:p-12">
            <div className="w-full max-w-md space-y-8">
              <div className="space-y-2">
                <h2 className="t-display-md tracking-tight">Welcome back</h2>
                <p className="t-caption text-ink-mute">Sign in with your admin account.</p>
              </div>

              {errorMessage && (
                <div className="bg-accent-tint border border-accent-soft rounded-lg p-3.5 text-xs text-primary-deep flex items-start gap-2.5">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span className="font-medium">{errorMessage}</span>
                </div>
              )}

              <form onSubmit={handleLogin} className="space-y-4">
                <div>
                  <label className="block t-button-cap text-ink mb-1.5">Email</label>
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
                      placeholder="you@example.com"
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
                    <span>Signing in…</span>
                  ) : (
                    <>
                      <span>Sign In</span>
                      <ArrowRight className="w-4 h-4" />
                    </>
                  )}
                </button>
              </form>
            </div>
          </div>
        </main>
      </div>

      {/* ============ Closing near-black band ============ */}
      <footer className="card-teal-band rounded-none px-6 sm:px-10 lg:px-16 py-10 sm:py-12">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6">
          <div className="space-y-1.5">
            <h3 className="t-display-lg text-on-primary">Every stay, quietly orchestrated.</h3>
            <p className="t-caption text-white/60">NEXORA HOTEL OS</p>
          </div>
          <button onClick={() => emailRef.current?.focus()} className="btn-on-teal shrink-0">
            Begin at the sign in
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </footer>
    </div>
  );
};
