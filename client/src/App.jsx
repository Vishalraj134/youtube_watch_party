import React, { useState, useEffect, useCallback } from 'react';
import Navbar from './components/Navbar';
import HomePage from './pages/HomePage';
import WatchRoomPage from './pages/WatchRoomPage';
import { getSocket, createRoomSocket, joinRoomSocket, leaveRoomSocket } from './services/socket';
import './App.css';

export default function App() {
  const [currentView, setCurrentView] = useState('home'); // 'home' | 'room'
  const [backendStatus, setBackendStatus] = useState({
    isOnline: false,
    version: null,
    uptimeSeconds: 0,
    activeRooms: 0,
  });
  const [isCheckingHealth, setIsCheckingHealth] = useState(false);
  const [initialRoomCode, setInitialRoomCode] = useState('');

  // Active user session and authoritative room state from backend
  const [currentUser, setCurrentUser] = useState(null);
  const [roomData, setRoomData] = useState(null);

  // Check URL query parameters for invite links (e.g., ?room=WP-4291)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const roomParam = params.get('room');
    if (roomParam) {
      setInitialRoomCode(roomParam.trim().toUpperCase());
    }
  }, []);

  // Initialize socket on mount
  useEffect(() => {
    const socket = getSocket();
    return () => {
      // Disconnect socket on page unload if needed
    };
  }, []);

  // Health check verification against backend /api/health
  const checkBackendHealth = useCallback(async () => {
    setIsCheckingHealth(true);
    try {
      const response = await fetch('/api/health');
      if (response.ok) {
        const data = await response.json();
        setBackendStatus({
          isOnline: true,
          version: data.version,
          uptimeSeconds: data.uptimeSeconds,
          activeRooms: data.activeRooms || 0,
        });
      } else {
        setBackendStatus({ isOnline: false, version: null, uptimeSeconds: 0, activeRooms: 0 });
      }
    } catch {
      try {
        const fallbackRes = await fetch('http://localhost:5000/api/health');
        if (fallbackRes.ok) {
          const fallbackData = await fallbackRes.json();
          setBackendStatus({
            isOnline: true,
            version: fallbackData.version,
            uptimeSeconds: fallbackData.uptimeSeconds,
            activeRooms: fallbackData.activeRooms || 0,
          });
        } else {
          setBackendStatus({ isOnline: false, version: null, uptimeSeconds: 0, activeRooms: 0 });
        }
      } catch {
        setBackendStatus({ isOnline: false, version: null, uptimeSeconds: 0, activeRooms: 0 });
      }
    } finally {
      setIsCheckingHealth(false);
    }
  }, []);

  useEffect(() => {
    checkBackendHealth();
    const interval = setInterval(checkBackendHealth, 30000);
    return () => clearInterval(interval);
  }, [checkBackendHealth]);

  // Handler for creating a party room via Socket.IO
  const handleCreateRoom = async ({ username, initialVideoUrl, policy }) => {
    const result = await createRoomSocket({ username, initialVideoUrl, policy });
    setRoomData(result.room);
    setCurrentUser(result.user);
    setCurrentView('room');
    return result;
  };

  // Handler for joining an existing party room via Socket.IO
  const handleJoinRoom = async ({ username, roomCode }) => {
    const result = await joinRoomSocket({ username, roomCode });
    setRoomData(result.room);
    setCurrentUser(result.user);
    setCurrentView('room');
    return result;
  };

  // Handler for leaving a room
  const handleLeaveRoom = () => {
    if (roomData?.roomCode) {
      leaveRoomSocket(roomData.roomCode);
    }
    setRoomData(null);
    setCurrentUser(null);
    setCurrentView('home');
  };

  return (
    <div className="app-wrapper">
      <Navbar
        currentView={currentView}
        onNavigate={(view) => {
          // If in a room and navigating to home, warn or leave
          if (view === 'home' && currentView === 'room') {
            handleLeaveRoom();
          } else {
            setCurrentView(view);
          }
        }}
        backendStatus={backendStatus}
        onRetryHealth={checkBackendHealth}
        isCheckingHealth={isCheckingHealth}
      />

      <main className="main-content">
        {currentView === 'home' || !roomData ? (
          <HomePage
            onCreateRoom={handleCreateRoom}
            onJoinRoom={handleJoinRoom}
            initialRoomCode={initialRoomCode}
          />
        ) : (
          <WatchRoomPage
            initialRoomData={roomData}
            currentUser={currentUser}
            onLeaveRoom={handleLeaveRoom}
          />
        )}
      </main>
    </div>
  );
}
