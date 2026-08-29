const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const XLSX = require('xlsx');
require('dotenv').config();

// 🤖 Gemini AI Integration (100% Free / Optional)
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

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'nexus_scan_ai_secret_key_production_2026';

// 🔐 Configuration (see .env.example)
const SECURITY_PHONE = process.env.SECURITY_PHONE || '03236404459';
const ADMIN_WHITELIST = (process.env.ADMIN_WHITELIST || '')
    .split(',').map(s => s.trim().replace(/\D/g, '')).filter(Boolean)
    .map(d => d.startsWith('03') ? '92' + d.substring(1) : d);

// 🔒 Global Security State
let isSystemLocked = false;
let currentAnnouncement = "";

// ============================================================
// 🗄️ MongoDB Models + Hybrid Memory Fallback
// ============================================================
const UserSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true },
    passwordHash: { type: String, required: true },
    role: { type: String, enum: ['admin', 'guard', 'faculty'], default: 'guard' },
    name: { type: String, default: '' },
    createdAt: { type: Date, default: Date.now }
});

const BiometricSchema = new mongoose.Schema({
    name: { type: String, required: true, unique: true },
    role: { type: String, default: 'Student' },
    descriptors: { type: [[Number]], required: true }, 
    samplesCount: { type: Number, default: 0 },
    createdAt: { type: Date, default: Date.now }
});

const AttendanceSchema = new mongoose.Schema({
    name: String,
    status: String,
    time: String,
    date: { type: String, default: () => new Date().toDateString() },
    createdAt: { type: Date, default: Date.now }
});

const VisitorPassSchema = new mongoose.Schema({
    visitorName: String,
    cnic: String,
    hostPhone: String,
    purpose: String,
    status: { type: String, default: 'pending' },
    passCode: String,
    usedAt: Date,
    createdAt: { type: Date, default: Date.now }
});

const ThreatSchema = new mongoose.Schema({
    reason: String,
    hasSnapshot: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now }
});

const User = mongoose.model('User', UserSchema);
const Biometric = mongoose.model('Biometric', BiometricSchema);
const Attendance = mongoose.model('Attendance', AttendanceSchema);
const VisitorPass = mongoose.model('VisitorPass', VisitorPassSchema);
const Threat = mongoose.model('Threat', ThreatSchema);

const memoryStore = {
    users: [],
    biometrics: [],
    attendance: [],
    passes: [],
    threats: []
};
let mongoReady = false;

const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/nexusScanAI';

mongoose.connect(MONGO_URI)
    .then(async () => {
        mongoReady = true;
        console.log('✅ MongoDB Connected Successfully!');
        await seedDefaultUsers();
    })
    .catch(async () => {
        console.log('⚠️ Local MongoDB not detected! Running server in Hybrid Memory Mode.');
        await seedDefaultUsers();
    });

async function seedDefaultUsers() {
    const defaultAccounts = [
        { username: 'admin', password: process.env.ADMIN_PASSWORD || 'admin123', role: 'admin', name: 'Chief Security Officer' },
        { username: 'guard', password: 'guard123', role: 'guard', name: 'Main Gate Officer' },
        { username: 'faculty', password: 'faculty123', role: 'faculty', name: 'Department Faculty' }
    ];

    for (const acc of defaultAccounts) {
        const hash = await bcrypt.hash(acc.password, 10);
        if (mongoReady) {
            const exists = await User.findOne({ username: acc.username });
            if (!exists) {
                await User.create({ username: acc.username, passwordHash: hash, role: acc.role, name: acc.name });
            }
        } else {
            const exists = memoryStore.users.find(u => u.username === acc.username);
            if (!exists) {
                memoryStore.users.push({ username: acc.username, passwordHash: hash, role: acc.role, name: acc.name });
            }
        }
    }
    console.log('🔐 RBAC System Active: Default Accounts (admin, guard, faculty) Ready.');
}

function authenticateJWT(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.split(' ')[1] : null;
    if (!token) return res.status(401).json({ success: false, error: 'Unauthorized: Authentication token required.' });
    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) return res.status(403).json({ success: false, error: 'Forbidden: Invalid or expired token.' });
        req.user = user;
        next();
    });
}

