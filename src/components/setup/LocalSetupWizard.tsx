/**
 * First-run activation wizard for the Desktop Edition.
 *
 * Marg-style flow: the customer already downloaded + installed the software.
 * The seller has given them an activation string (and username/password).
 * Together they unlock *this machine* — the hotel data stays here forever.
 */
import React, { useMemo, useState } from 'react';
import {
  ShieldCheck,
  KeyRound,
  FileUp,
  CheckCircle2,
  ArrowRight,
  ArrowLeft,
  AlertCircle,
  Sparkles,
  Download,
  Hotel,
  User,
  Loader2,
} from 'lucide-react';
import { fetchSetupStatus, activateLocal, activateDemo, localLogin, type LocalSetupStatus } from '../../services/local/localApi';

type Step = 'welcome' | 'activation' | 'credentials' | 'activating' | 'done';

interface LicensePreview {
  code: string;
  hotelName: string;
  ownerName: string;
  username: string;
}

function previewFromString(s: string): LicensePreview | null {
  try {
    const obj = JSON.parse(Buffer.from(s.trim(), 'base64url').toString('utf8'));
    if (!obj?.payload?.code) return null;
    const p = obj.payload;
    return { code: p.code, hotelName: p.hotelName || '', ownerName: p.ownerName || '', username: p.username || '' };
  } catch {
    return null;
  }
}

async function readFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error('Could not read the activation file.'));
    r.readAsText(file);
  });
}

