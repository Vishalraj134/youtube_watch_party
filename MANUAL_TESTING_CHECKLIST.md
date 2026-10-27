# SyncPlay (YouTube Watch Party System) — Manual Testing Checklist

This manual testing checklist is designed for step-by-step verification of the current implementation.

---

### Prerequisites & Test Setup
1. **Verify Backend Server** (Port 5000):
   ```bash
   cd server
   npm start
   ```
   *Health Check URL*: `http://localhost:5000/api/health`
2. **Verify Frontend Client** (Port 5173 / 5174):
   ```bash
   cd client
   npm run dev
   ```
   *App URL*: `http://localhost:5173`
3. **Open Two Independent Browser Windows**:
   - **Browser Session A (Host)**: Open a standard browser window to `http://localhost:5173`
   - **Browser Session B (Participant)**: Open an **Incognito / Private** window to `http://localhost:5173` *(ensures distinct socket connections and sessions)*

---

## Test Suite 1: Host Playback & Video Synchronization

### TC-1.1: Host Plays and Pauses Video
- **Goal**: Verify Host play/pause actions synchronize authoritatively to the participant.
- **Steps**:
  1. In **Browser A**, enter nickname `HostAlice` under **Host a Watch Party**, leave default video or enter `https://www.youtube.com/watch?v=aqz-KE-bpKQ`, and click **Create Party Room**.
  2. Note the generated Room Code (e.g., `WP-XXXX`).
  3. In **Browser B (Incognito)**, enter nickname `GuestBob` and the room code under **Join an Existing Party**, then click **Join Party Room**.
  4. In **Browser A**, click the **Play** button on the custom player bar.
  5. Wait 5 seconds, then click the **Pause** button in **Browser A**.
- **Expected Result**:
  - In Browser B, video automatically begins playing when Host plays.
  - In Browser B, video pauses at the exact same timestamp when Host pauses.
  - The Sync Log tab displays `Playback play by HostAlice` and `Playback pause by HostAlice`.
- **Actual Result**: `[                                                                    ]`
- **Status**: `[ ] PASS   [ ] FAIL`

---

### TC-1.2: Host Seeks Forward and Backward
- **Goal**: Verify Host scrubber and skip button actions synchronize to the participant.
- **Steps**:
  1. With both sessions connected in the room, in **Browser A**, click the **+10s** (Forward) button.
  2. In **Browser A**, click on the timeline progress bar around the 50% mark.
  3. In **Browser A**, click the **-10s** (Rewind) button.
- **Expected Result**:
  - In Browser B, the playback position immediately updates to match Browser A within 1 second.
  - Neither player gets stuck in an infinite seeking or buffering loop.
- **Actual Result**: `[                                                                    ]`
- **Status**: `[ ] PASS   [ ] FAIL`

---

### TC-1.3: Host Changes the Active Video
- **Goal**: Verify Host can change the YouTube video and both sessions update seamlessly without refreshing or rejoining.
- **Steps**:
  1. In **Browser A**, paste `https://www.youtube.com/watch?v=jfKfPfyJRdk` into the **Change Video** input bar.
  2. Click **Load Video** (or press `Enter`).
- **Expected Result**:
  - In both Browser A and Browser B, the player cues the new video (`jfKfPfyJRdk`), resets playback time to `00:00`, and sets state to paused.
  - Neither user is disconnected from the room.
  - In Browser B, a banner appears: `New video loaded by HostAlice!`.
- **Actual Result**: `[                                                                    ]`
- **Status**: `[ ] PASS   [ ] FAIL`

---

## Test Suite 2: Control Request & Approval Workflow

### TC-2.1: Participant Requests Playback Control
- **Goal**: Verify participant can request control and the Host receives real-time notification.
- **Steps**:
  1. In **Browser B (Participant)**, observe that the Play/Pause buttons and scrubber show lock icons / locked styling.
  2. In **Browser B**, click the **Request Control** button.
- **Expected Result**:
  - In Browser B, button state changes to `Request Pending...` (disabled).
  - In Browser A (Host), an alert banner appears: `GuestBob requested playback control. Review in Requests tab.`.
  - In Browser A, a red badge `1` appears on the **Requests** tab in the sidebar.
- **Actual Result**: `[                                                                    ]`
- **Status**: `[ ] PASS   [ ] FAIL`

---

### TC-2.2: Host Approves Control Request
- **Goal**: Verify approving temporary control grants active control authority to the participant.
- **Steps**:
  1. In **Browser A (Host)**, click the **Requests** tab in the right sidebar.
  2. Locate GuestBob's pending card and click **Approve (60s)**.
