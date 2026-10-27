# 🎬 YouTube Watch Party System

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/Vishalraj134/youtube_watch_party)

> A production-ready, real-time synchronized YouTube watch party web application built with React, Node.js, Express, Socket.IO, and the YouTube IFrame API.

---

## 📌 Live Demo & Public Deployment
- **Live URL**: *(Deployment will be configured in Phase 5 after core real-time sync is finalized)*
- **Backend Service**: Render / Railway (Node.js WebSocket persistent service)
- **Frontend App**: Render / Vercel (Static SPA)

---

## 🎯 Project Overview & Internship Objectives
The **YouTube Watch Party System** enables distributed groups of friends or study circles to watch YouTube videos in frame-accurate synchronization. It addresses real-world distributed state challenges:
- **Zero-Drift Playback**: Synchronizing Play, Pause, Seek, and Video transitions across all connected clients.
- **Role Hierarchy**: Structured permissions for **Host**, **Moderators**, and **Participants**.
- **Approval Queues**: Participants can request seeking or video changes, which hosts can approve or decline in real time.
- **Backend Authority**: Strict server-side validation to prevent unauthorized playback modifications.

---

## 🏗️ Architecture & Tech Stack

| Layer | Technology | Rationale |
| :--- | :--- | :--- |
| **Frontend** | React 19 + Vite | Blazing-fast HMR, component modularity, modern declarative UI |
| **Styling** | Vanilla Modern CSS | Custom cinema dark theme (`#080B11`), glassmorphism, responsive flex/grid, zero build friction |
| **Icons** | Lucide React | High-legibility UI icons for player controls, role badges, and status pills |
| **Backend** | Node.js + Express | Lightweight, event-driven REST API and HTTP server |
| **Real-Time** | Socket.IO | Bidirectional WebSocket communication with automatic fallback and room partitioning |
| **Video Engine** | YouTube IFrame Player API | Native embed supporting programmatic play, pause, seek, and state change callbacks |
| **State Store** | In-Memory (Phase 1-4) | High-speed, zero-dependency room and participant management |

---

## 📁 Repository Structure & Responsibilities

```text
YouTube Watch Party System/
├── client/                              # Frontend React + Vite Application
│   ├── public/                          # Static assets and favicons
│   ├── src/
│   │   ├── components/                  # Modular, reusable UI components
│   │   │   ├── AlertBanner.jsx          # Error, warning, and success notifications
│   │   │   ├── Navbar.jsx               # Header with brand logo, nav tabs, & live backend health badge
│   │   │   ├── RoomBadge.jsx            # Shareable Room Code pill with 1-click clipboard copy
│   │   │   └── YouTubeIcon.jsx          # Crisp SVG YouTube brand icon
│   │   ├── pages/                       # Screen-level views
│   │   │   ├── HomePage.jsx             # Lobby with dual Create Party & Join Party cards
│   │   │   └── WatchRoomPage.jsx        # 16:9 theater player, role switcher preview, & moderation sidebar
│   │   ├── App.jsx                      # Root view router, health-check polling, and room state
│   │   ├── App.css                      # Custom components and responsive layout stylesheet
│   │   ├── index.css                    # Design system tokens, cinema dark theme, and typography
│   │   └── main.jsx                     # React DOM mount point
│   ├── .env.example                     # Client environment template
│   ├── index.html                       # HTML5 entry with Plus Jakarta Sans & JetBrains Mono fonts
│   ├── package.json                     # Frontend dependencies & scripts
│   └── vite.config.js                   # Vite configuration with /api reverse proxy to port 5000
│
├── server/                              # Backend Node.js + Express + Socket.IO Server
│   ├── src/
│   │   ├── config/                      # Environment and server configuration
│   │   │   └── index.js                 # Centralized configuration (PORT, CLIENT_ORIGIN)
│   │   └── server.js                    # Express app, CORS, /api/health endpoint, & Socket.IO initialization
│   ├── .env.example                     # Backend environment template
│   └── package.json                     # Backend dependencies (express, cors, dotenv, socket.io)
│
├── .gitignore                           # Excludes node_modules, dist/, and .env secrets
├── package.json                         # Root monorepo orchestration scripts
└── README.md                            # Comprehensive project guide and assessment documentation
```

