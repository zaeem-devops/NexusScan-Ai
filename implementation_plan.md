# NexusScan AI 2.0 - Secure Server-Driven Architecture Refactor

This document outlines the architectural shift from a client-heavy prototype to a secure, production-ready server-driven system.

## Goal Description
Move sensitive operations (Biometric Storage, Identity Matching, Entry Decisions) from the browser's JavaScript to the Node.js backend. Implement real Role-Based Access Control (RBAC) and eliminate local storage reliance.

## User Review Required
> [!IMPORTANT]
> **Architecture Decision on Face Matching:**
> Running full video-stream facial detection on a Node.js server is extremely heavy and usually requires a dedicated Python/C++ GPU server. 
> **Proposed Hybrid Solution:** The Browser will *only* extract the 68-point numerical descriptors (math array) from the camera to save bandwidth. The browser will instantly send these numbers to the Server via an API. The **Server** will hold the database, do the matching, make the "Pass/Fail" decision, and send the result back to the browser.
> *Do you approve this hybrid approach?*

## Proposed Changes

---

### Phase 1: Authentication & RBAC (Role-Based Access Control)
Replacing the single shared password with a real user system.

#### [NEW] `models/User.js`
- Mongoose schema for Users (username, password hash, role: 'guard', 'faculty', 'admin').

#### [MODIFY] `server.js`
- Add `bcrypt` and `jsonwebtoken` (JWT).
- Add `/api/login` endpoint that issues JWTs based on roles.
- Add middleware to protect sensitive routes so only authorized roles can make changes.

#### [MODIFY] `index.html` & `script.js`
- Create a real Login Screen overlay.
- Store JWT securely in `sessionStorage`.
- Attach JWT to all API requests. Remove hardcoded `admin123`.

---

### Phase 2: Secure Database Migration (Biometrics & Data)
Removing `localStorage` and migrating face data to MongoDB.

#### [NEW] `models/Biometric.js`
- Mongoose schema to store face descriptors (`name`, `role`, `descriptorArray`).

#### [MODIFY] `server.js`
- Add API endpoints: `/api/enroll-face` (Saves math array to DB).
- Add API endpoint: `/api/verify-face` (Takes math array from client, compares it against the DB using Euclidean distance on the server, returns decision).

#### [MODIFY] `script.js`
- Remove `localStorage.getItem('custom_faces')`.
- Modify `enrollNewFace()` to POST data to `/api/enroll-face`.

---

### Phase 3: Server-Side Decision Making
Stripping the browser of its decision-making power.

#### [MODIFY] `server.js`
- The `/api/verify-face` endpoint will now handle the logic: 
  - *Is it a spoof?* (Client sends EAR data, server validates).
  - *Is this person allowed?* (Server checks DB).
  - *Log Attendance:* Server automatically writes to MongoDB and triggers WhatsApp without relying on the client to ask for it.

#### [MODIFY] `script.js`
- Remove `faceMatcher` and local matching logic.
- The `detectFaces()` loop will now send descriptors to the server and strictly obey the server's response (`Granted`, `Denied`, `Spoof`).

---

## Verification Plan

### Automated/Manual Tests
- **Auth:** Attempt to hit `/api/enroll-face` without a token (Should 401 Unauthorized).
- **Storage:** Clear browser cache; face data should persist via MongoDB.
- **Decision:** Spoof the JS client variables to force a match; the server should reject it because the math array won't match the DB.
