import React, { useState, useEffect, useRef } from 'react';
import { 
  Play, 
  Pause, 
  RotateCcw, 
  RotateCw, 
  Volume2, 
  VolumeX,
  Users, 
  Crown, 
  Shield, 
  Radio, 
  Lock, 
  Unlock, 
  Clock, 
  Check, 
  X, 
  ArrowLeft,
  Sparkles,
  Wifi,
  UserMinus
} from 'lucide-react';
import YouTubePlayer from '../components/YouTubePlayer';
import YouTubeIcon from '../components/YouTubeIcon';
import RoomBadge from '../components/RoomBadge';
import AlertBanner from '../components/AlertBanner';
import { 
  getSocket, 
  changeVideoSocket, 
  emitPlaybackAction,
  requestControlSocket,
  approveControlSocket,
  rejectControlSocket,
  revokeControlSocket,
  reconnectRoomSocket,
  removeParticipantSocket
} from '../services/socket';

export default function WatchRoomPage({
  initialRoomData,
  currentUser,
  onLeaveRoom,
}) {
  // Authoritative server-synchronized room state
  const [room, setRoom] = useState(initialRoomData);
  const [activeTab, setActiveTab] = useState('participants'); // 'participants', 'requests', 'logs'
  const [isPlaying, setIsPlaying] = useState(room.playbackStatus === 'playing');
  const [currentTimeSec, setCurrentTimeSec] = useState(room.currentTime || 0);
  const [videoDurationSec, setVideoDurationSec] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [newVideoUrl, setNewVideoUrl] = useState('');
  const [isChangingVideo, setIsChangingVideo] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState('connected'); // 'connected' | 'reconnecting' | 'disconnected'
  const [tempSecondsLeft, setTempSecondsLeft] = useState(() => {
    const until = initialRoomData.participants?.find((p) => p.userId === currentUser?.userId)?.temporaryControlUntil;
    return until && until > Date.now() ? Math.ceil((until - Date.now()) / 1000) : 0;
  });
  const [feedbackMessage, setFeedbackMessage] = useState(
    `Connected to room ${room.roomCode}. Real-time YouTube sync engine is active.`
  );
  const [removingUserId, setRemovingUserId] = useState(null);
  const [wasRemoved, setWasRemoved] = useState(false);
  const [removalMessage, setRemovalMessage] = useState('');

  // References to active player instance and synchronization loop guard
  const playerRef = useRef(null);
  const isRemoteSyncRef = useRef(false);
  const lastDriftCorrectionRef = useRef(0);
  const remoteSyncTimeoutRef = useRef(null);
  const expectedRemoteStateRef = useRef(null);

  // Up-to-date refs for callbacks to eliminate stale React closures
  const roomRef = useRef(room);
  useEffect(() => {
    roomRef.current = room;
  }, [room]);

  const canControlPlaybackRef = useRef(false);

  // Sync activity logs (Real-time events from server)
  const [logs, setLogs] = useState(() => [
    {
      id: 'l1',
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      text: `Joined party ${room.roomCode} as ${currentUser?.username} (${currentUser?.role})`,
    },
  ]);

  // Save session info to sessionStorage for seamless reconnection recovery
  useEffect(() => {
    if (room?.roomCode && currentUser?.userId) {
      sessionStorage.setItem(
        'syncplay_session',
        JSON.stringify({
          roomCode: room.roomCode,
          userId: currentUser.userId,
          username: currentUser.username,
        })
      );
    }
  }, [room?.roomCode, currentUser?.userId, currentUser?.username]);

  // Determine current effective role & temporary control permissions from authoritative room state
  const selfRecord = room.participants.find((p) => p.userId === currentUser?.userId);
  const effectiveRole = selfRecord?.role || currentUser?.role || 'participant';
  const isHost = effectiveRole === 'host';
  const hasTempControl = !!(
    (selfRecord?.temporaryControlUntil && selfRecord.temporaryControlUntil > Date.now()) ||
    (selfRecord?.hasTemporaryControl && (!selfRecord?.temporaryControlUntil || selfRecord.temporaryControlUntil > Date.now()))
  );
  const canControlPlayback =
    effectiveRole === 'host' ||
    effectiveRole === 'moderator' ||
    room.policy === 'collaborative' ||
    hasTempControl;

  useEffect(() => {
    canControlPlaybackRef.current = canControlPlayback;
  }, [canControlPlayback]);

  const canChangeVideo =
    effectiveRole === 'host' ||
    effectiveRole === 'moderator' ||
    room.policy === 'collaborative' ||
    hasTempControl;

  // Active control requests
  const requests = room.controlRequests || [];
  const pendingRequests = requests.filter((r) => r.status === 'pending');
  const myPendingRequest = requests.find(
    (r) => r.userId === currentUser?.userId && r.status === 'pending'
  );
  const myRecentRequest = requests.find((r) => r.userId === currentUser?.userId);

  // Countdown timer for temporary control grant
  useEffect(() => {
    if (!selfRecord?.temporaryControlUntil) {
      return;
    }
    const updateCountdown = () => {
      const left = Math.max(0, Math.ceil((selfRecord.temporaryControlUntil - Date.now()) / 1000));
      setTempSecondsLeft(left);
    };
    updateCountdown();
    const interval = setInterval(updateCountdown, 1000);
    return () => clearInterval(interval);
  }, [selfRecord?.temporaryControlUntil]);

  // Clean explicit leave
  const handleLeaveParty = () => {
    sessionStorage.removeItem('syncplay_session');
    onLeaveRoom?.();
  };

  // Format time (MM:SS or HH:MM:SS)
  const formatTime = (seconds) => {
    if (isNaN(seconds) || seconds < 0) return '00:00';
    const totalSecs = Math.floor(seconds);
    const hrs = Math.floor(totalSecs / 3600);
    const mins = Math.floor((totalSecs % 3600) / 60);
    const secs = totalSecs % 60;
    if (hrs > 0) {
      return `${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  // Socket.IO real-time synchronization
  useEffect(() => {
    const socket = getSocket();

    // 1. Authoritative sync state received from server
    const handleSyncState = ({ room: syncedRoom, isReconnected }) => {
      console.log('[Socket] Authoritative sync_state:', syncedRoom);
      setRoom(syncedRoom);
      setIsPlaying(syncedRoom.playbackStatus === 'playing');

      if (isReconnected) {
        setConnectionStatus('connected');
        setFeedbackMessage(`Reconnected to room ${syncedRoom.roomCode}. Playback state restored.`);
        // Resync player to authoritative expected position
        if (playerRef.current && typeof syncedRoom.expectedPosition === 'number') {
          isRemoteSyncRef.current = true;
          playerRef.current.seekTo?.(syncedRoom.expectedPosition, true);
          if (syncedRoom.playbackStatus === 'playing') {
            playerRef.current.playVideo?.();
          } else {
            playerRef.current.pauseVideo?.();
          }
          setTimeout(() => {
            isRemoteSyncRef.current = false;
          }, 800);
        }
      }
    };

    // 2. Playback state synced from authorized participant (play, pause, seek)
    const handlePlaybackSynced = ({ action, currentTime, expectedPosition, playbackStatus, room: updatedRoom, user }) => {
      if (import.meta.env?.DEV) {
        console.log(`[WatchRoom:playback_synced] action=${action}, time=${currentTime}s, expectedPos=${expectedPosition}s, status=${playbackStatus}, by=${user?.username}`);
      }
      
      const currentRoom = roomRef.current;
      const newStatus = playbackStatus || (action === 'play' ? 'playing' : action === 'pause' ? 'paused' : currentRoom.playbackStatus);
      const targetTime = typeof expectedPosition === 'number' 
        ? expectedPosition 
        : (typeof currentTime === 'number' ? currentTime : currentRoom.currentTime);

      // Immediately update local room state so guards and UI reflect authoritative state
      if (updatedRoom) {
        setRoom(updatedRoom);
      } else {
        setRoom((prev) => ({
          ...prev,
          playbackStatus: newStatus,
          currentTime: targetTime,
          lastStateUpdatedAt: new Date().toISOString(),
        }));
      }

      // Raise remote sync lock to prevent echoing this action back to the server
      isRemoteSyncRef.current = true;
      if (remoteSyncTimeoutRef.current) clearTimeout(remoteSyncTimeoutRef.current);

      if (action === 'play') {
        expectedRemoteStateRef.current = 1; // YouTube state 1 = PLAYING
        setIsPlaying(true);
        if (playerRef.current) {
          const current = playerRef.current.getCurrentTime?.() || 0;
          if (Math.abs(current - targetTime) > 2.0) {
            playerRef.current.seekTo?.(targetTime, true);
          }
          playerRef.current.playVideo?.();
        }
      } else if (action === 'pause') {
        expectedRemoteStateRef.current = 2; // YouTube state 2 = PAUSED
        setIsPlaying(false);
        if (playerRef.current) {
          // Pause first to prevent YouTube auto-playing from seek buffer
          playerRef.current.pauseVideo?.();
          const current = playerRef.current.getCurrentTime?.() || 0;
          if (Math.abs(current - targetTime) > 1.5) {
            playerRef.current.seekTo?.(targetTime, true);
          }
        }
      } else if (action === 'seek') {
        setCurrentTimeSec(targetTime);
        if (playerRef.current) {
          playerRef.current.seekTo?.(targetTime, true);
        }
      }

      setLogs((prev) => [
        {
          id: Date.now().toString(),
          time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          text: `Playback ${action} by ${user?.username || 'Host'} (${user?.role || 'host'})`,
        },
        ...prev.slice(0, 49),
      ]);

      // Release remote lock after safe debounce window
      remoteSyncTimeoutRef.current = setTimeout(() => {
        isRemoteSyncRef.current = false;
        expectedRemoteStateRef.current = null;
      }, 1500);
    };

    // 3. New video loaded by Host/Moderator
    const handleVideoChanged = ({ videoId, videoUrl, room: updatedRoom, user }) => {
      if (import.meta.env?.DEV) {
        console.log(`[WatchRoom:video_changed] to ${videoId} by ${user?.username}`);
      }
      isRemoteSyncRef.current = true;
      if (remoteSyncTimeoutRef.current) clearTimeout(remoteSyncTimeoutRef.current);
      remoteSyncTimeoutRef.current = setTimeout(() => {
        isRemoteSyncRef.current = false;
      }, 1500);

      if (updatedRoom) {
        setRoom(updatedRoom);
      } else {
        setRoom((prev) => ({
          ...prev,
          currentVideoId: videoId,
          videoUrl: videoUrl || prev.videoUrl,
          playbackStatus: 'paused',
          currentTime: 0,
          lastStateUpdatedAt: new Date().toISOString(),
        }));
      }
      setIsPlaying(false);
      setCurrentTimeSec(0);
      setLogs((prev) => [
        {
          id: Date.now().toString(),
          time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          text: `${user?.username || 'Host'} changed video to "${videoId}"`,
        },
        ...prev.slice(0, 49),
      ]);
      setFeedbackMessage(`New video loaded by ${user?.username || 'Host'}!`);
    };

    // 4. Participant joined
    const handleUserJoined = ({ user: joinedUser, room: updatedRoom }) => {
      setRoom(updatedRoom);
      setLogs((prev) => [
        {
          id: Date.now().toString(),
          time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          text: `${joinedUser.username} joined the party as ${joinedUser.role.toUpperCase()}`,
        },
        ...prev.slice(0, 49),
      ]);
    };

    // 5. Participant departed
    const handleUserLeft = ({ user: departedUser, room: updatedRoom }) => {
      if (updatedRoom) {
        setRoom(updatedRoom);
      }
      if (departedUser?.userId === currentUser?.userId) {
        sessionStorage.removeItem('syncplay_session');
      }
      setLogs((prev) => [
        {
          id: Date.now().toString(),
          time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          text: `${departedUser?.username || 'A member'} left the party`,
        },
        ...prev.slice(0, 49),
      ]);
    };

    // 5b. Participant removed / kicked by Host
    const handleParticipantRemoved = ({ targetUserId, user: removedUser, message, room: updatedRoom }) => {
      if (updatedRoom) {
        setRoom(updatedRoom);
      }
      const isTarget = targetUserId === currentUser?.userId || removedUser?.userId === currentUser?.userId;
      if (isTarget) {
        sessionStorage.removeItem('syncplay_session');
        setWasRemoved(true);
        setRemovalMessage(message || 'You have been removed from the watch party by the Host.');
        setIsPlaying(false);
        if (playerRef.current) {
          try {
            playerRef.current.pauseVideo?.();
          } catch {}
        }
      } else if (removedUser) {
        setLogs((prev) => [
          {
            id: Date.now().toString(),
            time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            text: `${removedUser.username} was removed from the party by Host`,
          },
          ...prev.slice(0, 49),
        ]);
      }
    };

    // 6. Control request received
    const handleControlRequested = ({ request, room: updatedRoom }) => {
      setRoom(updatedRoom);
      setLogs((prev) => [
        {
          id: Date.now().toString(),
          time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          text: `${request.username} requested temporary playback control`,
        },
        ...prev.slice(0, 49),
      ]);
      if (isHost || effectiveRole === 'moderator') {
        setFeedbackMessage(`${request.username} requested playback control. Review in Requests tab.`);
      }
    };

    // 7. Control request approved
    const handleControlApproved = ({ request, room: updatedRoom }) => {
      setRoom(updatedRoom);
      setLogs((prev) => [
        {
          id: Date.now().toString(),
          time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          text: `Playback control approved for ${request.username} (60s)`,
        },
        ...prev.slice(0, 49),
      ]);
      if (request.userId === currentUser?.userId) {
        setFeedbackMessage('Your control request was approved! You now have temporary playback authority for 60 seconds.');
      }
    };

    // 8. Control request rejected
    const handleControlRejected = ({ request, room: updatedRoom }) => {
      setRoom(updatedRoom);
      setLogs((prev) => [
        {
          id: Date.now().toString(),
          time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          text: `Control request from ${request.username} was declined`,
        },
        ...prev.slice(0, 49),
      ]);
      if (request.userId === currentUser?.userId) {
        setFeedbackMessage('Your control request was declined by the Host.');
      }
    };

    // 9. Control revoked
    const handleControlRevoked = ({ targetUserId, room: updatedRoom }) => {
      setRoom(updatedRoom);
      setLogs((prev) => [
        {
          id: Date.now().toString(),
          time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          text: `Temporary playback control was revoked`,
        },
        ...prev.slice(0, 49),
      ]);
      if (targetUserId === currentUser?.userId) {
        setFeedbackMessage('Your temporary playback authority was revoked.');
      }
    };

    // 10. User reconnected
    const handleUserReconnected = ({ user: reconnectedUser, room: updatedRoom }) => {
      setRoom(updatedRoom);
      setLogs((prev) => [
        {
          id: Date.now().toString(),
          time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          text: `${reconnectedUser.username} reconnected to the party`,
        },
        ...prev.slice(0, 49),
      ]);
    };

    // 11. Socket connection drop / recovery listeners
    const handleDisconnect = (reason) => {
      console.warn(`[Socket] Disconnected: ${reason}`);
      setConnectionStatus('reconnecting');
      setFeedbackMessage('Connection interrupted. Attempting to restore room session...');
    };

    const handleConnect = () => {
      if (sessionStorage.getItem('syncplay_session')) {
        reconnectRoomSocket({ roomCode: room.roomCode, userId: currentUser?.userId })
          .then(({ room: recoveredRoom }) => {
            setRoom(recoveredRoom);
            setConnectionStatus('connected');
            setFeedbackMessage(`Reconnected to room ${room.roomCode}! Playback recovered.`);
          })
          .catch((err) => {
            console.warn('[Socket] Reconnect failed:', err.message);
            setConnectionStatus('connected');
          });
      } else {
        setConnectionStatus('connected');
      }
    };

    // 12. Room error
    const handleRoomError = ({ message }) => {
      setFeedbackMessage(`Server Warning: ${message}`);
    };

    socket.on('sync_state', handleSyncState);
    socket.on('playback_synced', handlePlaybackSynced);
    socket.on('video_changed', handleVideoChanged);
    socket.on('user_joined', handleUserJoined);
    socket.on('user_left', handleUserLeft);
    socket.on('participant_removed', handleParticipantRemoved);
    socket.on('control_requested', handleControlRequested);
    socket.on('control_approved', handleControlApproved);
    socket.on('control_rejected', handleControlRejected);
    socket.on('control_revoked', handleControlRevoked);
    socket.on('user_reconnected', handleUserReconnected);
    socket.on('disconnect', handleDisconnect);
    socket.on('connect', handleConnect);
    socket.on('room_error', handleRoomError);

    return () => {
      socket.off('sync_state', handleSyncState);
      socket.off('playback_synced', handlePlaybackSynced);
      socket.off('video_changed', handleVideoChanged);
      socket.off('user_joined', handleUserJoined);
      socket.off('user_left', handleUserLeft);
      socket.off('participant_removed', handleParticipantRemoved);
      socket.off('control_requested', handleControlRequested);
      socket.off('control_approved', handleControlApproved);
      socket.off('control_rejected', handleControlRejected);
      socket.off('control_revoked', handleControlRevoked);
      socket.off('user_reconnected', handleUserReconnected);
      socket.off('disconnect', handleDisconnect);
      socket.off('connect', handleConnect);
      socket.off('room_error', handleRoomError);
    };
  }, [room.roomCode, currentUser?.userId, isHost, effectiveRole]);

  // Player callbacks
  const handlePlayerReady = (playerInstance) => {
    playerRef.current = playerInstance;
    console.log('[YouTubePlayer] Player ready instance captured');
  };

  // Phase 4 Continuous Playback Drift Correction (Participants only)
  const handleTimeUpdate = (current, duration) => {
    setCurrentTimeSec(current);
    if (duration > 0 && duration !== videoDurationSec) {
      setVideoDurationSec(duration);
    }

    // Host and controllers are the authoritative source of playback; never drift correct the master
    if (canControlPlaybackRef.current) {
      return;
    }

    const currentRoom = roomRef.current;
    // Only apply drift correction if room is playing, no active remote sync in progress, and player is actively playing
    if (
      currentRoom.playbackStatus === 'playing' &&
      !isRemoteSyncRef.current &&
      playerRef.current &&
      typeof playerRef.current.getPlayerState === 'function' &&
      playerRef.current.getPlayerState() === 1
    ) {
      const now = Date.now();
      // Cooldown of 5 seconds between automatic drift corrections prevents seeking loops
      if (now - lastDriftCorrectionRef.current > 5000) {
        const lastUpdate = currentRoom.lastStateUpdatedAt ? new Date(currentRoom.lastStateUpdatedAt).getTime() : now;
        const elapsedSec = Math.max(0, (now - lastUpdate) / 1000);
        const expectedTime = Math.max(0, (currentRoom.currentTime || 0) + elapsedSec);
        const drift = current - expectedTime;

        // Sensible drift threshold: 2.5 seconds to avoid interrupting normal playback due to minor buffer jitter
        if (Math.abs(drift) > 2.5) {
          if (import.meta.env?.DEV) {
            console.log(`[WatchRoom:drift_correct] Drift of ${drift.toFixed(2)}s detected. Resyncing to ${expectedTime.toFixed(2)}s`);
          }
          isRemoteSyncRef.current = true;
          lastDriftCorrectionRef.current = now;
          playerRef.current.seekTo?.(expectedTime, true);
          setLogs((prev) => [
            {
              id: Date.now().toString(),
              time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
              text: `Playback resynced with Host (${drift > 0 ? '+' : ''}${drift.toFixed(1)}s drift corrected)`,
            },
            ...prev.slice(0, 49),
          ]);
          setTimeout(() => {
            isRemoteSyncRef.current = false;
          }, 1500);
        }
      }
    }
  };

  // Control request handlers
  const handleRequestControl = async () => {
    try {
      const res = await requestControlSocket({ roomCode: room.roomCode });
      if (res.alreadyHasControl) {
        setFeedbackMessage('You already have playback control authority.');
      } else {
        setFeedbackMessage('Control request submitted! Awaiting Host approval.');
      }
    } catch (err) {
      setFeedbackMessage(`Request failed: ${err.message}`);
    }
  };

  const handleApproveRequest = async (requestId) => {
    try {
      await approveControlSocket({ roomCode: room.roomCode, requestId, durationMs: 60000 });
      setFeedbackMessage('Request approved! Temporary control granted for 60 seconds.');
    } catch (err) {
      setFeedbackMessage(`Approval failed: ${err.message}`);
    }
  };

  const handleRejectRequest = async (requestId) => {
    try {
      await rejectControlSocket({ roomCode: room.roomCode, requestId });
      setFeedbackMessage('Control request declined.');
    } catch (err) {
      setFeedbackMessage(`Rejection failed: ${err.message}`);
    }
  };

  const handleRevokeControl = async (targetUserId) => {
    try {
      await revokeControlSocket({ roomCode: room.roomCode, targetUserId });
      setFeedbackMessage('Temporary control revoked.');
    } catch (err) {
      setFeedbackMessage(`Revoke failed: ${err.message}`);
    }
  };

  const handleRemoveParticipant = async (targetUserId, targetUsername) => {
    if (!isHost) return;
    if (targetUserId === currentUser?.userId) return;

    const confirmed = window.confirm(
      `Are you sure you want to remove ${targetUsername} from the watch party?`
    );
    if (!confirmed) return;

    setRemovingUserId(targetUserId);
    try {
      const res = await removeParticipantSocket({
        roomCode: room.roomCode,
        targetUserId,
      });
      if (res.room) {
        setRoom(res.room);
      }
      setFeedbackMessage(`${targetUsername} was removed from the party.`);
      setLogs((prev) => [
        {
          id: Date.now().toString(),
          time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          text: `You removed ${targetUsername} from the party`,
        },
        ...prev.slice(0, 49),
      ]);
    } catch (err) {
      setFeedbackMessage(`Failed to remove ${targetUsername}: ${err.message}`);
    } finally {
      setRemovingUserId(null);
    }
  };

  // Handles state changes inside the YouTube IFrame itself (e.g. user clicked directly on video)
  const handleLocalPlayerStateChange = (state, current) => {
    // If state change was initiated by a remote socket sync, ignore!
    if (isRemoteSyncRef.current) {
      if (import.meta.env?.DEV) console.log('[WatchRoom:localStateChange] Ignored due to isRemoteSyncRef', { state, current });
      return;
    }
    if (expectedRemoteStateRef.current === state) {
      if (import.meta.env?.DEV) console.log('[WatchRoom:localStateChange] Matched expectedRemoteState', { state });
      expectedRemoteStateRef.current = null;
      return;
    }

    const currentRoom = roomRef.current;
    const canControl = canControlPlaybackRef.current;

    // YT.PlayerState: 1 = PLAYING, 2 = PAUSED
    if (state === 1) { // Video entered PLAYING state
      if (!canControl) {
        // Revert unauthorized playback ONLY if room is supposed to be paused!
        if (currentRoom.playbackStatus === 'paused') {
          if (import.meta.env?.DEV) console.warn('[WatchRoom:unauthorized_play] Participant attempted play while room paused. Reverting.');
          playerRef.current?.pauseVideo?.();
          setFeedbackMessage('Playback restricted: Only Host or Moderator can control playback. Request control below.');
        } else {
          // Room is playing; participant player is naturally following authoritative state
          if (import.meta.env?.DEV) console.log('[WatchRoom:participant_playing] Confirmed playing in sync with room.');
          setIsPlaying(true);
        }
        return;
      }

      // Host / Controller: Only emit if room is not already playing
      if (currentRoom.playbackStatus === 'playing') {
        if (import.meta.env?.DEV) console.log('[WatchRoom:host_already_playing] Room already marked playing. Skipping duplicate emit.');
        setIsPlaying(true);
        return;
      }

      if (import.meta.env?.DEV) console.log('[WatchRoom:host_play] Emitting authoritative play', { current });
      setIsPlaying(true);
      emitPlaybackAction({
        roomCode: currentRoom.roomCode,
        action: 'play',
        currentTime: current,
      });
      setRoom((prev) => ({
        ...prev,
        playbackStatus: 'playing',
        currentTime: current,
        lastStateUpdatedAt: new Date().toISOString(),
      }));
      setLogs((prev) => [
        {
          id: Date.now().toString(),
          time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          text: `You resumed playback`,
        },
        ...prev,
      ]);
    } else if (state === 2) { // Video entered PAUSED state
      if (!canControl) {
        // Revert unauthorized pause ONLY if room is supposed to be playing!
        if (currentRoom.playbackStatus === 'playing') {
          if (import.meta.env?.DEV) console.warn('[WatchRoom:unauthorized_pause] Participant attempted pause while room playing. Reverting.');
          playerRef.current?.playVideo?.();
          setFeedbackMessage('Playback restricted: Only Host or Moderator can control playback.');
        } else {
          // Room is paused; participant player is naturally following authoritative state
          if (import.meta.env?.DEV) console.log('[WatchRoom:participant_paused] Confirmed paused in sync with room.');
          setIsPlaying(false);
        }
        return;
      }

      // Host / Controller: Only emit if room is not already paused
      if (currentRoom.playbackStatus === 'paused') {
        if (import.meta.env?.DEV) console.log('[WatchRoom:host_already_paused] Room already marked paused. Skipping duplicate emit.');
        setIsPlaying(false);
        return;
      }

      if (import.meta.env?.DEV) console.log('[WatchRoom:host_pause] Emitting authoritative pause', { current });
      setIsPlaying(false);
      emitPlaybackAction({
        roomCode: currentRoom.roomCode,
        action: 'pause',
        currentTime: current,
      });
      setRoom((prev) => ({
        ...prev,
        playbackStatus: 'paused',
        currentTime: current,
        lastStateUpdatedAt: new Date().toISOString(),
      }));
      setLogs((prev) => [
        {
          id: Date.now().toString(),
          time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          text: `You paused playback`,
        },
        ...prev,
      ]);
    }
  };

  // Controls: Toggle Play / Pause from custom buttons
  const handleTogglePlay = () => {
    if (!canControlPlaybackRef.current) {
      setFeedbackMessage('Permission Denied: Only Host or Moderators can alter playback state.');
      return;
    }
    if (!playerRef.current) return;

    const currentRoom = roomRef.current;
    if (isPlaying) {
      const current = playerRef.current.getCurrentTime?.() || currentTimeSec;
      if (import.meta.env?.DEV) console.log('[WatchRoom:btn_pause] Custom button pause initiated', { current });
      playerRef.current.pauseVideo?.();
      setIsPlaying(false);
      emitPlaybackAction({
        roomCode: currentRoom.roomCode,
        action: 'pause',
        currentTime: current,
      });
      setRoom((prev) => ({
        ...prev,
        playbackStatus: 'paused',
        currentTime: current,
        lastStateUpdatedAt: new Date().toISOString(),
      }));
      setLogs((prev) => [
        {
          id: Date.now().toString(),
          time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          text: `You paused playback at ${formatTime(current)}`,
        },
        ...prev,
      ]);
    } else {
      const current = playerRef.current.getCurrentTime?.() || currentTimeSec;
      if (import.meta.env?.DEV) console.log('[WatchRoom:btn_play] Custom button play initiated', { current });
      playerRef.current.playVideo?.();
      setIsPlaying(true);
      emitPlaybackAction({
        roomCode: currentRoom.roomCode,
        action: 'play',
        currentTime: current,
      });
      setRoom((prev) => ({
        ...prev,
        playbackStatus: 'playing',
        currentTime: current,
        lastStateUpdatedAt: new Date().toISOString(),
      }));
      setLogs((prev) => [
        {
          id: Date.now().toString(),
          time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          text: `You resumed playback from ${formatTime(current)}`,
        },
        ...prev,
      ]);
    }
  };

  // Controls: Seek forward or backward by delta seconds
  const handleSeekDelta = (delta) => {
    if (!canControlPlaybackRef.current) {
      setFeedbackMessage('Permission Denied: Participants cannot seek without approval.');
      return;
    }
    if (!playerRef.current) return;
    const currentRoom = roomRef.current;
    const current = playerRef.current.getCurrentTime?.() || currentTimeSec;
    const newTime = Math.max(0, Math.min(videoDurationSec, current + delta));
    playerRef.current.seekTo?.(newTime, true);
    setCurrentTimeSec(newTime);
    setRoom((prev) => ({ ...prev, currentTime: newTime }));
    emitPlaybackAction({
      roomCode: currentRoom.roomCode,
      action: 'seek',
      currentTime: newTime,
    });
    setLogs((prev) => [
      {
        id: Date.now().toString(),
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        text: `You scrubbed to ${formatTime(newTime)}`,
      },
      ...prev,
    ]);
  };

  // Controls: Click on timeline progress bar
  const handleScrubberClick = (e) => {
    if (!canControlPlaybackRef.current) {
      setFeedbackMessage('Permission Denied: Only Host or Moderators can seek the timeline.');
      return;
    }
    const rect = e.currentTarget.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const percentage = Math.max(0, Math.min(1, clickX / rect.width));
    const targetTime = percentage * videoDurationSec;

    const currentRoom = roomRef.current;
    if (playerRef.current && typeof playerRef.current.seekTo === 'function') {
      playerRef.current.seekTo(targetTime, true);
    }
    setCurrentTimeSec(targetTime);
    setRoom((prev) => ({ ...prev, currentTime: targetTime }));
    emitPlaybackAction({
      roomCode: currentRoom.roomCode,
      action: 'seek',
      currentTime: targetTime,
    });
    setLogs((prev) => [
      {
        id: Date.now().toString(),
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        text: `You scrubbed to ${formatTime(targetTime)}`,
      },
      ...prev,
    ]);
  };

  // Controls: Mute toggle
  const handleToggleMute = () => {
    if (!playerRef.current) return;
    if (isMuted) {
      playerRef.current.unMute?.();
      setIsMuted(false);
    } else {
      playerRef.current.mute?.();
      setIsMuted(true);
    }
  };

  // Controls: Change Video
  const handleChangeVideoSubmit = async () => {
    if (!newVideoUrl.trim()) return;
    if (!canChangeVideo) {
      setFeedbackMessage('Permission Denied: Video changing is restricted to Host, Moderators, or members with approved control.');
      return;
    }

    setIsChangingVideo(true);
    try {
      isRemoteSyncRef.current = true;
      if (remoteSyncTimeoutRef.current) clearTimeout(remoteSyncTimeoutRef.current);
      remoteSyncTimeoutRef.current = setTimeout(() => {
        isRemoteSyncRef.current = false;
      }, 1500);

      const res = await changeVideoSocket({
        roomCode: room.roomCode,
        videoUrl: newVideoUrl.trim(),
      });
      if (res && res.room) {
        setRoom(res.room);
        setIsPlaying(false);
        setCurrentTimeSec(0);
      }
      setLogs((prev) => [
        {
          id: Date.now().toString(),
          time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          text: `You changed video to "${res?.videoId || res?.room?.currentVideoId || 'new video'}"`,
        },
        ...prev.slice(0, 49),
      ]);
      setNewVideoUrl('');
      setFeedbackMessage('Video successfully changed and synchronized with all participants!');
    } catch (err) {
      setFeedbackMessage(`Failed to change video: ${err.message}`);
    } finally {
      setIsChangingVideo(false);
    }
  };

  const progressPercentage = videoDurationSec > 0 ? (currentTimeSec / videoDurationSec) * 100 : 0;

  return (
    <div className="watchroom-container animate-fade-in">
      {/* Watch Room Top Action Header */}
      <div className="watchroom-header glass-panel">
        <div className="header-left">
          <button onClick={handleLeaveParty} className="leave-room-btn" title="Leave Party">
            <ArrowLeft size={16} />
            <span>Leave Party</span>
          </button>
          <div className="room-meta">
            <RoomBadge roomCode={room.roomCode} />
          </div>
        </div>

        {/* Server-Authoritative Identity Pill & Connection State */}
        <div className="header-role-controls">
          <div className="connection-status-pill-wrap">
            {connectionStatus === 'connected' ? (
              <span className="conn-status-pill online" title="Real-time WebSocket synchronization connected">
                <span className="status-dot online" />
                <span>ONLINE</span>
              </span>
            ) : connectionStatus === 'reconnecting' ? (
              <span className="conn-status-pill reconnecting" title="Reconnecting to room session...">
                <span className="status-dot offline" />
                <span>RECONNECTING...</span>
              </span>
            ) : (
              <span className="conn-status-pill offline" title="Connection lost">
                <span className="status-dot offline" />
                <span>DISCONNECTED</span>
              </span>
            )}
          </div>

          <div className="role-authoritative-badge">
            <Wifi size={13} className="connected-pulse-icon" />
            <span className="role-auth-label">YOUR ROLE:</span>
            {effectiveRole === 'host' && (
              <span className="role-tag host">
                <Crown size={12} /> HOST (Creator)
              </span>
            )}
            {effectiveRole === 'moderator' && (
              <span className="role-tag mod">
                <Shield size={12} /> MODERATOR
              </span>
            )}
            {effectiveRole === 'participant' && (
              <span className="role-tag participant">
                <Users size={12} /> PARTICIPANT
              </span>
            )}
          </div>
        </div>
      </div>

      {feedbackMessage && (
        <AlertBanner
          type="info"
          message={feedbackMessage}
          onDismiss={() => setFeedbackMessage('')}
        />
      )}

      {/* Main Watch Party Grid (Theater + Sidebar) */}
      <div className="watch-grid">
        {/* Left Column: Video Theater Stage */}
        <section className="theater-column">
          <div className="theater-screen glass-panel">
            {/* 16:9 Video Player Screen */}
            <div className="video-player-container">
              <div className="video-viewport-mock">
                {/* Official YouTube IFrame Player */}
                <YouTubePlayer
                  videoId={room.currentVideoId || 'aqz-KE-bpKQ'}
                  initialTime={room.currentTime || 0}
                  initialPlaybackStatus={room.playbackStatus}
                  canControl={canControlPlayback}
                  onPlayerReady={handlePlayerReady}
                  onLocalStateChange={handleLocalPlayerStateChange}
                  onTimeUpdate={handleTimeUpdate}
                  onError={(err) => setFeedbackMessage(`YouTube Error: ${err}`)}
                />
              </div>

              {/* Interactive Scrubber Bar */}
              <div 
                className={`video-progress-bar ${!canControlPlayback ? 'locked' : ''}`}
                onClick={handleScrubberClick}
                title={canControlPlayback ? 'Click to scrub' : 'Only Host/Moderator can seek'}
              >
                <div 
                  className="video-progress-fill" 
                  style={{ width: `${progressPercentage}%` }}
                />
              </div>

              {/* Player Control Bar */}
              <div className="player-controls-bar">
                <div className="controls-left">
                  <button 
                    onClick={handleTogglePlay}
                    className={`ctrl-btn play-btn ${!canControlPlayback ? 'locked' : ''}`}
                    title={canControlPlayback ? (isPlaying ? 'Pause' : 'Play') : 'Playback restricted to Host/Moderator'}
                  >
                    {isPlaying ? <Pause size={20} /> : <Play size={20} fill="currentColor" />}
                  </button>

                  <button 
                    onClick={() => handleSeekDelta(-10)} 
                    className={`ctrl-btn ${!canControlPlayback ? 'locked' : ''}`}
                    title="Rewind 10 seconds"
                  >
                    <RotateCcw size={16} />
                  </button>

                  <button 
                    onClick={() => handleSeekDelta(10)} 
                    className={`ctrl-btn ${!canControlPlayback ? 'locked' : ''}`}
                    title="Forward 10 seconds"
                  >
                    <RotateCw size={16} />
                  </button>

                  <div className="time-display">
                    <span className="time-current">{formatTime(currentTimeSec)}</span>
                    <span className="time-sep">/</span>
                    <span className="time-total">{formatTime(videoDurationSec)}</span>
                  </div>
                </div>

                <div className="controls-right">
                  {!canControlPlayback ? (
                    myPendingRequest ? (
                      <button 
                        className="request-seek-btn pending" 
                        disabled 
                        title="Your request is awaiting Host approval"
                      >
                        <Clock size={14} className="spin-slow" />
                        <span>Request Pending...</span>
                      </button>
                    ) : myRecentRequest?.status === 'rejected' ? (
                      <button 
                        onClick={handleRequestControl} 
                        className="request-seek-btn rejected"
                        title="Request declined. Click to try again"
                      >
                        <X size={14} />
                        <span>Request Declined (Retry)</span>
                      </button>
                    ) : (
                      <button 
                        onClick={handleRequestControl} 
                        className="request-seek-btn"
                        title="Request temporary playback control from the Host"
                      >
                        <Lock size={14} />
                        <span>Request Control</span>
                      </button>
                    )
                  ) : hasTempControl ? (
                    <span className="permission-indicator temporary-granted" title="Temporary playback authority active">
                      <Sparkles size={14} className="sparkle-icon" />
                      <span>Temp Control ({tempSecondsLeft}s)</span>
                    </span>
                  ) : (
                    <span className="permission-indicator granted">
                      <Unlock size={14} />
                      <span>Playback Authority Active</span>
                    </span>
                  )}
                  <button onClick={handleToggleMute} className="ctrl-btn" title={isMuted ? 'Unmute' : 'Mute'}>
                    {isMuted ? <VolumeX size={18} /> : <Volume2 size={18} />}
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Change Video Bar */}
          <div className="change-video-bar glass-panel">
            <div className="change-video-icon">
              <YouTubeIcon size={20} className="yt-icon" />
            </div>
            <input
              type="text"
              className="change-video-input"
              placeholder={
                canChangeVideo
                  ? 'Paste YouTube URL or Video ID to synchronize across all party members...'
                  : 'Only Host, Moderators, or members with approved control can load a new video'
              }
              value={newVideoUrl}
              onChange={(e) => setNewVideoUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleChangeVideoSubmit();
              }}
              disabled={!canChangeVideo || isChangingVideo}
            />
            <button
              onClick={handleChangeVideoSubmit}
              className="change-video-btn"
              disabled={!canChangeVideo || !newVideoUrl.trim() || isChangingVideo}
              title={canChangeVideo ? 'Load and synchronize video' : 'Permission required to change video'}
            >
              {isChangingVideo ? <span>Loading...</span> : <span>Load Video</span>}
            </button>
          </div>
        </section>

        {/* Right Column: Dynamic Tabbed Control Sidebar */}
        <aside className="sidebar-column glass-panel">
          {/* Sidebar Tabs */}
          <div className="sidebar-tabs">
            <button
              onClick={() => setActiveTab('participants')}
              className={`sidebar-tab ${activeTab === 'participants' ? 'active' : ''}`}
            >
              <Users size={16} />
              <span>Participants ({room.participants.length})</span>
            </button>
            <button
              onClick={() => setActiveTab('requests')}
              className={`sidebar-tab ${activeTab === 'requests' ? 'active' : ''}`}
            >
              <Radio size={16} />
              <span>Requests</span>
              {pendingRequests.length > 0 && <span className="tab-badge">{pendingRequests.length}</span>}
            </button>
            <button
              onClick={() => setActiveTab('logs')}
              className={`sidebar-tab ${activeTab === 'logs' ? 'active' : ''}`}
            >
              <Clock size={16} />
              <span>Sync Log</span>
            </button>
          </div>

          {/* Tab 1: Real Server Participants List */}
          {activeTab === 'participants' && (
            <div className="tab-pane participants-pane">
              <div className="pane-header">
                <span className="pane-title">Connected Members</span>
                <span className="pane-counter">{room.participants.length} online</span>
              </div>

              <div className="participants-list">
                {room.participants.map((user) => {
                  const isSelf = user.userId === currentUser?.userId;
                  return (
                    <div key={user.userId} className="participant-card">
                      <div className="participant-info">
                        <div className={`avatar-bubble role-${user.role}`}>
                          {user.username.charAt(0).toUpperCase()}
                        </div>
                        <div className="user-text">
                          <span className="user-name">
                            {user.username} {isSelf && <span className="self-tag">(You)</span>}
                          </span>
                          <div className="role-tag-container">
                            {user.role === 'host' && (
                              <span className="role-tag host">
                                <Crown size={12} /> Host
                              </span>
                            )}
                            {user.role === 'moderator' && (
                              <span className="role-tag mod">
                                <Shield size={12} /> Moderator
                              </span>
                            )}
                            {user.role === 'participant' && (
                              <span className="role-tag participant">
                                <Users size={12} /> Participant
                              </span>
                            )}
                            {user.hasTemporaryControl && (
                              <span className="role-tag mod" style={{ marginLeft: '0.35rem', background: 'rgba(139, 92, 246, 0.2)', color: '#c084fc' }}>
                                <Sparkles size={11} /> Temp Control
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      {isHost && !isSelf && (
                        <div className="participant-actions">
                          <button
                            type="button"
                            className="btn-kick-participant"
                            title={`Remove ${user.username} from party`}
                            onClick={() => handleRemoveParticipant(user.userId, user.username)}
                            disabled={removingUserId === user.userId}
                            aria-label={`Remove ${user.username}`}
                          >
                            <UserMinus size={13} />
                            <span>{removingUserId === user.userId ? 'Removing...' : 'Remove'}</span>
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Tab 2: Seeking / Playback Permission Requests */}
          {activeTab === 'requests' && (
            <div className="tab-pane requests-pane">
              <div className="pane-header">
                <span className="pane-title">Playback Approvals</span>
                <span className="pane-counter">{pendingRequests.length} pending</span>
              </div>

              {requests.length === 0 ? (
                <div className="empty-state">
                  <Check size={28} className="empty-icon" />
                  <p>No permission requests</p>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-subtle)' }}>
                    Participants can request temporary control using the lock button.
                  </span>
                </div>
              ) : (
                <div className="requests-list">
                  {requests.map((req) => {
                    const isSelfRequest = req.userId === currentUser?.userId;
                    return (
                      <div key={req.requestId} className={`request-card status-${req.status}`}>
                        <div className="request-body">
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.25rem' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
                              <div className="avatar-bubble role-participant" style={{ width: 24, height: 24, fontSize: '0.7rem' }}>
                                {req.username.charAt(0).toUpperCase()}
                              </div>
                              <strong>{req.username}</strong>
                              {isSelfRequest && <span className="self-tag">(You)</span>}
                            </div>
                            <span className="req-time">
                              {new Date(req.requestedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </span>
                          </div>
                          <div style={{ fontSize: '0.775rem', color: 'var(--text-muted)' }}>
                            Requested temporary playback control (60s)
                          </div>
                        </div>

                        {/* Interactive Approval / Rejection Controls */}
                        {req.status === 'pending' ? (
                          (isHost || effectiveRole === 'moderator') ? (
                            <div className="request-buttons">
                              <button
                                className="req-btn approve"
                                onClick={() => handleApproveRequest(req.requestId)}
                                title="Grant 60 seconds temporary playback authority"
                              >
                                <Check size={14} />
                                <span>Approve (60s)</span>
                              </button>
                              <button
                                className="req-btn deny"
                                onClick={() => handleRejectRequest(req.requestId)}
                                title="Decline request"
                              >
                                <X size={14} />
                                <span>Reject</span>
                              </button>
                            </div>
                          ) : (
                            <div className="req-status-text" style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', color: '#f59e0b' }}>
                              <Clock size={13} className="spin-slow" />
                              <span>Awaiting Host Review</span>
                            </div>
                          )
                        ) : req.status === 'approved' ? (
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '0.75rem', color: '#10b981' }}>
                            <span style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                              <Check size={14} /> Control Granted
                            </span>
                            {isHost && (
                              <button
                                onClick={() => handleRevokeControl(req.userId)}
                                style={{ background: 'rgba(239, 68, 68, 0.15)', border: '1px solid rgba(239, 68, 68, 0.3)', color: '#f87171', borderRadius: '4px', padding: '0.15rem 0.5rem', fontSize: '0.7rem', cursor: 'pointer' }}
                                title="Revoke temporary control"
                              >
                                Revoke
                              </button>
                            )}
                          </div>
                        ) : req.status === 'rejected' ? (
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.75rem', color: '#f87171' }}>
                            <X size={14} /> Request Declined
                          </div>
                        ) : (
                          <div style={{ fontSize: '0.75rem', color: 'var(--text-subtle)' }}>
                            Expired / Invalidated
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Tab 3: Live Sync Activity Log */}
          {activeTab === 'logs' && (
            <div className="tab-pane logs-pane">
              <div className="pane-header">
                <span className="pane-title">Sync Event Stream</span>
                <span className="pane-counter">Live</span>
              </div>

              <div className="logs-feed">
                {logs.map((log) => (
                  <div key={log.id} className="log-entry">
                    <span className="log-time">{log.time}</span>
                    <span className="log-text">{log.text}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </aside>
      </div>

      {/* Removed from room notification modal */}
      {wasRemoved && (
        <div className="removal-modal-backdrop">
          <div className="removal-modal-card">
            <div className="removal-modal-icon">
              <UserMinus size={36} color="#ef4444" />
            </div>
            <h3 className="removal-modal-title">Removed from Party</h3>
            <p className="removal-modal-desc">
              {removalMessage || `You have been removed from watch party "${room.roomCode}" by the Host.`}
            </p>
            <button
              type="button"
              className="btn-return-lobby"
              onClick={() => {
                sessionStorage.removeItem('syncplay_session');
                onLeaveRoom?.();
              }}
            >
              Return to Lobby
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
