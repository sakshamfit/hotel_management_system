/**
 * Seller Console → Desktop Licences.
 *
 * Marg-style distribution: the seller issues a signed activation for a
 * customer's hotel, downloads/sends the .nexora file (or the one-line
 * activation string) plus username & password. The customer's copy runs
 * fully offline; the licence row here is the paper trail + re-issue source.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { supabase } from '../../supabase/config';
import {
  Download,
  KeyRound,
  Plus,
  Copy,
  RefreshCw,
  ShieldCheck,
  Trash2,
  Ban,
  CheckCircle2,
  AlertCircle,
  X,
  Eye,
  EyeOff,
} from 'lucide-react';

export interface DesktopLicense {
  id: string;
  code: string;
  hotelName: string;
  ownerName: string;
  username: string;
  email?: string | null;
  status: string;
  issuedAt: string;
  activatedAt?: string | null;
  expiresAt?: string | null;
  notes?: string | null;
  activationString?: string;
}

const STATUS_STYLES: Record<string, string> = {
  issued: 'bg-accent-tint text-primary-deep',
  activated: 'bg-success-tint text-success-mid',
  expired: 'bg-warn-tint text-warn-deep',
  revoked: 'bg-danger-tint text-danger-deep',
};

function copyText(text: string): Promise<void> {
  return navigator.clipboard.writeText(text).catch(() => {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  });
}

async function withToken(): Promise<string> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error('Not signed in as Super Admin.');
  return session.access_token;
}

async function api(path: string, init: RequestInit = {}): Promise<any> {
  const token = await withToken();
  const res = await fetch(path, {
    ...init,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(init.headers || {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `Request failed (HTTP ${res.status}).`);
  return data;
}

export const LicensesTab: React.FC = () => {
  const [licenses, setLicenses] = useState<DesktopLicense[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data } = await api('/api/licenses');
      setLicenses(data || []);
    } catch (err: any) {
      setError(err?.message || 'Could not load licences.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const flash = (msg: string) => {
    setNotice(msg);
    setTimeout(() => setNotice(null), 4000);
  };

  const downloadNexora = async (l: DesktopLicense) => {
    try {
      const token = await withToken();
      const res = await fetch(`/api/licenses/${l.id}/download`, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error('Download failed.');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `nexora-${l.hotelName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${l.code.replace(/^NX-/, '')}.nexora`;
      a.click();
      URL.revokeObjectURL(url);
      flash('Activation file downloaded — send it with the credentials.');
    } catch (err: any) {
      setError(err?.message || 'Download failed.');
    }
  };

  const revealCredentials = async (l: DesktopLicense) => {
    if (revealed[l.id]) return setRevealed((r) => ({ ...r, [l.id]: '' }));
    setBusyId(l.id);
    try {
      const { username, password } = await api(`/api/licenses/${l.id}/credentials`);
      setRevealed((r) => ({ ...r, [l.id]: `${username} / ${password}` }));
    } catch (err: any) {
      setError(err?.message || 'Could not recover credentials.');
    } finally {
      setBusyId(null);
    }
  };

  const setStatus = async (l: DesktopLicense, status: string) => {
    if (!window.confirm(`Mark ${l.hotelName} (${l.code}) as ${status}?`)) return;
    setBusyId(l.id);
    try {
      await api(`/api/licenses/${l.id}/status`, { method: 'POST', body: JSON.stringify({ status }) });
      await load();
      flash(`Licence marked ${status}.`);
    } catch (err: any) {
      setError(err?.message || 'Could not update the licence.');
    } finally {
      setBusyId(null);
    }
  };

  const del = async (l: DesktopLicense) => {
    if (!window.confirm(`Delete licence ${l.code} for ${l.hotelName}? Already-activated copies keep working (offline licensing).`)) return;
    setBusyId(l.id);
    try {
      await api(`/api/licenses/${l.id}`, { method: 'DELETE' });
      await load();
      flash('Licence deleted.');
    } catch (err: any) {
      setError(err?.message || 'Could not delete the licence.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="t-display-md">Desktop licences</h2>
          <p className="t-caption text-ink-mute mt-1 max-w-2xl">
            Issue activations for customers who run NEXORA on their own computer (Marg-style). Each licence creates a
            signed activation + username & password you share with the buyer.
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => load()} className="btn-secondary-outline py-2.5">
            <RefreshCw className="w-4 h-4" /> Refresh
          </button>
          <button onClick={() => setShowCreate(true)} className="btn-primary-dark py-2.5">
            <Plus className="w-4 h-4" /> Issue licence
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-danger-tint border border-danger-line rounded-lg p-3.5 text-xs text-danger-deep flex items-start gap-2.5">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span className="font-medium">{error}</span>
          <button className="ml-auto t-micro underline" onClick={() => setError(null)}>dismiss</button>
        </div>
      )}
      {notice && (
        <div className="bg-success-tint border border-success-line rounded-lg p-3.5 text-xs text-success-mid flex items-start gap-2.5">
          <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
          <span className="font-medium">{notice}</span>
        </div>
      )}

      <div className="rounded-xl border border-hairline overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-canvas-soft t-button-cap text-ink-mute">
            <tr>
              <th className="text-left px-4 py-3">Hotel</th>
              <th className="text-left px-4 py-3">Licence</th>
              <th className="text-left px-4 py-3">Username</th>
              <th className="text-left px-4 py-3">Status</th>
              <th className="text-left px-4 py-3">Issued</th>
              <th className="text-right px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {licenses.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center t-caption text-ink-mute">
                  {loading ? 'Loading licences…' : 'No desktop licences yet. Click "Issue licence" to create the first one.'}
                </td>
              </tr>
            )}
            {licenses.map((l) => (
              <tr key={l.id} className="border-t border-hairline">
                <td className="px-4 py-3">
                  <div className="t-body-strong">{l.hotelName}</div>
                  <div className="t-micro text-ink-mute">{l.ownerName}</div>
                </td>
                <td className="px-4 py-3 font-mono t-micro text-ink-mute">{l.code}</td>
                <td className="px-4 py-3 t-caption font-mono">
                  {revealed[l.id] ? (
                    <span className="text-ink">{revealed[l.id]}</span>
                  ) : (
                    <span>{l.username}</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  <span className={`inline-flex px-2.5 py-1 rounded-full t-micro uppercase tracking-wide ${STATUS_STYLES[l.status] || 'bg-canvas-soft text-ink-mute'}`}>
                    {l.status}
                  </span>
                </td>
                <td className="px-4 py-3 t-caption text-ink-mute">{new Date(l.issuedAt).toLocaleDateString()}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-end gap-1">
                    <button title="Download .nexora activation file" onClick={() => downloadNexora(l)} disabled={busyId === l.id} className="p-2 rounded-lg hover:bg-canvas-soft text-ink-mute hover:text-ink">
                      <Download className="w-4 h-4" />
                    </button>
                    {l.activationString && (
                      <button
                        title="Copy activation string"
                        onClick={async () => {
                          await copyText(l.activationString!);
                          flash('Activation string copied — paste it into your message to the customer.');
                        }}
                        className="p-2 rounded-lg hover:bg-canvas-soft text-ink-mute hover:text-ink"
                      >
                        <Copy className="w-4 h-4" />
                      </button>
                    )}
                    <button title="Show credentials" onClick={() => revealCredentials(l)} disabled={busyId === l.id} className="p-2 rounded-lg hover:bg-canvas-soft text-ink-mute hover:text-ink">
                      {revealed[l.id] ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                    {(l.status === 'issued') && (
                      <button title="Mark activated" onClick={() => setStatus(l, 'activated')} disabled={busyId === l.id} className="p-2 rounded-lg hover:bg-success-tint text-success-mid">
                        <CheckCircle2 className="w-4 h-4" />
                      </button>
                    )}
                    {l.status !== 'revoked' && (
                      <button title="Revoke" onClick={() => setStatus(l, 'revoked')} disabled={busyId === l.id} className="p-2 rounded-lg hover:bg-danger-tint text-danger-deep">
                        <Ban className="w-4 h-4" />
                      </button>
                    )}
                    <button title="Delete" onClick={() => del(l)} disabled={busyId === l.id} className="p-2 rounded-lg hover:bg-danger-tint text-danger-deep">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showCreate && <CreateLicenseModal onClose={() => setShowCreate(false)} onCreated={() => { setShowCreate(false); load(); }} />}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Issue modal
// ---------------------------------------------------------------------------
const CreateLicenseModal: React.FC<{ onClose: () => void; onCreated: () => void }> = ({ onClose, onCreated }) => {
  const [hotelName, setHotelName] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [email, setEmail] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ license: DesktopLicense & { activationString: string }; credentials: { username: string; password: string } } | null>(null);

  const autoUsername = () => {
    const base = (hotelName || 'hotel').toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 14);
    setUsername(base ? `${base}${Math.floor(100 + Math.random() * 900)}` : `owner${Math.floor(100 + Math.random() * 900)}`);
  };

  const autoPassword = () => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
    let out = '';
    for (let i = 0; i < 12; i++) out += chars[Math.floor(Math.random() * chars.length)];
    setPassword(`${out}1!`);
  };

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const data = await api('/api/licenses', {
        method: 'POST',
        body: JSON.stringify({
          hotelName,
          ownerName,
          username,
          password,
          email: email || undefined,
          expiresAt: expiresAt || undefined,
          notes: notes || undefined,
        }),
      });
      setResult(data);
    } catch (err: any) {
      setError(err?.message || 'Could not issue the licence.');
    } finally {
      setBusy(false);
    }
  };

  if (result) {
    const l = result.license;
    return (
      <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
        <div className="bg-canvas rounded-2xl max-w-xl w-full p-6 space-y-5 max-h-[90vh] overflow-y-auto">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-lg bg-success-tint text-success-mid flex items-center justify-center">
                <ShieldCheck className="w-5 h-5" />
              </div>
              <div>
                <h3 className="t-heading-lg">Licence issued 🎉</h3>
                <p className="t-caption text-ink-mute">Share these with the customer — they paste the activation string on first run.</p>
              </div>
            </div>
            <button onClick={onCreated} className="text-ink-mute hover:text-ink"><X className="w-5 h-5" /></button>
          </div>

          <div className="bg-canvas-soft rounded-xl p-4 space-y-2">
            <Row label="Hotel" value={l.hotelName} />
            <Row label="Licence code" value={l.code} mono />
            <Row label="Username" value={result.credentials.username} mono copyable />
            <Row label="Password" value={result.credentials.password} mono copyable />
          </div>

          <div>
            <label className="block t-button-cap text-ink mb-1.5">Activation string (send with the credentials)</label>
            <div className="flex gap-2">
              <textarea readOnly value={l.activationString} rows={4} className="input-super flex-1 p-3 font-mono text-[10px] leading-relaxed resize-none" />
              <button
                onClick={async () => {
                  await copyText(l.activationString);
                  alert('Copied!');
                }}
                className="btn-secondary-outline self-start py-2.5"
              >
                <Copy className="w-4 h-4" /> Copy
              </button>
            </div>
          </div>

          <div className="flex items-center justify-between">
            <button onClick={() => setResult(null)} className="t-caption text-ink-mute hover:text-ink">← Issue another</button>
            <div className="flex gap-2">
              <button
                onClick={async () => {
                  try {
                    const token = await withToken();
                    const res = await fetch(`/api/licenses/${l.id}/download`, { headers: { Authorization: `Bearer ${token}` } });
                    if (res.ok) {
                      const blob = await res.blob();
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement('a');
                      a.href = url;
                      a.download = `nexora-${l.hotelName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${l.code.replace(/^NX-/, '')}.nexora`;
                      a.click();
                      URL.revokeObjectURL(url);
                    }
                  } catch {
                    /* row action also downloads */
                  }
                }}
                className="btn-secondary-outline py-2.5"
              >
                <Download className="w-4 h-4" /> .nexora file
              </button>
              <button onClick={onCreated} className="btn-primary-dark py-2.5">Done</button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <div className="bg-canvas rounded-2xl max-w-xl w-full p-6 space-y-5 max-h-[90vh] overflow-y-auto">
        <div className="flex items-start justify-between">
          <div>
            <h3 className="t-heading-lg">Issue a desktop licence</h3>
            <p className="t-caption text-ink-mute mt-1">Creates a signed activation for one hotel installation.</p>
          </div>
          <button onClick={onClose} className="text-ink-mute hover:text-ink"><X className="w-5 h-5" /></button>
        </div>

        {error && (
          <div className="bg-danger-tint border border-danger-line rounded-lg p-3.5 text-xs text-danger-deep flex items-start gap-2.5">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span className="font-medium">{error}</span>
          </div>
        )}

        <div className="grid gap-4">
          <Field label="Hotel name" value={hotelName} onChange={setHotelName} placeholder="The Grand Palace" />
          <div className="grid sm:grid-cols-2 gap-4">
            <Field label="Owner name" value={ownerName} onChange={setOwnerName} placeholder="Rahul Sharma" />
            <Field label="Customer email (optional)" value={email} onChange={setEmail} placeholder="owner@hotel.com" type="email" />
          </div>

          <Field label="Username" value={username} onChange={setUsername} placeholder="grandpalace" mono>
            <button type="button" onClick={autoUsername} className="t-micro text-primary hover:underline">suggest</button>
          </Field>

          <div>
            <label className="block t-button-cap text-ink mb-1.5">Password (min 8 chars)</label>
            <div className="flex gap-2">
              <input type={showPassword ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 8 characters" className="input-super flex-1 px-3 py-2.5 font-mono" />
              <button type="button" onClick={() => setShowPassword(!showPassword)} className="btn-secondary-outline py-2.5 px-3">
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
              <button type="button" onClick={autoPassword} className="btn-secondary-outline py-2.5 px-3">Generate</button>
            </div>
          </div>

          <div className="grid sm:grid-cols-2 gap-4">
            <Field label="Expires (optional)" value={expiresAt} onChange={setExpiresAt} placeholder="2027-12-31" type="date" />
            <Field label="Notes" value={notes} onChange={setNotes} placeholder="Branch 2 — bought over phone" />
          </div>
        </div>

        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="btn-secondary-outline py-2.5">Cancel</button>
          <button
            onClick={submit}
            disabled={busy || !hotelName || !username || password.length < 8}
            className="btn-primary-dark py-2.5"
          >
            {busy ? 'Signing…' : (<><KeyRound className="w-4 h-4" /> Issue licence</>)}
          </button>
        </div>
      </div>
    </div>
  );
};

const Field: React.FC<{
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  mono?: boolean;
  children?: React.ReactNode;
}> = ({ label, value, onChange, placeholder, type = 'text', mono, children }) => (
  <div>
    <label className="block t-button-cap text-ink mb-1.5 flex items-center justify-between">
      <span>{label}</span>
      {children}
    </label>
    <input type={type} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className={`input-super w-full px-3 py-2.5 ${mono ? 'font-mono' : ''}`} />
  </div>
);

const Row: React.FC<{ label: string; value: string; mono?: boolean; copyable?: boolean }> = ({ label, value, mono, copyable }) => (
  <div className="flex items-center justify-between gap-4 py-0.5">
    <span className="t-caption text-ink-mute">{label}</span>
    <span className={`t-caption text-ink flex items-center gap-1.5 ${mono ? 'font-mono' : ''}`}>
      {value}
      {copyable && (
        <button
          onClick={async () => {
            await copyText(value);
            alert('Copied!');
          }}
          className="text-primary hover:text-primary-hover"
          title="Copy"
        >
          <Copy className="w-3.5 h-3.5" />
        </button>
      )}
    </span>
  </div>
);
