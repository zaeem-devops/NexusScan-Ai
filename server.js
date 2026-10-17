const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const XLSX = require('xlsx');
require('dotenv').config();

let geminiModel = null;
try {
    const { GoogleGenerativeAI } = require('@google/generative-ai');
    if (process.env.GEMINI_API_KEY) {
        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        geminiModel = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
        console.log('✅ Gemini AI Engine Loaded!');
    } else {
        console.log('⚠️  GEMINI_API_KEY not set — running Smart Local AI fallback mode.');
    }
} catch (e) {
    console.log('⚠️  Gemini package not found — running Smart Local AI fallback mode.');
}

const app = express();

app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname)));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

const PORT = process.env.PORT || 3000;

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const SECURITY_PHONE = process.env.SECURITY_PHONE || '03236404459';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
const FACULTY_PASSWORD = process.env.FACULTY_PASSWORD || 'faculty123';
const GUARD_PASSWORD = process.env.GUARD_PASSWORD || 'guard123';
const JWT_SECRET = process.env.JWT_SECRET || 'nexusscan-secret-2026';

const ADMIN_WHITELIST = (process.env.ADMIN_WHITELIST || '')
    .split(',').map(s => s.trim().replace(/\D/g, '')).filter(Boolean)
    .map(d => d.startsWith('03') ? '92' + d.substring(1) : d); // normalize 03xx → 92xx

const USERS = {
    admin: { role: 'admin', passwordHash: bcrypt.hashSync(ADMIN_PASSWORD, 10) },
    faculty: { role: 'faculty', passwordHash: bcrypt.hashSync(FACULTY_PASSWORD, 10) },
    guard: { role: 'guard', passwordHash: bcrypt.hashSync(GUARD_PASSWORD, 10) }
};

function authenticateToken(req, res, next) {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.substring(7) : '';
    if (!token) return res.status(401).json({ success: false, error: 'Authentication required.' });

    try {
        req.user = jwt.verify(token, JWT_SECRET);
        next();
    } catch (error) {
        return res.status(401).json({ success: false, error: 'Invalid or expired session.' });
    }
}

function authorizeRoles(...roles) {
    return (req, res, next) => {
        if (!req.user || !roles.includes(req.user.role)) {
            return res.status(403).json({ success: false, error: 'Access denied for this role.' });
        }
        next();
    };
}

let isSystemLocked = false;
let currentAnnouncement = "";

const AttendanceSchema = new mongoose.Schema({
    name: String,
    status: String,           // Present | Late | Leave | Denied
    time: String,
    date: { type: String, default: () => new Date().toDateString() },
    createdAt: { type: Date, default: Date.now }
});

const VisitorPassSchema = new mongoose.Schema({
    visitorName: String,
    cnic: String,
    hostPhone: String,
    purpose: String,
    status: { type: String, default: 'pending' },   // pending | approved | rejected
    passCode: String,                                // NX-XXXX, set on approval
    usedAt: Date,
    createdAt: { type: Date, default: Date.now }
});

const ThreatSchema = new mongoose.Schema({
    reason: String,
    hasSnapshot: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now }
});

const BiometricSchema = new mongoose.Schema({
    name: { type: String, required: true, unique: true },
    descriptors: { type: [[Number]], required: true },
    createdAt: { type: Date, default: Date.now }
});

const Attendance = mongoose.model('Attendance', AttendanceSchema);
const VisitorPass = mongoose.model('VisitorPass', VisitorPassSchema);
const Threat = mongoose.model('Threat', ThreatSchema);
const Biometric = mongoose.model('Biometric', BiometricSchema);

const memoryStore = { attendance: [], passes: [], threats: [], biometrics: [] };
let mongoReady = false;

const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/nexusScanAI';

mongoose.connect(MONGO_URI)
    .then(() => { mongoReady = true; console.log('✅ MongoDB Connected Successfully!'); })
    .catch(() => console.log('⚠️ Local MongoDB not detected! Running server in Hybrid Memory Mode.'));

async function saveAttendance(record) {
    if (mongoReady) { return Attendance.create(record); }
    record.date = record.date || new Date().toDateString();
    const copy = {
        _id: 'att_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9),
        ...record,
        createdAt: new Date()
    };
    memoryStore.attendance.push(copy);
    return copy;
}

async function findAttendanceToday(name) {
    const today = new Date().toDateString();
    if (mongoReady) {
        return Attendance.findOne({ name, date: today, status: { $in: ['Present', 'Late'] } });
    }
    return memoryStore.attendance.find(r => r.name === name && r.date === today && ['Present', 'Late'].includes(r.status));
}

async function getAllAttendance() {
    if (mongoReady) return Attendance.find().sort({ createdAt: -1 }).limit(500);
    return [...memoryStore.attendance].reverse();
}

async function saveVisitorPass(doc) {
    if (mongoReady) return VisitorPass.create(doc);
    const copy = {
        _id: 'pass_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9),
        ...doc,
        createdAt: new Date()
    };
    memoryStore.passes.push(copy);
    return copy;
}