### Responsibility Breakdown
1. **`client/src/pages/HomePage.jsx`**: Handles room creation (defining nickname, optional video, and control policy) and room joining (validating room code).
2. **`client/src/pages/WatchRoomPage.jsx`**: Renders the synchronized 16:9 theater screen, custom controls, and a multi-tab sidebar (Participants, Playback Approvals, and Sync Event Stream). Includes an interactive **Role Switcher** for interviewers to test Host, Moderator, and Participant capabilities.
3. **`client/src/components/Navbar.jsx`**: Displays application status, quick assessment view switcher, and a live health check pill connected to the backend.
4. **`server/src/server.js`**: Runs the HTTP server, provides the `/api/health` diagnostic endpoint, and attaches the Socket.IO instance for real-time room communication.
5. **`client/vite.config.js`**: Proxies `/api` requests directly to `http://localhost:5000` to eliminate cross-origin configuration friction during local development.

---

## 🚀 Quickstart & Local Setup

### Prerequisites
- **Node.js**: v18.0.0 or higher (Tested on Node v23.10.0)
- **npm**: v9.0.0 or higher

### 1. Installation
Clone the repository and install dependencies for both client and server:
```bash
# Install backend dependencies
cd server
npm install

# Install frontend dependencies
cd ../client
npm install
```

### 2. Environment Configuration
Copy the `.env.example` templates:
```bash
# Server environment
cp server/.env.example server/.env

# Client environment
cp client/.env.example client/.env
```

**Default values:**
- `server/.env`: `PORT=5000`, `CLIENT_ORIGIN=http://localhost:5173`
- `client/.env`: `VITE_SERVER_URL=http://localhost:5000`

### 3. Running Locally
Open two terminal windows (or run via npm prefix from root):

**Terminal 1 — Backend Server:**
```bash
cd server
npm run dev
# Server starts on http://localhost:5000
# Health check available at: http://localhost:5000/api/health
```

**Terminal 2 — Frontend Application:**
```bash
cd client
npm run dev
# Vite dev server runs at: http://localhost:5173
```

---

## 🧪 Build & Verification Results (Phase 1 – Phase 4)

| Check | Command | Result | Notes |
| :--- | :--- | :--- | :--- |
| **Backend Unit & Integration Tests** | `npm test` (in `server/`) | **PASSED (39/39 tests)** | Authoritative playback, elapsed time calculations, drift correction, control request approval/rejection, permission expiry, and reconnect recovery |
| **Backend Health** | `GET http://localhost:5000/api/health` | **PASSED (200 OK)** | Returns `{ status: "ok", phase: "Phase 4 - Reliable Playback Synchronization...", activeRooms: 0 }` |
| **Frontend Dev** | `http://localhost:5173/` | **PASSED (200 OK)** | Serves SPA with dark cinematic UI and real-time WebSocket sync |
| **Client Build** | `npm run build` (in `client/`) | **PASSED (0 Errors)** | Production bundle built cleanly with Vite in 299ms |
| **Live Multi-Client Sockets** | Socket.IO Client test harness | **PASSED** | Multi-socket create, join, drift seek, control request approval, and reconnection verified |

---

## 📡 Real-Time Socket.IO Event Contracts (Phase 2)

### 1. `create_room` (Client ➔ Server)
- **Purpose**: Creates a new room and authoritative Host session.
- **Payload**:
  ```json
  {
    "username": "Alex",
    "initialVideoUrl": "https://www.youtube.com/watch?v=aqz-KE-bpKQ",
    "policy": "host_only"
  }
  ```
- **Server Response / Callback**:
  ```json
  {
    "success": true,
    "room": {
      "roomCode": "WP-4821",
      "hostUserId": "usr_9d8f...",
      "policy": "host_only",
      "currentVideoId": "aqz-KE-bpKQ",
      "videoUrl": "https://www.youtube.com/watch?v=aqz-KE-bpKQ",
      "playbackStatus": "paused",
      "currentTime": 0,
      "lastStateUpdatedAt": "2026-10-26T14:35:00.000Z",
      "participants": [
        {
          "userId": "usr_9d8f...",
          "username": "Alex",
          "role": "host",
          "joinedAt": "2026-10-26T14:35:00.000Z"
        }
      ]
    },
    "user": {
      "userId": "usr_9d8f...",
      "username": "Alex",
      "role": "host"
    }
  }
  ```

