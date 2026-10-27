import crypto from 'crypto';

/**
 * In-Memory Room Store
 * 
 * NOTE ON PERSISTENCE:
 * Rooms and participant sessions are maintained purely in-memory for this MVP.
 * All room data is transient and will reset if the Node.js server restarts.
 */
class RoomStore {
  constructor() {
    /** @type {Map<string, Object>} roomCode -> Room */
    this.rooms = new Map();
    /** @type {Map<string, { roomCode: string, userId: string }>} socketId -> mapping */
    this.socketMap = new Map();
  }

  /**
   * Helper to extract YouTube video ID from various URL formats or raw 11-char ID
   * @param {string} url 
   * @returns {string|null}
   */
  extractVideoId(url) {
    if (!url || typeof url !== 'string') return null;
    const cleanUrl = url.trim();

    // Check direct 11-character video ID
    if (/^[a-zA-Z0-9_-]{11}$/.test(cleanUrl)) {
      return cleanUrl;
    }

    // Match youtube.com (watch, embed, v, live, shorts) or youtu.be
    const match = cleanUrl.match(
      /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?|live|shorts)\/|.*[?&]v=)|youtu\.be\/|youtube-nocookie\.com\/embed\/)([^"&?\/\s]{11})/i
    );
    return match ? match[1] : null;
  }

  /**
   * Generates a unique, collision-free room code (e.g. WP-4892)
   * @returns {string}
   */
  generateRoomCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Avoid confusing 0/O, 1/I
    for (let attempts = 0; attempts < 100; attempts++) {
      let code = 'WP-';
      for (let i = 0; i < 4; i++) {
        const randomIndex = crypto.randomInt(0, chars.length);
        code += chars[randomIndex];
      }
      if (!this.rooms.has(code)) {
        return code;
      }
    }
    // Fallback timestamp code if high volume
    return `WP-${Date.now().toString(36).slice(-4).toUpperCase()}`;
  }

  /**
   * Creates a new watch party room with the caller as authoritative Host
   * @param {Object} params
   * @param {string} params.username
   * @param {string} [params.initialVideoUrl]
   * @param {string} [params.policy]
   * @param {string} params.socketId
   * @returns {{ room: Object, user: Object }}
   */
  createRoom({ username, initialVideoUrl = '', policy = 'host_only', socketId }) {
    if (!username || typeof username !== 'string' || !username.trim()) {
      throw { code: 'INVALID_USERNAME', message: 'A non-empty display name is required to host a room.' };
    }
    const cleanUsername = username.trim().slice(0, 30);
    if (!socketId) {
      throw { code: 'SOCKET_REQUIRED', message: 'An active connection socket ID is required.' };
    }

    // Clean up any stale room this socket was previously in
    if (this.socketMap.has(socketId)) {
      this.handleDisconnect(socketId);
    }

    const roomCode = this.generateRoomCode();
    const userId = `usr_${crypto.randomBytes(6).toString('hex')}`;
    const videoId = this.extractVideoId(initialVideoUrl);
    const now = new Date().toISOString();

    const hostUser = {
      userId,
      socketId,
      username: cleanUsername,
      role: 'host', // Server-authoritative Host assignment
      joinedAt: now,
    };

    const room = {
      roomCode,
      hostUserId: userId,
      policy: policy === 'collaborative' ? 'collaborative' : 'host_only',
      currentVideoId: videoId,
      videoUrl: videoId ? initialVideoUrl.trim() : null,
      playbackStatus: 'paused',
      currentTime: 0,
      lastStateUpdatedAt: now,
      createdAt: now,
      participants: [hostUser],
      controlRequests: [],
      disconnectedParticipants: new Map(),
    };

    this.rooms.set(roomCode, room);
    this.socketMap.set(socketId, { roomCode, userId });

    return {
      room: this.sanitizeRoom(room),
      user: { ...hostUser },
    };
  }

  /**
   * Joins an existing room as a Participant
   * @param {Object} params
   * @param {string} params.roomCode
   * @param {string} params.username
   * @param {string} params.socketId
   * @returns {{ room: Object, user: Object }}
   */
  joinRoom({ roomCode, username, socketId }) {
    if (!roomCode || typeof roomCode !== 'string') {
      throw { code: 'INVALID_ROOM_CODE', message: 'A valid room code is required.' };
    }
    const cleanRoomCode = roomCode.trim().toUpperCase();

    const room = this.rooms.get(cleanRoomCode);
    if (!room) {
      throw { code: 'ROOM_NOT_FOUND', message: `Room "${cleanRoomCode}" does not exist or has expired.` };
    }

    if (!username || typeof username !== 'string' || !username.trim()) {
      throw { code: 'INVALID_USERNAME', message: 'Please enter a valid display name to join.' };
    }
    const cleanUsername = username.trim().slice(0, 30);

    if (!socketId) {
      throw { code: 'SOCKET_REQUIRED', message: 'Active socket ID is required.' };
    }

    // Check if the socket is already part of this room
    const existingSocketInRoom = room.participants.find((p) => p.socketId === socketId);
    if (existingSocketInRoom) {
      throw { code: 'ALREADY_JOINED', message: 'You have already joined this room.' };
    }

    // Check duplicate usernames ignoring case
    const usernameExists = room.participants.some(
      (p) => p.username.toLowerCase() === cleanUsername.toLowerCase()
    );
    if (usernameExists) {
      throw { 
        code: 'DUPLICATE_USERNAME', 
        message: `The name "${cleanUsername}" is already taken in this room. Please choose another nickname.` 
      };
    }

    // Clean up if the socket was connected to another room previously
    if (this.socketMap.has(socketId)) {
      this.handleDisconnect(socketId);
    }

    const userId = `usr_${crypto.randomBytes(6).toString('hex')}`;
    const now = new Date().toISOString();

    const newUser = {
      userId,
      socketId,
      username: cleanUsername,
      role: 'participant', // Default role for joining users
      joinedAt: now,
    };

    room.participants.push(newUser);
    this.socketMap.set(socketId, { roomCode: cleanRoomCode, userId });

    return {
      room: this.sanitizeRoom(room),
      user: { ...newUser },
    };
  }

  /**
   * Leaves a room explicitly
   * @param {Object} params
   * @param {string} params.roomCode
   * @param {string} params.socketId
   * @returns {{ leftUser: Object|null, room: Object|null }}
   */
  leaveRoom({ roomCode, socketId }) {
    if (!roomCode) return { leftUser: null, room: null };
    const cleanRoomCode = roomCode.trim().toUpperCase();
    const room = this.rooms.get(cleanRoomCode);
    if (!room) return { leftUser: null, room: null };

    const participantIndex = room.participants.findIndex((p) => p.socketId === socketId);
    if (participantIndex === -1) return { leftUser: null, room: this.sanitizeRoom(room) };

    const [leftUser] = room.participants.splice(participantIndex, 1);
    this.socketMap.delete(socketId);

    // Invalidate any pending requests from this leaving participant
    if (room.controlRequests) {
      room.controlRequests.forEach((req) => {
        if (req.userId === leftUser.userId && req.status === 'pending') {
          req.status = 'invalidated';
        }
      });
    }

    // If room is empty, delete it
    if (room.participants.length === 0) {
      this.rooms.delete(cleanRoomCode);
      return { leftUser, room: null };
    }

    // If the host departed, promote next moderator or oldest participant
    if (room.hostUserId === leftUser.userId) {
      const nextMod = room.participants.find((p) => p.role === 'moderator');
      const nextHost = nextMod || room.participants[0];
      nextHost.role = 'host';
      room.hostUserId = nextHost.userId;
    }

    return {
      leftUser,
      room: this.sanitizeRoom(room),
    };
  }

  /**
   * Authoritatively removes/kicks a participant from a room (Host only)
   * @param {Object} params
   * @param {string} params.roomCode
   * @param {string} params.socketId - Calling socket ID (must be authoritative Host)
   * @param {string} params.targetUserId - Target user ID to remove
   * @returns {{ removedUser: Object, room: Object }}
   */
  removeParticipant({ roomCode, socketId, targetUserId }) {
    if (!roomCode || typeof roomCode !== 'string') {
      throw { code: 'INVALID_ROOM_CODE', message: 'Room code is required.' };
    }
    const cleanRoomCode = roomCode.trim().toUpperCase();
    const room = this.rooms.get(cleanRoomCode);
    if (!room) {
      throw { code: 'ROOM_NOT_FOUND', message: `Room "${cleanRoomCode}" does not exist or has expired.` };
    }

    if (!socketId) {
      throw { code: 'SOCKET_REQUIRED', message: 'Active socket ID is required.' };
    }

    // Verify caller is the authoritative host of this room
    const caller = room.participants.find((p) => p.socketId === socketId);
    if (!caller) {
      throw { code: 'PERMISSION_DENIED', message: 'You are not an active member of this room.' };
    }
    if (caller.role !== 'host' || room.hostUserId !== caller.userId) {
      throw {
        code: 'PERMISSION_DENIED',
        message: 'Only the Host can remove participants from the room.',
      };
    }

    if (!targetUserId || typeof targetUserId !== 'string') {
      throw { code: 'INVALID_TARGET_USER_ID', message: 'Target user ID is required.' };
    }

    // Host cannot remove themselves
    if (targetUserId === caller.userId || targetUserId === room.hostUserId) {
      throw {
        code: 'CANNOT_REMOVE_SELF',
        message: 'The Host cannot remove themselves from the room.',
      };
    }

    // Check active participants
    const activeIndex = room.participants.findIndex((p) => p.userId === targetUserId);
    let removedUser = null;

    if (activeIndex !== -1) {
      [removedUser] = room.participants.splice(activeIndex, 1);
    } else if (room.disconnectedParticipants && room.disconnectedParticipants.has(targetUserId)) {
      removedUser = room.disconnectedParticipants.get(targetUserId);
      room.disconnectedParticipants.delete(targetUserId);
    } else {
      throw {
        code: 'PARTICIPANT_NOT_FOUND',
        message: 'Participant was not found in this room.',
      };
    }

    // Clean up active socket mapping for removed participant
    if (removedUser.socketId) {
      this.socketMap.delete(removedUser.socketId);
    }

    // Purge from disconnected pool if lingering
    if (room.disconnectedParticipants) {
      room.disconnectedParticipants.delete(targetUserId);
    }

    // Invalidate any pending control requests from this removed participant
    if (room.controlRequests) {
      room.controlRequests.forEach((req) => {
        if (req.userId === targetUserId && req.status === 'pending') {
          req.status = 'invalidated';
        }
      });
    }

    // Prevent recovering or reusing session in this room
    if (!room.removedUserIds) {
      room.removedUserIds = new Set();
    }
    room.removedUserIds.add(targetUserId);

    room.lastStateUpdatedAt = new Date().toISOString();

    return {
      removedUser,
      room: this.sanitizeRoom(room),
    };
  }

  /**
   * Handles unexpected socket disconnection with recovery tracking
   * @param {string} socketId 
   * @returns {{ roomCode: string, leftUser: Object, remainingRoom: Object|null } | null}
   */
  handleDisconnect(socketId) {
    const mapping = this.socketMap.get(socketId);
    if (!mapping) return null;

    const { roomCode, userId } = mapping;
    const cleanRoomCode = roomCode.trim().toUpperCase();
    const room = this.rooms.get(cleanRoomCode);

    // If room exists, record disconnected participant for session recovery
    if (room) {
      const participant = room.participants.find((p) => p.socketId === socketId);
      if (participant) {
        if (!room.disconnectedParticipants) {
          room.disconnectedParticipants = new Map();
        }
        room.disconnectedParticipants.set(participant.userId, {
          ...participant,
          disconnectedAt: Date.now(),
        });
      }
    }

    const { leftUser, room: remainingRoom } = this.leaveRoom({ roomCode, socketId });
    if (!leftUser) return null;

    return {
      roomCode,
      leftUser,
      remainingRoom,
    };
  }

  /**
   * Reconnects a previously connected participant after a temporary drop
   * @param {Object} params
   * @param {string} params.roomCode
   * @param {string} params.userId
   * @param {string} params.socketId
   * @returns {{ room: Object, user: Object }}
   */
  reconnectParticipant({ roomCode, userId, socketId }) {
    if (!roomCode) throw { code: 'INVALID_ROOM_CODE', message: 'Room code is required.' };
    if (!userId) throw { code: 'INVALID_USER_ID', message: 'User ID is required to restore session.' };
    if (!socketId) throw { code: 'SOCKET_REQUIRED', message: 'Active socket ID is required.' };

    const cleanRoomCode = roomCode.trim().toUpperCase();
    const room = this.rooms.get(cleanRoomCode);
    if (!room) {
      throw { code: 'ROOM_NOT_FOUND', message: `Room "${cleanRoomCode}" does not exist or has expired.` };
    }

    // Check if participant was removed by host
    if (room.removedUserIds && room.removedUserIds.has(userId)) {
      throw {
        code: 'REMOVED_FROM_ROOM',
        message: 'You have been removed from this room by the Host.',
      };
    }

    // 1. Check if participant is already in active participants list
    let participant = room.participants.find((p) => p.userId === userId);
    if (participant) {
      if (participant.socketId && participant.socketId !== socketId) {
        this.socketMap.delete(participant.socketId);
      }
      participant.socketId = socketId;
      this.socketMap.set(socketId, { roomCode: cleanRoomCode, userId });
      return {
        room: this.sanitizeRoom(room),
        user: { ...participant },
      };
    }

    // 2. Check if participant was saved in disconnected recovery pool
    const disconnected = room.disconnectedParticipants ? room.disconnectedParticipants.get(userId) : null;
    if (disconnected) {
      participant = {
        userId: disconnected.userId,
        socketId,
        username: disconnected.username,
        role: disconnected.role,
        joinedAt: disconnected.joinedAt,
        temporaryControlUntil: disconnected.temporaryControlUntil || null,
      };

      // If the room lost its host and this user was host, restore host role
      if (room.hostUserId === userId || !room.participants.some((p) => p.role === 'host')) {
        participant.role = 'host';
        room.hostUserId = userId;
      }

      room.participants.push(participant);
      room.disconnectedParticipants.delete(userId);
      this.socketMap.set(socketId, { roomCode: cleanRoomCode, userId });
      room.lastStateUpdatedAt = new Date().toISOString();

      return {
        room: this.sanitizeRoom(room),
        user: { ...participant },
      };
    }

    throw {
      code: 'SESSION_EXPIRED',
      message: 'Your room session has expired. Please rejoin the room.',
    };
  }

  /**
   * Evaluates if a given socket has playback control permissions in a room
   * @param {Object} room
   * @param {string} socketId
   * @returns {{ allowed: boolean, user: Object|null, reason?: string, isTemporary?: boolean }}
   */
  canControlPlayback(room, socketId) {
    if (!room || !socketId) return { allowed: false, user: null, reason: 'Invalid room or socket.' };
    const participant = room.participants.find((p) => p.socketId === socketId);
    if (!participant) return { allowed: false, user: null, reason: 'Participant not in room.' };

    // Host and Moderator always have authoritative control
    if (participant.role === 'host' || participant.role === 'moderator') {
      return { allowed: true, user: participant };
    }

    // Collaborative policy allows participant control
    if (room.policy === 'collaborative') {
      return { allowed: true, user: participant };
    }

    // Temporary control grant
    if (participant.temporaryControlUntil && participant.temporaryControlUntil > Date.now()) {
      return { allowed: true, user: participant, isTemporary: true };
    }

    return {
      allowed: false,
      user: participant,
      reason: 'Room playback is restricted to Host and Moderators. Request control from Host.',
    };
  }

  /**
   * Evaluates if a given socket has video change permissions in a room
   * @param {Object} room
   * @param {string} socketId
   * @returns {{ allowed: boolean, user: Object|null, reason?: string, isTemporary?: boolean }}
   */
  canChangeVideo(room, socketId) {
    if (!room || !socketId) return { allowed: false, user: null, reason: 'Invalid room or socket.' };
    const participant = room.participants.find((p) => p.socketId === socketId);
    if (!participant) return { allowed: false, user: null, reason: 'Participant not in room.' };

    // Host and Moderator always have authoritative control
    if (participant.role === 'host' || participant.role === 'moderator') {
      return { allowed: true, user: participant };
    }

    // Collaborative policy allows participant control
    if (room.policy === 'collaborative') {
      return { allowed: true, user: participant };
    }

    // Temporary control grant authorizes video changes while active
    if (participant.temporaryControlUntil && participant.temporaryControlUntil > Date.now()) {
      return { allowed: true, user: participant, isTemporary: true };
    }

    return {
      allowed: false,
      user: participant,
      reason: 'Video changing is restricted to Host, Moderators, or members with approved control.',
    };
  }

  /**
   * Submits a request for temporary playback control
   * @param {Object} params
   * @param {string} params.roomCode
   * @param {string} params.socketId
   * @returns {{ alreadyHasControl: boolean, request: Object|null, room: Object }}
   */
  requestControl({ roomCode, socketId }) {
    if (!roomCode) throw { code: 'INVALID_ROOM_CODE', message: 'Room code is required.' };
    const cleanRoomCode = roomCode.trim().toUpperCase();
    const room = this.rooms.get(cleanRoomCode);
    if (!room) throw { code: 'ROOM_NOT_FOUND', message: `Room "${cleanRoomCode}" does not exist.` };

    const participant = room.participants.find((p) => p.socketId === socketId);
    if (!participant) throw { code: 'PARTICIPANT_NOT_FOUND', message: 'Participant not in room.' };

    // If user already has control, inform them
    if (
      participant.role === 'host' ||
      participant.role === 'moderator' ||
      room.policy === 'collaborative' ||
      (participant.temporaryControlUntil && participant.temporaryControlUntil > Date.now())
    ) {
      return {
        alreadyHasControl: true,
        request: null,
        room: this.sanitizeRoom(room),
      };
    }

    if (!room.controlRequests) room.controlRequests = [];

    // Prevent duplicate pending requests from same participant
    const existingPending = room.controlRequests.find(
      (r) => r.userId === participant.userId && r.status === 'pending'
    );
    if (existingPending) {
      throw {
        code: 'DUPLICATE_REQUEST',
        message: 'You already have a pending control request awaiting Host approval.',
      };
    }

    const request = {
      requestId: `req_${crypto.randomBytes(4).toString('hex')}`,
      userId: participant.userId,
      username: participant.username,
      socketId,
      requestedAt: new Date().toISOString(),
      status: 'pending',
      expiresAt: null,
    };

    room.controlRequests.push(request);

    return {
      alreadyHasControl: false,
      request,
      room: this.sanitizeRoom(room),
    };
  }

  /**
   * Approves a pending temporary control request
   * @param {Object} params
   * @param {string} params.roomCode
   * @param {string} params.socketId
   * @param {string} params.requestId
   * @param {number} [params.durationMs=60000]
   * @returns {{ request: Object, participant: Object, room: Object }}
   */
  approveControl({ roomCode, socketId, requestId, durationMs = 60000 }) {
    if (!roomCode) throw { code: 'INVALID_ROOM_CODE', message: 'Room code is required.' };
    const cleanRoomCode = roomCode.trim().toUpperCase();
    const room = this.rooms.get(cleanRoomCode);
    if (!room) throw { code: 'ROOM_NOT_FOUND', message: `Room "${cleanRoomCode}" does not exist.` };

    const approver = room.participants.find((p) => p.socketId === socketId);
    if (!approver || (approver.role !== 'host' && approver.role !== 'moderator')) {
      throw {
        code: 'PERMISSION_DENIED',
        message: 'Only the Host or a Moderator can approve control requests.',
      };
    }

    if (!room.controlRequests) room.controlRequests = [];
    const request = room.controlRequests.find((r) => r.requestId === requestId);
    if (!request) {
      throw { code: 'REQUEST_NOT_FOUND', message: 'Control request was not found.' };
    }

    if (request.status !== 'pending') {
      throw { code: 'REQUEST_NOT_PENDING', message: `Request is already ${request.status}.` };
    }

    const targetParticipant = room.participants.find((p) => p.userId === request.userId);
    if (!targetParticipant) {
      request.status = 'invalidated';
      throw { code: 'PARTICIPANT_NOT_FOUND', message: 'Requesting participant has left the room.' };
    }

    const expiresAt = Date.now() + durationMs;
    targetParticipant.temporaryControlUntil = expiresAt;
    request.status = 'approved';
    request.expiresAt = expiresAt;

    return {
      request,
      participant: {
        userId: targetParticipant.userId,
        username: targetParticipant.username,
        hasTemporaryControl: true,
        temporaryControlUntil: expiresAt,
      },
      room: this.sanitizeRoom(room),
    };
  }

  /**
   * Rejects a pending temporary control request
   * @param {Object} params
   * @param {string} params.roomCode
   * @param {string} params.socketId
   * @param {string} params.requestId
   * @returns {{ request: Object, room: Object }}
   */
  rejectControl({ roomCode, socketId, requestId }) {
    if (!roomCode) throw { code: 'INVALID_ROOM_CODE', message: 'Room code is required.' };
    const cleanRoomCode = roomCode.trim().toUpperCase();
    const room = this.rooms.get(cleanRoomCode);
    if (!room) throw { code: 'ROOM_NOT_FOUND', message: `Room "${cleanRoomCode}" does not exist.` };

    const reviewer = room.participants.find((p) => p.socketId === socketId);
    if (!reviewer || (reviewer.role !== 'host' && reviewer.role !== 'moderator')) {
      throw {
        code: 'PERMISSION_DENIED',
        message: 'Only the Host or a Moderator can reject control requests.',
      };
    }

    if (!room.controlRequests) room.controlRequests = [];
    const request = room.controlRequests.find((r) => r.requestId === requestId);
    if (!request) {
      throw { code: 'REQUEST_NOT_FOUND', message: 'Control request was not found.' };
    }

    if (request.status !== 'pending') {
      throw { code: 'REQUEST_NOT_PENDING', message: `Request is already ${request.status}.` };
    }

    request.status = 'rejected';

    return {
      request,
      room: this.sanitizeRoom(room),
    };
  }

  /**
   * Revokes temporary playback control from a participant
   * @param {Object} params
   * @param {string} params.roomCode
   * @param {string} params.socketId
   * @param {string} params.targetUserId
   * @returns {{ targetUserId: string, room: Object }}
   */
  revokeControl({ roomCode, socketId, targetUserId }) {
    if (!roomCode) throw { code: 'INVALID_ROOM_CODE', message: 'Room code is required.' };
    const cleanRoomCode = roomCode.trim().toUpperCase();
    const room = this.rooms.get(cleanRoomCode);
    if (!room) throw { code: 'ROOM_NOT_FOUND', message: `Room "${cleanRoomCode}" does not exist.` };

    const caller = room.participants.find((p) => p.socketId === socketId);
    if (!caller || (caller.role !== 'host' && caller.role !== 'moderator')) {
      throw {
        code: 'PERMISSION_DENIED',
        message: 'Only the Host or a Moderator can revoke temporary control.',
      };
    }

    const target = room.participants.find((p) => p.userId === targetUserId);
    if (target) {
      target.temporaryControlUntil = null;
    }

    if (room.controlRequests) {
      room.controlRequests.forEach((r) => {
        if (r.userId === targetUserId && r.status === 'approved') {
          r.status = 'revoked';
        }
      });
    }

    return {
      targetUserId,
      room: this.sanitizeRoom(room),
    };
  }

  /**
   * Authoritatively changes the room's active video
   * @param {Object} params
   * @param {string} params.roomCode
   * @param {string} params.socketId
   * @param {string} params.videoUrl
   * @returns {{ room: Object, videoId: string, videoUrl: string, user: Object }}
   */
  changeVideo({ roomCode, socketId, videoUrl }) {
    if (!roomCode) throw { code: 'INVALID_ROOM_CODE', message: 'Room code is required.' };
    const cleanRoomCode = roomCode.trim().toUpperCase();
    const room = this.rooms.get(cleanRoomCode);
    if (!room) throw { code: 'ROOM_NOT_FOUND', message: `Room "${cleanRoomCode}" does not exist.` };

    const { allowed, user, reason } = this.canChangeVideo(room, socketId);
    if (!allowed) {
      throw { code: 'PERMISSION_DENIED', message: reason || 'Permission denied to change video.' };
    }

    const videoId = this.extractVideoId(videoUrl);
    if (!videoId) {
      throw { 
        code: 'INVALID_VIDEO_URL', 
        message: 'Could not extract a valid YouTube video ID. Please check the URL format.' 
      };
    }

    const now = new Date().toISOString();
    room.currentVideoId = videoId;
    room.videoUrl = videoUrl.trim();
    room.playbackStatus = 'paused';
    room.currentTime = 0;
    room.lastStateUpdatedAt = now;

    return {
      room: this.sanitizeRoom(room),
      videoId,
      videoUrl: room.videoUrl,
      user,
    };
  }

  /**
   * Authoritatively updates room playback state (play, pause, seek)
   * @param {Object} params
   * @param {string} params.roomCode
   * @param {string} params.socketId
   * @param {'play'|'pause'|'seek'} params.action
   * @param {number} params.currentTime
   * @returns {{ room: Object, action: string, currentTime: number, expectedPosition: number, user: Object }}
   */
  syncPlayback({ roomCode, socketId, action, currentTime = 0 }) {
    if (!roomCode) throw { code: 'INVALID_ROOM_CODE', message: 'Room code is required.' };
    const cleanRoomCode = roomCode.trim().toUpperCase();
    const room = this.rooms.get(cleanRoomCode);
    if (!room) throw { code: 'ROOM_NOT_FOUND', message: `Room "${cleanRoomCode}" does not exist.` };

    const { allowed, user, reason } = this.canControlPlayback(room, socketId);
    if (!allowed) {
      throw { code: 'PERMISSION_DENIED', message: reason || 'Permission denied to control playback.' };
    }

    const validActions = ['play', 'pause', 'seek'];
    if (!validActions.includes(action)) {
      throw { code: 'INVALID_ACTION', message: `Invalid action "${action}". Expected play, pause, or seek.` };
    }

    const parsedTime = typeof currentTime === 'number' && !isNaN(currentTime) ? Math.max(0, currentTime) : 0;
    const now = new Date().toISOString();

    if (action === 'play') {
      room.playbackStatus = 'playing';
      room.currentTime = parsedTime;
    } else if (action === 'pause') {
      room.playbackStatus = 'paused';
      room.currentTime = parsedTime;
    } else if (action === 'seek') {
      room.currentTime = parsedTime;
    }
    room.lastStateUpdatedAt = now;

    return {
      room: this.sanitizeRoom(room),
      action,
      currentTime: room.currentTime,
      expectedPosition: this.getExpectedPlaybackPosition(room),
      user,
    };
  }

  /**
   * Returns authoritative expected playback position considering elapsed server time
   * @param {Object} room
   * @returns {number}
   */
  getExpectedPlaybackPosition(room) {
    if (!room) return 0;
    const baseTime = typeof room.currentTime === 'number' && !isNaN(room.currentTime) ? Math.max(0, room.currentTime) : 0;
    if (room.playbackStatus === 'playing') {
      const lastUpdate = room.lastStateUpdatedAt ? new Date(room.lastStateUpdatedAt).getTime() : Date.now();
      const elapsedSec = Math.max(0, (Date.now() - lastUpdate) / 1000);
      return Math.round((baseTime + elapsedSec) * 100) / 100;
    }
    return baseTime;
  }

  /**
   * Retrieves sanitized room by code
   * @param {string} roomCode 
   * @returns {Object|null}
   */
  getRoom(roomCode) {
    if (!roomCode) return null;
    const room = this.rooms.get(roomCode.trim().toUpperCase());
    return room ? this.sanitizeRoom(room) : null;
  }

  /**
   * Strips internal metadata and computes authoritative sync values
   * @param {Object} room 
   * @returns {Object}
   */
  sanitizeRoom(room) {
    const expectedPosition = this.getExpectedPlaybackPosition(room);
    const now = Date.now();
    return {
      roomCode: room.roomCode,
      hostUserId: room.hostUserId,
      policy: room.policy,
      currentVideoId: room.currentVideoId,
      videoUrl: room.videoUrl,
      playbackStatus: room.playbackStatus,
      currentTime: room.currentTime,
      expectedPosition,
      lastStateUpdatedAt: room.lastStateUpdatedAt,
      createdAt: room.createdAt,
      participants: room.participants.map((p) => ({
        userId: p.userId,
        username: p.username,
        role: p.role,
        joinedAt: p.joinedAt,
        hasTemporaryControl: !!(p.temporaryControlUntil && p.temporaryControlUntil > now),
        temporaryControlUntil: p.temporaryControlUntil || null,
      })),
      controlRequests: (room.controlRequests || [])
        .filter((r) => r.status === 'pending' || now - new Date(r.requestedAt).getTime() < 120000)
        .map((r) => ({
          requestId: r.requestId,
          userId: r.userId,
          username: r.username,
          requestedAt: r.requestedAt,
          status: r.status,
          expiresAt: r.expiresAt || null,
        })),
    };
  }

  /**
   * Resets all in-memory state (useful for test suites)
   */
  clear() {
    this.rooms.clear();
    this.socketMap.clear();
  }
}

// Export singleton instance and class definition
export const roomStore = new RoomStore();
export { RoomStore };
