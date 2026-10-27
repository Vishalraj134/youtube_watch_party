import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'http';
import express from 'express';
import { Server as SocketIOServer } from 'socket.io';
import { io as ClientIO } from 'socket.io-client';
import { registerRoomHandlers } from '../src/sockets/roomHandler.js';
import { roomStore } from '../src/models/RoomStore.js';

describe('Socket.IO Real-Time Communication Integration Tests', () => {
  let server;
  let ioServer;
  let serverPort;

  before(async () => {
    const app = express();
    server = http.createServer(app);
    ioServer = new SocketIOServer(server, { cors: { origin: '*' } });

    ioServer.on('connection', (socket) => {
      registerRoomHandlers(ioServer, socket);
    });

    await new Promise((resolve) => {
      server.listen(0, () => {
        serverPort = server.address().port;
        resolve();
      });
    });
  });

  after(async () => {
    roomStore.clear();
    await new Promise((resolve) => ioServer.close(resolve));
    await new Promise((resolve) => server.close(resolve));
  });

  test('Host creates room via create_room and receives authoritative sync_state', async () => {
    const client1 = ClientIO(`http://localhost:${serverPort}`);

    await new Promise((resolve, reject) => {
      client1.on('connect', () => {
        client1.emit(
          'create_room',
          {
            username: 'SuperHost',
            initialVideoUrl: 'https://www.youtube.com/watch?v=aqz-KE-bpKQ',
          },
          (response) => {
            try {
              assert.equal(response.success, true);
              assert.ok(response.room.roomCode);
              assert.equal(response.user.role, 'host');
              assert.equal(response.user.username, 'SuperHost');
              client1.disconnect();
              resolve();
            } catch (err) {
              client1.disconnect();
              reject(err);
            }
          }
        );
      });
    });
  });

  test('Participant joins via join_room, broadcasts user_joined, and receives sync_state', async () => {
    const hostClient = ClientIO(`http://localhost:${serverPort}`);
    const joinClient = ClientIO(`http://localhost:${serverPort}`);

    let activeRoomCode = '';

    // Step 1: Host creates room
    await new Promise((resolve) => {
      hostClient.emit(
        'create_room',
        { username: 'RoomHost' },
        (res) => {
          activeRoomCode = res.room.roomCode;
          resolve();
        }
      );
    });

    // Step 2: Set up listener on Host for user_joined
    const userJoinedPromise = new Promise((resolve) => {
      hostClient.on('user_joined', (data) => {
        assert.equal(data.user.username, 'PartyGuest');
        assert.equal(data.user.role, 'participant');
        assert.equal(data.room.participants.length, 2);
        resolve();
      });
    });

    // Step 3: Guest joins room
    const guestSyncPromise = new Promise((resolve, reject) => {
      joinClient.emit(
        'join_room',
        { roomCode: activeRoomCode, username: 'PartyGuest' },
        (res) => {
          try {
            assert.equal(res.success, true);
            assert.equal(res.user.role, 'participant');
            assert.equal(res.room.participants.length, 2);
            resolve();
          } catch (e) {
            reject(e);
          }
        }
      );
    });

    await Promise.all([userJoinedPromise, guestSyncPromise]);

    // Step 4: Disconnect guest and verify host receives user_left
    const userLeftPromise = new Promise((resolve) => {
      hostClient.on('user_left', (data) => {
        assert.equal(data.user.username, 'PartyGuest');
        assert.equal(data.room.participants.length, 1);
        resolve();
      });
    });

    joinClient.disconnect();
    await userLeftPromise;

    hostClient.disconnect();
  });

  test('Emits room_error on duplicate username attempt', async () => {
    const hostClient = ClientIO(`http://localhost:${serverPort}`);
    const guestClient = ClientIO(`http://localhost:${serverPort}`);
    let activeRoomCode = '';

    await new Promise((resolve) => {
      hostClient.emit('create_room', { username: 'UniqueName' }, (res) => {
        activeRoomCode = res.room.roomCode;
        resolve();
      });
    });

    await new Promise((resolve) => {
      guestClient.emit(
        'join_room',
        { roomCode: activeRoomCode, username: 'uniquename' }, // case-insensitive match
        (res) => {
          assert.equal(res.success, false);
          assert.equal(res.code, 'DUPLICATE_USERNAME');
          resolve();
        }
      );
    });

    hostClient.disconnect();
    guestClient.disconnect();
  });

  test('Host broadcasts video_changed to all room members on change_video', async () => {
    const hostClient = ClientIO(`http://localhost:${serverPort}`);
    const guestClient = ClientIO(`http://localhost:${serverPort}`);
    let activeRoomCode = '';

    await new Promise((resolve) => {
      hostClient.emit('create_room', { username: 'VideoHost' }, (res) => {
        activeRoomCode = res.room.roomCode;
        resolve();
      });
    });

    await new Promise((resolve) => {
      guestClient.emit('join_room', { roomCode: activeRoomCode, username: 'VideoGuest' }, () => {
        resolve();
      });
    });

    const guestVideoPromise = new Promise((resolve) => {
      guestClient.on('video_changed', (data) => {
        assert.equal(data.videoId, 'jfKfPfyJRdk');
        assert.equal(data.room.currentVideoId, 'jfKfPfyJRdk');
        assert.equal(data.user.username, 'VideoHost');
        resolve();
      });
    });

    await new Promise((resolve) => {
      hostClient.emit(
        'change_video',
        { roomCode: activeRoomCode, videoUrl: 'https://www.youtube.com/watch?v=jfKfPfyJRdk' },
        (res) => {
          assert.equal(res.success, true);
          assert.equal(res.videoId, 'jfKfPfyJRdk');
          resolve();
        }
      );
    });

    await guestVideoPromise;

    hostClient.disconnect();
    guestClient.disconnect();
  });

  test('Host broadcasts playback_synced to other members on playback_action', async () => {
    const hostClient = ClientIO(`http://localhost:${serverPort}`);
    const guestClient = ClientIO(`http://localhost:${serverPort}`);
    let activeRoomCode = '';

    await new Promise((resolve) => {
      hostClient.emit('create_room', { username: 'PlayHost' }, (res) => {
        activeRoomCode = res.room.roomCode;
        resolve();
      });
    });

    await new Promise((resolve) => {
      guestClient.emit('join_room', { roomCode: activeRoomCode, username: 'PlayGuest' }, () => {
        resolve();
      });
    });

    const guestPlaybackPromise = new Promise((resolve) => {
      guestClient.on('playback_synced', (data) => {
        assert.equal(data.action, 'play');
        assert.equal(data.currentTime, 45.2);
        assert.equal(data.playbackStatus, 'playing');
        resolve();
      });
    });

    await new Promise((resolve) => {
      hostClient.emit(
        'playback_action',
        { roomCode: activeRoomCode, action: 'play', currentTime: 45.2 },
        (res) => {
          assert.equal(res.success, true);
          resolve();
        }
      );
    });

    await guestPlaybackPromise;

    // Verify participant cannot control playback when restricted
    await new Promise((resolve) => {
      guestClient.emit(
        'playback_action',
        { roomCode: activeRoomCode, action: 'pause', currentTime: 45.2 },
        (res) => {
          assert.equal(res.success, false);
          assert.equal(res.code, 'PERMISSION_DENIED');
          resolve();
        }
      );
    });

    hostClient.disconnect();
    guestClient.disconnect();
  });

  test('Participant submits request_control, Host receives control_requested and approves via approve_control', async () => {
    const hostClient = ClientIO(`http://localhost:${serverPort}`);
    const guestClient = ClientIO(`http://localhost:${serverPort}`);
    let activeRoomCode = '';

    await new Promise((resolve) => {
      hostClient.emit('create_room', { username: 'ControlHost' }, (res) => {
        activeRoomCode = res.room.roomCode;
        resolve();
      });
    });

    await new Promise((resolve) => {
      guestClient.emit('join_room', { roomCode: activeRoomCode, username: 'ControlGuest' }, () => {
        resolve();
      });
    });

    let submittedRequestId = '';

    // Step 1: Host listens for control_requested broadcast
    const hostRequestPromise = new Promise((resolve) => {
      hostClient.on('control_requested', (data) => {
        assert.equal(data.request.username, 'ControlGuest');
        assert.equal(data.request.status, 'pending');
        submittedRequestId = data.request.requestId;
        resolve();
      });
    });

    // Step 2: Guest requests control
    await new Promise((resolve) => {
      guestClient.emit('request_control', { roomCode: activeRoomCode }, (res) => {
        assert.equal(res.success, true);
        assert.equal(res.request.status, 'pending');
        resolve();
      });
    });

    await hostRequestPromise;

    // Step 3: Guest listens for control_approved
    const guestApprovedPromise = new Promise((resolve) => {
      guestClient.on('control_approved', (data) => {
        assert.equal(data.request.requestId, submittedRequestId);
        assert.equal(data.participant.hasTemporaryControl, true);
        resolve();
      });
    });

    // Step 4: Host approves control request
    await new Promise((resolve) => {
      hostClient.emit(
        'approve_control',
        { roomCode: activeRoomCode, requestId: submittedRequestId, durationMs: 10000 },
        (res) => {
          assert.equal(res.success, true);
          assert.equal(res.request.status, 'approved');
          resolve();
        }
      );
    });

    await guestApprovedPromise;

    // Step 5: Guest now can execute playback_action successfully
    await new Promise((resolve) => {
      guestClient.emit(
        'playback_action',
        { roomCode: activeRoomCode, action: 'play', currentTime: 60 },
        (res) => {
          assert.equal(res.success, true);
          assert.equal(res.currentTime, 60);
          resolve();
        }
      );
    });

    hostClient.disconnect();
    guestClient.disconnect();
  });

  test('reconnect_room restores room membership and broadcasts user_reconnected', async () => {
    const hostClient = ClientIO(`http://localhost:${serverPort}`);
    const guestClient1 = ClientIO(`http://localhost:${serverPort}`);
    let activeRoomCode = '';
    let guestUserId = '';

    await new Promise((resolve) => {
      hostClient.emit('create_room', { username: 'RecoveryHost' }, (res) => {
        activeRoomCode = res.room.roomCode;
        resolve();
      });
    });

    await new Promise((resolve) => {
      guestClient1.emit('join_room', { roomCode: activeRoomCode, username: 'RecoveryGuest' }, (res) => {
        guestUserId = res.user.userId;
        resolve();
      });
    });

    // Guest socket 1 drops
    guestClient1.disconnect();
    await new Promise((r) => setTimeout(r, 50));

    // Host listens for user_reconnected
    const reconnectedPromise = new Promise((resolve) => {
      hostClient.on('user_reconnected', (data) => {
        assert.equal(data.user.username, 'RecoveryGuest');
        assert.equal(data.user.userId, guestUserId);
        resolve();
      });
    });

    // New socket client connects and reconnects
    const guestClient2 = ClientIO(`http://localhost:${serverPort}`);

    await new Promise((resolve) => {
      guestClient2.on('connect', () => {
        guestClient2.emit(
          'reconnect_room',
          { roomCode: activeRoomCode, userId: guestUserId },
          (res) => {
            assert.equal(res.success, true);
            assert.equal(res.user.userId, guestUserId);
            assert.equal(res.room.participants.length, 2);
            resolve();
          }
        );
      });
    });

    await reconnectedPromise;

    hostClient.disconnect();
    guestClient2.disconnect();
  });

  test('Regression: Host pause, play, and seek synchronization across two clients', async () => {
    const hostClient = ClientIO(`http://localhost:${serverPort}`);
    const guestClient = ClientIO(`http://localhost:${serverPort}`);
    let activeRoomCode = '';

    // Step 1: Create room as Host
    await new Promise((resolve) => {
      hostClient.emit('create_room', { username: 'SyncHost' }, (res) => {
        assert.equal(res.success, true);
        activeRoomCode = res.room.roomCode;
        resolve();
      });
    });

    // Step 2: Join room as Participant
    await new Promise((resolve) => {
      guestClient.emit('join_room', { roomCode: activeRoomCode, username: 'SyncParticipant' }, (res) => {
        assert.equal(res.success, true);
        assert.equal(res.user.role, 'participant');
        resolve();
      });
    });

    // Step 3: Host plays video -> Participant receives playback_synced with action: 'play'
    const playSyncedPromise = new Promise((resolve) => {
      guestClient.once('playback_synced', (data) => {
        assert.equal(data.action, 'play');
        assert.equal(data.playbackStatus, 'playing');
        assert.equal(data.currentTime, 10);
        assert.ok(data.room, 'Payload must include updated room object');
        assert.equal(data.room.playbackStatus, 'playing');
        assert.equal(data.user.role, 'host');
        resolve();
      });
    });

    await new Promise((resolve) => {
      hostClient.emit(
        'playback_action',
        { roomCode: activeRoomCode, action: 'play', currentTime: 10 },
        (res) => {
          assert.equal(res.success, true);
          assert.equal(res.room.playbackStatus, 'playing');
          resolve();
        }
      );
    });

    await playSyncedPromise;

    // Step 4: Host pauses video -> Participant receives playback_synced with action: 'pause'
    const pauseSyncedPromise = new Promise((resolve) => {
      guestClient.once('playback_synced', (data) => {
        assert.equal(data.action, 'pause');
        assert.equal(data.playbackStatus, 'paused');
        assert.equal(data.currentTime, 42.5);
        assert.ok(data.room, 'Payload must include updated room object');
        assert.equal(data.room.playbackStatus, 'paused');
        assert.equal(data.user.role, 'host');
        resolve();
      });
    });

    await new Promise((resolve) => {
      hostClient.emit(
        'playback_action',
        { roomCode: activeRoomCode, action: 'pause', currentTime: 42.5 },
        (res) => {
          assert.equal(res.success, true);
          assert.equal(res.room.playbackStatus, 'paused');
          assert.equal(res.room.currentTime, 42.5);
          resolve();
        }
      );
    });

    await pauseSyncedPromise;

    // Step 5: Host seeks video -> Participant receives playback_synced with action: 'seek'
    const seekSyncedPromise = new Promise((resolve) => {
      guestClient.once('playback_synced', (data) => {
        assert.equal(data.action, 'seek');
        assert.equal(data.currentTime, 120);
        assert.ok(data.room, 'Payload must include updated room object');
        assert.equal(data.room.currentTime, 120);
        resolve();
      });
    });

    await new Promise((resolve) => {
      hostClient.emit(
        'playback_action',
        { roomCode: activeRoomCode, action: 'seek', currentTime: 120 },
        (res) => {
          assert.equal(res.success, true);
          assert.equal(res.room.currentTime, 120);
          resolve();
        }
      );
    });

    await seekSyncedPromise;

    // Step 6: Verify unauthorized Participant cannot pause or play without permissions
    await new Promise((resolve) => {
      guestClient.emit(
        'playback_action',
        { roomCode: activeRoomCode, action: 'pause', currentTime: 120 },
        (res) => {
          assert.equal(res.success, false);
          assert.equal(res.code, 'PERMISSION_DENIED');
          resolve();
        }
      );
    });

    hostClient.disconnect();
    guestClient.disconnect();
  });

  test('Playback events do not leak between different rooms', async () => {
    const hostA = ClientIO(`http://localhost:${serverPort}`);
    const hostB = ClientIO(`http://localhost:${serverPort}`);
    let roomA = '';
    let roomB = '';

    // Create Room A
    await new Promise((resolve) => {
      hostA.emit('create_room', { username: 'HostA' }, (res) => {
        roomA = res.room.roomCode;
        resolve();
      });
    });

    // Create Room B
    await new Promise((resolve) => {
      hostB.emit('create_room', { username: 'HostB' }, (res) => {
        roomB = res.room.roomCode;
        resolve();
      });
    });

    let roomBReceivedSync = false;
    hostB.on('playback_synced', () => {
      roomBReceivedSync = true;
    });

    // Host A emits playback action in Room A
    await new Promise((resolve) => {
      hostA.emit('playback_action', { roomCode: roomA, action: 'play', currentTime: 15 }, (res) => {
        assert.equal(res.success, true);
        resolve();
      });
    });

    // Wait a brief window to ensure no cross-room leakage
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(roomBReceivedSync, false, 'Clients in different rooms must not receive playback_synced events from other rooms');

    hostA.disconnect();
    hostB.disconnect();
  });

  test('Remote sync does not generate echo loops and unauthorized participant actions are rejected', async () => {
    const host = ClientIO(`http://localhost:${serverPort}`);
    const guest = ClientIO(`http://localhost:${serverPort}`);
    let roomCode = '';

    await new Promise((resolve) => {
      host.emit('create_room', { username: 'LoopTestHost' }, (res) => {
        roomCode = res.room.roomCode;
        resolve();
      });
    });

    await new Promise((resolve) => {
      guest.emit('join_room', { roomCode, username: 'LoopTestGuest' }, () => {
        resolve();
      });
    });

    let hostReceivedUnsolicitedAction = false;
    host.on('playback_synced', () => {
      // Host should only receive playback_synced if someone else successfully acted
      hostReceivedUnsolicitedAction = true;
    });

    // Host emits play
    await new Promise((resolve) => {
      host.emit('playback_action', { roomCode, action: 'play', currentTime: 5 }, (res) => {
        assert.equal(res.success, true);
        resolve();
      });
    });

    // Guest receives sync; verify guest cannot echo it back
    await new Promise((resolve) => {
      guest.emit('playback_action', { roomCode, action: 'play', currentTime: 5 }, (res) => {
        assert.equal(res.success, false);
        assert.equal(res.code, 'PERMISSION_DENIED');
        resolve();
      });
    });

    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(hostReceivedUnsolicitedAction, false, 'No echo events should reach the host from an unauthorized participant');

    host.disconnect();
    guest.disconnect();
  });

  test('Regression: Consecutive video changes broadcast and update participant without leaving room', async () => {
    const host = ClientIO(`http://localhost:${serverPort}`);
    const participant = ClientIO(`http://localhost:${serverPort}`);
    let roomCode = '';

    // Step 1: Create room as Host
    await new Promise((resolve) => {
      host.emit('create_room', { username: 'VideoChangeHost' }, (res) => {
        assert.equal(res.success, true);
        roomCode = res.room.roomCode;
        resolve();
      });
    });

    // Step 2: Participant joins
    await new Promise((resolve) => {
      participant.emit('join_room', { roomCode, username: 'VideoChangeParticipant' }, (res) => {
        assert.equal(res.success, true);
        assert.equal(res.user.role, 'participant');
        resolve();
      });
    });

    // Step 3: First video change
    const firstChangePromise = new Promise((resolve) => {
      participant.once('video_changed', (data) => {
        assert.equal(data.videoId, 'jfKfPfyJRdk');
        assert.equal(data.room.currentVideoId, 'jfKfPfyJRdk');
        assert.equal(data.room.playbackStatus, 'paused');
        assert.equal(data.room.currentTime, 0);
        resolve();
      });
    });

    await new Promise((resolve) => {
      host.emit(
        'change_video',
        { roomCode, videoUrl: 'https://www.youtube.com/watch?v=jfKfPfyJRdk' },
        (res) => {
          assert.equal(res.success, true);
          assert.equal(res.videoId, 'jfKfPfyJRdk');
          assert.equal(res.room.currentVideoId, 'jfKfPfyJRdk');
          resolve();
        }
      );
    });

    await firstChangePromise;

    // Step 4: Consecutive second video change immediately following first
    const secondChangePromise = new Promise((resolve) => {
      participant.once('video_changed', (data) => {
        assert.equal(data.videoId, 'dQw4w9WgXcQ');
        assert.equal(data.room.currentVideoId, 'dQw4w9WgXcQ');
        assert.equal(data.room.playbackStatus, 'paused');
        assert.equal(data.room.currentTime, 0);
        resolve();
      });
    });

    await new Promise((resolve) => {
      host.emit(
        'change_video',
        { roomCode, videoUrl: 'https://youtu.be/dQw4w9WgXcQ' },
        (res) => {
          assert.equal(res.success, true);
          assert.equal(res.videoId, 'dQw4w9WgXcQ');
          assert.equal(res.room.currentVideoId, 'dQw4w9WgXcQ');
          resolve();
        }
      );
    });

    await secondChangePromise;

    // Step 5: Verify participant cannot change video without permissions
    await new Promise((resolve) => {
      participant.emit(
        'change_video',
        { roomCode, videoUrl: 'https://www.youtube.com/watch?v=aqz-KE-bpKQ' },
        (res) => {
          assert.equal(res.success, false);
          assert.equal(res.code, 'PERMISSION_DENIED');
          resolve();
        }
      );
    });

    host.disconnect();
    participant.disconnect();
  });

  test('Approved Participant can change video and broadcast video_changed to other room members, but revoked participant is denied', async () => {
    const host = ClientIO(`http://localhost:${serverPort}`);
    const guest = ClientIO(`http://localhost:${serverPort}`);
    let roomCode = '';
    let guestUserId = '';

    // Step 1: Create room as Host
    await new Promise((resolve) => {
      host.emit('create_room', { username: 'VideoPermHost' }, (res) => {
        assert.equal(res.success, true);
        roomCode = res.room.roomCode;
        resolve();
      });
    });

    // Step 2: Guest joins as Participant
    await new Promise((resolve) => {
      guest.emit('join_room', { roomCode, username: 'VideoPermGuest' }, (res) => {
        assert.equal(res.success, true);
        assert.equal(res.user.role, 'participant');
        guestUserId = res.user.userId;
        resolve();
      });
    });

    // Step 3: Unapproved Guest cannot change video
    await new Promise((resolve) => {
      guest.emit(
        'change_video',
        { roomCode, videoUrl: 'https://www.youtube.com/watch?v=jfKfPfyJRdk' },
        (res) => {
          assert.equal(res.success, false);
          assert.equal(res.code, 'PERMISSION_DENIED');
          resolve();
        }
      );
    });

    // Step 4: Guest requests control and Host approves
    let requestId = '';
    const hostRequestedPromise = new Promise((resolve) => {
      host.once('control_requested', (data) => {
        requestId = data.request.requestId;
        resolve();
      });
    });

    await new Promise((resolve) => {
      guest.emit('request_control', { roomCode }, (res) => {
        assert.equal(res.success, true);
        resolve();
      });
    });

    await hostRequestedPromise;

    const guestApprovedPromise = new Promise((resolve) => {
      guest.once('control_approved', (data) => {
        assert.equal(data.participant.hasTemporaryControl, true);
        resolve();
      });
    });

    await new Promise((resolve) => {
      host.emit('approve_control', { roomCode, requestId, durationMs: 60000 }, (res) => {
        assert.equal(res.success, true);
        resolve();
      });
    });

    await guestApprovedPromise;

    // Step 5: Approved Guest changes video and broadcasts video_changed to Host
    const hostVideoChangedPromise = new Promise((resolve) => {
      host.once('video_changed', (data) => {
        assert.equal(data.videoId, 'jfKfPfyJRdk');
        assert.equal(data.room.currentVideoId, 'jfKfPfyJRdk');
        assert.equal(data.user.username, 'VideoPermGuest');
        resolve();
      });
    });

    await new Promise((resolve) => {
      guest.emit(
        'change_video',
        { roomCode, videoUrl: 'https://www.youtube.com/watch?v=jfKfPfyJRdk' },
        (res) => {
          assert.equal(res.success, true);
          assert.equal(res.videoId, 'jfKfPfyJRdk');
          assert.equal(res.room.currentVideoId, 'jfKfPfyJRdk');
          resolve();
        }
      );
    });

    await hostVideoChangedPromise;

    // Step 6: Host revokes control
    const guestRevokedPromise = new Promise((resolve) => {
      guest.once('control_revoked', (data) => {
        assert.equal(data.targetUserId, guestUserId);
        resolve();
      });
    });

    await new Promise((resolve) => {
      host.emit('revoke_control', { roomCode, targetUserId: guestUserId }, (res) => {
        assert.equal(res.success, true);
        resolve();
      });
    });

    await guestRevokedPromise;

    // Step 7: Revoked Guest can no longer change video
    await new Promise((resolve) => {
      guest.emit(
        'change_video',
        { roomCode, videoUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' },
        (res) => {
          assert.equal(res.success, false);
          assert.equal(res.code, 'PERMISSION_DENIED');
          resolve();
        }
      );
    });

    host.disconnect();
    guest.disconnect();
  });

  test('Host rejects participant control request via reject_control, broadcasting control_rejected, and participant actions remain restricted', async () => {
    const host = ClientIO(`http://localhost:${serverPort}`);
    const guest = ClientIO(`http://localhost:${serverPort}`);
    let roomCode = '';

    // Step 1: Create room
    await new Promise((resolve) => {
      host.emit('create_room', { username: 'RejectHost' }, (res) => {
        assert.equal(res.success, true);
        roomCode = res.room.roomCode;
        resolve();
      });
    });

    // Step 2: Guest joins room
    await new Promise((resolve) => {
      guest.emit('join_room', { roomCode, username: 'RejectGuest' }, (res) => {
        assert.equal(res.success, true);
        resolve();
      });
    });

    // Step 3: Guest submits request_control
    let requestId = '';
    const hostControlRequestedPromise = new Promise((resolve) => {
      host.once('control_requested', (data) => {
        requestId = data.request.requestId;
        assert.equal(data.request.username, 'RejectGuest');
        assert.equal(data.request.status, 'pending');
        resolve();
      });
    });

    await new Promise((resolve) => {
      guest.emit('request_control', { roomCode }, (res) => {
        assert.equal(res.success, true);
        resolve();
      });
    });

    await hostControlRequestedPromise;

    // Step 4: Host rejects control request
    const guestControlRejectedPromise = new Promise((resolve) => {
      guest.once('control_rejected', (data) => {
        assert.equal(data.request.requestId, requestId);
        assert.equal(data.request.status, 'rejected');
        resolve();
      });
    });

    await new Promise((resolve) => {
      host.emit('reject_control', { roomCode, requestId }, (res) => {
        assert.equal(res.success, true);
        assert.equal(res.request.status, 'rejected');
        resolve();
      });
    });

    await guestControlRejectedPromise;

    // Step 5: Verify participant playback action is still rejected
    await new Promise((resolve) => {
      guest.emit(
        'playback_action',
        { roomCode, action: 'play', currentTime: 15 },
        (res) => {
          assert.equal(res.success, false);
          assert.equal(res.code, 'PERMISSION_DENIED');
          resolve();
        }
      );
    });

    host.disconnect();
    guest.disconnect();
  });

  test('Host removes participant via remove_participant, participant receives event, and cannot control room', async () => {
    const host = ClientIO(`http://localhost:${serverPort}`);
    const guest1 = ClientIO(`http://localhost:${serverPort}`);
    const guest2 = ClientIO(`http://localhost:${serverPort}`);

    let roomCode = '';
    let hostUser = null;
    let guest1User = null;
    let guest2User = null;

    // Step 1: Host creates room
    await new Promise((resolve) => {
      host.emit('create_room', { username: 'KickHost' }, (res) => {
        assert.equal(res.success, true);
        roomCode = res.room.roomCode;
        hostUser = res.user;
        resolve();
      });
    });

    // Step 2: Guest 1 & Guest 2 join
    await new Promise((resolve) => {
      guest1.emit('join_room', { roomCode, username: 'KickGuest1' }, (res) => {
        assert.equal(res.success, true);
        guest1User = res.user;
        resolve();
      });
    });

    await new Promise((resolve) => {
      guest2.emit('join_room', { roomCode, username: 'KickGuest2' }, (res) => {
        assert.equal(res.success, true);
        guest2User = res.user;
        resolve();
      });
    });

    // Step 3: Listeners for removal
    const guest1RemovedPromise = new Promise((resolve) => {
      guest1.once('participant_removed', (data) => {
        assert.equal(data.user.userId, guest1User.userId);
        assert.ok(data.message.includes('removed'));
        resolve();
      });
    });

    const guest2NotifiedPromise = new Promise((resolve) => {
      guest2.once('user_left', (data) => {
        assert.equal(data.user.userId, guest1User.userId);
        assert.equal(data.room.participants.length, 2);
        resolve();
      });
    });

    // Step 4: Host removes Guest 1
    await new Promise((resolve) => {
      host.emit(
        'remove_participant',
        { roomCode, targetUserId: guest1User.userId },
        (res) => {
          assert.equal(res.success, true);
          assert.equal(res.removedUser.userId, guest1User.userId);
          assert.equal(res.room.participants.length, 2);
          resolve();
        }
      );
    });

    await Promise.all([guest1RemovedPromise, guest2NotifiedPromise]);

    // Step 5: Removed Guest 1 tries playback_action -> rejected
    await new Promise((resolve) => {
      guest1.emit(
        'playback_action',
        { roomCode, action: 'play', currentTime: 10 },
        (res) => {
          assert.equal(res.success, false);
          assert.equal(res.code, 'PERMISSION_DENIED');
          resolve();
        }
      );
    });

    // Step 6: Removed Guest 1 tries reconnect_room -> rejected
    await new Promise((resolve) => {
      guest1.emit(
        'reconnect_room',
        { roomCode, userId: guest1User.userId },
        (res) => {
          assert.equal(res.success, false);
          assert.equal(res.code, 'REMOVED_FROM_ROOM');
          resolve();
        }
      );
    });

    host.disconnect();
    guest1.disconnect();
    guest2.disconnect();
  });

  test('Unauthorized participant attempting remove_participant is rejected with PERMISSION_DENIED', async () => {
    const host = ClientIO(`http://localhost:${serverPort}`);
    const guest1 = ClientIO(`http://localhost:${serverPort}`);
    const guest2 = ClientIO(`http://localhost:${serverPort}`);

    let roomCode = '';
    let guest2User = null;

    await new Promise((resolve) => {
      host.emit('create_room', { username: 'AuthHost' }, (res) => {
        roomCode = res.room.roomCode;
        resolve();
      });
    });

    await new Promise((resolve) => {
      guest1.emit('join_room', { roomCode, username: 'AuthGuest1' }, () => resolve());
    });

    await new Promise((resolve) => {
      guest2.emit('join_room', { roomCode, username: 'AuthGuest2' }, (res) => {
        guest2User = res.user;
        resolve();
      });
    });

    // Guest 1 tries to kick Guest 2
    await new Promise((resolve) => {
      guest1.emit(
        'remove_participant',
        { roomCode, targetUserId: guest2User.userId },
        (res) => {
          assert.equal(res.success, false);
          assert.equal(res.code, 'PERMISSION_DENIED');
          resolve();
        }
      );
    });

    host.disconnect();
    guest1.disconnect();
    guest2.disconnect();
  });

  test('Host attempting to remove themselves via remove_participant is rejected with CANNOT_REMOVE_SELF', async () => {
    const host = ClientIO(`http://localhost:${serverPort}`);

    let roomCode = '';
    let hostUser = null;

    await new Promise((resolve) => {
      host.emit('create_room', { username: 'SelfKickHost' }, (res) => {
        roomCode = res.room.roomCode;
        hostUser = res.user;
        resolve();
      });
    });

    await new Promise((resolve) => {
      host.emit(
        'remove_participant',
        { roomCode, targetUserId: hostUser.userId },
        (res) => {
          assert.equal(res.success, false);
          assert.equal(res.code, 'CANNOT_REMOVE_SELF');
          resolve();
        }
      );
    });

    host.disconnect();
  });
});