### 2. `join_room` (Client ➔ Server)
- **Purpose**: Joins an existing room by room code. Assigns `participant` role by default.
- **Payload**:
  ```json
  {
    "roomCode": "WP-4821",
    "username": "Sam"
  }
  ```
- **Validation**:
  - Rejects if room does not exist (`ROOM_NOT_FOUND`).
  - Rejects duplicate username within the same room ignoring case (`DUPLICATE_USERNAME`).
  - Rejects duplicate connection from the same socket (`ALREADY_JOINED`).

### 3. `sync_state` (Server ➔ Client)
- **Purpose**: Direct unicast to the joining client with full authoritative room state.
- **Payload**:
  ```json
  {
    "room": { /* Full Room State */ },
    "user": { "userId": "usr_...", "username": "Sam", "role": "participant" }
  }
  ```

### 4. `user_joined` (Server ➔ Room Broadcast)
- **Purpose**: Broadcasts to all other room members when a new participant joins.
- **Payload**:
  ```json
  {
    "user": { "userId": "usr_...", "username": "Sam", "role": "participant" },
    "room": { /* Updated Room State with all participants */ }
  }
  ```

### 5. `leave_room` / Disconnect (Client ➔ Server / Server ➔ Room Broadcast)
- **Purpose**: Client sends `leave_room` or drops connection. Server removes participant and broadcasts `user_left`.
- **`user_left` Payload**:
  ```json
  {
    "user": { "userId": "usr_...", "username": "Sam", "role": "participant" },
    "room": { /* Updated Room State with remaining participants */ }
  }
  ```
- *Host Promotion*: If the host leaves, the next moderator or participant is automatically promoted to Host. If no members remain, the room is deleted from memory.

### 6. `room_error` (Server ➔ Client)
- **Purpose**: Dispatched when an action fails validation or business rules.
- **Payload**:
  ```json
  {
    "code": "DUPLICATE_USERNAME",
    "message": "The name \"Alex\" is already taken in this room. Please choose another nickname."
  }
  ```

### 7. `change_video` (Client ➔ Server) / `video_changed` (Server ➔ Room Broadcast)
- **Purpose**: Host or Moderator changes the room's active video. Backend validates permission and extracts the 11-char YouTube ID.
- **Inbound Payload (`change_video`)**:
  ```json
  {
    "roomCode": "WP-4821",
    "videoUrl": "https://www.youtube.com/watch?v=jfKfPfyJRdk"
  }
  ```
- **Outbound Broadcast (`video_changed`)**:
  ```json
  {
    "videoId": "jfKfPfyJRdk",
    "videoUrl": "https://www.youtube.com/watch?v=jfKfPfyJRdk",
    "room": { /* Updated Room State */ },
    "user": { "userId": "usr_...", "username": "Alex", "role": "host" }
  }
  ```

### 8. `playback_action` (Client ➔ Server) / `playback_synced` (Server ➔ Room Broadcast)
- **Purpose**: Broadcasts play, pause, or seek events across all clients with loop-prevention guard.
- **Inbound Payload (`playback_action`)**:
  ```json
  {
    "roomCode": "WP-4821",
    "action": "play",
    "currentTime": 45.2
  }
  ```
- **Outbound Broadcast (`playback_synced`)**:
  ```json
  {
    "action": "play",
    "currentTime": 45.2,
    "playbackStatus": "playing",
    "user": { "username": "Alex", "role": "host" },
    "timestamp": 1729955400000
  }
  ```
- **Echo Loop Prevention**: Clients maintain an internal `isRemoteSyncRef` lock when executing remote socket actions so that the player's native `onStateChange` callback does NOT bounce back to the server.

