import React, { useEffect, useRef, useState } from 'react';
import { useAuth, MIN_PASSWORD_LENGTH } from '../../context/AuthContext';
import {
  DEMO_HOTEL_ADMIN_EMAIL,
  DEMO_HOTEL_ADMIN_PASSWORD,
  DEMO_SUPER_ADMIN_EMAIL,
  DEMO_SUPER_ADMIN_PASSWORD,
} from '../../supabase/demoSeed';
import {
  Lock,
  Mail,
  Eye,
  EyeOff,
  ArrowRight,
  ArrowLeft,
  AlertCircle,
  CheckCircle2,
  KeyRound,
  UserRound,
  Info,
} from 'lucide-react';

type Mode = 'signin' | 'signup' | 'forgot' | 'reset';

/** Maps backend error shapes onto a single human sentence. */
function friendlyMessage(err: any, demoMode: boolean): string {
  const code: string = err?.code || '';
  const raw: string = err?.message || '';

  if (
    code === 'auth/user-not-found' ||
    code === 'auth/wrong-password' ||
    code === 'auth/invalid-credential' ||
    code === 'invalid_credentials' ||
    raw.includes('Invalid login credentials')
  ) {
    return demoMode
      ? 'No account matches that email/password on this demo backend. Use a demo account below, or create your own.'
      : 'Invalid email or password. Please double-check your credentials and try again.';
  }
  if (code === 'user_already_exists' || raw.includes('already registered')) {
    return 'An account with that email already exists. Try signing in, or reset its password.';
  }
  if (code === 'weak_password' || /at least \d+ characters/i.test(raw)) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  if (code === 'invalid_email' || raw.toLowerCase().includes('email address is not valid')) {
    return 'That email address does not look valid.';
  }
  if (code === 'auth/too-many-requests' || code === 'over_email_send_rate_limit') {
    return 'Too many attempts. Please wait a moment and try again.';
  }
  return raw || 'Something went wrong. Please try again.';
}

