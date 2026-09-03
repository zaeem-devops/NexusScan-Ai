# NexusScan AI

NexusScan AI is a web-based campus security and access-control system. It combines browser-based face recognition, blink-based liveness detection, role-based access control, attendance logging, visitor pass approval, WhatsApp notifications, and an AI security assistant in one dashboard.

## Features

- Face detection and recognition using the models in `models/`.
- Liveness checking using facial landmarks and eye-blink detection.
- JWT authentication with three roles: Admin, Faculty, and Guard.
- Camera-based attendance with manual attendance fallback.
- Visitor requests approved or rejected through WhatsApp replies.
- Single-use visitor passes in the `NX-XXXX` format.
- Threat alerts with optional camera snapshots sent through WhatsApp.
- Live attendance, threat counters, system status, and Excel export.
- AI assistant using Google Gemini when configured, with a local fallback when it is not.
- Remote WhatsApp commands for status, lockdown, unlock, and announcements.
- MongoDB persistence with automatic in-memory fallback when MongoDB is unavailable.

## Technology

- Frontend: HTML, CSS, JavaScript, Tailwind CSS CDN, Face API, and Chart.js.
- Backend: Node.js and Express.
- Database: MongoDB through Mongoose, with hybrid memory mode as a fallback.
- Messaging: `whatsapp-web.js` and Puppeteer.
- Authentication: JWT and bcrypt.

## Requirements

Install the following before running the project:

- Node.js 18 or newer and npm.
- A modern browser with camera permission support.
- MongoDB, if attendance, visitor, and threat data must survive server restarts.
- Google Chrome or Chromium for WhatsApp Web automation.
- A WhatsApp phone for the account that will be paired with WhatsApp Web.

MongoDB, Gemini, and WhatsApp are optional for a basic demo. The dashboard and local AI fallback can still run without MongoDB or a Gemini API key. WhatsApp notifications are skipped until WhatsApp Web is authenticated.

## Installation

Open PowerShell or a terminal in the project directory:

```powershell
npm install
```

Create the local environment file:

```powershell
Copy-Item .env.example .env
```

Edit `.env` and replace the demo values with your own values before using the project outside a local demonstration. The `.env` file contains passwords, phone numbers, and API keys and must not be committed.

## Configuration

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `PORT` | No | `3000` | Express server port. |
| `MONGO_URI` | No | `mongodb://127.0.0.1:27017/nexusScanAI` | MongoDB connection string. |
| `JWT_SECRET` | Recommended | `nexusscan-secret-2026` | Secret used to sign login tokens. Change it in production. |
| `ADMIN_PASSWORD` | Recommended | `admin123` | Admin login password. |
| `FACULTY_PASSWORD` | Recommended | `faculty123` | Faculty login password. |
| `GUARD_PASSWORD` | Recommended | `guard123` | Guard login password. |
| `SECURITY_PHONE` | For WhatsApp | Demo value | Number that receives attendance and threat alerts. |
| `ADMIN_WHITELIST` | For WhatsApp security | Empty | Comma-separated numbers allowed to issue admin WhatsApp commands. |
| `CHROME_PATH` | No | Automatic | Custom Chrome/Chromium executable path for Puppeteer. |
| `GEMINI_API_KEY` | No | Empty | Enables Google Gemini AI instead of the local fallback. |

Use international phone formatting where possible. For example:

```env
PORT=3000
MONGO_URI=mongodb://127.0.0.1:27017/nexusScanAI
JWT_SECRET=replace-with-a-long-random-secret
SECURITY_PHONE=923001234567
ADMIN_WHITELIST=923001234567
GEMINI_API_KEY=your_gemini_api_key
```

## Start the application

Start the backend and serve the frontend:

```powershell
npm start
```

The application is available at:

```text
http://127.0.0.1:3000
```

The equivalent direct command is:

```powershell
node server.js
```

Keep the server terminal open while using the dashboard. To stop it, press `Ctrl+C`.

## First run checklist

1. Run `npm install`.
2. Copy `.env.example` to `.env` and configure passwords and phone numbers.
3. Start MongoDB if persistent storage is needed.
4. Run `npm start`.
5. Open `http://127.0.0.1:3000` in Chrome or another modern browser.
6. Allow camera access when prompted.
7. On the first server start, scan the printed WhatsApp QR code with the WhatsApp account used for notifications.
8. Log in with one of the accounts below.

## Demo accounts

These values come from the default environment configuration and should be changed before deployment:

