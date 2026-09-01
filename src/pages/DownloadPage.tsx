/**
 * Public "Download NEXORA Desktop Edition" page — the Marg-style sales funnel.
 * The seller's site links here; buyers grab the installer, install it, and the
 * seller activates their copy with credentials.
 */
import React, { useState } from 'react';
import {
  Download,
  ShieldCheck,
  WifiOff,
  KeyRound,
  ArrowRight,
  CheckCircle2,
  FileDown,
  HardDrive,
  Users,
  QrCode,
  AlertCircle,
} from 'lucide-react';

const DOWNLOAD_URL: string =
  (import.meta.env.VITE_DESKTOP_DOWNLOAD_URL as string | undefined) || '/downloads/nexora-setup.exe';

export const DownloadPage: React.FC = () => {
  const [downloaded, setDownloaded] = useState(false);

  return (
    <div className="min-h-screen bg-canvas text-ink flex flex-col font-sans">
      {/* ---------- Header ---------- */}
      <header className="px-6 sm:px-10 py-5 border-b border-hairline">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <a href="/" className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-primary text-on-primary flex items-center justify-center font-bold text-base">N</div>
            <span className="t-heading-lg tracking-tight" style={{ fontSize: 17 }}>NEXORA Hotel OS</span>
          </a>
          <a href="/" className="t-caption text-ink-mute hover:text-ink">Back to sign in</a>
        </div>
      </header>

      {/* ---------- Hero ---------- */}
      <section className="bg-surface-tile-1 text-on-primary">
        <div className="max-w-6xl mx-auto px-6 sm:px-10 py-16 sm:py-24 grid lg:grid-cols-2 gap-12 items-center">
          <div className="space-y-6">
            <p className="t-micro uppercase tracking-[0.18em] text-primary-on-dark">Desktop Edition · Windows</p>
            <h1 className="t-display-xl text-on-primary">Own the software.<br />Run it on your computer.</h1>
            <p className="t-body-lg text-on-dark-mute max-w-md" style={{ fontWeight: 300 }}>
              Download NEXORA once, install it at your hotel, and your seller switches it on with your
              credentials. Every booking, every guest stays on <strong className="text-on-primary">your</strong> machine —
              it works even when the internet doesn't.
            </p>
            <div className="flex flex-col sm:flex-row gap-3">
              <a
                href={DOWNLOAD_URL}
                download
                onClick={() => setDownloaded(true)}
                className="btn-on-dark-pill py-4 px-6 !text-base"
              >
                <Download className="w-5 h-5" />
                Download installer (Windows)
              </a>
              <a href="#how-it-works" className="btn-secondary-outline py-4 px-6 !text-base !border-on-dark-faint !text-on-primary">
                How it works
              </a>
            </div>
            {downloaded && (
              <p className="t-caption text-primary-on-dark flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4" /> Download started. Once installed, contact your seller for the activation.
              </p>
            )}
            <div className="flex flex-wrap gap-x-6 gap-y-2 text-on-dark-faint">
              <span className="t-micro uppercase tracking-wider">Free download</span>
              <span className="t-micro uppercase tracking-wider">No internet required to run</span>
              <span className="t-micro uppercase tracking-wider">Your data stays local</span>
            </div>
          </div>

          <div className="bg-surface-tile-2 rounded-2xl p-6 sm:p-8 border border-hairline-dark">
            <div className="space-y-4">
              {[
                { icon: KeyRound, title: '1 · Download & install', text: 'Run the installer — no account, no card. Takes a minute.' },
                { icon: ShieldCheck, title: '2 · Get your activation', text: 'Your seller sends your activation code + username + password.' },
                { icon: WifiOff, title: '3 · Activate — offline', text: 'Open NEXORA, paste the code, sign in. Everything is local.' },
                { icon: HardDrive, title: '4 · Run your hotel', text: 'Rooms, front desk, QR check-in, F&B, housekeeping — all on this PC.' },
              ].map((s) => (
                <div key={s.title} className="flex gap-4 items-start">
                  <div className="w-10 h-10 rounded-xl bg-surface-tile-3 border border-hairline-dark flex items-center justify-center text-primary-on-dark shrink-0">
                    <s.icon className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="t-body-strong text-on-primary">{s.title}</div>
                    <div className="t-caption text-on-dark-mute">{s.text}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ---------- Feature bands ---------- */}
      <section className="py-16 sm:py-20">
        <div className="max-w-6xl mx-auto px-6 sm:px-10">
          <h2 className="t-display-lg max-w-xl">Everything you already run in the cloud — now on your desk.</h2>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 mt-10">
            {[
              { icon: Users, title: 'Front desk & guests', text: 'Check-in/out, folios, payments, ID records.' },
              { icon: QrCode, title: 'Guest QR system', text: 'Scan the room QR — guests order food & services in-room.' },
              { icon: HardDrive, title: '100% local data', text: 'SQLite database on your PC. Backups are one click.' },
              { icon: WifiOff, title: 'Works offline', text: 'No internet needed after setup. No monthly cloud bill.' },
            ].map((f) => (
              <div key={f.title} className="rounded-xl border border-hairline p-5">
                <f.icon className="w-6 h-6 text-primary" />
                <div className="t-body-strong mt-3">{f.title}</div>
                <p className="t-caption text-ink-mute mt-1">{f.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ---------- How it works ---------- */}
      <section id="how-it-works" className="bg-canvas-soft py-16 sm:py-20">
        <div className="max-w-6xl mx-auto px-6 sm:px-10">
          <h2 className="t-display-lg">How the activation works</h2>
          <div className="grid md:grid-cols-3 gap-4 mt-10">
            {[
              {
                title: 'One machine, one license',
                text: 'Each activation creates the hotel owner account on that computer. The code is signed — it can only be used with the matching username & password.',
              },
              {
                title: 'Your seller manages it',
                text: 'They issue, re-issue or renew codes from their seller console. You never see their credentials, and they never see your data.',
              },
              {
                title: 'You own the data',
                text: 'Database and photos live in your data folder. Back up regularly — one click from Settings — or copy the folder to a pen drive.',
              },
            ].map((s, i) => (
              <div key={s.title} className="rounded-xl border border-hairline bg-canvas p-6">
                <div className="w-8 h-8 rounded-full bg-primary text-on-primary flex items-center justify-center text-sm font-bold">{i + 1}</div>
                <div className="t-body-strong mt-4">{s.title}</div>
                <p className="t-caption text-ink-mute mt-1.5">{s.text}</p>
              </div>
            ))}
          </div>

          <div className="bg-accent-tint border border-accent-soft rounded-xl p-5 mt-8 flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-primary shrink-0 mt-0.5" />
            <div className="t-caption text-ink">
              <strong>Buying for a hotel?</strong> After downloading, ask the seller for your activation code and
              username/password. Already a NEXORA cloud customer? Your hosted account keeps working side by side — this is a
              separate, self-owned install.
            </div>
          </div>

          <div className="mt-10 text-center">
            <a href={DOWNLOAD_URL} download onClick={() => setDownloaded(true)} className="btn-primary-dark py-4 px-8 !text-base">
              <FileDown className="w-5 h-5" />
              Download NEXORA Desktop Edition
            </a>
          </div>
        </div>
      </section>

      {/* ---------- Footer ---------- */}
      <footer className="bg-surface-tile-1 py-10 text-on-dark-mute">
        <div className="max-w-6xl mx-auto px-6 sm:px-10 flex flex-col sm:flex-row justify-between gap-4">
          <div>
            <div className="t-body-strong text-on-primary">NEXORA HOTEL OS</div>
            <div className="t-caption mt-1">Desktop Edition · works without internet</div>
          </div>
          <a href="/" className="inline-flex items-center gap-1.5 t-caption text-primary-on-dark hover:underline">
            Back to sign in <ArrowRight className="w-3.5 h-3.5" />
          </a>
        </div>
      </footer>
    </div>
  );
};
