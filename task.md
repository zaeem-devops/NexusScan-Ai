# NexusScan AI 2.0 - Task Tracker

**Context for AI Assistants:**
NexusScan AI is migrating from a client-side prototype to a secure, server-side architecture. 
The client (browser) should only capture video, extract 68-point descriptors via `face-api.js`, and send them to the server. 
The server (Node.js/Express + MongoDB) will handle authentication (JWT), role-based access, biometric storage, and all entry decisions.

## Phase 1: Authentication & RBAC
- [ ] Install `bcryptjs` and `jsonwebtoken`
- [ ] Create `User` Mongoose schema (Admin, Guard, Faculty)
- [ ] Create `/api/login` route and JWT middleware
- [ ] Build Login UI in `index.html` (replaces direct access)
- [ ] Secure all existing API endpoints with JWT middleware

## Phase 2: Biometric Database Migration
- [ ] Create `Biometric` Mongoose schema
- [ ] Create `/api/enroll-face` endpoint (secure)
- [ ] Update frontend `enrollNewFace()` to push to server, remove `localStorage`

## Phase 3: Server-Side Decision Engine
- [ ] Create `/api/verify-face` endpoint on Node.js
- [ ] Move Euclidean distance matching logic (`faceapi.FaceMatcher` equivalent) to the Node.js server
- [ ] Move Liveness/Spoof validation to the server
- [ ] Update frontend `detectFaces()` to stream descriptors to server and render server responses

## Phase 4: Final Cleanup
- [ ] Remove `markedAttendance` and `custom_faces` from browser localStorage
- [ ] Ensure all WhatsApp triggers happen entirely on the server-side during verification