async function updateVisitorPass(id, patch) {
    if (mongoReady) return VisitorPass.findByIdAndUpdate(id, patch, { new: true });
    const doc = memoryStore.passes.find(p => String(p._id || p.id) === String(id));
    if (doc) Object.assign(doc, patch);
    return doc;
}

async function findPendingPassForHost(hostPhone) {
    const norm = String(hostPhone || '').replace(/\D/g, '');
    const alt = norm.startsWith('92') ? '0' + norm.substring(2) : (norm.startsWith('0') ? '92' + norm.substring(1) : norm);
    if (mongoReady) {
        return VisitorPass.findOne({ hostPhone: { $in: [norm, alt] }, status: 'pending' }).sort({ createdAt: -1 });
    }
    return [...memoryStore.passes].reverse()
        .find(p => (p.hostPhone === norm || p.hostPhone === alt) && p.status === 'pending');
}

async function findPassByCode(passCode) {
    if (!passCode) return null;
    const code = passCode.trim().toUpperCase();
    if (mongoReady) return VisitorPass.findOne({ passCode: code });
    return memoryStore.passes.find(p => String(p.passCode || '').toUpperCase() === code);
}

async function saveThreat(doc) {
    if (mongoReady) { return Threat.create(doc); }
    const copy = {
        _id: 'threat_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9),
        ...doc,
        createdAt: new Date()
    };
    memoryStore.threats.push(copy);
    return copy;
}

async function countThreatsToday() {
    const today = new Date().toDateString();
    if (mongoReady) {
        return Threat.countDocuments({ createdAt: { $gte: new Date(new Date().setHours(0, 0, 0, 0)) } });
    }
    return memoryStore.threats.filter(t => new Date(t.createdAt).toDateString() === today).length;
}

async function getAllBiometrics() {
    if (mongoReady) return Biometric.find().lean();
    return memoryStore.biometrics;
}

async function saveBiometric(name, descriptors) {
    if (mongoReady) {
        return Biometric.findOneAndUpdate(
            { name },
            { descriptors, createdAt: new Date() },
            { upsert: true, new: true }
        );
    }
    const idx = memoryStore.biometrics.findIndex(b => b.name.toLowerCase() === name.toLowerCase());
    const doc = {
        _id: 'bio_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9),
        name,
        descriptors,
        createdAt: new Date()
    };
    if (idx >= 0) {
        memoryStore.biometrics[idx] = doc;
    } else {
        memoryStore.biometrics.push(doc);
    }
    return doc;
}

function euclideanDistance(arr1, arr2) {
    if (!arr1 || !arr2 || arr1.length !== arr2.length) return 1;
    let sum = 0;
    for (let i = 0; i < arr1.length; i++) {
        const diff = arr1[i] - arr2[i];
        sum += diff * diff;
    }
    return Math.sqrt(sum);
}

const whatsappClient = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        headless: true,
        executablePath: process.env.CHROME_PATH || undefined,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--disable-gpu',
            '--disable-extensions',
            '--disable-component-update',
            '--unhandled-rejections=strict'
        ]
    }
});

whatsappClient.on('qr', (qr) => {
    console.log('⚠️ SCAN THIS QR CODE WITH UNIVERSITY WHATSAPP PHONE:');
    qrcode.generate(qr, { small: true });
});

whatsappClient.on('ready', () => {
    console.log('✅ NexusScan AI WhatsApp Engine is READY and Authenticated!');
    if (!ADMIN_WHITELIST.length) {
        console.log('⚠️ WARNING: ADMIN_WHITELIST is empty — ANY WhatsApp number can send LOCK/UNLOCK commands!');
    }
});

function formatWhatsAppNumber(phone) {
    let cleaned = String(phone || '').replace(/\D/g, '');
    if (!cleaned) return '';
    if (cleaned.startsWith('03')) {
        cleaned = '92' + cleaned.substring(1);
    } else if (cleaned.length === 10 && cleaned.startsWith('3')) {
        cleaned = '92' + cleaned;
    }
    return cleaned.endsWith('@c.us') ? cleaned : `${cleaned}@c.us`;
}

function validatePakistaniCNIC(cnic) {
    const cleaned = String(cnic || '').replace(/\D/g, '');
    return cleaned.length === 13;
}

function validatePakistaniPhone(phone) {
    const cleaned = String(phone || '').replace(/\D/g, '');
    if (cleaned.length === 11 && cleaned.startsWith('03')) return true;
    if (cleaned.length === 12 && cleaned.startsWith('923')) return true;
    return false;
}

async function safeSendWhatsApp(to, content, options) {
    try {
        if (!whatsappClient.info) {
            console.log(`ℹ️ WhatsApp not ready — message to ${to} skipped.`);
            return false;
        }
        await whatsappClient.sendMessage(to, content, options);
        return true;
    } catch (err) {
        console.warn(`⚠️ WhatsApp send failed to ${to}:`, err.message);
        return false;
    }
}