export const LoginPage: React.FC = () => {
  const {
    loginWithCredentials,
    signUpWithCredentials,
    requestPasswordReset,
    beginPasswordRecovery,
    completePasswordReset,
    authError,
    clearAuthError,
    recoveryParams,
    demoMode,
  } = useAuth();

  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [demoResetUrl, setDemoResetUrl] = useState<string | null>(null);
  const [recoveryEmail, setRecoveryEmail] = useState('');
  const emailRef = useRef<HTMLInputElement>(null);
  const recoveryStarted = useRef(false);

  // A password-reset link in the URL switches the panel to "set new password".
  // config.ts disables detectSessionInUrl, so the session has to be exchanged
  // by hand here (demo links carry no session at all).
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
        setErrorMessage(friendlyMessage(err, demoMode));
        setMode('forgot');
      } finally {
        setLoading(false);
      }
    })();
  }, [recoveryParams, beginPasswordRecovery, demoMode]);

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

  const fillDemoAccount = (demoEmail: string, demoPassword: string) => {
    switchMode('signin');
    setEmail(demoEmail);
    setPassword(demoPassword);
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
      setErrorMessage(friendlyMessage(err, demoMode));
    } finally {
      setLoading(false);
    }
  };

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setNotice(null);
    if (password !== confirmPassword) {
      setErrorMessage('The two passwords do not match.');
      return;
    }
    setLoading(true);
    try {
      await signUpWithCredentials(email.trim(), password, displayName.trim() || undefined);
      // On success activeExperience changes and this page unmounts.
    } catch (err: any) {
      setErrorMessage(friendlyMessage(err, demoMode));
    } finally {
      setLoading(false);
    }
  };

  const handleForgot = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setNotice(null);
    setDemoResetUrl(null);
    setLoading(true);
    try {
      const { demoResetUrl: url } = await requestPasswordReset(email.trim());
      if (url) {
        setDemoResetUrl(url);
        setNotice(
          'Demo mode sends no email. Open the reset link below to set a new password for this account.'
        );
      } else {
        setNotice(
          `If an account exists for ${email.trim()}, a password reset link is on its way. Check your inbox (and spam folder).`
        );
      }
    } catch (err: any) {
      setErrorMessage(friendlyMessage(err, demoMode));
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
      setErrorMessage(friendlyMessage(err, demoMode));
    } finally {
      setLoading(false);
    }
  };

  const shownError = errorMessage || (mode === 'signin' ? authError : null);

  const headings: Record<Mode, { title: string; subtitle: string }> = {
    signin: { title: 'Welcome back', subtitle: 'Sign in with your admin account.' },
    signup: {
      title: 'Create your account',
      subtitle: 'Demo mode only — the account is stored locally in this browser.',
    },
    forgot: {
      title: 'Reset your password',
      subtitle: 'We will send a link to set a new password.',
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
                    <label className="block t-button-cap text-ink mb-1.5">Email</label>
                    <div className="relative">
                      <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-ink-faint">
                        <Mail className="w-4 h-4" />
                      </div>
                      <input
                        ref={emailRef}
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

                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="block t-button-cap text-ink">Password</label>
                      <button
                        type="button"
                        onClick={() => switchMode('forgot')}
                        className="t-caption text-primary hover:underline"
                      >
                        Forgot password?
                      </button>
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

                  {demoMode && (
                    <p className="t-caption text-ink-mute text-center">
                      No account yet?{' '}
                      <button
                        type="button"
                        onClick={() => switchMode('signup')}
                        className="text-primary hover:underline font-medium"
                      >
                        Create one
                      </button>
                    </p>
                  )}
                </form>
              )}

              {/* ---------------- Create account (demo) ---------------- */}
              {mode === 'signup' && (
                <form onSubmit={handleSignUp} className="space-y-4">
                  <div>
                    <label className="block t-button-cap text-ink mb-1.5">Name</label>
                    <div className="relative">
                      <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-ink-faint">
                        <UserRound className="w-4 h-4" />
                      </div>
                      <input
                        type="text"
                        autoComplete="name"
                        value={displayName}
                        onChange={(e) => setDisplayName(e.target.value)}
                        placeholder="Saksham"
                        className="input-super pl-9 pr-3 py-2.5"
                      />
                    </div>
                  </div>

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

                  <div>
                    <label className="block t-button-cap text-ink mb-1.5">Password</label>
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
                    <label className="block t-button-cap text-ink mb-1.5">Confirm password</label>
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
                    disabled={loading || !email || password.length < MIN_PASSWORD_LENGTH}
                    className="btn-primary-dark w-full py-3"
                  >
                    {loading ? (
                      <span>Creating account…</span>
                    ) : (
                      <>
                        <span>Create account</span>
                        <ArrowRight className="w-4 h-4" />
                      </>
                    )}
                  </button>

                  <p className="t-caption text-ink-mute text-center">
                    Already registered?{' '}
                    <button
                      type="button"
                      onClick={focusSignIn}
                      className="text-primary hover:underline font-medium"
                    >
                      Sign in
                    </button>
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

                  {demoResetUrl && (
                    <a href={demoResetUrl} className="btn-on-dark-pill w-full">
                      Open the reset link
                      <ArrowRight className="w-4 h-4" />
                    </a>
                  )}

                  {demoMode && (
                    <p className="t-caption text-ink-mute">
                      The link resets the password on this browser's demo store only — nothing is
                      emailed and nothing leaves the device.
                    </p>
                  )}
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

              {/* ---------------- Demo accounts ---------------- */}
              {demoMode && (
                <div className="border border-hairline rounded-xl p-4 space-y-3 bg-canvas-soft">
                  <div className="flex items-start gap-2 text-ink-mute">
                    <Info className="w-4 h-4 shrink-0 mt-0.5" />
                    <p className="t-caption">
                      Running on the local demo backend — only the accounts below exist unless you
                      create one. Add Supabase credentials in <code>.env</code> to go live.
                    </p>
                  </div>
                  <div className="grid gap-2">
                    <button
                      type="button"
                      onClick={() => fillDemoAccount(DEMO_SUPER_ADMIN_EMAIL, DEMO_SUPER_ADMIN_PASSWORD)}
                      className="flex items-center justify-between text-left border border-hairline rounded-lg px-3 py-2 hover:border-primary/40 bg-canvas"
                    >
                      <span className="t-caption text-ink">{DEMO_SUPER_ADMIN_EMAIL}</span>
                      <span className="t-micro uppercase tracking-wide text-ink-faint">
                        Super admin
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => fillDemoAccount(DEMO_HOTEL_ADMIN_EMAIL, DEMO_HOTEL_ADMIN_PASSWORD)}
                      className="flex items-center justify-between text-left border border-hairline rounded-lg px-3 py-2 hover:border-primary/40 bg-canvas"
                    >
                      <span className="t-caption text-ink">{DEMO_HOTEL_ADMIN_EMAIL}</span>
                      <span className="t-micro uppercase tracking-wide text-ink-faint">
                        Hotel admin
                      </span>
                    </button>
                  </div>
                  <p className="t-caption text-ink-faint">
                    Both use the password <code className="font-mono">{DEMO_SUPER_ADMIN_PASSWORD}</code>.
                  </p>
                </div>
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