### 9. `request_control` / `control_requested` (Client ➔ Server / Server ➔ Room Broadcast)
- **Purpose**: Participant requests temporary playback authority. Broadcasts to all room members so Host/Moderator can review immediately.
- **Inbound Payload (`request_control`)**: `{ "roomCode": "WP-4821" }`
- **Broadcast (`control_requested`)**:
  ```json
  {
    "request": {
      "requestId": "req_8f3a",
      "userId": "usr_...",
      "username": "Sam",
      "status": "pending",
      "requestedAt": "2026-10-26T16:00:00.000Z"
    },
    "room": { /* Updated Room State */ }
  }
  ```

### 10. `approve_control` & `reject_control` (Host/Mod ➔ Server / Server ➔ Room Broadcast)
- **Purpose**: Host or Moderator approves or declines a pending request. Approvals grant temporary playback authority (`hasTemporaryControl: true`) for a configurable window (default 60s).
- **Inbound Payload (`approve_control`)**: `{ "roomCode": "WP-4821", "requestId": "req_8f3a", "durationMs": 60000 }`
- **Broadcast (`control_approved`)**:
  ```json
  {
    "request": { "requestId": "req_8f3a", "status": "approved", "expiresAt": 1729956060000 },
    "participant": { "userId": "usr_...", "username": "Sam", "hasTemporaryControl": true },
    "room": { /* Updated Room State */ }
  }
  ```

### 11. `reconnect_room` / `user_reconnected` (Client ➔ Server / Server ➔ Room Broadcast)
- **Purpose**: Re-associates a reconnecting participant after a network dropout or tab reload, restoring session, role, temporary permissions, and authoritative expected playback position.
- **Inbound Payload (`reconnect_room`)**: `{ "roomCode": "WP-4821", "userId": "usr_..." }`
- **Unicast (`sync_state`)**: Returns full room state with `expectedPosition` and `isReconnected: true`.
- **Broadcast (`user_reconnected`)**: `{ "user": { "username": "Sam" }, "room": { /* State */ } }`

---

## 🗺️ Incremental Implementation Plan

- [x] **Phase 1: Project Architecture & Responsive Application Shell**
  - Project initialization, folder structure, clean dependencies
  - Cinema dark UI with glassmorphism, responsive dual-card lobby, and 16:9 theater screen
  - Live backend connection health check & diagnostic endpoint
- [x] **Phase 2: In-Memory Room Management & Real-Time Socket.IO Synchronization**
  - Backend authoritative room creation & collision-free room code generation
  - Authoritative Host role assignment and Participant default role
  - Case-insensitive duplicate username rejection and nonexistent room rejection
  - Real-time Socket.IO communication (`join_room`, `leave_room`, `user_joined`, `user_left`, `sync_state`, `room_error`)
  - Live connected participant lists and disconnect handling with host reassignment
  - Automated unit and integration test suite
- [x] **Phase 3: Real YouTube Video Playback & Synchronization**
  - Official YouTube IFrame Player API integration (`YouTubePlayer.jsx`)
  - Automatic extraction and validation of YouTube watch URLs, youtu.be links, and raw 11-char IDs
  - Synchronized play, pause, and seek controls via Socket.IO (`playback_action` ➔ `playback_synced`)
  - Real-time video URL changes with authoritative backend validation (`change_video` ➔ `video_changed`)
  - Bidirectional event echo loop prevention (`isRemoteSyncRef`)
  - Backend permission enforcement for playback actions and video changes
  - Timeline scrubber, current time / duration display, and YouTube error handling
- [x] **Phase 4: Reliable Playback Synchronization, Control Requests & Room State Recovery**
  - Authoritative backend room playback state with elapsed server time calculation (`currentTime + elapsedSec`)
  - Resilient playback drift correction with 1.5s threshold, seeking cooldown, and echo prevention
  - Complete Request Control workflow: participant requests, Host/Mod approve or reject
  - Temporary control grant with countdown timer and explicit revocation
  - Reconnection recovery via `reconnect_room`: restores session, role, temporary permissions, and video position
  - Visual status badges for connection health (Online / Reconnecting / Disconnected) and control request states
  - Automated test suite expanded to 39 passing tests (unit + socket integration)
- [ ] **Phase 5: Production Deployment & Final Polish**
  - Deploy backend WebSocket server to Render
  - Deploy frontend to Render / Vercel
  - Add live deployment URL to README