// Sliding-window rate limiter: max 5 login attempts per minute per IP
const loginAttempts = new Map();
function loginRateLimiter(req, res, next) {
    const ip = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    const windowMs = 60 * 1000;
    const maxAttempts = 5;

    let record = loginAttempts.get(ip);
    if (!record || (now - record.startTime) > windowMs) {
        record = { count: 0, startTime: now };
        loginAttempts.set(ip, record);
    }

    if (record.count >= maxAttempts) {
        const remainingSeconds = Math.ceil((windowMs - (now - record.startTime)) / 1000);
        return res.status(429).json({
            success: false,
            error: `Too many login attempts. Please wait ${remainingSeconds} seconds before trying again.`
        });
    }

    req.loginAttemptRecord = record;
    req.clientIp = ip;
    next();
}

function isAdminChat(chatId) {
    const digits = String(chatId).replace(/\D/g, '');
    const ownId = whatsappClient.info && whatsappClient.info.wid
        ? String(whatsappClient.info.wid._serialized).replace(/\D/g, '')
        : '';
    if (ownId && digits.startsWith(ownId)) return true;
    if (!ADMIN_WHITELIST.length) return true; // demo mode — set ADMIN_WHITELIST in .env for real security
    return ADMIN_WHITELIST.some(admin => digits === admin || digits.endsWith(admin));
}

app.post(['/api/auth', '/api/login', '/api/auth/login'], loginRateLimiter, async (req, res) => {
    const { username, password } = req.body || {};
    const normalizedUsername = String(username || '').trim().toLowerCase();
    if (!normalizedUsername || !password) {
        return res.status(400).json({ success: false, error: 'Username and password required!' });
    }

    const user = USERS[normalizedUsername];
    if (!user) {
        if (req.loginAttemptRecord) req.loginAttemptRecord.count++;
        return res.status(401).json({ success: false, error: 'Invalid username!' });
    }

    const isValid = await bcrypt.compare(password, user.passwordHash);
    if (!isValid) {
        if (req.loginAttemptRecord) req.loginAttemptRecord.count++;
        return res.status(401).json({ success: false, error: 'Incorrect password!' });
    }

    if (req.clientIp) loginAttempts.delete(req.clientIp);

    const token = jwt.sign(
        { username: normalizedUsername, role: user.role },
        JWT_SECRET,
        { expiresIn: '12h' }
    );

    console.log(`🔑 ${user.role.toUpperCase()} login: ${normalizedUsername}`);
    return res.json({ success: true, token, role: user.role, username: normalizedUsername });
});

app.get('/api/auth/me', authenticateToken, (req, res) => {
    const user = USERS[req.user.username];
    if (!user || user.role !== req.user.role) {
        return res.status(401).json({ success: false, error: 'Invalid session user.' });
    }
    return res.json({ success: true, username: req.user.username, role: user.role });
});

