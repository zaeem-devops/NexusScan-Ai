# 🛡️ NexusScan AI Pro — Intelligent Biometric Campus Security & Access Control System

> **A cutting-edge, real-time physical campus security management engine powered by Computer Vision, Eye Aspect Ratio (EAR) Liveness Detection, WhatsApp Web Command Automation, Role-Based Access Control (RBAC), and Google Gemini AI.**

---

## 🏛️ System Architecture

```
                                  +---------------------------------------+
                                  |     NexusScan AI Pro Client (Web)     |
                                  |  (Face-API.js + Tailwind + HUD Canvas)|
                                  +-------------------+-------------------+
                                                      |
                                          HTTP / REST (JWT Auth)
                                                      |
                                                      v
+---------------------------------------------------------------------------------------------------------+
|                                    Node.js Express Security Server                                      |
|                                                                                                         |
|  +------------------------+  +------------------------+  +--------------------+  +-------------------+  |
|  |  JWT & RBAC Auth Engine|  | Biometric Vector Engine|  | Rate Limiter (IP)  |  | WhatsApp Engine   |  |
|  |  (Bcrypt Hash / Roles) |  | (Euclidean Dist <=0.48)|  | (Anti-Brute Force) |  | (Puppeteer Client)|  |
|  +------------------------+  +------------------------+  +--------------------+  +---------+---------+  |
+--------------------------------------------------------------------------------------------|------------+
               |                                                                             |
               v                                                                             v
+-----------------------------+                                               +---------------------------+
|    NeDB Embedded Database   |                                               | WhatsApp Real-time Network|
|  - data/users.db            |                                               |  - Security Threat Alerts |
|  - data/biometrics.db       |                                               |  - Attendance Notices     |
|  - data/attendance.db       |                                               |  - Host Visitor Approvals |
|  - data/passes.db           |                                               |  - Remote Lockdown (LOCK) |
|  - data/threats.db          |                                               +---------------------------+
+-----------------------------+
```

---

## 🚀 Key Innovations & Features

1. **Anti-Deepfake Liveness Defense:** Uses facial landmark geometry and dynamic Eye Aspect Ratio (EAR) blink detection to block photo/video spoofing attacks.
2. **Euclidean Vector Biometric Matching:** Matches 128-dimensional facial descriptors with a strict confidence threshold of **0.48**.
3. **15-Second Threat Alert Defense:** Suppresses alert spamming by strictly enforcing a 15-second timestamp cooldown between security broadcasts.
4. **Interactive WhatsApp Automation:**
   * Hosts receive visitor approval notifications with `1` (Approve) and `2` (Reject) interactive reply commands.
   * Approved gate pass codes (`NX-XXXX`) automatically forward to the Gate Guard WhatsApp.
   * Admin whitelist commands: `LOCK`, `UNLOCK`, `STATUS`, `ANNOUNCE <text>`.
5. **Zero-Crash Architecture:** Non-overlapping sequential frame inference loop prevents WebGL memory leaks and browser tab crashes.
6. **Zero-Setup Database:** Runs out-of-the-box using embedded persistent `@seald-io/nedb` without requiring local MongoDB installations.
7. **Bcrypt + JWT Multi-Role RBAC:** Protects Admin, Guard, and Faculty views with cryptographic tokens and sliding-window rate limiting.

---

## 📡 API Reference Table

