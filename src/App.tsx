/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { Header } from './components/common/Header';
import { SuperAdminDashboard } from './components/super-admin/SuperAdminDashboard';
import { HotelAdminLayout } from './components/hotel-admin/HotelAdminLayout';
import { GuestRoomView } from './components/guest/GuestRoomView';
import { LoginPage } from './components/auth/LoginPage';
import { LocalSetupWizard } from './components/setup/LocalSetupWizard';
import { DownloadPage } from './pages/DownloadPage';
import { isLocalMode, fetchSetupStatus, type LocalSetupStatus } from './services/local/localApi';
import { isSupabaseConfigured } from './supabase/config';
import { AlertCircle, Loader2 } from 'lucide-react';

const MainAppContent: React.FC = () => {
  const { activeExperience, setActiveExperience, setGuestRoomToken, isLoading } = useAuth();

  useEffect(() => {
    // Check if URL has ?token=... for direct permanent QR scans
    const params = new URLSearchParams(window.location.search);
    const tokenParam = params.get('token');
    if (tokenParam) {
      setGuestRoomToken(tokenParam);
      setActiveExperience('guest_experience');
    }
  }, [setGuestRoomToken, setActiveExperience]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-canvas flex items-center justify-center">
        <div className="text-center space-y-3">
          <div className="w-10 h-10 border-[3px] border-primary border-t-transparent rounded-lg animate-spin mx-auto" />
          <p className="t-caption text-ink-mute">Loading Nexora Platform…</p>
        </div>
      </div>
    );
  }

  // If in guest experience (e.g. scanning QR code in a hotel room)
  if (activeExperience === 'guest_experience') {
    return (
      <div className="min-h-screen bg-canvas text-ink flex flex-col font-sans">
        <Header />
        <div className="flex-1">
          <GuestRoomView />
        </div>
      </div>
    );
  }

  // If unauthenticated / login page mode
  if (activeExperience === 'login') {
    return <LoginPage />;
  }

  return (
    <div className="min-h-screen bg-canvas text-ink flex flex-col font-sans selection:bg-violet-soft/40 selection:text-primary-deep">
      <Header />
      <div className="flex-1">
        {activeExperience === 'super_admin' && <SuperAdminDashboard />}
        {activeExperience === 'hotel_os' && <HotelAdminLayout />}
      </div>
    </div>
  );
};

export default function App() {
  // Public product page: "Download the Desktop Edition" (works in both editions).
  if (window.location.pathname.startsWith('/download')) {
    return <DownloadPage />;
  }

  // Desktop edition — first run shows the activation wizard, then the app.
  if (isLocalMode()) return <LocalEditionGate />;

  // Without Supabase credentials there is no backend at all — show what to set
  // instead of a login form that can only fail (see docs/supabase-setup.md).
  if (!isSupabaseConfigured) return <SetupScreen />;

  return (
    <AuthProvider>
      <MainAppContent />
    </AuthProvider>
  );
}

/** Local (desktop) edition: activation wizard until the machine is licensed. */
const LocalEditionGate: React.FC = () => {
  const [status, setStatus] = useState<LocalSetupStatus | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let mounted = true;
    fetchSetupStatus()
      .then((s) => mounted && setStatus(s))
      .catch(() => mounted && setFailed(true));
    return () => {
      mounted = false;
    };
  }, []);

  if (failed) {
    return (
      <div className="min-h-screen bg-canvas text-ink flex items-center justify-center p-6">
        <div className="max-w-md text-center space-y-4">
          <AlertCircle className="w-8 h-8 text-danger mx-auto" />
          <h1 className="t-display-md">The local service did not respond</h1>
          <p className="t-caption text-ink-mute">
            NEXORA Desktop Edition expects its offline service on this machine. Restart the app, or reinstall if the problem
            continues. Your data is safe in the app's data folder.
          </p>
        </div>
      </div>
    );
  }

  if (!status) {
    return (
      <div className="min-h-screen bg-canvas flex items-center justify-center">
        <div className="text-center space-y-3">
          <Loader2 className="w-8 h-8 text-primary animate-spin mx-auto" />
          <p className="t-caption text-ink-mute">Starting NEXORA…</p>
        </div>
      </div>
    );
  }

  if (!status.activated) {
    return <LocalSetupWizard onActivated={() => setStatus({ ...status, activated: true })} />;
  }

  return (
    <AuthProvider>
      <MainAppContent />
    </AuthProvider>
  );
};

/** Rendered when VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY are missing. */
const SetupScreen: React.FC = () => (
  <div className="min-h-screen bg-canvas text-ink flex items-center justify-center p-6">
    <div className="w-full max-w-lg space-y-6">
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-lg bg-primary text-on-primary flex items-center justify-center font-bold text-base">
          N
        </div>
        <span className="t-heading-lg tracking-tight" style={{ fontSize: 17 }}>
          NEXORA
        </span>
      </div>

      <div className="space-y-2">
        <h1 className="t-display-md tracking-tight">Connect your Supabase project</h1>
        <p className="t-caption text-ink-mute">
          NEXORA runs entirely on Supabase — Postgres + RLS, Realtime, Auth and Storage. Add the
          credentials below, then restart the server.
        </p>
      </div>

      <div className="bg-accent-tint border border-accent-soft rounded-lg p-3.5 text-xs text-primary-deep flex items-start gap-2.5">
        <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
        <span className="font-medium">
          VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are missing or still hold the .env.example
          placeholders, so no data or sign-in can work yet.
        </span>
      </div>

      <ol className="space-y-3">
        {[
          ['Copy the template', 'cp .env.example .env'],
          [
            'Fill in the project values',
            'VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY',
          ],
          ['Apply the schema', 'npm run db:push'],
          ['Provision the first super admin', 'npm run create-super-admin -- --email you@example.com'],
          ['Restart', 'npm run dev'],
        ].map(([title, detail], i) => (
          <li key={title} className="flex gap-3">
            <span className="w-6 h-6 shrink-0 rounded-full bg-primary text-on-primary text-xs font-semibold flex items-center justify-center">
              {i + 1}
            </span>
            <div>
              <p className="t-button-cap text-ink">{title}</p>
              <code className="t-caption font-mono text-ink-mute break-all">{detail}</code>
            </div>
          </li>
        ))}
      </ol>

      <p className="t-caption text-ink-faint">
        Full walkthrough, including Auth provider settings and the redirect URLs password reset
        needs: <code>docs/supabase-setup.md</code>. Looking for the offline version? It ships as the{' '}
        <a className="text-primary underline" href="/download">Desktop Edition</a>.
      </p>
    </div>
  </div>
);