app.post('/api/visitor-request', authenticateToken, authorizeRoles('admin', 'faculty', 'guard'), async (req, res) => {
    try {
        const { visitorName, cnic, hostPhone, purpose } = req.body || {};

        if (!visitorName || !cnic || !hostPhone || !purpose) {
            return res.status(400).json({ success: false, error: 'Please complete all required fields.' });
        }

        if (!validatePakistaniCNIC(cnic)) {
            return res.status(400).json({
                success: false,
                error: 'Invalid CNIC format. Pakistani CNIC must contain 13 digits (e.g. 35201-1234567-1).'
            });
        }

        if (!validatePakistaniPhone(hostPhone)) {
            return res.status(400).json({
                success: false,
                error: 'Invalid phone format. Please enter a valid Pakistani mobile number (e.g. 03236404459).'
            });
        }

        const formattedPhone = formatWhatsAppNumber(hostPhone);
        await saveVisitorPass({
            visitorName, cnic, purpose,
            hostPhone: formattedPhone.replace('@c.us', ''),
            status: 'pending'
        });

        const msg = `🚨 *NexusScan Visitor Approval Request*\n\n` +
            `👤 *Visitor:* ${visitorName}\n` +
            `🪪 *CNIC:* ${cnic}\n` +
            `📌 *Purpose:* ${purpose}\n\n` +
            `Reply *1* to APPROVE | Reply *2* to REJECT`;

        await safeSendWhatsApp(formattedPhone, msg);
        console.log(`📩 Visitor request sent to ${formattedPhone}`);

        return res.status(200).json({
            success: true,
            message: 'Request sent successfully via WhatsApp!'
        });
    } catch (err) {
        console.error('Visitor API Error:', err);
        return res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/api/verify-pass', authenticateToken, authorizeRoles('admin', 'guard'), async (req, res) => {
    try {
        const passCode = String((req.body || {}).passCode || '').trim().toUpperCase();
        if (!passCode) return res.status(400).json({ success: false, error: 'Pass code required!' });

        const pass = await findPassByCode(passCode);
        if (!pass) {
            return res.status(404).json({ success: false, error: 'INVALID PASS — No record found!' });
        }
        if (pass.status !== 'approved') {
            return res.json({ success: false, error: `Pass is ${pass.status.toUpperCase()} — Entry Denied!` });
        }
        const issuedToday = new Date(pass.createdAt).toDateString() === new Date().toDateString();
        if (!issuedToday) {
            return res.json({ success: false, error: 'Pass EXPIRED — valid for issue day only!' });
        }
        if (pass.usedAt) {
            return res.json({ success: false, error: 'Pass ALREADY USED — one entry per pass!' });
        }

        await updateVisitorPass(pass._id, { usedAt: new Date() });
        return res.json({
            success: true,
            visitor: pass.visitorName,
            purpose: pass.purpose,
            message: `✅ VERIFIED: ${pass.visitorName} — Entry Granted!`
        });
    } catch (err) {
        console.error('Verify Pass Error:', err);
        return res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/api/attendance', authenticateToken, authorizeRoles('admin', 'faculty', 'guard'), async (req, res) => {
    try {
        const { name, status, phone, time } = req.body || {};
        if (!name || !status) return res.status(400).json({ success: false, error: 'Name & status required!' });

        // CRITICAL BUG FIX: Check already marked BEFORE saving to avoid duplicate rows
        const alreadyMarked = ['Present', 'Late'].includes(status) && await findAttendanceToday(name);
        if (alreadyMarked) {
            return res.json({ success: true, message: 'Already marked today — skipped.' });
        }

        await saveAttendance({
            name,
            status,
            time: time || new Date().toLocaleTimeString()
        });

        const recipientPhone = formatWhatsAppNumber(phone || SECURITY_PHONE);
        const statusMsg = `📋 *NexusScan Attendance Alert*\n\n` +
            `👤 *Name:* ${name}\n` +
            `📌 *Status:* ${String(status).toUpperCase()}\n` +
            `⏰ *Time:* ${new Date().toLocaleTimeString()}`;

        await safeSendWhatsApp(recipientPhone, statusMsg);
        console.log(`📩 Notification sent for ${name} (${status}) to ${recipientPhone}`);
        return res.json({ success: true, message: 'Notification sent successfully!' });
    } catch (err) {
        console.error('Attendance API Error:', err);
        return res.status(500).json({ success: false, error: err.message });
    }
});

// 15-second threat alert cooldown defense to prevent WhatsApp spam bans
let lastThreatDispatchTime = 0;
const THREAT_ALERT_COOLDOWN_MS = 15000;

app.post('/api/threat-alert', authenticateToken, authorizeRoles('admin', 'guard'), async (req, res) => {
    try {
        const { reason, snapshot } = req.body || {};
        await saveThreat({ reason: reason || 'Unknown threat', hasSnapshot: Boolean(snapshot) });

        const now = Date.now();
        if (now - lastThreatDispatchTime >= THREAT_ALERT_COOLDOWN_MS) {
            lastThreatDispatchTime = now;
            const securityNumber = formatWhatsAppNumber(SECURITY_PHONE);
            const alertMsg = `🚨 *EMERGENCY BREACH ALERT:*\n${reason || 'Unidentified Threat or Security Bypass Detected at Main Gate!'}` +
                `\n⏰ ${new Date().toLocaleTimeString()}`;

            if (snapshot) {
                const base64 = snapshot.replace(/^data:image\/\w+;base64,/, '');
                const media = new MessageMedia('image/jpeg', base64, 'nexus-threat-capture.jpg');
                await safeSendWhatsApp(securityNumber, media, { caption: alertMsg });
            } else {
                await safeSendWhatsApp(securityNumber, alertMsg);
            }
            console.log('🚨 Threat Alert Dispatched via WhatsApp!');
        } else {
            console.log('⏳ Threat logged in DB, but WhatsApp alert throttled (15-second defense active).');
        }

        return res.json({ success: true, message: 'Threat alert logged and broadcast processed!' });
    } catch (err) {
        console.error('Threat Alert Error:', err);
        return res.status(500).json({ success: false, error: err.message });
    }
});

app.get('/api/logs', authenticateToken, authorizeRoles('admin', 'faculty', 'guard'), async (req, res) => {
    const attendance = await getAllAttendance();
    const today = new Date().toDateString();
    const todays = attendance.filter(r => r.date === today);

    // Deduplicate headcount by person name
    const uniquePresent = new Set(todays.filter(r => ['Present', 'Late'].includes(r.status)).map(r => r.name.toLowerCase()));
    const uniqueLate = new Set(todays.filter(r => r.status === 'Late').map(r => r.name.toLowerCase()));

    res.json({
        attendance: attendance.slice(0, 100).map(r => ({ name: r.name, time: r.time, status: r.status })),
        counts: {
            present: uniquePresent.size,
            late: uniqueLate.size
        },
        threats: await countThreatsToday(),
        locked: isSystemLocked
    });
});

app.delete('/api/logs', authenticateToken, authorizeRoles('admin'), async (req, res) => {
    try {
        if (mongoReady) {
            await Attendance.deleteMany({});
            await Threat.deleteMany({});
        }
        memoryStore.attendance = [];
        memoryStore.threats = [];
        console.log(`🗑️ Session logs cleared by Admin (${req.user.username})`);
        return res.json({ success: true, message: 'All attendance and threat logs have been wiped.' });
    } catch (err) {
        console.error('Clear Logs Error:', err);
        return res.status(500).json({ success: false, error: err.message });
    }
});

app.get('/api/privacy-policy', (req, res) => {
    res.json({
        success: true,
        title: "NexusScan AI Biometric Privacy & Retention Policy",
        retentionDays: 30,
        policy: {
            rawImages: "No raw facial photographs are stored permanently. Video frames are immediately processed into 128-dimensional floating point mathematical vectors and discarded.",
            biometrics: "Mathematical facial descriptors are stored securely and used strictly for identity verification and access control.",
            consent: "Explicit user consent is mandatory prior to biometric enrollment.",
            retention: "Access logs and temporary threat snapshots are retained for a 30-day compliance cycle, after which they are subject to automated purging.",
            rights: "Users may request deletion of their biometric descriptors by contacting a system administrator."
        }
    });
});

app.get('/api/biometrics', authenticateToken, authorizeRoles('admin', 'faculty', 'guard'), async (req, res) => {
    try {
        const biometrics = await getAllBiometrics();
        return res.json({ success: true, biometrics });
    } catch (err) {
        console.error('Fetch Biometrics Error:', err);
        return res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/api/enroll-face', authenticateToken, authorizeRoles('admin'), async (req, res) => {
    try {
        const { name, descriptors } = req.body || {};
        const label = String(name || '').trim();
        if (!label) return res.status(400).json({ success: false, error: 'Person name is required.' });
        if (!Array.isArray(descriptors) || descriptors.length < 3) {
            return res.status(400).json({ success: false, error: 'At least 3 valid facial descriptor samples are required.' });
        }

        // Duplicate Face Detection (Euclidean distance < 0.38)
        const existingProfiles = await getAllBiometrics();
        const incomingAvg = descriptors[0];
        for (const profile of existingProfiles) {
            if (profile.name.toLowerCase() === label.toLowerCase()) continue;
            for (const sample of (profile.descriptors || [])) {
                const dist = euclideanDistance(incomingAvg, sample);
                if (dist < 0.38) {
                    return res.status(409).json({
                        success: false,
                        error: `Duplicate face detected: looks identical to already enrolled profile '${profile.name}' (distance: ${dist.toFixed(3)} < 0.38).`
                    });
                }
            }
        }

        const saved = await saveBiometric(label, descriptors);
        console.log(`✅ Biometric profile enrolled: ${label} (${descriptors.length} samples)`);
        return res.json({
            success: true,
            message: `Profile '${label}' enrolled successfully.`,
            biometric: { name: saved.name, count: descriptors.length }
        });
    } catch (err) {
        console.error('Enroll Face Error:', err);
        return res.status(500).json({ success: false, error: err.message });
    }
});

app.get('/api/labels', authenticateToken, authorizeRoles('admin', 'faculty', 'guard'), (req, res) => {
    try {
        const dir = path.join(__dirname, 'labels');
        const labels = fs.readdirSync(dir)
            .filter(f => fs.statSync(path.join(dir, f)).isDirectory());
        res.json({ labels });
    } catch (err) {
        res.json({ labels: [] });
    }
});

app.get('/api/system-status', authenticateToken, authorizeRoles('admin', 'faculty', 'guard'), (req, res) => {
    res.json({
        locked: isSystemLocked,
        announcement: currentAnnouncement
    });
});

app.get('/api/export/excel', authenticateToken, authorizeRoles('admin', 'faculty'), async (req, res) => {
    try {
        const rows = (await getAllAttendance()).map(r => ({
            Name: r.name, Time: r.time, Status: r.status, Date: r.date
        }));
        const ws = XLSX.utils.json_to_sheet(rows.length ? rows : [{ Info: 'No records yet' }]);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'NexusScan Logs');
        const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
        res.setHeader('Content-Disposition', `attachment; filename=NexusScan_Report_${new Date().toISOString().slice(0, 10)}.xlsx`);
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.send(buffer);
    } catch (err) {
        console.error('Export Error:', err);
        res.status(500).send('Export failed: ' + err.message);
    }
});

app.post('/api/ask-ai', authenticateToken, authorizeRoles('admin', 'faculty', 'guard'), async (req, res) => {
    try {
        const { question } = req.body || {};
        if (!question) return res.status(400).json({ success: false, error: 'Question required!' });
        const userRole = req.user.role;

        // Strict Admin-only features detection
        const adminRestrictedRegex = /enroll|biometric|face profile|clear logs?|wipe|database reset|force reboot|reboot|restart server|manage users?|user management|admin controls?|delete records?/i;
        const exportRestrictedRegex = /export|download (report|excel|log|sheet)|xlsx/i;
        const gateControlRegex = /lock|unlock|lockdown|panic|red alert|emergency alert|breach trigger/i;

        // 1. RBAC Restriction Checks
        if (userRole !== 'admin') {
            if (adminRestrictedRegex.test(question)) {
                return res.json({
                    success: true,
                    answer: '⛔ Access Denied: Biometric face enrollment, log clearing, database reset, reboot, and administrator controls are strictly restricted to Administrators.',
                    source: 'access-control'
                });
            }
            if (userRole === 'guard' && exportRestrictedRegex.test(question)) {
                return res.json({
                    success: true,
                    answer: '⛔ Access Denied: Log export (.xlsx) is restricted to Administrators and Faculty. Security Guards can monitor gate attendance counts and live events.',
                    source: 'access-control'
                });
            }
            if (userRole === 'faculty' && gateControlRegex.test(question)) {
                return res.json({
                    success: true,
                    answer: '⛔ Access Denied: Gate emergency controls, remote lockdown commands, and panic triggers are restricted to Security Guards and Administrators.',
                    source: 'access-control'
                });
            }
        }

        const attendance = await getAllAttendance();
        const today = new Date().toDateString();
        const todayRecords = attendance.filter(r => r.date === today);
        const uniquePresent = new Set(todayRecords.filter(r => ['Present', 'Late'].includes(r.status)).map(r => r.name.toLowerCase()));
        const uniqueLate = new Set(todayRecords.filter(r => r.status === 'Late').map(r => r.name.toLowerCase()));
        const presentCount = uniquePresent.size;
        const lateCount = uniqueLate.size;
        const threatCount = await countThreatsToday();
        const recentNames = todayRecords.slice(0, 10).map(r => `${r.name} (${r.status})`).join(', ');

        // Check if asking about capabilities / features / help
        const isFeaturesQuery = /features?|capabilities|what can (you|i) do|help|commands?|menu|options?/i.test(question);
        if (isFeaturesQuery) {
            let roleFeatureAnswer = '';
            if (userRole === 'guard') {
                roleFeatureAnswer = `💂 GUARD AUTHORIZED CAPABILITIES:\n1. Check today's gate attendance (${presentCount} present, ${lateCount} late).\n2. Monitor security breach & spoofing alerts (${threatCount} threats today).\n3. Verify digital visitor passes (NX-XXXX).\n4. View live gate status and vitality.\n*Note: Face enrollment, log wipe, and report exports are restricted to administrators.*`;
            } else if (userRole === 'faculty') {
                roleFeatureAnswer = `🎓 FACULTY AUTHORIZED CAPABILITIES:\n1. View student attendance totals (${presentCount} present today).\n2. Track late arrivals (${lateCount} late today).\n3. Review attendance logs.\n4. Export attendance records to Excel (.xlsx).\n5. Check system status.\n*Note: Gate biometric enrollment and physical security overrides require administrator authorization.*`;
            } else {
                roleFeatureAnswer = `🛡️ ADMINISTRATOR FULL ACCESS:\n1. Biometric face enrollment & profile management.\n2. Session log management and database clearing.\n3. Remote WhatsApp lockdown & release commands (LOCK / UNLOCK).\n4. Live threat telemetry & emergency broadcast.\n5. Excel attendance reporting & full system diagnostics.`;
            }
            return res.json({ success: true, answer: roleFeatureAnswer, source: 'rbac-system' });
        }

        const roleConstraints = userRole === 'guard'
            ? 'USER IS A SECURITY GUARD. You must ONLY answer regarding gate operations: attendance counts, threats today, gate pass verification, and system status. NEVER mention, offer, or explain how to perform face enrollment, log clearing, force reboot, or Excel export.'
            : userRole === 'faculty'
            ? 'USER IS A FACULTY MEMBER. You must ONLY answer regarding academic attendance: total present, late arrivals, log summaries, and Excel export. NEVER discuss guard operations, panic alerts, or administrator overrides.'
            : 'USER IS AN ADMINISTRATOR. Provide full administrative, diagnostic, and security operational assistance.';

        const systemContext = `You are NexusScan AI, an intelligent physical security assistant for a university/organization gate system. Current live data:
- System Status: ${isSystemLocked ? 'LOCKED (Emergency Lockdown)' : 'ACTIVE & OPERATIONAL'}
- Present Today: ${presentCount} persons
- Late Arrivals: ${lateCount} persons  
- Security Threats Detected Today: ${threatCount}
- Recent entries: ${recentNames || 'No entries yet'}
- Current Time: ${new Date().toLocaleTimeString()}
- Database: ${mongoReady ? 'MongoDB Connected' : 'Hybrid Memory Mode'}
- Signed-in role: ${userRole}
ROLE CONSTRAINTS: ${roleConstraints}

Answer concisely (2-3 sentences max). Be professional and direct. Strict role-based authorization is enforced. If asked about a restricted feature, firmly state that it requires higher-level authorization.`;

        if (geminiModel) {
            try {
                const prompt = `${systemContext}\n\nUser Question: "${question}"`;
                const result = await geminiModel.generateContent(prompt);
                const aiAnswer = result.response.text();
                return res.json({ success: true, answer: aiAnswer, source: 'gemini' });
            } catch (geminiErr) {
                console.warn('Gemini API error, falling back to local AI:', geminiErr.message);
            }
        }

        const q = question.toLowerCase();
        let answer = '';

        if (q.match(/how many|count|total|present/)) {
            answer = `Currently ${presentCount} persons are marked present today, with ${lateCount} late arrivals. System is ${isSystemLocked ? 'in LOCKDOWN' : 'fully operational'}.`;
        } else if (q.match(/late|delay|tardy/)) {
            answer = `${lateCount} persons arrived late today out of ${presentCount} total present. Late is defined as arrival after 9:00 AM.`;
        } else if (q.match(/threat|breach|unknown|unauthorized|attack|suspicious/)) {
            answer = threatCount > 0
                ? `⚠️ Alert! ${threatCount} security breach attempts detected today at the main gate. All incidents have been logged and WhatsApp alerts dispatched to security personnel.`
                : `All security parameters are normal. No unauthorized threats detected at the main gate today. AI anti-spoofing and blink liveness detection are active.`;
        } else if (q.match(/lock|lockdown|shutdown/)) {
            if (userRole === 'faculty') {
                answer = `The gate system is currently ${isSystemLocked ? 'in EMERGENCY LOCKDOWN' : 'ACTIVE'}. Lockdown controls are restricted to administrators and security guards.`;
            } else {
                answer = isSystemLocked
                    ? `System is currently in EMERGENCY LOCKDOWN mode. All face scanning is disabled. Authorized admins can send 'UNLOCK' via WhatsApp to resume operations.`
                    : `System is fully active. Authorized admins can send 'LOCK' via WhatsApp to initiate emergency lockdown.`;
            }
        } else if (q.match(/status|state|running|online/)) {
            answer = `NexusScan AI is fully operational. ${presentCount} present, ${lateCount} late, ${threatCount} threats today. Database: ${mongoReady ? 'MongoDB Active' : 'Memory Mode'}. All systems nominal.`;
        } else if (q.match(/visitor|guest|pass|gate pass/)) {
            answer = `The Smart Visitor Entry system is active. Visitors submit details at the gate, hosts approve via WhatsApp, and an NX-XXXX gate pass code is issued for single-use verification.`;
        } else if (q.match(/hello|hi|hey|good morning|good evening|salaam|salam/)) {
            const roleGreeting = userRole === 'guard' ? 'Officer' : userRole === 'faculty' ? 'Professor' : 'Administrator';
            answer = `Hello ${roleGreeting}! I am NexusScan AI Assistant. How can I assist you with your role-authorized security tasks today?`;
        } else if (q.match(/who|which person|name/)) {
            answer = recentNames
                ? `Recent entries today: ${recentNames}.`
                : `No entries recorded yet today. The face recognition system is scanning at the main gate.`;
        } else {
            const allowedScope = userRole === 'guard'
                ? 'gate attendance, security threats, system status, and visitor passes'
                : userRole === 'faculty'
                ? 'student attendance, late arrivals, and attendance log summaries'
                : 'attendance, threats, system vitality, lockdown controls, and visitor management';
            answer = `I heard: "${question}". For your ${userRole.toUpperCase()} role, I can assist with: ${allowedScope}.`;
        }

        return res.json({ success: true, answer, source: 'local-ai' });
    } catch (err) {
        console.error('AI Assistant Error:', err);
        return res.status(500).json({ success: false, error: err.message });
    }
});

async function handleMessage(msg) {
    try {
        const rawText = (msg.body || '').trim();
        const upperText = rawText.toUpperCase();
        const admin = isAdminChat(msg.from);

        const isCommand = ['STATUS', 'LOCK', 'UNLOCK', '1', '2'].includes(upperText) || upperText.startsWith('ANNOUNCE ');
        if (isCommand) {
            console.log(`📨 Incoming WhatsApp command from ${msg.from}: "${rawText}"`);
        }

        if (upperText === 'STATUS' || upperText === 'LOCK' || upperText === 'UNLOCK' || upperText.startsWith('ANNOUNCE ')) {
            if (!admin) {
                await msg.reply('⛔ *ACCESS DENIED:* This number is not an authorized NexusScan admin.');
                console.log(`⛔ Blocked admin command from unauthorized ${msg.from}`);
                return;
            }
        }

        if (upperText.startsWith('ANNOUNCE ')) {
            currentAnnouncement = rawText.substring(9);
            await msg.reply(`📢 *Voice Announcement Triggered:* "${currentAnnouncement}"`);
            console.log(`📢 Voice Broadcast: ${currentAnnouncement}`);
            setTimeout(() => { currentAnnouncement = ""; }, 6000);
            return;
        }

        if (upperText === 'STATUS') {
            const threats = await countThreatsToday();
            const statusReport = `📊 *NexusScan System Live Status*\n\n` +
                `⚙️ *Security Engine:* ${isSystemLocked ? '🔴 LOCKED' : '🟢 ACTIVE'}\n` +
                `🚨 *Threats Today:* ${threats}\n` +
                `⏰ *Server:* Running on Port ${PORT}\n` +
                `📡 *Database:* ${mongoReady ? 'MongoDB Active' : 'Hybrid Memory Mode'}\n\n` +
                `Send *LOCK* to disable gate access.\n` +
                `Send *UNLOCK* to resume operations.\n` +
                `Send *ANNOUNCE [msg]* for audio broadcast.`;
            await msg.reply(statusReport);
            console.log(`📡 Status Report Sent to ${msg.from}`);
            return;
        }

        if (upperText === 'LOCK') {
            isSystemLocked = true;
            await msg.reply('🔴 *EMERGENCY LOCKDOWN ACTIVATED!* Scanner disabled at Main Gate.');
            console.log(`🔴 System Locked via WhatsApp Command by ${msg.from}`);
            return;
        }

        if (upperText === 'UNLOCK') {
            isSystemLocked = false;
            await msg.reply('🟢 *LOCKDOWN RELEASED.* NexusScan normal operations resumed.');
            console.log(`🟢 System Unlocked via WhatsApp Command by ${msg.from}`);
            return;
        }

        if (upperText === '1' || upperText === '2') {
            const hostDigits = String(msg.from).replace(/\D/g, '');
            const pending = await findPendingPassForHost(hostDigits);

            if (!pending) {
                await msg.reply('⚠️ *No pending visitor request found* for this number. Please submit a Smart Visitor Entry first, then reply 1 or 2.');
                console.log(`⚠️ Reply "${upperText}" from ${msg.from} but no pending request found.`);
                return;
            }

            if (upperText === '1') {
                const passCode = 'NX-' + Math.floor(1000 + Math.random() * 9000);
                await updateVisitorPass(pending._id, { status: 'approved', passCode });
                const approvalMsg = `✅ *VISITOR APPROVED!*\n\n` +
                    `👤 *Visitor:* ${pending.visitorName}\n` +
                    `🪪 *Digital Gate Pass Code:* ${passCode}\n` +
                    `📌 Status: Valid for Today (single entry)\n` +
                    `Show this code to Main Gate Security Guard for verification.`;
                await msg.reply(approvalMsg);

                const guardNumber = formatWhatsAppNumber(SECURITY_PHONE);
                const hostNumber = String(msg.from).replace('@c.us', '');
                const guardAlertMsg = `🛂 *GATE ALERT: Visitor Approved*\n\n` +
                    `👤 *Visitor:* ${pending.visitorName}\n` +
                    `🪪 *Pass Code:* ${passCode}\n` +
                    `📱 *Approved By:* ${hostNumber}\n\n` +
                    `Please allow entry.`;

                if (msg.from !== guardNumber) {
                    await safeSendWhatsApp(guardNumber, guardAlertMsg);
                }

                console.log(`✅ Visitor ${pending.visitorName} approved by ${msg.from} — Pass ${passCode}`);
            } else {
                await updateVisitorPass(pending._id, { status: 'rejected' });
                await msg.reply(`❌ *VISITOR REJECTED!*\n${pending.visitorName} — Entry denied at Main Gate.`);
                console.log(`❌ Visitor ${pending.visitorName} rejected by ${msg.from}`);
            }
            return;
        }

    } catch (err) {
        console.error('WhatsApp Command Error:', err);
    }
}

whatsappClient.on('message', handleMessage);

whatsappClient.on('message_create', (msg) => {
    if (msg.fromMe) handleMessage(msg);
});

whatsappClient.on('disconnected', (reason) => {
    console.warn('⚠️ NexusScan WhatsApp Client Disconnected:', reason);
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 NexusScan AI Backend Engine Running on port ${PORT}`);
});

process.on('uncaughtException', error => {
    if (error.message && error.message.includes('browser is already running for')) {
        console.warn(`⚠️ WhatsApp service unavailable: ${error.message}`);
        console.warn('Authentication and dashboard APIs remain available.');
        return;
    }
    console.error('Fatal server error:', error);
    process.exitCode = 1;
});

process.on('unhandledRejection', (reason) => {
    console.warn('⚠️ Unhandled promise rejection (non-fatal):', reason && reason.message ? reason.message : reason);
});

whatsappClient.initialize().catch(error => {
    console.warn(`⚠️ WhatsApp service unavailable: ${error.message}`);
    console.warn('Authentication and dashboard APIs remain available.');
});
