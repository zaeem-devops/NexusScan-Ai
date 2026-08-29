# NexusScan AI — Complete System Overview
## Kya tha, kya badla, kya baaki hai

---

## 📁 Project Files — Kaun Si File Kya Karti Hai

| File | Kya Hai | Size |
|------|---------|------|
| `server.js` | Poora backend — Node.js server, WhatsApp, APIs | 837 lines |
| `index.html` | Frontend — jo browser mein dikhta hai | 482 lines |
| `script.js` | Browser ka logic — camera, face detection, login UI | 978 lines |
| `.env` | **Tumhara config file** — phone numbers, passwords | 27 lines |
| `.env.example` | Template — dusron ke liye guide | 32 lines |
| `package.json` | Dependencies list (jo packages install hain) | 28 lines |
| `style.css` | Extra CSS styling | — |

---

## ✅ Kya Kiya — Changes Ki Full List

### 1️⃣ `server.js` — Backend Changes

#### 🆕 JWT Login System (naya)
```
Pehle: koi login nahi tha, seedha system khulta tha
Ab: username + password se JWT token milta hai
Accounts: admin/admin123 | guard/guard123 | faculty/faculty123
```

#### 🆕 RBAC — Role-Based Access (naya)
```
Pehle: sab kuch sab ke liye open tha
Ab: Guard sirf camera dekh sakta hai
    Admin sab kuch kar sakta hai
    Faculty attendance dekh sakti hai
```

#### 🆕 Server-Side Face Matching (naya)
```
Pehle: Browser khud face match karta tha (UNSAFE — koi bhi hack kar sakta tha)
Ab: Browser sirf 128 numbers ka array bhejta hai server ko
    Server match karta hai aur GRANTED/DENIED decision deta hai
```

#### 🆕 Anti-Spam Cooldown (aaj ka)
```
Pehle: Har second WhatsApp alert — SPAM ban jata tha
Ab: 30 second cooldown — ek alert ke baad 30 sec tak koi alert nahi
```

#### 🆕 GUARD_PHONE alag (aaj ka)
```
Pehle: sirf SECURITY_PHONE tha — ek hi number sab kuch receive karta tha
Ab: SECURITY_PHONE = Admin ko alerts
    GUARD_PHONE = Guard ko visitor approved/rejected ka alert
```

#### ⚠️ Hybrid Memory Mode (limitation)
```
MongoDB install nahi → data RAM mein hai
Server restart = sab data gone (faces, attendance)
YEH PROBLEM HAI — nedb se fix hogi (pending)
```

---

### 2️⃣ `script.js` — Frontend Logic Changes

#### 🆕 Login Screen (naya)
```
Pehle: seedha system khulta tha
Ab: Cyberpunk login screen aati hai
    1-click buttons: 👮 Guard | 👩‍🏫 Faculty | 👑 Admin
```

#### 🆕 User Badge Header (naya)
```
Pehle: koi indicator nahi tha kaun logged in hai
Ab: Top header mein naam + role chip + logout button
```

#### 🆕 Server Decision Engine (naya)
```
Pehle: script.js mein localStorage se face match hota tha
Ab: Server ko descriptor bhejta hai, server ka jawab maanta hai
```

#### 🆕 Client Cooldown 30s (aaj ka)
```
Pehle: Unknown face baar baar detect hoti to baar baar alert
Ab: 30 second tak ek hi alert, phir dobara
```

---

### 3️⃣ `.env` File — Config Changes

```env
# Pehle sirf yeh tha:
SECURITY_PHONE=03...    ← ek number

# Ab yeh hai:
SECURITY_PHONE=03...    ← Admin/Security Officer ka number (threats + attendance)
GUARD_PHONE=03...       ← Guard ka number (visitor alerts)
ADMIN_WHITELIST=03...   ← Admin ka number (WhatsApp commands)
ADMIN_PASSWORD=admin123 ← Admin login password
```

---

### 4️⃣ `index.html` — UI Changes

```
🆕 Login Overlay — full screen cyberpunk login modal
🆕 User Profile Badge — header mein naam aur role
🆕 Quick Login Buttons — Guard / Faculty / Admin 1-click
```

---

## 🔴 Jo ABHI BHI Problem Hai (Fixed Nahi)

| Problem | Reason | Fix |
|---------|--------|-----|
| Face data restart pe gone | MongoDB nahi, RAM use ho rahi | nedb install karna |
| Admin/Guard ka number database mein nahi | Abhi sirf .env mein | User management panel banana |
| Attendance restart pe gone | Same — RAM | nedb fix karega |

---

## 🗺️ Poora Flow — Kaise Kaam Karta Hai

```
[Browser] → Login (username/password)
    ↓
[Server] → JWT Token deta hai
    ↓
[Browser] → Camera on, face detect karta hai
    ↓
[Browser] → 128 numbers ka array server ko bhejta hai
    ↓
[Server] → Database se compare karta hai (EUCLIDEAN DISTANCE)
    ↓
[Server] → GRANTED / DENIED / SPOOF decision deta hai
    ↓
[Server] → Attendance log karta hai
    ↓
[Server] → WhatsApp alert bhejta hai (30 sec cooldown ke saath)
    ↓
[Browser] → Screen par result dikhata hai
```

---

## 📱 WhatsApp Commands (Admin ke liye)

Admin ka number `ADMIN_WHITELIST` mein hona chahiye. Phir WhatsApp se yeh commands:

| Command | Kya Karta Hai |
|---------|---------------|
| `STATUS` | System ki live report milti hai |
| `LOCK` | Emergency lockdown — camera band |
| `UNLOCK` | Lockdown khatam |
| `ANNOUNCE kuch bhi text` | Speaker se announcement |
| `1` | Pending visitor APPROVE |
| `2` | Pending visitor REJECT |
