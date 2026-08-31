import React, { useEffect, useRef, useState } from 'react';
import { useAuth, MIN_PASSWORD_LENGTH } from '../../context/AuthContext';
import { isLocalMode } from '../../services/local/localApi';
import {
  Lock,
  Mail,
  User,
  Eye,
  EyeOff,
  ArrowRight,
  ArrowLeft,
  AlertCircle,
  CheckCircle2,
  KeyRound,
  Download,
} from 'lucide-react';

type Mode = 'signin' | 'forgot' | 'reset';

/** Maps backend error shapes onto a single human sentence. */
function friendlyMessage(err: any): string {
  const code: string = err?.code || '';
  const raw: string = err?.message || '';

  if (
    code === 'auth/user-not-found' ||
    code === 'auth/wrong-password' ||
    code === 'auth/invalid-credential' ||
    code === 'invalid_credentials' ||
    raw.includes('Invalid login credentials')
  ) {
    return 'Invalid email or password. Please double-check your credentials and try again.';
  }
  if (code === 'weak_password' || /at least \d+ characters/i.test(raw)) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  if (code === 'auth/too-many-requests' || code === 'over_email_send_rate_limit') {
    return 'Too many attempts. Please wait a moment and try again.';
  }
  return raw || 'Something went wrong. Please try again.';
}