| Username | Default password | Access |
| --- | --- | --- |
| `admin` | `admin123` | Full dashboard, enrollment, logs, threat controls, and exports. |
| `faculty` | `faculty123` | Attendance logs, analytics, AI assistant, and Excel export. |
| `guard` | `guard123` | Guard console, visitor pass verification, and emergency alerts. |

## WhatsApp setup and commands

When the server starts, `whatsapp-web.js` prints a QR code in the terminal if the session is not authenticated. Scan it from WhatsApp on the phone that owns the notification account. The authenticated session is stored locally in `.wwebjs_auth/` and should not be committed.

Set `ADMIN_WHITELIST` before using remote commands. If it is empty, the server is in demo mode and admin command protection is disabled.

Send these commands from an authorized WhatsApp number:

| Command | Result |
| --- | --- |
| `STATUS` | Returns lock state, threat count, port, and database mode. |
| `LOCK` | Activates emergency lockdown and disables normal scanning. |
| `UNLOCK` | Releases lockdown and resumes normal operation. |
| `ANNOUNCE message` | Publishes a temporary system announcement. |
| `1` | Approves the latest pending visitor request for that host. |
| `2` | Rejects the latest pending visitor request for that host. |

## Main workflow

1. A user signs in and receives a JWT session token.
2. The browser loads the face-recognition models and requests camera access.
3. A recognized live face can create an attendance record.
4. An unknown or non-live face is treated as a security event and can trigger a WhatsApp alert.
5. Staff submit visitor details from the dashboard.
6. The host replies `1` or `2` in WhatsApp to approve or reject the request.
7. An approved visitor receives an `NX-XXXX` pass valid for one entry on the issue date.
8. An Admin or Guard verifies the pass from the dashboard.

## Important project directories

| Path | Purpose |
| --- | --- |
| `server.js` | Express API, authentication, MongoDB access, WhatsApp integration, and server startup. |
| `index.html` | Dashboard markup and login interface. |
| `script.js` | Camera, face recognition, authentication, dashboard, and API client logic. |
| `style.css` | Application styling and scanner effects. |
| `models/` | Face API model files loaded by the browser. |
| `labels/` | Enrolled profile label directories. |
| `data/` | Local application data directory. |
| `.env.example` | Safe configuration template. |

## API endpoints

All protected endpoints require `Authorization: Bearer <token>`.

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `POST` | `/api/auth` | Sign in and receive a JWT. |
| `GET` | `/api/auth/me` | Validate the current session. |
| `POST` | `/api/attendance` | Create an attendance record. |
| `GET` | `/api/logs` | Read attendance, threat counts, and lock state. |
| `POST` | `/api/visitor-request` | Submit a visitor approval request. |
| `POST` | `/api/verify-pass` | Verify a visitor pass. |
| `POST` | `/api/threat-alert` | Record and dispatch a threat alert. |
| `GET` | `/api/export/excel` | Download attendance as an `.xlsx` file. |
| `POST` | `/api/ask-ai` | Ask the role-authorized AI assistant a question. |
| `GET` | `/api/system-status` | Read lockdown and announcement status. |
| `GET` | `/api/labels` | List enrolled face labels. |

## Troubleshooting

### Backend is offline

Confirm that `npm start` is running and that port `3000` is available. If another application uses that port, set a different `PORT` in `.env` and open the matching URL.

### Camera is offline

Open the app through `http://127.0.0.1:3000`, allow camera access in the browser, and refresh the page. Close other applications that are using the camera.

### MongoDB connection warning

The app continues in hybrid memory mode, but records stored in memory are lost when the server restarts. Start MongoDB and check `MONGO_URI` for persistent storage.

### WhatsApp does not send messages

Check that the QR code was scanned, the WhatsApp client reports `READY`, the phone numbers are correct, and the server can launch Chrome. Set `CHROME_PATH` if Chrome is installed in a non-standard location.

### Gemini is unavailable

Check `GEMINI_API_KEY`. If it is missing or invalid, the built-in local AI fallback remains available.

## Available npm commands

```powershell
npm install       # Install project dependencies
npm start         # Start the Express server
npm test          # Placeholder command; no automated tests are currently configured
node server.js    # Start the server without npm
```

## Security notes

- Change all default passwords and `JWT_SECRET` before deployment.
- Keep `.env`, `.wwebjs_auth/`, `.wwebjs_cache/`, and database files private.
- Set `ADMIN_WHITELIST`; an empty whitelist enables demo-mode command access.
- Use HTTPS and a production database when exposing the system beyond localhost.
- Biometric descriptors and attendance data are sensitive information. Obtain consent and follow applicable privacy requirements.
