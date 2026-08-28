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
  }, [setActiveExperience, setGuestRoomToken]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="text-center space-y-3">
          <div className="w-10 h-10 border-3 border-[#ff385c] border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-xs font-semibold text-[#6a6a6a]">Loading Nexora Platform...</p>
        </div>
      </div>
    );
  }

  // If in guest experience (e.g. scanning QR code in a hotel room)
  if (activeExperience === 'guest_experience') {
    return (
      <div className="min-h-screen bg-white text-[#222222] flex flex-col font-sans">
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
    <div className="min-h-screen bg-white text-[#222222] flex flex-col font-sans selection:bg-[#ffd1da] selection:text-[#ff385c]">
      <Header />
      <div className="flex-1">
        {activeExperience === 'super_admin' && <SuperAdminDashboard />}
        {activeExperience === 'hotel_os' && <HotelAdminLayout />}
      </div>
    </div>
  );
};

export default function App() {
  return (
    <AuthProvider>
      <MainAppContent />
    </AuthProvider>
  );
}