export const LoginPage: React.FC = () => {
  const {
    loginWithCredentials,
    requestPasswordReset,
    beginPasswordRecovery,
    completePasswordReset,
    authError,
    clearAuthError,
    recoveryParams,
  } = useAuth();

  const local = isLocalMode();

  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [recoveryEmail, setRecoveryEmail] = useState('');
  const emailRef = useRef<HTMLInputElement>(null);
  const recoveryStarted = useRef(false);

  // A password-reset link in the URL switches the panel to "set new password".
  // config.ts disables detectSessionInUrl, so the session is exchanged here.
  useEffect(() => {
    if (!recoveryParams || recoveryStarted.current) return;
    recoveryStarted.current = true;
    setMode('reset');
    (async () => {
      try {
        setLoading(true);
        const { email: accountEmail } = await beginPasswordRecovery();
        if (accountEmail) setRecoveryEmail(accountEmail);
      } catch (err: any) {
        setErrorMessage(friendlyMessage(err));
        setMode('forgot');
      } finally {
        setLoading(false);
      }
    })();
  }, [recoveryParams, beginPasswordRecovery]);

  const switchMode = (next: Mode) => {
    setMode(next);
    setErrorMessage(null);
    setNotice(null);
    clearAuthError();
    setPassword('');
    setConfirmPassword('');
  };

  const focusSignIn = () => {
    switchMode('signin');
    setTimeout(() => emailRef.current?.focus(), 0);
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setNotice(null);
    clearAuthError();
    setLoading(true);

    try {
      await loginWithCredentials(email.trim(), password.trim());
    } catch (err: any) {
      console.error('Login error:', err);
      setErrorMessage(friendlyMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const handleForgot = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setNotice(null);
    setLoading(true);
    try {
      await requestPasswordReset(email.trim());
      setNotice(
        `If an account exists for ${email.trim()}, a password reset link is on its way. Check your inbox (and spam folder).`
      );
    } catch (err: any) {
      setErrorMessage(friendlyMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setNotice(null);
    if (password !== confirmPassword) {
      setErrorMessage('The two passwords do not match.');
      return;
    }
    setLoading(true);
    try {
      await completePasswordReset(password);
      setNotice('Password updated — signing you in…');
    } catch (err: any) {
      setErrorMessage(friendlyMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const shownError = errorMessage || (mode === 'signin' ? authError : null);

  const headings: Record<Mode, { title: string; subtitle: string }> = {
    signin: local
      ? { title: 'Welcome back', subtitle: 'Sign in with the username & password your seller gave you.' }
      : { title: 'Welcome back', subtitle: 'Sign in with your admin account.' },
    forgot: {
      title: 'Reset your password',
      subtitle: 'We will email you a link to set a new password.',
    },
    reset: {
      title: 'Choose a new password',
      subtitle: recoveryEmail ? `For ${recoveryEmail}` : 'Set the password for your account.',
    },
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

              <button onClick={focusSignIn} className="btn-on-dark-pill mt-8">
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
                {mode !== 'signin' && (
                  <button
                    type="button"
                    onClick={focusSignIn}
                    className="inline-flex items-center gap-1.5 t-caption text-ink-mute hover:text-ink mb-2"
                  >
                    <ArrowLeft className="w-3.5 h-3.5" />
                    Back to sign in
                  </button>
                )}
                <h2 className="t-display-md tracking-tight">{headings[mode].title}</h2>
                <p className="t-caption text-ink-mute">{headings[mode].subtitle}</p>
              </div>

              {shownError && (
                <div className="bg-accent-tint border border-accent-soft rounded-lg p-3.5 text-xs text-primary-deep flex items-start gap-2.5">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span className="font-medium">{shownError}</span>
                </div>
              )}

              {notice && (
                <div className="bg-canvas-soft border border-hairline rounded-lg p-3.5 text-xs text-ink flex items-start gap-2.5">
                  <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-primary" />
                  <span className="font-medium">{notice}</span>
                </div>
              )}

              {/* ---------------- Sign in ---------------- */}
              {mode === 'signin' && (
                <form onSubmit={handleLogin} className="space-y-4">
                  <div>
                    <label className="block t-button-cap text-ink mb-1.5">{local ? 'Username' : 'Email'}</label>
                    <div className="relative">
                      <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-ink-faint">
                        {local ? <User className="w-4 h-4" /> : <Mail className="w-4 h-4" />}
                      </div>
                      <input
                        ref={emailRef}
                        type={local ? 'text' : 'email'}
                        required
                        autoComplete={local ? 'username' : 'email'}
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder={local ? 'your hotel account' : 'you@example.com'}
                        className="input-super pl-9 pr-3 py-2.5"
                      />
                    </div>
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="block t-button-cap text-ink">Password</label>
                      {!local && (
                        <button
                          type="button"
                          onClick={() => switchMode('forgot')}
                          className="t-caption text-primary hover:underline"
                        >
                          Forgot password?
                        </button>
                      )}
                    </div>
                    <div className="relative">
                      <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-ink-faint">
                        <Lock className="w-4 h-4" />
                      </div>
                      <input
                        type={showPassword ? 'text' : 'password'}
                        required
                        autoComplete="current-password"
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

                  <p className="t-caption text-ink-faint text-center">
                    {local ? (
                      <>Running offline on this computer — your data never leaves it. Lost your password? Ask your seller.</>
                    ) : (
                      <>
                        Accounts are provisioned by the platform owner. Want to run NEXORA on your own
                        computer? <a href="/download" className="text-primary hover:underline">Get the Desktop Edition</a>.
                      </>
                    )}
                  </p>
                </form>
              )}

              {/* ---------------- Forgot password ---------------- */}
              {mode === 'forgot' && (
                <form onSubmit={handleForgot} className="space-y-4">
                  <div>
                    <label className="block t-button-cap text-ink mb-1.5">Email</label>
                    <div className="relative">
                      <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-ink-faint">
                        <Mail className="w-4 h-4" />
                      </div>
                      <input
                        type="email"
                        required
                        autoComplete="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="you@example.com"
                        className="input-super pl-9 pr-3 py-2.5"
                      />
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={loading || !email}
                    className="btn-primary-dark w-full py-3"
                  >
                    {loading ? (
                      <span>Sending…</span>
                    ) : (
                      <>
                        <KeyRound className="w-4 h-4" />
                        <span>Send reset link</span>
                      </>
                    )}
                  </button>

                  <p className="t-caption text-ink-mute">
                    The link opens this app on the "choose a new password" screen. If it does not
                    arrive, ask the platform owner to resend it from the Super Admin console.
                  </p>
                </form>
              )}

              {/* ---------------- Set a new password ---------------- */}
              {mode === 'reset' && (
                <form onSubmit={handleReset} className="space-y-4">
                  <div>
                    <label className="block t-button-cap text-ink mb-1.5">New password</label>
                    <div className="relative">
                      <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-ink-faint">
                        <Lock className="w-4 h-4" />
                      </div>
                      <input
                        type={showPassword ? 'text' : 'password'}
                        required
                        minLength={MIN_PASSWORD_LENGTH}
                        autoComplete="new-password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder={`At least ${MIN_PASSWORD_LENGTH} characters`}
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

                  <div>
                    <label className="block t-button-cap text-ink mb-1.5">Confirm new password</label>
                    <div className="relative">
                      <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-ink-faint">
                        <Lock className="w-4 h-4" />
                      </div>
                      <input
                        type={showPassword ? 'text' : 'password'}
                        required
                        minLength={MIN_PASSWORD_LENGTH}
                        autoComplete="new-password"
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        placeholder="Repeat it"
                        className="input-super pl-9 pr-3 py-2.5 font-mono"
                      />
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={loading || password.length < MIN_PASSWORD_LENGTH}
                    className="btn-primary-dark w-full py-3"
                  >
                    {loading ? (
                      <span>Updating…</span>
                    ) : (
                      <>
                        <span>Update password</span>
                        <ArrowRight className="w-4 h-4" />
                      </>
                    )}
                  </button>
                </form>
              )}
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
          <button onClick={focusSignIn} className="btn-on-teal shrink-0">
            Begin at the sign in
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </footer>
    </div>
  );
};
