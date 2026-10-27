import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { RoomStore } from '../src/models/RoomStore.js';

describe('RoomStore In-Memory Unit Tests', () => {
  let store;

  beforeEach(() => {
    store = new RoomStore();
  });

  describe('Room Creation', () => {
    test('creates room with authoritative Host role and unique room code', () => {
      const { room, user } = store.createRoom({
        username: 'AliceHost',
        initialVideoUrl: 'https://www.youtube.com/watch?v=aqz-KE-bpKQ',
        policy: 'host_only',
        socketId: 'socket_alice_1',
      });

      assert.ok(room.roomCode.startsWith('WP-'), 'Room code should have WP- prefix');
      assert.equal(room.hostUserId, user.userId);
      assert.equal(user.username, 'AliceHost');
      assert.equal(user.role, 'host', 'Creator must be assigned the host role');
      assert.equal(room.currentVideoId, 'aqz-KE-bpKQ');
      assert.equal(room.playbackStatus, 'paused');
      assert.equal(room.currentTime, 0);
      assert.equal(room.participants.length, 1);
      assert.equal(room.participants[0].userId, user.userId);
    });

    test('rejects empty or whitespace-only host username', () => {
      assert.throws(
        () => {
          store.createRoom({
            username: '   ',
            socketId: 'socket_fail',
          });
        },
        (err) => err.code === 'INVALID_USERNAME'
      );
    });

    test('rejects room creation if socketId is missing', () => {
      assert.throws(
        () => {
          store.createRoom({
            username: 'ValidName',
            socketId: null,
          });
        },
        (err) => err.code === 'SOCKET_REQUIRED'
      );
    });
  });

  describe('Joining Rooms', () => {
    test('allows participant to join with default participant role', () => {
      const { room: createdRoom } = store.createRoom({
        username: 'AliceHost',
        socketId: 'socket_alice_1',
      });

      const { room: joinedRoom, user: bobUser } = store.joinRoom({
        roomCode: createdRoom.roomCode,
        username: 'BobMember',
        socketId: 'socket_bob_1',
      });

      assert.equal(bobUser.role, 'participant', 'Joining users must default to participant');
      assert.equal(joinedRoom.participants.length, 2);
      assert.ok(joinedRoom.participants.some((p) => p.username === 'BobMember'));
      assert.ok(joinedRoom.participants.some((p) => p.username === 'AliceHost'));
    });

    test('rejects joining a nonexistent room with ROOM_NOT_FOUND', () => {
      assert.throws(
        () => {
          store.joinRoom({
            roomCode: 'WP-FAKE99',
            username: 'Charlie',
            socketId: 'socket_charlie',
          });
        },
        (err) => err.code === 'ROOM_NOT_FOUND'
      );
    });

    test('rejects duplicate username in the same room ignoring case', () => {
      const { room } = store.createRoom({
        username: 'Alex',
        socketId: 'socket_alex_1',
      });

      assert.throws(
        () => {
          store.joinRoom({
            roomCode: room.roomCode,
            username: 'alex', // lowercase duplicate
            socketId: 'socket_alex_2',
          });
        },
        (err) => err.code === 'DUPLICATE_USERNAME'
      );
    });

    test('prevents duplicate connection from the same socket in the same room', () => {
      const { room } = store.createRoom({
        username: 'Alex',
        socketId: 'socket_same',
      });

      assert.throws(
        () => {
          store.joinRoom({
            roomCode: room.roomCode,
            username: 'DifferentName',
            socketId: 'socket_same',
          });
        },
        (err) => err.code === 'ALREADY_JOINED'
      );
    });
  });

  describe('Leaving & Disconnection', () => {
    test('participant departure removes them from room state', () => {
      const { room } = store.createRoom({ username: 'HostUser', socketId: 's1' });
      store.joinRoom({ roomCode: room.roomCode, username: 'PartUser', socketId: 's2' });

      const { leftUser, room: updatedRoom } = store.leaveRoom({
        roomCode: room.roomCode,
        socketId: 's2',
      });

      assert.equal(leftUser.username, 'PartUser');
      assert.equal(updatedRoom.participants.length, 1);
      assert.equal(updatedRoom.participants[0].username, 'HostUser');
    });

    test('when host leaves, room promotes the remaining participant to host', () => {
      const { room } = store.createRoom({ username: 'InitialHost', socketId: 's1' });
      store.joinRoom({ roomCode: room.roomCode, username: 'RemainingUser', socketId: 's2' });

      const { leftUser, room: updatedRoom } = store.leaveRoom({
        roomCode: room.roomCode,
        socketId: 's1',
      });

      assert.equal(leftUser.username, 'InitialHost');
      assert.equal(updatedRoom.participants.length, 1);
      assert.equal(updatedRoom.participants[0].role, 'host', 'Remaining user should become host');
      assert.equal(updatedRoom.hostUserId, updatedRoom.participants[0].userId);
    });

    test('when last participant leaves, room is cleaned up from memory', () => {
      const { room } = store.createRoom({ username: 'SoloUser', socketId: 's1' });
      const { room: remainingRoom } = store.leaveRoom({
        roomCode: room.roomCode,
        socketId: 's1',
      });

      assert.equal(remainingRoom, null, 'Empty room must be deleted');
      assert.equal(store.getRoom(room.roomCode), null);
    });

    test('handles unexpected socket disconnect', () => {
      const { room } = store.createRoom({ username: 'HostUser', socketId: 's1' });
      store.joinRoom({ roomCode: room.roomCode, username: 'DropUser', socketId: 's_drop' });

      const disconnectResult = store.handleDisconnect('s_drop');
      assert.ok(disconnectResult);
      assert.equal(disconnectResult.leftUser.username, 'DropUser');
      assert.equal(disconnectResult.remainingRoom.participants.length, 1);
    });
  });

  describe('Room Isolation', () => {
    test('updates and participants in Room A do not leak into Room B', () => {
      const { room: roomA } = store.createRoom({ username: 'UserInA', socketId: 'sA1' });
      const { room: roomB } = store.createRoom({ username: 'UserInB', socketId: 'sB1' });

      assert.notEqual(roomA.roomCode, roomB.roomCode);

      store.joinRoom({ roomCode: roomA.roomCode, username: 'SecondInA', socketId: 'sA2' });

      const stateA = store.getRoom(roomA.roomCode);
      const stateB = store.getRoom(roomB.roomCode);

      assert.equal(stateA.participants.length, 2);
      assert.equal(stateB.participants.length, 1);
      assert.ok(!stateB.participants.some((p) => p.username === 'SecondInA'));
    });
  });

  describe('Video Management & Validation', () => {
    test('extractVideoId validates and extracts 11-character video IDs from all supported YouTube URL formats', () => {
      // 1. Standard watch URL
      assert.equal(store.extractVideoId('https://www.youtube.com/watch?v=aqz-KE-bpKQ'), 'aqz-KE-bpKQ');
      // 2. Watch URL with additional parameters (timestamps, feature flags)
      assert.equal(store.extractVideoId('https://www.youtube.com/watch?v=aqz-KE-bpKQ&t=120s&feature=share'), 'aqz-KE-bpKQ');
      // 3. Shortened youtu.be link
      assert.equal(store.extractVideoId('https://youtu.be/aqz-KE-bpKQ'), 'aqz-KE-bpKQ');
      // 4. Shortened link with tracking parameters
      assert.equal(store.extractVideoId('https://youtu.be/aqz-KE-bpKQ?si=xyz123'), 'aqz-KE-bpKQ');
      // 5. Official YouTube embed URL
      assert.equal(store.extractVideoId('https://www.youtube.com/embed/aqz-KE-bpKQ'), 'aqz-KE-bpKQ');
      // 6. YouTube Shorts URL
      assert.equal(store.extractVideoId('https://www.youtube.com/shorts/aqz-KE-bpKQ'), 'aqz-KE-bpKQ');
      // 7. YouTube Live stream URL
      assert.equal(store.extractVideoId('https://www.youtube.com/live/aqz-KE-bpKQ'), 'aqz-KE-bpKQ');
      // 8. Privacy-enhanced embed URL
      assert.equal(store.extractVideoId('https://www.youtube-nocookie.com/embed/aqz-KE-bpKQ'), 'aqz-KE-bpKQ');
      // 9. Direct raw 11-character video ID
      assert.equal(store.extractVideoId('aqz-KE-bpKQ'), 'aqz-KE-bpKQ');
      // 10. Mobile YouTube URL
      assert.equal(store.extractVideoId('https://m.youtube.com/watch?v=aqz-KE-bpKQ'), 'aqz-KE-bpKQ');

      // Invalid inputs
      assert.equal(store.extractVideoId(''), null);
      assert.equal(store.extractVideoId(null), null);
      assert.equal(store.extractVideoId(undefined), null);
      assert.equal(store.extractVideoId('https://vimeo.com/123456789'), null);
      assert.equal(store.extractVideoId('https://youtube.com/watch?v=short'), null);
      assert.equal(store.extractVideoId('not a url'), null);
    });

    test('Participant in collaborative room can control playback and change video without requesting control', () => {
      const { room } = store.createRoom({
        username: 'CollabHost',
        policy: 'collaborative',
        socketId: 's_collab_host',
      });
      store.joinRoom({ roomCode: room.roomCode, username: 'CollabGuest', socketId: 's_collab_guest' });

      // Collaborative participant can change video
      const changeRes = store.changeVideo({
        roomCode: room.roomCode,
        socketId: 's_collab_guest',
        videoUrl: 'https://www.youtube.com/watch?v=jfKfPfyJRdk',
      });
      assert.equal(changeRes.videoId, 'jfKfPfyJRdk');
      assert.equal(changeRes.room.currentVideoId, 'jfKfPfyJRdk');

      // Collaborative participant can sync playback
      const playRes = store.syncPlayback({
        roomCode: room.roomCode,
        socketId: 's_collab_guest',
        action: 'play',
        currentTime: 30,
      });
      assert.equal(playRes.room.playbackStatus, 'playing');
      assert.equal(playRes.currentTime, 30);
    });

    test('Host can change video with valid YouTube watch URL or direct ID', () => {
      const { room } = store.createRoom({ username: 'HostUser', socketId: 's_host' });

      const result1 = store.changeVideo({
        roomCode: room.roomCode,
        socketId: 's_host',
        videoUrl: 'https://www.youtube.com/watch?v=jfKfPfyJRdk',
      });
      assert.equal(result1.videoId, 'jfKfPfyJRdk');
      assert.equal(result1.room.currentVideoId, 'jfKfPfyJRdk');
      assert.equal(result1.room.playbackStatus, 'paused');
      assert.equal(result1.room.currentTime, 0);

      // Direct 11-character ID
      const result2 = store.changeVideo({
        roomCode: room.roomCode,
        socketId: 's_host',
        videoUrl: 'aqz-KE-bpKQ',
      });
      assert.equal(result2.videoId, 'aqz-KE-bpKQ');
    });

    test('rejects invalid YouTube URL with INVALID_VIDEO_URL', () => {
      const { room } = store.createRoom({ username: 'HostUser', socketId: 's_host' });
      assert.throws(
        () => {
          store.changeVideo({
            roomCode: room.roomCode,
            socketId: 's_host',
            videoUrl: 'https://vimeo.com/123456',
          });
        },
        (err) => err.code === 'INVALID_VIDEO_URL'
      );
    });

    test('rejects video change from Participant in host_only room with PERMISSION_DENIED', () => {
      const { room } = store.createRoom({
        username: 'HostUser',
        policy: 'host_only',
        socketId: 's_host',
      });
      store.joinRoom({ roomCode: room.roomCode, username: 'Participant1', socketId: 's_part' });

      assert.throws(
        () => {
          store.changeVideo({
            roomCode: room.roomCode,
            socketId: 's_part',
            videoUrl: 'https://www.youtube.com/watch?v=jfKfPfyJRdk',
          });
        },
        (err) => err.code === 'PERMISSION_DENIED'
      );
    });

    test('Moderator can change video with valid YouTube URL', () => {
      const { room } = store.createRoom({ username: 'HostUser', socketId: 's_host' });
      const { user: modUser } = store.joinRoom({ roomCode: room.roomCode, username: 'ModUser', socketId: 's_mod' });
      const internalRoom = store.rooms.get(room.roomCode);
      const modParticipant = internalRoom.participants.find((p) => p.userId === modUser.userId);
      modParticipant.role = 'moderator';

      const result = store.changeVideo({
        roomCode: room.roomCode,
        socketId: 's_mod',
        videoUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      });
      assert.equal(result.videoId, 'dQw4w9WgXcQ');
      assert.equal(result.room.currentVideoId, 'dQw4w9WgXcQ');
    });

    test('Approved Participant with active temporary control can change video', () => {
      const { room } = store.createRoom({ username: 'HostUser', socketId: 's_host' });
      store.joinRoom({ roomCode: room.roomCode, username: 'ApprovedPart', socketId: 's_app' });
      const { request } = store.requestControl({ roomCode: room.roomCode, socketId: 's_app' });
      store.approveControl({
        roomCode: room.roomCode,
        socketId: 's_host',
        requestId: request.requestId,
        durationMs: 60000,
      });

      const result = store.changeVideo({
        roomCode: room.roomCode,
        socketId: 's_app',
        videoUrl: 'https://www.youtube.com/watch?v=jfKfPfyJRdk',
      });
      assert.equal(result.videoId, 'jfKfPfyJRdk');
      assert.equal(result.room.currentVideoId, 'jfKfPfyJRdk');
      assert.equal(result.user.username, 'ApprovedPart');
    });

    test('Revoked temporary control cannot authorize video change', () => {
      const { room } = store.createRoom({ username: 'HostUser', socketId: 's_host' });
      const { user: partUser } = store.joinRoom({ roomCode: room.roomCode, username: 'RevokedPart', socketId: 's_rev' });
      const { request } = store.requestControl({ roomCode: room.roomCode, socketId: 's_rev' });
      store.approveControl({
        roomCode: room.roomCode,
        socketId: 's_host',
        requestId: request.requestId,
        durationMs: 60000,
      });

      store.revokeControl({
        roomCode: room.roomCode,
        socketId: 's_host',
        targetUserId: partUser.userId,
      });

      assert.throws(
        () => {
          store.changeVideo({
            roomCode: room.roomCode,
            socketId: 's_rev',
            videoUrl: 'https://www.youtube.com/watch?v=jfKfPfyJRdk',
          });
        },
        (err) => err.code === 'PERMISSION_DENIED'
      );
    });

    test('Expired temporary control cannot authorize video change', async () => {
      const { room } = store.createRoom({ username: 'HostUser', socketId: 's_host' });
      store.joinRoom({ roomCode: room.roomCode, username: 'ExpiredPart', socketId: 's_exp' });
      const { request } = store.requestControl({ roomCode: room.roomCode, socketId: 's_exp' });
      store.approveControl({
        roomCode: room.roomCode,
        socketId: 's_host',
        requestId: request.requestId,
        durationMs: 50,
      });

      await new Promise((r) => setTimeout(r, 70));

      assert.throws(
        () => {
          store.changeVideo({
            roomCode: room.roomCode,
            socketId: 's_exp',
            videoUrl: 'https://www.youtube.com/watch?v=jfKfPfyJRdk',
          });
        },
        (err) => err.code === 'PERMISSION_DENIED'
      );
    });
  });

  describe('Playback Synchronization & Permissions', () => {
    test('Host can play, pause, and seek video', () => {
      const { room } = store.createRoom({ username: 'HostUser', socketId: 's_host' });

      // Play
      const playRes = store.syncPlayback({
        roomCode: room.roomCode,
        socketId: 's_host',
        action: 'play',
        currentTime: 15.5,
      });
      assert.equal(playRes.room.playbackStatus, 'playing');
      assert.equal(playRes.room.currentTime, 15.5);

      // Pause
      const pauseRes = store.syncPlayback({
        roomCode: room.roomCode,
        socketId: 's_host',
        action: 'pause',
        currentTime: 24,
      });
      assert.equal(pauseRes.room.playbackStatus, 'paused');
      assert.equal(pauseRes.room.currentTime, 24);

      // Seek
      const seekRes = store.syncPlayback({
        roomCode: room.roomCode,
        socketId: 's_host',
        action: 'seek',
        currentTime: 120,
      });
      assert.equal(seekRes.room.currentTime, 120);
    });

    test('rejects unauthorized participant playback action with PERMISSION_DENIED', () => {
      const { room } = store.createRoom({
        username: 'HostUser',
        policy: 'host_only',
        socketId: 's_host',
      });
      store.joinRoom({ roomCode: room.roomCode, username: 'GuestUser', socketId: 's_guest' });

      assert.throws(
        () => {
          store.syncPlayback({
            roomCode: room.roomCode,
            socketId: 's_guest',
            action: 'play',
            currentTime: 30,
          });
        },
        (err) => err.code === 'PERMISSION_DENIED'
      );
    });

    test('new participant joining while paused receives saved paused position', () => {
      const { room } = store.createRoom({ username: 'HostUser', socketId: 's_host' });
      store.syncPlayback({
        roomCode: room.roomCode,
        socketId: 's_host',
        action: 'pause',
        currentTime: 42.5,
      });

      const { room: joinedRoom } = store.joinRoom({
        roomCode: room.roomCode,
        username: 'NewJoiner',
        socketId: 's_joiner',
      });

      assert.equal(joinedRoom.playbackStatus, 'paused');
      assert.equal(joinedRoom.currentTime, 42.5);
      assert.equal(joinedRoom.expectedPosition, 42.5);
    });

    test('new participant joining while playing receives authoritative expected position with elapsed time', async () => {
      const { room } = store.createRoom({ username: 'HostUser', socketId: 's_host' });
      store.syncPlayback({
        roomCode: room.roomCode,
        socketId: 's_host',
        action: 'play',
        currentTime: 10.0,
      });

      // Wait 150ms to simulate real elapsed time
      await new Promise((r) => setTimeout(r, 150));

      const { room: joinedRoom } = store.joinRoom({
        roomCode: room.roomCode,
        username: 'NewJoiner',
        socketId: 's_joiner',
      });

      assert.equal(joinedRoom.playbackStatus, 'playing');
      assert.equal(joinedRoom.currentTime, 10.0);
      assert.ok(
        joinedRoom.expectedPosition >= 10.1 && joinedRoom.expectedPosition <= 10.8,
        `Expected position should include elapsed time (~10.15s), got ${joinedRoom.expectedPosition}`
      );
    });

    test('changing video authoritatively resets position to 0 and pauses playback', () => {
      const { room } = store.createRoom({ username: 'HostUser', socketId: 's_host' });
      store.syncPlayback({
        roomCode: room.roomCode,
        socketId: 's_host',
        action: 'play',
        currentTime: 75.0,
      });

      const changed = store.changeVideo({
        roomCode: room.roomCode,
        socketId: 's_host',
        videoUrl: 'https://www.youtube.com/watch?v=jfKfPfyJRdk',
      });

      assert.equal(changed.room.playbackStatus, 'paused');
      assert.equal(changed.room.currentTime, 0);
      assert.equal(changed.room.expectedPosition, 0);
    });
  });

  describe('Control Requests & Temporary Permissions Workflow', () => {
    test('participant can submit request for temporary control', () => {
      const { room } = store.createRoom({ username: 'HostUser', socketId: 's_host' });
      store.joinRoom({ roomCode: room.roomCode, username: 'Requester', socketId: 's_req' });

      const res = store.requestControl({
        roomCode: room.roomCode,
        socketId: 's_req',
      });

      assert.equal(res.alreadyHasControl, false);
      assert.ok(res.request);
      assert.equal(res.request.username, 'Requester');
      assert.equal(res.request.status, 'pending');
      assert.equal(res.room.controlRequests.length, 1);
    });

    test('rejects duplicate pending control requests from the same participant', () => {
      const { room } = store.createRoom({ username: 'HostUser', socketId: 's_host' });
      store.joinRoom({ roomCode: room.roomCode, username: 'Requester', socketId: 's_req' });

      store.requestControl({ roomCode: room.roomCode, socketId: 's_req' });

      assert.throws(
        () => {
          store.requestControl({ roomCode: room.roomCode, socketId: 's_req' });
        },
        (err) => err.code === 'DUPLICATE_REQUEST'
      );
    });

    test('Host can approve pending request, granting temporary control', () => {
      const { room } = store.createRoom({ username: 'HostUser', socketId: 's_host' });
      store.joinRoom({ roomCode: room.roomCode, username: 'Requester', socketId: 's_req' });
      const { request } = store.requestControl({ roomCode: room.roomCode, socketId: 's_req' });

      const approved = store.approveControl({
        roomCode: room.roomCode,
        socketId: 's_host',
        requestId: request.requestId,
        durationMs: 5000,
      });

      assert.equal(approved.request.status, 'approved');
      assert.equal(approved.participant.hasTemporaryControl, true);
      assert.ok(approved.participant.temporaryControlUntil > Date.now());

      // Verify participant now has playback authority
      const syncResult = store.syncPlayback({
        roomCode: room.roomCode,
        socketId: 's_req',
        action: 'play',
        currentTime: 50,
      });
      assert.equal(syncResult.room.currentTime, 50);
    });

    test('rejects unauthorized approval attempts from regular participants', () => {
      const { room } = store.createRoom({ username: 'HostUser', socketId: 's_host' });
      store.joinRoom({ roomCode: room.roomCode, username: 'User1', socketId: 's_user1' });
      store.joinRoom({ roomCode: room.roomCode, username: 'User2', socketId: 's_user2' });

      const { request } = store.requestControl({ roomCode: room.roomCode, socketId: 's_user1' });

      assert.throws(
        () => {
          store.approveControl({
            roomCode: room.roomCode,
            socketId: 's_user2', // Not host or moderator
            requestId: request.requestId,
          });
        },
        (err) => err.code === 'PERMISSION_DENIED'
      );
    });

    test('Host can reject control request', () => {
      const { room } = store.createRoom({ username: 'HostUser', socketId: 's_host' });
      store.joinRoom({ roomCode: room.roomCode, username: 'Requester', socketId: 's_req' });
      const { request } = store.requestControl({ roomCode: room.roomCode, socketId: 's_req' });

      const rejected = store.rejectControl({
        roomCode: room.roomCode,
        socketId: 's_host',
        requestId: request.requestId,
      });

      assert.equal(rejected.request.status, 'rejected');

      // Still denied playback control
      assert.throws(
        () => {
          store.syncPlayback({
            roomCode: room.roomCode,
            socketId: 's_req',
            action: 'play',
            currentTime: 20,
          });
        },
        (err) => err.code === 'PERMISSION_DENIED'
      );
    });

    test('temporary control expires after durationMs', async () => {
      const { room } = store.createRoom({ username: 'HostUser', socketId: 's_host' });
      store.joinRoom({ roomCode: room.roomCode, username: 'ShortTemp', socketId: 's_short' });
      const { request } = store.requestControl({ roomCode: room.roomCode, socketId: 's_short' });

      // Grant 100ms temporary control
      store.approveControl({
        roomCode: room.roomCode,
        socketId: 's_host',
        requestId: request.requestId,
        durationMs: 100,
      });

      // Immediately allowed
      const allowedBefore = store.canControlPlayback(store.rooms.get(room.roomCode), 's_short');
      assert.equal(allowedBefore.allowed, true);

      // Wait 150ms for expiry
      await new Promise((r) => setTimeout(r, 150));

      const allowedAfter = store.canControlPlayback(store.rooms.get(room.roomCode), 's_short');
      assert.equal(allowedAfter.allowed, false);
    });

    test('Host can explicitly revoke temporary control', () => {
      const { room } = store.createRoom({ username: 'HostUser', socketId: 's_host' });
      const { user: guest } = store.joinRoom({ roomCode: room.roomCode, username: 'Revokee', socketId: 's_rev' });
      const { request } = store.requestControl({ roomCode: room.roomCode, socketId: 's_rev' });

      store.approveControl({
        roomCode: room.roomCode,
        socketId: 's_host',
        requestId: request.requestId,
        durationMs: 60000,
      });

      store.revokeControl({
        roomCode: room.roomCode,
        socketId: 's_host',
        targetUserId: guest.userId,
      });

      const check = store.canControlPlayback(store.rooms.get(room.roomCode), 's_rev');
      assert.equal(check.allowed, false);
    });

    test('departing participant invalidates pending control requests', () => {
      const { room } = store.createRoom({ username: 'HostUser', socketId: 's_host' });
      store.joinRoom({ roomCode: room.roomCode, username: 'LeavingUser', socketId: 's_leave' });
      const { request } = store.requestControl({ roomCode: room.roomCode, socketId: 's_leave' });

      assert.equal(request.status, 'pending');

      store.leaveRoom({ roomCode: room.roomCode, socketId: 's_leave' });

      const updated = store.getRoom(room.roomCode);
      const reqInRoom = updated.controlRequests.find((r) => r.requestId === request.requestId);
      assert.ok(!reqInRoom || reqInRoom.status === 'invalidated');
    });
  });

  describe('Reconnection & Room State Recovery', () => {
    test('reconnectParticipant restores session for active socket', () => {
      const { room, user } = store.createRoom({ username: 'ReconnectHost', socketId: 's_orig' });

      const reconnected = store.reconnectParticipant({
        roomCode: room.roomCode,
        userId: user.userId,
        socketId: 's_new',
      });

      assert.equal(reconnected.user.userId, user.userId);
      assert.equal(reconnected.user.socketId, 's_new');
      assert.equal(reconnected.user.role, 'host');
    });

    test('reconnectParticipant restores dropped participant from recovery pool', () => {
      const { room } = store.createRoom({ username: 'StableHost', socketId: 's_host' });
      const { user: guest } = store.joinRoom({
        roomCode: room.roomCode,
        username: 'DroppedGuest',
        socketId: 's_drop_1',
      });

      // Abrupt disconnect occurs
      store.handleDisconnect('s_drop_1');

      // Room now has 1 member
      assert.equal(store.getRoom(room.roomCode).participants.length, 1);

      // Guest reconnects with new socket ID
      const recovered = store.reconnectParticipant({
        roomCode: room.roomCode,
        userId: guest.userId,
        socketId: 's_drop_2',
      });

      assert.equal(recovered.user.userId, guest.userId);
      assert.equal(recovered.user.username, 'DroppedGuest');
      assert.equal(recovered.user.socketId, 's_drop_2');
      assert.equal(recovered.room.participants.length, 2);
    });

    test('reconnectParticipant rejects nonexistent room with ROOM_NOT_FOUND', () => {
      assert.throws(
        () => {
          store.reconnectParticipant({
            roomCode: 'WP-NONEXIST',
            userId: 'usr_xyz',
            socketId: 's_new',
          });
        },
        (err) => err.code === 'ROOM_NOT_FOUND'
      );
    });

    test('reconnectParticipant rejects unknown user with SESSION_EXPIRED', () => {
      const { room } = store.createRoom({ username: 'HostUser', socketId: 's_host' });

      assert.throws(
        () => {
          store.reconnectParticipant({
            roomCode: room.roomCode,
            userId: 'usr_stranger',
            socketId: 's_new',
          });
        },
        (err) => err.code === 'SESSION_EXPIRED'
      );
    });
  });

  describe('Remove / Kick Participant Workflow', () => {
    test('Host can remove a participant from the active room', () => {
      const { room, user: hostUser } = store.createRoom({
        username: 'AliceHost',
        socketId: 's_host',
      });
      const { user: guestUser } = store.joinRoom({
        roomCode: room.roomCode,
        username: 'BobGuest',
        socketId: 's_guest',
      });

      const { removedUser, room: updatedRoom } = store.removeParticipant({
        roomCode: room.roomCode,
        socketId: 's_host',
        targetUserId: guestUser.userId,
      });

      assert.equal(removedUser.userId, guestUser.userId);
      assert.equal(removedUser.username, 'BobGuest');
      assert.equal(updatedRoom.participants.length, 1);
      assert.equal(updatedRoom.participants[0].userId, hostUser.userId);
      assert.equal(store.socketMap.has('s_guest'), false, 'Removed socket must be purged from socketMap');
      assert.equal(store.socketMap.has('s_host'), true, 'Host socket mapping must remain intact');
    });

    test('Participant cannot remove another participant (permission denied)', () => {
      const { room } = store.createRoom({
        username: 'AliceHost',
        socketId: 's_host',
      });
      const { user: guest1 } = store.joinRoom({
        roomCode: room.roomCode,
        username: 'BobGuest1',
        socketId: 's_guest1',
      });
      const { user: guest2 } = store.joinRoom({
        roomCode: room.roomCode,
        username: 'CharlieGuest2',
        socketId: 's_guest2',
      });

      assert.throws(
        () => {
          store.removeParticipant({
            roomCode: room.roomCode,
            socketId: 's_guest1',
            targetUserId: guest2.userId,
          });
        },
        (err) => err.code === 'PERMISSION_DENIED'
      );

      const currentRoom = store.getRoom(room.roomCode);
      assert.equal(currentRoom.participants.length, 3, 'All participants must remain in room');
    });

    test('Host cannot remove themselves from the room', () => {
      const { room, user: hostUser } = store.createRoom({
        username: 'AliceHost',
        socketId: 's_host',
      });

      assert.throws(
        () => {
          store.removeParticipant({
            roomCode: room.roomCode,
            socketId: 's_host',
            targetUserId: hostUser.userId,
          });
        },
        (err) => err.code === 'CANNOT_REMOVE_SELF'
      );

      const currentRoom = store.getRoom(room.roomCode);
      assert.equal(currentRoom.participants.length, 1);
      assert.equal(currentRoom.hostUserId, hostUser.userId);
    });

    test('Rejects invalid targets and non-existent participants', () => {
      const { room } = store.createRoom({
        username: 'AliceHost',
        socketId: 's_host',
      });

      // Target does not exist
      assert.throws(
        () => {
          store.removeParticipant({
            roomCode: room.roomCode,
            socketId: 's_host',
            targetUserId: 'usr_nonexistent',
          });
        },
        (err) => err.code === 'PARTICIPANT_NOT_FOUND'
      );

      // Target in a different room
      const { user: otherGuest } = store.createRoom({
        username: 'OtherHost',
        socketId: 's_other_host',
      });

      assert.throws(
        () => {
          store.removeParticipant({
            roomCode: room.roomCode,
            socketId: 's_host',
            targetUserId: otherGuest.userId,
          });
        },
        (err) => err.code === 'PARTICIPANT_NOT_FOUND'
      );

      // Nonexistent room
      assert.throws(
        () => {
          store.removeParticipant({
            roomCode: 'WP-FAKE',
            socketId: 's_host',
            targetUserId: 'usr_abc',
          });
        },
        (err) => err.code === 'ROOM_NOT_FOUND'
      );
    });

    test('Remaining participants receive updated participant list and count', () => {
      const { room, user: host } = store.createRoom({
        username: 'Host',
        socketId: 's_host',
      });
      const { user: g1 } = store.joinRoom({
        roomCode: room.roomCode,
        username: 'Guest1',
        socketId: 's_g1',
      });
      const { user: g2 } = store.joinRoom({
        roomCode: room.roomCode,
        username: 'Guest2',
        socketId: 's_g2',
      });

      const { room: afterRemove } = store.removeParticipant({
        roomCode: room.roomCode,
        socketId: 's_host',
        targetUserId: g1.userId,
      });

      assert.equal(afterRemove.participants.length, 2);
      assert.deepEqual(
        afterRemove.participants.map((p) => p.userId).sort(),
        [host.userId, g2.userId].sort()
      );
    });

    test('Removed participant cannot continue controlling playback or changing video', () => {
      const { room } = store.createRoom({
        username: 'Host',
        initialVideoUrl: 'https://www.youtube.com/watch?v=aqz-KE-bpKQ',
        policy: 'collaborative',
        socketId: 's_host',
      });
      const { user: guest } = store.joinRoom({
        roomCode: room.roomCode,
        username: 'Guest',
        socketId: 's_guest',
      });

      // Guest can initially control in collaborative room
      const initialControl = store.canControlPlayback(store.rooms.get(room.roomCode), 's_guest');
      assert.equal(initialControl.allowed, true);

      // Host removes guest
      store.removeParticipant({
        roomCode: room.roomCode,
        socketId: 's_host',
        targetUserId: guest.userId,
      });

      // Subsequent control checks must fail
      const controlAfterRemoval = store.canControlPlayback(store.rooms.get(room.roomCode), 's_guest');
      assert.equal(controlAfterRemoval.allowed, false);

      assert.throws(
        () => {
          store.syncPlayback({
            roomCode: room.roomCode,
            socketId: 's_guest',
            action: 'play',
            currentTime: 10,
          });
        },
        (err) => err.code === 'PERMISSION_DENIED'
      );

      assert.throws(
        () => {
          store.changeVideo({
            roomCode: room.roomCode,
            socketId: 's_guest',
            videoUrl: 'https://www.youtube.com/watch?v=jfKfPfyJRdk',
          });
        },
        (err) => err.code === 'PERMISSION_DENIED'
      );
    });

    test('Invalidates pending control requests from removed participant', () => {
      const { room } = store.createRoom({
        username: 'Host',
        socketId: 's_host',
      });
      const { user: guest } = store.joinRoom({
        roomCode: room.roomCode,
        username: 'Guest',
        socketId: 's_guest',
      });

      const { request } = store.requestControl({
        roomCode: room.roomCode,
        socketId: 's_guest',
      });
      assert.equal(request.status, 'pending');

      store.removeParticipant({
        roomCode: room.roomCode,
        socketId: 's_host',
        targetUserId: guest.userId,
      });

      const rawRoom = store.rooms.get(room.roomCode);
      const reqAfter = rawRoom.controlRequests.find((r) => r.requestId === request.requestId);
      assert.equal(reqAfter.status, 'invalidated');
    });

    test('Removed participant cannot recover session via reconnectParticipant', () => {
      const { room } = store.createRoom({
        username: 'Host',
        socketId: 's_host',
      });
      const { user: guest } = store.joinRoom({
        roomCode: room.roomCode,
        username: 'Guest',
        socketId: 's_guest',
      });

      store.removeParticipant({
        roomCode: room.roomCode,
        socketId: 's_host',
        targetUserId: guest.userId,
      });

      assert.throws(
        () => {
          store.reconnectParticipant({
            roomCode: room.roomCode,
            userId: guest.userId,
            socketId: 's_guest_reconnect',
          });
        },
        (err) => err.code === 'REMOVED_FROM_ROOM'
      );
    });

    test('Host can remove a participant who temporarily dropped connection', () => {
      const { room } = store.createRoom({
        username: 'Host',
        socketId: 's_host',
      });
      const { user: guest } = store.joinRoom({
        roomCode: room.roomCode,
        username: 'Guest',
        socketId: 's_guest',
      });

      // Guest disconnects unexpectedly
      store.handleDisconnect('s_guest');
      const rawRoom = store.rooms.get(room.roomCode);
      assert.equal(rawRoom.disconnectedParticipants.has(guest.userId), true);

      // Host removes the disconnected guest
      const { removedUser } = store.removeParticipant({
        roomCode: room.roomCode,
        socketId: 's_host',
        targetUserId: guest.userId,
      });
      assert.equal(removedUser.userId, guest.userId);
      assert.equal(rawRoom.disconnectedParticipants.has(guest.userId), false);

      // Attempted reconnection is rejected
      assert.throws(
        () => {
          store.reconnectParticipant({
            roomCode: room.roomCode,
            userId: guest.userId,
            socketId: 's_new',
          });
        },
        (err) => err.code === 'REMOVED_FROM_ROOM'
      );
    });
  });
});