function requireRole(allowedRoles = []) {
    return (req, res, next) => {
        if (!req.user || !allowedRoles.includes(req.user.role)) {
            return res.status(403).json({ success: false, error: `Access Denied: Required role [${allowedRoles.join(', ')}]` });
        }
        next();
    };
}

async function saveAttendance(record) {
    if (mongoReady) { await Attendance.create(record); return; }
    record.date = record.date || new Date().toDateString();
    memoryStore.attendance.push({ ...record, createdAt: new Date() });
}

async function findAttendanceToday(name) {
    const today = new Date().toDateString();
    if (mongoReady) return Attendance.findOne({ name, date: today, status: { $in: ['Present', 'Late'] } });
    return memoryStore.attendance.find(r => r.name === name && r.date === today && ['Present', 'Late'].includes(r.status));
}

async function getAllAttendance() {
    if (mongoReady) return Attendance.find().sort({ createdAt: -1 }).limit(500);
    return [...memoryStore.attendance].reverse();
}

async function saveVisitorPass(doc) {
    if (mongoReady) return VisitorPass.create(doc);
    const copy = { ...doc, createdAt: new Date() };
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
    if (mongoReady) return VisitorPass.findOne({ hostPhone, status: 'pending' }).sort({ createdAt: -1 });
    return [...memoryStore.passes].reverse().find(p => p.hostPhone === hostPhone && p.status === 'pending');
}

async function findPassByCode(passCode) {
    if (mongoReady) return VisitorPass.findOne({ passCode });
    return memoryStore.passes.find(p => p.passCode === passCode);
}

async function saveThreat(doc) {
    if (mongoReady) { await Threat.create(doc); return; }
    memoryStore.threats.push({ ...doc, createdAt: new Date() });
}

async function countThreatsToday() {
    if (mongoReady) return Threat.countDocuments({ createdAt: { $gte: new Date(new Date().setHours(0, 0, 0, 0)) } });
    const today = new Date().toDateString();
    return memoryStore.threats.filter(t => new Date(t.createdAt).toDateString() === today).length;
}

async function getAllBiometrics() {
    if (mongoReady) return Biometric.find();
    return memoryStore.biometrics;
}

async function saveBiometric(name, descriptors, role = 'Student') {
    if (mongoReady) {
        return Biometric.findOneAndUpdate({ name }, { name, descriptors, role, samplesCount: descriptors.length, createdAt: new Date() }, { upsert: true, new: true });
    }
    const idx = memoryStore.biometrics.findIndex(b => b.name.toLowerCase() === name.toLowerCase());
    const doc = { name, descriptors, role, samplesCount: descriptors.length, createdAt: new Date() };
    if (idx >= 0) memoryStore.biometrics[idx] = doc; else memoryStore.biometrics.push(doc);
    return doc;
}

function euclideanDistance(d1, d2) {
    if (!d1 || !d2 || d1.length !== d2.length) return 1.0;
    let sum = 0.0;
    for (let i = 0; i < d1.length; i++) { const diff = d1[i] - d2[i]; sum += diff * diff; }
    return Math.sqrt(sum);
}

const whatsappClient = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    }
});

function formatWhatsAppNumber(phone) {
    let cleaned = String(phone).replace(/\D/g, '');
    if (cleaned.startsWith('03')) cleaned = '92' + cleaned.substring(1);
    return cleaned.endsWith('@c.us') ? cleaned : `${cleaned}@c.us`;
}

function isAdminChat(chatId) {
    const digits = String(chatId).replace(/\D/g, '');
    const ownId = whatsappClient.info && whatsappClient.info.wid ? String(whatsappClient.info.wid._serialized).replace(/\D/g, '') : '';
    if (ownId && digits.startsWith(ownId)) return true;
    if (!ADMIN_WHITELIST.length) return true;
    return ADMIN_WHITELIST.some(admin => digits.startsWith(admin));
}

// ============================================================
// 📩 API Endpoints
// ============================================================

