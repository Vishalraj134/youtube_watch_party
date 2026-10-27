import { io } from 'socket.io-client';

export const SERVER_URL =
  import.meta.env.VITE_SERVER_URL ||
  (import.meta.env.PROD
    ? 'https://youtube-watch-party-server-g1bk.onrender.com'
    : 'http://localhost:5000');

let socketInstance = null;

/**
 * Returns or initializes the singleton Socket.IO connection
 * @returns {import('socket.io-client').Socket}
 */
export function getSocket() {
  if (!socketInstance) {
    socketInstance = io(SERVER_URL, {
      autoConnect: true,
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
      transports: ['websocket', 'polling'],
    });

    socketInstance.on('connect', () => {
      console.log(`[Socket.IO Client] Connected to server at ${SERVER_URL} (${socketInstance.id})`);
    });

    socketInstance.on('disconnect', (reason) => {
      console.log(`[Socket.IO Client] Disconnected: ${reason}`);
    });

    socketInstance.on('connect_error', (err) => {
      console.warn(`[Socket.IO Client] Connection error:`, err.message);
    });
  }
  return socketInstance;
}

/**
 * Creates a room via real-time Socket.IO call
 * @param {Object} payload
 * @param {string} payload.username
 * @param {string} [payload.initialVideoUrl]
 * @param {string} [payload.policy]
 * @returns {Promise<{ room: Object, user: Object }>}
 */
export function createRoomSocket({ username, initialVideoUrl, policy }) {
  const socket = getSocket();
  return new Promise((resolve, reject) => {
    if (!socket.connected) {
      socket.connect();
    }

    // Set timeout to prevent hanging forever
    const timer = setTimeout(() => {
      reject(new Error('Server took too long to create room. Please check backend connection.'));
    }, 7000);

    socket.emit('create_room', { username, initialVideoUrl, policy }, (res) => {
      clearTimeout(timer);
      if (res && res.success) {
        resolve({ room: res.room, user: res.user });
      } else {
        reject(new Error(res?.error || 'Room creation failed.'));
      }
    });
  });
}

/**
 * Joins an existing room via real-time Socket.IO call
 * @param {Object} payload
 * @param {string} payload.roomCode
 * @param {string} payload.username
 * @returns {Promise<{ room: Object, user: Object }>}
 */
export function joinRoomSocket({ roomCode, username }) {
  const socket = getSocket();
  return new Promise((resolve, reject) => {
    if (!socket.connected) {
      socket.connect();
    }

    const timer = setTimeout(() => {
      reject(new Error('Server took too long to join room. Please check room code and connection.'));
    }, 7000);

    socket.emit('join_room', { roomCode, username }, (res) => {
      clearTimeout(timer);
      if (res && res.success) {
        resolve({ room: res.room, user: res.user });
      } else {
        reject(new Error(res?.error || 'Failed to join room.'));
      }
    });
  });
}

/**
 * Leaves current room and cleans up room channel
 * @param {string} roomCode 
 */
export function leaveRoomSocket(roomCode) {
  if (socketInstance && socketInstance.connected) {
    socketInstance.emit('leave_room', { roomCode });
  }
}

/**
 * Changes active YouTube video in the room
 * @param {Object} payload
 * @param {string} payload.roomCode
 * @param {string} payload.videoUrl
 * @returns {Promise<{ room: Object, videoId: string }>}
 */
export function changeVideoSocket({ roomCode, videoUrl }) {
  const socket = getSocket();
  return new Promise((resolve, reject) => {
    if (!socket.connected) {
      socket.connect();
    }

    const timer = setTimeout(() => {
      reject(new Error('Server took too long to change video. Please check connection.'));
    }, 7000);

    socket.emit('change_video', { roomCode, videoUrl }, (res) => {
      clearTimeout(timer);
      if (res && res.success) {
        resolve(res);
      } else {
        reject(new Error(res?.error || 'Failed to change video.'));
      }
    });
  });
}

/**
 * Emits a synchronized playback action (play, pause, seek)
 * @param {Object} payload
 * @param {string} payload.roomCode
 * @param {'play'|'pause'|'seek'} payload.action
 * @param {number} payload.currentTime
 */