- **Expected Result**:
  - In Browser B (Participant), an alert banner appears: `Your control request was approved! You now have temporary playback authority for 60 seconds.`.
  - In Browser B, the lock button transforms into `Temp Control (60s)` with an active second-by-second countdown.
  - In Browser B, Play/Pause buttons, timeline scrubber, and **Load Video** bar unlock.
  - In Browser A, the request card shows `Control Granted` with a red `Revoke` button.
- **Actual Result**: `[                                                                    ]`
- **Status**: `[ ] PASS   [ ] FAIL`

---

### TC-2.3: Approved Participant Plays, Seeks, and Changes Video
- **Goal**: Verify the approved participant can control playback and change video while permission is active.
- **Steps**:
  1. In **Browser B (Approved Participant)**, click **Play**, wait 3 seconds, then click **Pause**.
  2. In **Browser B**, click **+10s**.
  3. In **Browser B**, paste `https://youtu.be/dQw4w9WgXcQ` into the **Change Video** input and click **Load Video**.
- **Expected Result**:
  - Play, pause, and seek actions from Browser B immediately synchronize to Browser A.
  - The video change from Browser B loads the new video (`dQw4w9WgXcQ`) for both Browser A and Browser B.
  - Browser B's Sync Log confirms: `You changed video to "dQw4w9WgXcQ"`.
  - Browser A's Sync Log displays: `GuestBob changed video to "dQw4w9WgXcQ"`.
- **Actual Result**: `[                                                                    ]`
- **Status**: `[ ] PASS   [ ] FAIL`

---

## Test Suite 3: Rejection, Revocation & Expiration

### TC-3.1: Host Explicitly Revokes Temporary Control
- **Goal**: Verify Host can immediately revoke granted control before the timer expires.
- **Steps**:
  1. While GuestBob has active temporary control, go to **Browser A (Host)** -> **Requests** tab.
  2. Click the red **Revoke** button next to GuestBob.
- **Expected Result**:
  - In Browser B, an alert appears: `Your temporary playback authority was revoked.`.
  - In Browser B, the button reverts to locked `Request Control`.
  - In Browser B, playback controls and video change inputs are disabled/locked.
  - Any backend action attempted by Browser B is rejected with `PERMISSION_DENIED`.
- **Actual Result**: `[                                                                    ]`
- **Status**: `[ ] PASS   [ ] FAIL`

---

### TC-3.2: Host Rejects a Control Request
- **Goal**: Verify declining a control request keeps the participant restricted without granting permissions.
- **Steps**:
  1. In **Browser B**, click **Request Control** again.
  2. In **Browser A**, open the **Requests** tab and click **Reject** on GuestBob's pending request.
- **Expected Result**:
  - In Browser B, an alert appears: `Your control request was declined by the Host.`.
  - In Browser B, the button updates to `Request Declined (Retry)`.
  - Browser B controls remain locked.
- **Actual Result**: `[                                                                    ]`
- **Status**: `[ ] PASS   [ ] FAIL`

---

### TC-3.3: Automatic Permission Expiration After 60 Seconds
- **Goal**: Verify temporary permissions automatically expire when the timer elapses.
- **Steps**:
  1. In **Browser B**, click **Request Declined (Retry)** to submit a new request.
  2. In **Browser A**, click **Approve (60s)**.
  3. Wait 60 seconds without clicking Revoke, observing the countdown in Browser B (`Temp Control (..s)`).
- **Expected Result**:
  - When the countdown reaches `0s`, the indicator changes back to `Request Control`.
  - Controls automatically re-lock on Browser B.
  - Attempting to load a video or pause from Browser B is blocked by both frontend and backend.
- **Actual Result**: `[                                                                    ]`
- **Status**: `[ ] PASS   [ ] FAIL`

---

## Test Suite 4: Multi-Room Isolation

### TC-4.1: Cross-Room Isolation
- **Goal**: Verify that actions in Room 1 do not leak into or affect Room 2.
- **Steps**:
  1. In **Browser Window 1**, create Room 1 (`Host1`).
  2. In **Browser Window 2** (different profile/incognito), create Room 2 (`Host2`).
  3. Note both room codes (e.g., `WP-AAA1` and `WP-BBB2`).
  4. In Room 1, click **Play** and scrub to `02:00`.
  5. In Room 1, load video `jfKfPfyJRdk`.
- **Expected Result**:
  - Room 2 remains completely unaffected (stays paused at `00:00` on its original video).
  - Room 2's participant list and Sync Log show no events from Room 1.
- **Actual Result**: `[                                                                    ]`
- **Status**: `[ ] PASS   [ ] FAIL`

---

## Test Suite 5: Disconnection & Session Reconnection

### TC-5.1: Participant Page Refresh / Recovery
- **Goal**: Verify participant can refresh the browser tab and recover their room session.
- **Steps**:
  1. In **Browser B (Participant)**, while in an active watch room, refresh the browser page (`F5` or `Ctrl+R`).