// 🔑 RBAC Login Endpoint
app.post('/api/auth/login', async (req, res) => {
    try {
        const { username, password } = req.body || {};
        if (!username || !password) {
            return res.status(400).json({ success: false, error: 'Username and password required.' });
        }

        let user = null;
        if (mongoReady) {
            user = await User.findOne({ username: username.toLowerCase().trim() });
        } else {
            user = memoryStore.users.find(u => u.username.toLowerCase() === username.toLowerCase().trim());
        }

        if (!user) {
            return res.status(401).json({ success: false, error: 'Invalid username or password.' });
        }

        const validPassword = await bcrypt.compare(password, user.passwordHash);
        if (!validPassword) {
            return res.status(401).json({ success: false, error: 'Invalid username or password.' });
        }

        const token = jwt.sign(
            { id: user._id || user.username, username: user.username, role: user.role, name: user.name },
            JWT_SECRET,
            { expiresIn: '24h' }
        );

        return res.json({
            success: true,
            token,
            user: { username: user.username, role: user.role, name: user.name }
        });
    } catch (err) {
        console.error('Login Error:', err);
        return res.status(500).json({ success: false, error: err.message });
    }
});

// 🔑 Get Current Authenticated User
app.get('/api/auth/me', authenticateJWT, (req, res) => {
    return res.json({ success: true, user: req.user });
});

// 📸 Server-Side Biometric Enrollment
app.post('/api/biometrics/enroll', authenticateJWT, requireRole(['admin', 'guard']), async (req, res) => {
    try {
        const { name, role, descriptors } = req.body || {};
        if (!name || !descriptors || !Array.isArray(descriptors) || descriptors.length === 0) {
            return res.status(400).json({ success: false, error: 'Name and biometric samples required.' });
        }

        const saved = await saveBiometric(name.trim(), descriptors, role || 'Student');
        console.log(`👤 Biometric Enrolled: ${name} with ${descriptors.length} sample vectors.`);
        return res.json({
            success: true,
            message: `Biometric for ${name} stored securely on server.`,
            enrolledCount: saved.samplesCount
        });
    } catch (err) {
        console.error('Enrollment Error:', err);
        return res.status(500).json({ success: false, error: err.message });
    }
});

// 📋 List Enrolled Biometrics
app.get('/api/biometrics/list', async (req, res) => {
    try {
        const biometrics = await getAllBiometrics();
        const names = biometrics.map(b => ({ name: b.name, role: b.role, samples: b.samplesCount }));
        return res.json({ success: true, biometrics: names, count: names.length });
    } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
    }
});

// 🛡️ SERVER-SIDE DECISION ENGINE: Verify Face & Make Access Control Decision
app.post('/api/biometrics/verify', async (req, res) => {
    try {
        if (isSystemLocked) {
            return res.json({
                decision: 'LOCKED',
                label: 'SYSTEM LOCKED',
                message: '🚨 Emergency Lockdown Active. Scanner Disabled.',
                matched: false
            });
        }

        const { descriptor, isLive, snapshot } = req.body || {};
        if (!descriptor || !Array.isArray(descriptor) || descriptor.length !== 128) {
            return res.status(400).json({ success: false, error: 'Valid 128-dimensional descriptor vector required.' });
        }

        const allBiometrics = await getAllBiometrics();

        let bestMatch = { label: 'unknown', distance: 1.0 };
        const MATCH_THRESHOLD = 0.50;

        for (const bio of allBiometrics) {
            for (const storedDesc of bio.descriptors) {
                const dist = euclideanDistance(descriptor, storedDesc);
                if (dist < bestMatch.distance) {
                    bestMatch = { label: bio.name, distance: dist, role: bio.role };
                }
            }
        }

        const distanceStr = bestMatch.distance.toFixed(2);

        // Case 1: Unknown Suspect
        if (bestMatch.distance >= MATCH_THRESHOLD || bestMatch.label === 'unknown') {
            return res.json({
                decision: 'UNAUTHORIZED',
                matched: false,
                label: 'unknown',
                distance: distanceStr,
                message: `Unauthorized Suspect [${distanceStr}]`
            });
        }

        // Case 2: Spoof Attempt (Photo/Video Attack)
        if (!isLive) {
            return res.json({
                decision: 'SPOOF_BLOCKED',
                matched: false,
                label: bestMatch.label,
                distance: distanceStr,
                message: `BLINK TO VERIFY: ${bestMatch.label.toUpperCase()} [${distanceStr}]`
            });
        }

        // Case 3: Fully Verified Live Person -> Process Access & Log Attendance on Server
        const now = new Date();
        const timeString = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        const isLate = now.getHours() >= 9;
        const statusType = isLate ? 'Late' : 'Present';

        const alreadyMarked = await findAttendanceToday(bestMatch.label);
        let newlyMarked = false;

        if (!alreadyMarked) {
            newlyMarked = true;
            await saveAttendance({
                name: bestMatch.label,
                status: statusType,
                time: timeString
            });

            // Dispatch WhatsApp Alert on Server
            const recipientPhone = formatWhatsAppNumber(SECURITY_PHONE);
            const statusMsg = `📋 *NexusScan Attendance Alert*\n\n` +
                `👤 *Name:* ${bestMatch.label}\n` +
                `📌 *Status:* ${statusType.toUpperCase()}\n` +
                `⏰ *Time:* ${timeString}`;

            if (whatsappClient.info) {
                whatsappClient.sendMessage(recipientPhone, statusMsg).catch(e => console.error('WA err:', e.message));
            }
        }

        return res.json({
            decision: 'GRANTED',
            matched: true,
            label: bestMatch.label,
            distance: distanceStr,
            status: statusType,
            time: timeString,
            newlyMarked,
            message: `VERIFIED: ${bestMatch.label.toUpperCase()} [${distanceStr}]`
        });
    } catch (err) {
        console.error('Verification Error:', err);
        return res.status(500).json({ success: false, error: err.message });
    }
});