| Method | Endpoint | Auth | Description | Payload Example |
|---|---|---|---|---|
| `POST` | `/api/auth/login` | Public (Rate Limited) | Authenticate user & issue JWT | `{"username": "admin", "password": "..."}` |
| `GET` | `/api/auth/me` | Bearer JWT | Verify current session identity | _None_ |
| `POST` | `/api/biometrics/enroll` | Admin JWT | Enroll face with privacy consent | `{"name": "Zaeem", "role": "Student", "descriptors": [...], "consent": true}` |
| `GET` | `/api/biometrics/list` | Public | List all enrolled profiles | _None_ |
| `POST` | `/api/biometrics/verify` | Public | Server biometric matching | `{"descriptor": [128 floats], "isLive": true}` |
| `POST` | `/api/attendance` | Public | Manual / Face attendance sync | `{"name": "Safdar", "status": "Present", "time": "09:15 AM"}` |
| `POST` | `/api/threat-alert` | Public | Trigger threat & WhatsApp dispatch | `{"reason": "Unauthorized subject at Main Gate"}` |
| `POST` | `/api/visitor-request` | Public | Submit visitor approval request | `{"visitorName": "Ali", "cnic": "35201-1234567-1", "hostPhone": "03001234567", "purpose": "Meeting"}` |
| `POST` | `/api/verify-pass` | Public | Verify digital visitor pass code | `{"passCode": "NX-4821"}` |
| `GET` | `/api/logs` | Public | Fetch live attendance & statistics | _None_ |
| `GET` | `/api/export/excel` | Public | Download Excel attendance sheet | _None_ |
| `POST` | `/api/ai-chat` | Public | Google Gemini / Local AI chat | `{"message": "How many students are present?"}` |
| `GET` | `/api/system-status` | Public | Poll lockdown & announcement state | _None_ |
| `GET` | `/api/privacy-policy` | Public | Fetch biometric compliance policy | _None_ |

---

## ⚙️ Environment Variables Reference

| Variable | Type | Default | Description |
|---|---|---|---|
| `PORT` | Number | `3000` | Port for the Express backend server |
| `JWT_SECRET` | String | _Auto-generated_ | Secret key used to sign and verify authentication JWTs |
| `SECURITY_PHONE` | String | `03236404459` | Admin / Security WhatsApp number for threat & attendance logs |
| `GUARD_PHONE` | String | `03008692192` | Gate Security WhatsApp number for visitor pass alerts |
| `FACULTY_PHONE` | String | `03008692192` | Academic Faculty notification number |
| `ADMIN_PASSWORD` | String | `admin123` | Master password for the Admin account (hashed on boot) |
| `GUARD_PASSWORD` | String | `guard123` | Password for the Guard console |
| `FACULTY_PASSWORD` | String | `faculty123` | Password for the Faculty dashboard |
| `ADMIN_WHITELIST` | String | `03236404459` | Comma-separated WhatsApp numbers allowed to send remote commands |
| `GEMINI_API_KEY` | String | _Optional_ | Google Gemini API key for advanced natural language assistance |

---

## 👁️ Liveness & Anti-Spoofing Algorithm

NexusScan AI Pro incorporates multi-layered anti-spoofing defense:

1. **Geometric Landmark Ratio:** Verifies 68 facial landmark coordinates to confirm valid human facial proportions.
2. **Eye Aspect Ratio (EAR) Blink Verification:**
   $$\text{EAR} = \frac{|p_2 - p_6| + |p_3 - p_5|}{2 \cdot |p_1 - p_4|}$$
   Dynamic eye closure and reopening variance confirms live biological presence, preventing static photograph and pre-recorded video screen attacks.
3. **Euclidean Confidence Distance:**
   $$d(u, v) = \sqrt{\sum_{i=1}^{128} (u_i - v_i)^2}$$
   Matches vectors with a threshold of $d \le 0.48$. Distance values $> 0.48$ are immediately classified as **Unauthorized Suspects**.

---

## 🔒 Privacy & Biometric Data Handling

- **No Raw Image Retention:** Faces are converted directly into 128-dimensional floating-point vectors. Raw photos are not stored permanently.
- **Explicit Consent:** Every biometric registration requires checked user authorization.
- **Data Retention:** Access logs follow a 30-day compliance retention cycle.

---

## ⚠️ Known Limitations & Future Production Roadmap

### Known Limitations
- WhatsApp Web integration relies on local Chromium session instance (`whatsapp-web.js`).
- Webcam performance depends on client ambient lighting conditions.

### Future Production Roadmap (Phase 5 & 6)
- [ ] Migration to official Meta WhatsApp Cloud Business API.
- [ ] Multi-tenant PostgreSQL database support.
- [ ] Dockerized microservice container orchestration.
- [ ] Multi-camera RTSP/ONVIF IP-Camera streaming gateway.