- **Expected Result**:
  - Browser B reconnects automatically using saved session storage.
  - Connection status badge transitions from `RECONNECTING...` to `ONLINE`.
  - Participant is restored to the room without duplicate username errors.
  - Playback position and current video synchronize to the host's current room state.
- **Actual Result**: `[                                                                    ]`
- **Status**: `[ ] PASS   [ ] FAIL`

---

### TC-5.2: Participant Clean Departure
- **Goal**: Verify clicking Leave Party updates participant counts for remaining members.
- **Steps**:
  1. In **Browser B**, click the top-left **Leave Party** button.
- **Expected Result**:
  - Browser B navigates back to the Home Page.
  - In Browser A (Host), the member count drops by 1.
  - In Browser A, the Sync Log notes: `GuestBob left the party`.
- **Actual Result**: `[                                                                    ]`
- **Status**: `[ ] PASS   [ ] FAIL`

---

## Test Suite 6: Validation & Error Handling

### TC-6.1: Joining with Invalid or Non-Existent Room Code
- **Goal**: Verify clear error messaging when attempting to join a nonexistent room.
- **Steps**:
  1. On the Home Page, enter nickname `Tester` and room code `WP-FAKE99`.
  2. Click **Join Party Room**.
- **Expected Result**:
  - Red error alert appears: `Room "WP-FAKE99" does not exist or has expired.`.
  - User remains on the Home Page with their inputs intact.
- **Actual Result**: `[                                                                    ]`
- **Status**: `[ ] PASS   [ ] FAIL`

---

### TC-6.2: Joining with Duplicate Nickname
- **Goal**: Verify case-insensitive duplicate username rejection.
- **Steps**:
  1. In Browser A, Host is in room with nickname `Alice`.
  2. In Browser B, enter nickname `alice` (lowercase) and the same room code, then click **Join Party Room**.
- **Expected Result**:
  - Red error banner appears: `The name "alice" is already taken in this room. Please choose another nickname.`.
  - Joining is blocked.
- **Actual Result**: `[                                                                    ]`
- **Status**: `[ ] PASS   [ ] FAIL`

---

### TC-6.3: Changing to an Invalid YouTube URL Format
- **Goal**: Verify non-YouTube links or malformed URLs are rejected cleanly.
- **Steps**:
  1. In Browser A (Host), paste `https://vimeo.com/76979871` into the **Change Video** input and click **Load Video**.
- **Expected Result**:
  - An alert banner appears: `Failed to change video: Could not extract a valid YouTube video ID. Please check the URL format.`.
  - The current video continues playing without interruption.
- **Actual Result**: `[                                                                    ]`
- **Status**: `[ ] PASS   [ ] FAIL`

---

### TC-6.4: Non-Embeddable or Private YouTube Video Handling
- **Goal**: Verify player UI displays helpful guidance when a video cannot be embedded.
- **Steps**:
  1. In Browser A (Host), paste a private or embed-restricted video ID (e.g. standard restricted ID or URL known to restrict third-party embeds).
  2. Click **Load Video**.
- **Expected Result**:
  - The player displays the error overlay: `Playback Error: This video owner does not allow embedding outside YouTube. Please paste another YouTube video URL below.`.
  - Application does not crash or freeze.
- **Actual Result**: `[                                                                    ]`
- **Status**: `[ ] PASS   [ ] FAIL`

---

## Summary Checklist Matrix

| Test ID | Scenario | Pass / Fail | Notes |
| :--- | :--- | :--- | :--- |
| **TC-1.1** | Host Plays and Pauses Video | `[ ]` | |
| **TC-1.2** | Host Seeks Forward and Backward | `[ ]` | |
| **TC-1.3** | Host Changes the Active Video | `[ ]` | |
| **TC-2.1** | Participant Requests Playback Control | `[ ]` | |
| **TC-2.2** | Host Approves Control Request | `[ ]` | |
| **TC-2.3** | Approved Participant Plays, Seeks, and Changes Video | `[ ]` | |
| **TC-3.1** | Host Explicitly Revokes Temporary Control | `[ ]` | |
| **TC-3.2** | Host Rejects a Control Request | `[ ]` | |
| **TC-3.3** | Automatic Permission Expiration After 60 Seconds | `[ ]` | |
| **TC-4.1** | Cross-Room Isolation | `[ ]` | |
| **TC-5.1** | Participant Page Refresh / Recovery | `[ ]` | |
| **TC-5.2** | Participant Clean Departure | `[ ]` | |
| **TC-6.1** | Non-Existent Room Code Error | `[ ]` | |
| **TC-6.2** | Duplicate Nickname Error | `[ ]` | |
| **TC-6.3** | Invalid Video URL Error | `[ ]` | |
| **TC-6.4** | Non-Embeddable Video Handling | `[ ]` | |