// 📩 Smart Visitor Approval Endpoint
app.post('/api/visitor-request', async (req, res) => {
    try {
        const { visitorName, cnic, hostPhone, purpose } = req.body || {};

        if (!visitorName || !cnic || !hostPhone || !purpose) {
            return res.status(400).json({ success: false, error: 'Tamam fields require hain!' });
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

        if (whatsappClient.info) {
            await whatsappClient.sendMessage(formattedPhone, msg);
        }

        return res.status(200).json({
            success: true,
            message: 'Request sent successfully via WhatsApp!'
        });
    } catch (err) {
        console.error('Visitor API Error:', err);
        return res.status(500).json({ success: false, error: err.message });
    }
});

// 🎫 Gate Pass Verification
app.post('/api/verify-pass', async (req, res) => {
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

// 📩 Attendance Dispatcher (Manual Entry)
app.post('/api/attendance', async (req, res) => {
    try {
        const { name, status, phone, time } = req.body || {};
        if (!name || !status) return res.status(400).json({ success: false, error: 'Name & status required!' });

        const alreadyMarked = ['Present', 'Late'].includes(status) && await findAttendanceToday(name);
        await saveAttendance({
            name,
            status,
            time: time || new Date().toLocaleTimeString()
        });

        if (alreadyMarked) {
            return res.json({ success: true, message: 'Already marked today — log synced.' });
        }

        const recipientPhone = formatWhatsAppNumber(phone || SECURITY_PHONE);
        const statusMsg = `📋 *NexusScan Attendance Alert*\n\n` +
            `👤 *Name:* ${name}\n` +
            `📌 *Status:* ${String(status).toUpperCase()}\n` +
            `⏰ *Time:* ${new Date().toLocaleTimeString()}`;

        if (whatsappClient.info) {
            await whatsappClient.sendMessage(recipientPhone, statusMsg);
        }
        return res.json({ success: true, message: 'Attendance logged successfully!' });
    } catch (err) {
        console.error('Attendance API Error:', err);
        return res.status(500).json({ success: false, error: err.message });
    }
});

// 🚨 Emergency Threat Alert
app.post('/api/threat-alert', async (req, res) => {
    try {
        const { reason, snapshot } = req.body || {};
        await saveThreat({ reason: reason || 'Unknown threat', hasSnapshot: Boolean(snapshot) });

        const securityNumber = formatWhatsAppNumber(SECURITY_PHONE);
        const alertMsg = `🚨 *EMERGENCY BREACH ALERT:*\n${reason || 'Unidentified Threat or Security Bypass Detected at Main Gate!'}` +
            `\n⏰ ${new Date().toLocaleTimeString()}`;

        if (whatsappClient.info) {
            if (snapshot) {
                const base64 = snapshot.replace(/^data:image\/\w+;base64,/, '');
                const media = new MessageMedia('image/jpeg', base64, 'nexus-threat-capture.jpg');
                await whatsappClient.sendMessage(securityNumber, media, { caption: alertMsg });
            } else {
                await whatsappClient.sendMessage(securityNumber, alertMsg);
            }
        }
        return res.json({ success: true, message: 'Threat alert broadcast fired!' });
    } catch (err) {
        console.error('Threat Alert Error:', err);
        return res.status(500).json({ success: false, error: err.message });
    }
});

// 📊 Server Logs
app.get('/api/logs', async (req, res) => {
    const attendance = await getAllAttendance();
    const today = new Date().toDateString();
    const todays = attendance.filter(r => r.date === today);
    res.json({
        attendance: attendance.slice(0, 100).map(r => ({ name: r.name, time: r.time, status: r.status })),
        counts: {
            present: todays.filter(r => ['Present', 'Late'].includes(r.status)).length,
            late: todays.filter(r => r.status === 'Late').length
        },
        threats: await countThreatsToday(),
        locked: isSystemLocked
    });
});

// 🏷️ Enrolled face labels / Dynamic Registry
app.get('/api/labels', async (req, res) => {
    try {
        const biometrics = await getAllBiometrics();
        let labels = biometrics.map(b => b.name);

        const dir = path.join(__dirname, 'labels');
        if (fs.existsSync(dir)) {
            const diskLabels = fs.readdirSync(dir).filter(f => fs.statSync(path.join(dir, f)).isDirectory());
            labels = Array.from(new Set([...labels, ...diskLabels]));
        }
        res.json({ labels });
    } catch (err) {
        res.json({ labels: ['Zaeem', 'Safdar', 'Waqas'] });
    }
});

// 📡 System Status Check
app.get('/api/system-status', (req, res) => {
    res.json({
        locked: isSystemLocked,
        announcement: currentAnnouncement
    });
});

// 📥 Excel Export
app.get('/api/export/excel', async (req, res) => {
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

// 🤖 Gemini AI Security Assistant Endpoint
app.post('/api/ask-ai', async (req, res) => {
    try {
        const { question } = req.body || {};
        if (!question) return res.status(400).json({ success: false, error: 'Question required!' });

        const attendance = await getAllAttendance();
        const today = new Date().toDateString();
        const todayRecords = attendance.filter(r => r.date === today);
        const presentCount = todayRecords.filter(r => ['Present', 'Late'].includes(r.status)).length;
        const lateCount = todayRecords.filter(r => r.status === 'Late').length;
        const threatCount = await countThreatsToday();
        const recentNames = todayRecords.slice(0, 10).map(r => `${r.name} (${r.status})`).join(', ');

        const systemContext = `You are NexusScan AI, an intelligent physical security assistant for a university/organization gate system. Current live data:
- System Status: ${isSystemLocked ? 'LOCKED (Emergency Lockdown)' : 'ACTIVE & OPERATIONAL'}
- Present Today: ${presentCount} persons
- Late Arrivals: ${lateCount} persons  
- Security Threats Detected Today: ${threatCount}
- Recent entries: ${recentNames || 'No entries yet'}
- Current Time: ${new Date().toLocaleTimeString()}
- Database: ${mongoReady ? 'MongoDB Connected' : 'Hybrid Memory Mode'}

Answer concisely (2-3 sentences).`;

        if (geminiModel) {
            try {
                const prompt = `${systemContext}\n\nSecurity Officer's Question: "${question}"`;
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
                ? `⚠️ Alert! ${threatCount} security breach attempts detected today at the main gate. All incidents have been logged and WhatsApp alerts dispatched.`
                : `All security parameters are normal. No unauthorized threats detected today.`;
        } else if (q.match(/lock|lockdown|shutdown/)) {
            answer = isSystemLocked
                ? `System is in EMERGENCY LOCKDOWN mode. Send 'UNLOCK' via WhatsApp to resume operations.`
                : `System is fully active. Send 'LOCK' via WhatsApp from an authorized admin number to initiate lockdown.`;
        } else if (q.match(/status|state|running|online/)) {
            answer = `NexusScan AI is fully operational. ${presentCount} present, ${lateCount} late, ${threatCount} threats today. Database: ${mongoReady ? 'MongoDB Active' : 'Memory Mode'}.`;
        } else if (q.match(/visitor|guest|pass|gate pass/)) {
            answer = `Smart Visitor Entry system is active. Visitors register at the gate, hosts approve via WhatsApp, and automatic passes are issued.`;
        } else if (q.match(/hello|hi|hey|good morning|good evening|salaam|salam/)) {
            answer = `Hello! I am NexusScan AI Security Assistant. I can report on attendance, threats, system status, and visitor management. How can I assist you?`;
        } else {
            answer = `Current security status: ${presentCount} present, ${threatCount} threats today. System is ${isSystemLocked ? 'LOCKED' : 'ACTIVE'}.`;
        }

        return res.json({ success: true, answer, source: 'local-ai' });
    } catch (err) {
        console.error('AI Assistant Error:', err);
        return res.status(500).json({ success: false, error: err.message });
    }
});

// ============================================================
// 💬 WhatsApp Admin Command Center
// ============================================================
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
                await msg.reply('⛔ *ACCESS DENIED:* Unauthorized number.');
                return;
            }
        }

        if (upperText.startsWith('ANNOUNCE ')) {
            currentAnnouncement = rawText.substring(9);
            await msg.reply(`📢 *Voice Announcement Triggered:* "${currentAnnouncement}"`);
            setTimeout(() => { currentAnnouncement = ""; }, 6000);
            return;
        }

        if (upperText === 'STATUS') {
            const threats = await countThreatsToday();
            const statusReport = `📊 *NexusScan System Live Status*\n\n` +
                `⚙️ *Security Engine:* ${isSystemLocked ? '🔴 LOCKED' : '🟢 ACTIVE'}\n` +
                `🚨 *Threats Today:* ${threats}\n` +
                `⏰ *Server:* Running on Port ${PORT}\n` +
                `📡 *Database:* ${mongoReady ? 'MongoDB Active' : 'Hybrid Memory Mode'}`;
            await msg.reply(statusReport);
            return;
        }

        if (upperText === 'LOCK') {
            isSystemLocked = true;
            await msg.reply('🔴 *EMERGENCY LOCKDOWN ACTIVATED!* Scanner disabled at Main Gate.');
            return;
        }

        if (upperText === 'UNLOCK') {
            isSystemLocked = false;
            await msg.reply('🟢 *LOCKDOWN RELEASED.* NexusScan normal operations resumed.');
            return;
        }

        if (upperText === '1' || upperText === '2') {
            const hostDigits = String(msg.from).replace(/\D/g, '');
            const pending = await findPendingPassForHost(hostDigits);

            if (!pending) {
                await msg.reply('⚠️ *No pending visitor request found* for this number.');
                return;
            }

            if (upperText === '1') {
                const passCode = 'NX-' + Math.floor(1000 + Math.random() * 9000);
                await updateVisitorPass(pending._id, { status: 'approved', passCode });
                const approvalMsg = `✅ *VISITOR APPROVED!*\n\n` +
                    `👤 *Visitor:* ${pending.visitorName}\n` +
                    `🪪 *Digital Gate Pass Code:* ${passCode}\n` +
                    `📌 Status: Valid for Today (single entry)`;
                await msg.reply(approvalMsg);

                const guardNumber = formatWhatsAppNumber(SECURITY_PHONE);
                const hostNumber = String(msg.from).replace('@c.us', '');
                const guardAlertMsg = `🛂 *GATE ALERT: Visitor Approved*\n\n` +
                    `👤 *Visitor:* ${pending.visitorName}\n` +
                    `🪪 *Pass Code:* ${passCode}\n` +
                    `📱 *Approved By:* ${hostNumber}\n\n` +
                    `Please allow entry.`;

                if (whatsappClient.info && msg.from !== guardNumber) {
                    await whatsappClient.sendMessage(guardNumber, guardAlertMsg);
                }
            } else {
                await updateVisitorPass(pending._id, { status: 'rejected' });
                await msg.reply(`❌ *VISITOR REJECTED!*\n${pending.visitorName} — Entry denied at Main Gate.`);
            }
            return;
        }
    } catch (err) {
        console.error('WhatsApp Command Error:', err);
    }
}

whatsappClient.on('message', handleMessage);
whatsappClient.on('message_create', (msg) => { if (msg.fromMe) handleMessage(msg); });

// ============================================================
// 🚀 Startup
// ============================================================
app.listen(PORT, '127.0.0.1', () => {
    console.log(`🚀 NexusScan AI Backend Engine Running on http://127.0.0.1:${PORT}`);
});

whatsappClient.initialize();
