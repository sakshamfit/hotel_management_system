/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { Header } from './components/common/Header';
import { SuperAdminDashboard } from './components/super-admin/SuperAdminDashboard';
import { HotelAdminLayout } from './components/hotel-admin/HotelAdminLayout';
import { GuestRoomView } from './components/guest/GuestRoomView';
import { LoginPage } from './components/auth/LoginPage';
import { isSupabaseConfigured } from './supabase/config';

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

const Code: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <code className="font-mono text-[0.85em] bg-violet-soft/50 text-primary-deep px-1.5 py-0.5 rounded">
    {children}
  </code>
);

const SetupRequiredScreen: React.FC = () => {
  const steps = [
    <>
      Copy the environment template: <Code>cp .env.example .env</Code>
    </>,
    <>
      Create a Supabase project (supabase.com → <em>New project</em>), enable
      <strong> Email</strong> and <strong>Anonymous sign-ins</strong> under
      Authentication → Providers.
    </>,
    <>
      In <Code>.env</Code> set <Code>VITE_SUPABASE_URL</Code>,{' '}
      <Code>VITE_SUPABASE_ANON_KEY</Code> and <Code>SUPABASE_SERVICE_ROLE_KEY</Code>{' '}
      (Dashboard → Project Settings → API).
    </>,
    <>
      Apply the schema: <Code>supabase db push</Code> (or paste{' '}
      <Code>supabase/migrations/0001_init.sql</Code> into the SQL editor).
    </>,
    <>
      Provision the first super admin: <Code>npm run create-super-admin -- --email you@example.com</Code>
    </>,
    <>
      Restart the dev server: <Code>npm run dev</Code>
    </>,
  ];

  return (
    <div className="min-h-screen bg-canvas flex items-center justify-center p-6">
      <div className="w-full max-w-xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl shadow-xl p-8 space-y-5">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center font-bold text-lg">
            N
          </div>
          <div>
            <h1 className="text-xl font-semibold text-ink leading-tight">NEXORA HOTEL OS</h1>
            <p className="t-caption text-ink-mute">Backend not configured</p>
          </div>
        </div>

        <p className="text-ink-mute text-sm leading-relaxed">
          The app can&rsquo;t reach Supabase because the environment is missing. The server is
          running fine — it just needs your Supabase credentials.
        </p>

        <ol className="space-y-2.5">
          {steps.map((step, i) => (
            <li key={i} className="flex gap-3 text-sm text-ink-mute">
              <span className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/10 text-primary text-xs font-semibold flex items-center justify-center mt-0.5">
                {i + 1}
              </span>
              <span className="leading-relaxed">{step}</span>
            </li>
          ))}
        </ol>

        <p className="text-xs text-ink-mute pt-2 border-t border-zinc-200 dark:border-zinc-800">
          Full walkthrough: <Code>docs/supabase-setup.md</Code>. This page reappears automatically
          once the credentials are in place.
        </p>
      </div>
    </div>
  );
};

export default function App() {
  if (!isSupabaseConfigured) return <SetupRequiredScreen />;

  return (
    <AuthProvider>
      <MainAppContent />
    </AuthProvider>
  );
}