export function emitPlaybackAction({ roomCode, action, currentTime }) {
  const socket = getSocket();
  if (socket && socket.connected) {
    if (import.meta.env?.DEV) {
      console.log(`[Socket:emitPlaybackAction] Room: ${roomCode}, Action: ${action}, Time: ${currentTime}s`);
    }
    socket.emit('playback_action', { roomCode, action, currentTime });
  }
}

/**
 * Requests temporary playback control for a participant
 * @param {Object} payload
 * @param {string} payload.roomCode
 * @returns {Promise<{ alreadyHasControl: boolean, request: Object, room: Object }>}
 */
export function requestControlSocket({ roomCode }) {
  const socket = getSocket();
  return new Promise((resolve, reject) => {
    if (!socket.connected) {
      socket.connect();
    }
    const timer = setTimeout(() => {
      reject(new Error('Server took too long to submit control request.'));
    }, 7000);

    socket.emit('request_control', { roomCode }, (res) => {
      clearTimeout(timer);
      if (res && res.success) {
        resolve(res);
      } else {
        reject(new Error(res?.error || 'Failed to submit control request.'));
      }
    });
  });
}

/**
 * Approves a participant's control request (Host/Moderator only)
 * @param {Object} payload
 * @param {string} payload.roomCode
 * @param {string} payload.requestId
 * @param {number} [payload.durationMs=60000]
 * @returns {Promise<{ request: Object, room: Object }>}
 */
export function approveControlSocket({ roomCode, requestId, durationMs = 60000 }) {
  const socket = getSocket();
  return new Promise((resolve, reject) => {
    if (!socket.connected) {
      socket.connect();
    }
    const timer = setTimeout(() => {
      reject(new Error('Server took too long to approve control request.'));
    }, 7000);

    socket.emit('approve_control', { roomCode, requestId, durationMs }, (res) => {
      clearTimeout(timer);
      if (res && res.success) {
        resolve(res);
      } else {
        reject(new Error(res?.error || 'Failed to approve control request.'));
      }
    });
  });
}

/**
 * Rejects a participant's control request (Host/Moderator only)
 * @param {Object} payload
 * @param {string} payload.roomCode
 * @param {string} payload.requestId
 * @returns {Promise<{ request: Object, room: Object }>}
 */
export function rejectControlSocket({ roomCode, requestId }) {
  const socket = getSocket();
  return new Promise((resolve, reject) => {
    if (!socket.connected) {
      socket.connect();
    }
    const timer = setTimeout(() => {
      reject(new Error('Server took too long to reject control request.'));
    }, 7000);

    socket.emit('reject_control', { roomCode, requestId }, (res) => {
      clearTimeout(timer);
      if (res && res.success) {
        resolve(res);
      } else {
        reject(new Error(res?.error || 'Failed to reject control request.'));
      }
    });
  });
}

/**
 * Revokes temporary playback control
 * @param {Object} payload
 * @param {string} payload.roomCode
 * @param {string} payload.targetUserId
 * @returns {Promise<{ targetUserId: string, room: Object }>}
 */
export function revokeControlSocket({ roomCode, targetUserId }) {
  const socket = getSocket();
  return new Promise((resolve, reject) => {
    if (!socket.connected) {
      socket.connect();
    }
    const timer = setTimeout(() => {
      reject(new Error('Server took too long to revoke control.'));
    }, 7000);

    socket.emit('revoke_control', { roomCode, targetUserId }, (res) => {
      clearTimeout(timer);
      if (res && res.success) {
        resolve(res);
      } else {
        reject(new Error(res?.error || 'Failed to revoke control.'));
      }
    });
  });
}

/**
 * Reconnects a previously disconnected participant and recovers room state
 * @param {Object} payload
 * @param {string} payload.roomCode
 * @param {string} payload.userId
 * @returns {Promise<{ room: Object, user: Object }>}
 */
export function reconnectRoomSocket({ roomCode, userId }) {
  const socket = getSocket();
  return new Promise((resolve, reject) => {
    if (!socket.connected) {
      socket.connect();
    }
    const timer = setTimeout(() => {
      reject(new Error('Server took too long to restore room session.'));
    }, 7000);

    socket.emit('reconnect_room', { roomCode, userId }, (res) => {
      clearTimeout(timer);
      if (res && res.success) {
        resolve({ room: res.room, user: res.user });
      } else {
        reject(new Error(res?.error || 'Failed to reconnect to room.'));
      }
    });
  });
}
