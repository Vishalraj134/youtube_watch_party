import { roomStore } from '../models/RoomStore.js';

/**
 * Socket.IO Room Lifecycle Event Handler
 * 
 * Implements real-time room communication:
 * - create_room (Inbound: room creation)
 * - join_room   (Inbound: join existing room)
 * - leave_room  (Inbound: explicit departure)
 * - sync_state  (Outbound: full authoritative room state)
 * - user_joined (Outbound: notification to other participants)
 * - user_left   (Outbound: notification of member departure)
 * - room_error  (Outbound: validation or business rule errors)
 * 
 * @param {import('socket.io').Server} io
 * @param {import('socket.io').Socket} socket
 */
export function registerRoomHandlers(io, socket) {
  /**
   * CREATE ROOM
   * Creates a new room and assigns the calling socket as the Host.
   */
  socket.on('create_room', (payload, callback) => {
    try {
      if (!payload || typeof payload !== 'object') {
        throw { code: 'INVALID_PAYLOAD', message: 'Payload must be an object.' };
      }

      const { username, initialVideoUrl, policy } = payload;
      const { room, user } = roomStore.createRoom({
        username,
        initialVideoUrl,
        policy,
        socketId: socket.id,
      });

      // Join the Socket.IO channel
      socket.join(room.roomCode);

      // Send initial authoritative sync to creator
      socket.emit('sync_state', {
        room,
        user,
      });

      if (typeof callback === 'function') {
        callback({ success: true, room, user });
      }

      console.log(`[Socket.IO] Room created: ${room.roomCode} by ${user.username} (${user.userId})`);
    } catch (err) {
      const errorPayload = {
        code: err.code || 'ROOM_CREATION_FAILED',
        message: err.message || 'Failed to create room.',
      };
      socket.emit('room_error', errorPayload);
      if (typeof callback === 'function') {
        callback({ success: false, error: errorPayload.message, code: errorPayload.code });
      }
    }
  });

  /**
   * JOIN ROOM
   * Joins an existing room and assigns the participant role by default.
   */
  socket.on('join_room', (payload, callback) => {
    try {
      if (!payload || typeof payload !== 'object') {
        throw { code: 'INVALID_PAYLOAD', message: 'Payload must be an object.' };
      }

      const { roomCode, username } = payload;
      const { room, user } = roomStore.joinRoom({
        roomCode,
        username,
        socketId: socket.id,
      });

      // Join the Socket.IO channel
      socket.join(room.roomCode);

      // Send full state to newly joined user
      socket.emit('sync_state', {
        room,
        user,
      });

      // Broadcast join event to everyone else in this room
      socket.to(room.roomCode).emit('user_joined', {
        user,
        room,
      });

      if (typeof callback === 'function') {
        callback({ success: true, room, user });
      }

      console.log(`[Socket.IO] User ${user.username} joined room: ${room.roomCode}`);
    } catch (err) {
      const errorPayload = {
        code: err.code || 'ROOM_JOIN_FAILED',
        message: err.message || 'Failed to join room.',
      };
      socket.emit('room_error', errorPayload);
      if (typeof callback === 'function') {
        callback({ success: false, error: errorPayload.message, code: errorPayload.code });
      }
    }
  });

  /**
   * LEAVE ROOM
   * Handles explicit departure of a participant.
   */
  socket.on('leave_room', (payload, callback) => {
    try {
      const roomCode = payload?.roomCode;
      const { leftUser, room } = roomStore.leaveRoom({
        roomCode,
        socketId: socket.id,
      });

      if (roomCode) {
        socket.leave(roomCode.trim().toUpperCase());
      }

      if (leftUser && room) {
        // Broadcast to remaining room members
        io.to(room.roomCode).emit('user_left', {
          user: leftUser,
          room,
        });
      }

      if (typeof callback === 'function') {
        callback({ success: true });
      }

      console.log(`[Socket.IO] User left room: ${roomCode || 'unknown'}`);
    } catch (err) {
      if (typeof callback === 'function') {
        callback({ success: false, error: err.message });
      }
    }
  });

  /**
   * CHANGE VIDEO
   * Enforces backend permissions before updating the room's YouTube video.
   */
  socket.on('change_video', (payload, callback) => {
    try {
      if (!payload || typeof payload !== 'object') {
        throw { code: 'INVALID_PAYLOAD', message: 'Payload must be an object.' };
      }

      const { roomCode, videoUrl } = payload;
      const result = roomStore.changeVideo({
        roomCode,
        socketId: socket.id,
        videoUrl,
      });

      // Broadcast to other participants in the room
      socket.to(result.room.roomCode).emit('video_changed', {
        videoId: result.videoId,
        videoUrl: result.videoUrl,
        room: result.room,
        user: result.user,
      });

      if (typeof callback === 'function') {
        callback({ success: true, room: result.room, videoId: result.videoId, videoUrl: result.videoUrl });
      }

      console.log(`[Socket.IO] Video changed in ${result.room.roomCode} to ${result.videoId} by ${result.user.username}`);
    } catch (err) {
      const errorPayload = {
        code: err.code || 'VIDEO_CHANGE_FAILED',
        message: err.message || 'Failed to change video.',
      };
      socket.emit('room_error', errorPayload);
      if (typeof callback === 'function') {
        callback({ success: false, error: errorPayload.message, code: errorPayload.code });
      }
    }
  });

  /**
   * PLAYBACK ACTION (Play, Pause, Seek)
   * Enforces backend permissions and broadcasts playback state to other participants.
   */
  socket.on('playback_action', (payload, callback) => {
    try {
      if (!payload || typeof payload !== 'object') {
        throw { code: 'INVALID_PAYLOAD', message: 'Payload must be an object.' };
      }

      const { roomCode, action, currentTime } = payload;
      const result = roomStore.syncPlayback({
        roomCode,
        socketId: socket.id,
        action,
        currentTime,
      });

      // Broadcast to OTHER participants in the room
      socket.to(result.room.roomCode).emit('playback_synced', {
        action: result.action,
        currentTime: result.currentTime,
        expectedPosition: result.expectedPosition,
        playbackStatus: result.room.playbackStatus,
        room: result.room,
        user: result.user,
        timestamp: Date.now(),
      });

      if (process.env.NODE_ENV !== 'production') {
        console.log(`[Socket.IO:playback_action] Room: ${result.room.roomCode}, Action: ${result.action}, Time: ${result.currentTime}s, By: ${result.user.username} (${result.user.role})`);
      }

      if (typeof callback === 'function') {
        callback({
          success: true,
          room: result.room,
          action: result.action,
          currentTime: result.currentTime,
          expectedPosition: result.expectedPosition,
        });
      }
    } catch (err) {
      if (process.env.NODE_ENV !== 'production') {
        console.warn(`[Socket.IO:playback_action_rejected] Socket: ${socket.id}, Error: ${err.message || err.code}`);
      }
      const errorPayload = {
        code: err.code || 'PLAYBACK_SYNC_FAILED',
        message: err.message || 'Failed to sync playback.',
      };
      socket.emit('room_error', errorPayload);
      if (typeof callback === 'function') {
        callback({ success: false, error: errorPayload.message, code: errorPayload.code });
      }
    }
  });

  /**
   * REQUEST CONTROL
   * Allows participant to submit a temporary playback control request.
   */
  socket.on('request_control', (payload, callback) => {
    try {
      if (!payload || typeof payload !== 'object') {
        throw { code: 'INVALID_PAYLOAD', message: 'Payload must be an object.' };
      }

      const { roomCode } = payload;
      const result = roomStore.requestControl({
        roomCode,
        socketId: socket.id,
      });

      if (!result.alreadyHasControl && result.request) {
        // Broadcast request to all members in the room so Host/Moderator can see it immediately
        io.to(result.room.roomCode).emit('control_requested', {
          request: result.request,
          room: result.room,
        });
      }

      if (typeof callback === 'function') {
        callback({
          success: true,
          alreadyHasControl: result.alreadyHasControl,
          request: result.request,
          room: result.room,
        });
      }
    } catch (err) {
      const errorPayload = {
        code: err.code || 'REQUEST_CONTROL_FAILED',
        message: err.message || 'Failed to submit control request.',
      };
      socket.emit('room_error', errorPayload);
      if (typeof callback === 'function') {
        callback({ success: false, error: errorPayload.message, code: errorPayload.code });
      }
    }
  });

  /**
   * APPROVE CONTROL
   * Host or Moderator approves a pending control request.
   */
  socket.on('approve_control', (payload, callback) => {
    try {
      if (!payload || typeof payload !== 'object') {
        throw { code: 'INVALID_PAYLOAD', message: 'Payload must be an object.' };
      }

      const { roomCode, requestId, durationMs } = payload;
      const result = roomStore.approveControl({
        roomCode,
        socketId: socket.id,
        requestId,
        durationMs,
      });

      // Broadcast approval to room
      io.to(result.room.roomCode).emit('control_approved', {
        request: result.request,
        participant: result.participant,
        room: result.room,
      });

      if (typeof callback === 'function') {
        callback({ success: true, request: result.request, room: result.room });
      }
    } catch (err) {
      const errorPayload = {
        code: err.code || 'APPROVE_CONTROL_FAILED',
        message: err.message || 'Failed to approve control request.',
      };
      socket.emit('room_error', errorPayload);
      if (typeof callback === 'function') {
        callback({ success: false, error: errorPayload.message, code: errorPayload.code });
      }
    }
  });

  /**
   * REJECT CONTROL
   * Host or Moderator rejects a pending control request.
   */
  socket.on('reject_control', (payload, callback) => {
    try {
      if (!payload || typeof payload !== 'object') {
        throw { code: 'INVALID_PAYLOAD', message: 'Payload must be an object.' };
      }

      const { roomCode, requestId } = payload;
      const result = roomStore.rejectControl({
        roomCode,
        socketId: socket.id,
        requestId,
      });

      // Broadcast rejection to room
      io.to(result.room.roomCode).emit('control_rejected', {
        request: result.request,
        room: result.room,
      });

      if (typeof callback === 'function') {
        callback({ success: true, request: result.request, room: result.room });
      }
    } catch (err) {
      const errorPayload = {
        code: err.code || 'REJECT_CONTROL_FAILED',
        message: err.message || 'Failed to reject control request.',
      };
      socket.emit('room_error', errorPayload);
      if (typeof callback === 'function') {
        callback({ success: false, error: errorPayload.message, code: errorPayload.code });
      }
    }
  });

  /**
   * REVOKE CONTROL
   * Explicitly revokes temporary playback control from a user.
   */
  socket.on('revoke_control', (payload, callback) => {
    try {
      if (!payload || typeof payload !== 'object') {
        throw { code: 'INVALID_PAYLOAD', message: 'Payload must be an object.' };
      }

      const { roomCode, targetUserId } = payload;
      const result = roomStore.revokeControl({
        roomCode,
        socketId: socket.id,
        targetUserId,
      });

      io.to(result.room.roomCode).emit('control_revoked', {
        targetUserId: result.targetUserId,
        room: result.room,
      });

      if (typeof callback === 'function') {
        callback({ success: true, targetUserId: result.targetUserId, room: result.room });
      }
    } catch (err) {
      const errorPayload = {
        code: err.code || 'REVOKE_CONTROL_FAILED',
        message: err.message || 'Failed to revoke control.',
      };
      socket.emit('room_error', errorPayload);
      if (typeof callback === 'function') {
        callback({ success: false, error: errorPayload.message, code: errorPayload.code });
      }
    }
  });

  /**
   * RECONNECT ROOM
   * Re-associates a reconnecting participant socket with their existing room session.
   */
  socket.on('reconnect_room', (payload, callback) => {
    try {
      if (!payload || typeof payload !== 'object') {
        throw { code: 'INVALID_PAYLOAD', message: 'Payload must be an object.' };
      }

      const { roomCode, userId } = payload;
      const { room, user } = roomStore.reconnectParticipant({
        roomCode,
        userId,
        socketId: socket.id,
      });

      // Re-join Socket.IO channel
      socket.join(room.roomCode);

      // Send latest authoritative sync state to client
      socket.emit('sync_state', {
        room,
        user,
        isReconnected: true,
      });

      // Broadcast recovery to other members
      socket.to(room.roomCode).emit('user_reconnected', {
        user,
        room,
      });

      if (typeof callback === 'function') {
        callback({ success: true, room, user });
      }

      console.log(`[Socket.IO] Reconnected ${user.username} (${user.userId}) in ${room.roomCode}`);
    } catch (err) {
      const errorPayload = {
        code: err.code || 'RECONNECT_FAILED',
        message: err.message || 'Failed to restore room membership.',
      };
      socket.emit('room_error', errorPayload);
      if (typeof callback === 'function') {
        callback({ success: false, error: errorPayload.message, code: errorPayload.code });
      }
    }
  });

  /**
   * DISCONNECT
   * Handles unexpected socket dropouts (network drop, tab close).
   */
  socket.on('disconnect', (reason) => {
    console.log(`[Socket.IO] Client disconnected: ${socket.id} (${reason})`);
    const disconnectInfo = roomStore.handleDisconnect(socket.id);

    if (disconnectInfo && disconnectInfo.remainingRoom) {
      const { roomCode, leftUser, remainingRoom } = disconnectInfo;
      // Broadcast departure to active room members
      io.to(roomCode).emit('user_left', {
        user: leftUser,
        room: remainingRoom,
      });
      console.log(`[Socket.IO] Broadcasted disconnect of ${leftUser.username} from ${roomCode}`);
    }
  });
}