export const LocalSetupWizard: React.FC<{ onActivated: () => void }> = ({ onActivated }) => {
  const [step, setStep] = useState<Step>('welcome');
  const [status, setStatus] = useState<LocalSetupStatus | null>(null);
  const [activation, setActivation] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);

  const preview = useMemo(() => previewFromString(activation), [activation]);

  const loadStatus = async () => {
    try {
      setStatus(await fetchSetupStatus());
    } catch {
      setStatus({ activated: false, demoAvailable: false });
    }
  };
  React.useEffect(() => {
    loadStatus();
  }, []);

  const onFile = async (file: File | null) => {
    if (!file) return;
    try {
      const text = await readFile(file);
      setActivation(text.trim());
      setFileName(file.name);
      setError(null);
    } catch (err: any) {
      setError(err?.message || 'Could not read the activation file.');
    }
  };

  const goCredentials = () => {
    if (!activation) {
      setError('Paste the activation code/string you received from the seller, or choose the .nexora file.');
      return;
    }
    if (!preview) {
      setError('That does not look like a valid activation string. Re-copy it from the seller (one long line starting with letters/numbers).');
      return;
    }
    setError(null);
    setStep('credentials');
  };

  const doActivate = async (demo = false) => {
    setStep('activating');
    setError(null);
    try {
      if (demo) {
        await activateDemo();
      } else {
        await activateLocal(activation, username, password);
        await localLogin(username, password);
      }
      setStep('done');
      setTimeout(onActivated, 900);
    } catch (err: any) {
      setError(err?.message || 'Activation failed. Please check the details and try again.');
      setStep('credentials');
    }
  };

  const passwordMismatch = password !== confirm;
  const canSubmit = username.length >= 3 && password.length >= 8 && !passwordMismatch;

  return (
    <div className="min-h-screen bg-canvas text-ink flex flex-col font-sans">
      <div className="flex-1 flex items-center justify-center p-6">
        <div className="w-full max-w-lg space-y-8">
          {/* Brand */}
          <div className="flex items-center gap-3 justify-center">
            <div className="w-10 h-10 rounded-lg bg-primary text-on-primary flex items-center justify-center font-bold">
              N
            </div>
            <div>
              <div className="t-heading-lg tracking-tight">NEXORA Hotel OS</div>
              <div className="t-micro text-ink-faint uppercase tracking-[0.18em]">Desktop Edition · Offline</div>
            </div>
          </div>

          {error && (
            <div className="bg-danger-tint border border-danger-line rounded-lg p-3.5 text-xs text-danger-deep flex items-start gap-2.5">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span className="font-medium">{error}</span>
            </div>
          )}

          {/* ------------------------- WELCOME ------------------------- */}
          {step === 'welcome' && (
            <div className="space-y-6">
              <div className="text-center space-y-3">
                <div className="w-14 h-14 rounded-2xl bg-accent-tint text-primary flex items-center justify-center mx-auto">
                  <ShieldCheck className="w-7 h-7" />
                </div>
                <h1 className="t-display-lg">Set up your hotel</h1>
                <p className="t-body-md text-ink-mute max-w-md mx-auto">
                  This copy of NEXORA runs <strong className="text-ink">entirely on this computer</strong> — your data, your
                  booking records and your guest QR system never leave the machine. The seller's activation code switches it on.
                </p>
              </div>

              <div className="grid gap-3">
                {[
                  { icon: Download, title: '1 · You downloaded & installed NEXORA', text: 'Done — nothing more to install.' },
                  { icon: KeyRound, title: '2 · Get your activation from the seller', text: 'They send an activation code + your username & password.' },
                  { icon: ShieldCheck, title: '3 · Activate once', text: 'Your hotel is created on this PC. No internet needed.' },
                ].map((s) => (
                  <div key={s.title} className="flex items-start gap-3.5 bg-canvas-soft rounded-xl p-4">
                    <s.icon className="w-5 h-5 text-primary mt-0.5 shrink-0" />
                    <div>
                      <div className="t-body-strong">{s.title}</div>
                      <div className="t-caption text-ink-mute">{s.text}</div>
                    </div>
                  </div>
                ))}
              </div>

              <div className="space-y-3">
                <button onClick={() => setStep('activation')} className="btn-primary-dark w-full py-3.5">
                  I have an activation
                  <ArrowRight className="w-4 h-4" />
                </button>
                {status?.demoAvailable && (
                  <button
                    onClick={() => doActivate(true)}
                    disabled={step === 'activating'}
                    className="btn-secondary-outline w-full py-3"
                  >
                    <Sparkles className="w-4 h-4" />
                    Use a demo activation (developer build)
                  </button>
                )}
              </div>
              <p className="t-caption text-ink-faint text-center">
                Lost your activation? Contact the seller — they can re-issue it for this machine.
              </p>
            </div>
          )}

          {/* ----------------------- ACTIVATION ------------------------ */}
          {step === 'activation' && (
            <div className="space-y-5">
              <button onClick={() => setStep('welcome')} className="inline-flex items-center gap-1.5 t-caption text-ink-mute hover:text-ink">
                <ArrowLeft className="w-3.5 h-3.5" /> Back
              </button>
              <div>
                <h2 className="t-display-md">Paste your activation</h2>
                <p className="t-caption text-ink-mute mt-1">
                  From the seller's message, copy the long activation string — or choose the{' '}
                  <strong className="text-ink">.nexora</strong> file they sent.
                </p>
              </div>

              <div>
                <label className="block t-button-cap text-ink mb-1.5">Activation string</label>
                <textarea
                  value={activation}
                  onChange={(e) => setActivation(e.target.value)}
                  rows={4}
                  placeholder="Paste the activation string here…"
                  className="input-super w-full p-3 font-mono text-[11px] leading-relaxed resize-none"
                />
              </div>

              <label className="flex items-center justify-center gap-2.5 border-2 border-dashed border-hairline rounded-xl p-5 cursor-pointer hover:border-primary hover:bg-accent-tint transition-colors">
                <FileUp className="w-5 h-5 text-primary" />
                <span className="t-body-md">
                  {fileName ? <span className="text-ink font-semibold">{fileName}</span> : 'Or choose the .nexora activation file'}
                </span>
                <input type="file" accept=".nexora,.json,text/plain,application/json" className="hidden" onChange={(e) => onFile(e.target.files?.[0] || null)} />
              </label>

              {preview && (
                <div className="bg-success-tint border border-success-line rounded-xl p-4 space-y-1">
                  <div className="flex items-center gap-2 text-success-mid">
                    <CheckCircle2 className="w-4 h-4" />
                    <span className="t-body-strong">Activation looks good</span>
                  </div>
                  <div className="t-caption text-ink">
                    {preview.hotelName} · License <span className="font-mono">{preview.code}</span> · owner {preview.ownerName}
                  </div>
                </div>
              )}

              <button onClick={goCredentials} disabled={!activation} className="btn-primary-dark w-full py-3">
                Continue
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* ----------------------- CREDENTIALS ----------------------- */}
          {step === 'credentials' && (
            <div className="space-y-5">
              <button onClick={() => setStep('activation')} className="inline-flex items-center gap-1.5 t-caption text-ink-mute hover:text-ink">
                <ArrowLeft className="w-3.5 h-3.5" /> Back
              </button>
              <div>
                <h2 className="t-display-md">
                  {preview ? `${preview.hotelName} — sign in details` : 'Your sign-in details'}
                </h2>
                <p className="t-caption text-ink-mute mt-1">
                  Enter exactly the username & password the seller gave you. They are verified against your activation.
                </p>
              </div>

              <div>
                <label className="block t-button-cap text-ink mb-1.5">Username</label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-ink-faint">
                    <User className="w-4 h-4" />
                  </div>
                  <input
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    autoComplete="username"
                    placeholder="your hotel account"
                    className="input-super pl-9 pr-3 py-2.5"
                  />
                </div>
                {preview && username && username.toLowerCase() !== preview.username && (
                  <p className="t-micro text-warn-deep mt-1">This activation was issued for “{preview.username}” — check with the seller.</p>
                )}
              </div>

              <div>
                <label className="block t-button-cap text-ink mb-1.5">Password</label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-ink-faint">
                    <KeyRound className="w-4 h-4" />
                  </div>
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete="new-password"
                    placeholder="At least 8 characters"
                    className="input-super pl-9 pr-10 py-2.5 font-mono"
                  />
                  <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute inset-y-0 right-0 pr-3 text-ink-faint hover:text-ink">
                    {showPassword ? 'Hide' : 'Show'}
                  </button>
                </div>
              </div>

              <div>
                <label className="block t-button-cap text-ink mb-1.5">Confirm password</label>
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  autoComplete="new-password"
                  placeholder="Repeat it"
                  className="input-super w-full px-3 py-2.5 font-mono"
                />
                {passwordMismatch && <p className="t-micro text-danger-deep mt-1">Passwords do not match.</p>}
              </div>

              <button onClick={() => doActivate(false)} disabled={!canSubmit} className="btn-primary-dark w-full py-3">
                <ShieldCheck className="w-4 h-4" />
                Activate NEXORA
              </button>
              {status?.demoAvailable && (
                <p className="t-caption text-ink-faint text-center">
                  Developer build? <button className="text-primary underline" onClick={() => doActivate(true)}>Use demo activation instead</button>.
                </p>
              )}
            </div>
          )}

          {/* ----------------------- ACTIVATING ------------------------ */}
          {step === 'activating' && (
            <div className="text-center space-y-4 py-16">
              <Loader2 className="w-8 h-8 text-primary animate-spin mx-auto" />
              <p className="t-body-md text-ink-mute">Verifying your activation and creating your hotel…</p>
            </div>
          )}

          {/* -------------------------- DONE --------------------------- */}
          {step === 'done' && (
            <div className="text-center space-y-4 py-16">
              <div className="w-16 h-16 rounded-full bg-success-tint text-success-mid flex items-center justify-center mx-auto">
                <CheckCircle2 className="w-8 h-8" />
              </div>
              <h2 className="t-display-md">Welcome to NEXORA 🎉</h2>
              <p className="t-caption text-ink-mute max-w-sm mx-auto">
                {preview?.hotelName || 'Your hotel'} is now running on this computer. All data stays local — take a backup
                regularly from Settings.
              </p>
            </div>
          )}
        </div>
      </div>

      <footer className="border-t border-hairline py-4 px-6">
        <div className="max-w-lg mx-auto flex items-center justify-between">
          <span className="t-micro text-ink-faint">NEXORA Desktop Edition · works without internet</span>
          <span className="t-micro text-ink-mute">Questions? Ask your seller</span>
        </div>
      </footer>
    </div>
  );
};
