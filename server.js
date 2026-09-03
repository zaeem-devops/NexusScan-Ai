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

const Attendance = mongoose.model('Attendance', AttendanceSchema);
const VisitorPass = mongoose.model('VisitorPass', VisitorPassSchema);
const Threat = mongoose.model('Threat', ThreatSchema);

const memoryStore = { attendance: [], passes: [], threats: [] };
let mongoReady = false;

const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/nexusScanAI';

mongoose.connect(MONGO_URI)
    .then(() => { mongoReady = true; console.log('✅ MongoDB Connected Successfully!'); })
    .catch(() => console.log('⚠️ Local MongoDB not detected! Running server in Hybrid Memory Mode.'));

async function saveAttendance(record) {
    if (mongoReady) { await Attendance.create(record); return; }
    record.date = record.date || new Date().toDateString();
    memoryStore.attendance.push({ ...record, createdAt: new Date() });
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
    if (mongoReady) {
        return VisitorPass.findOne({ hostPhone, status: 'pending' }).sort({ createdAt: -1 });
    }
    return [...memoryStore.passes].reverse()
        .find(p => p.hostPhone === hostPhone && p.status === 'pending');
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
    const today = new Date().toDateString();
    if (mongoReady) {
        return Threat.countDocuments({ createdAt: { $gte: new Date(new Date().setHours(0, 0, 0, 0)) } });
    }
    return memoryStore.threats.filter(t => new Date(t.createdAt).toDateString() === today).length;
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
    let cleaned = String(phone).replace(/\D/g, '');
    if (cleaned.startsWith('03')) {
        cleaned = '92' + cleaned.substring(1);
    }
    return cleaned.endsWith('@c.us') ? cleaned : `${cleaned}@c.us`;
}

function isAdminChat(chatId) {
    const digits = String(chatId).replace(/\D/g, '');
    const ownId = whatsappClient.info && whatsappClient.info.wid
        ? String(whatsappClient.info.wid._serialized).replace(/\D/g, '')
        : '';
    if (ownId && digits.startsWith(ownId)) return true;
    if (!ADMIN_WHITELIST.length) return true; // demo mode — set ADMIN_WHITELIST in .env for real security
    return ADMIN_WHITELIST.some(admin => digits.startsWith(admin));
}


app.post('/api/auth', async (req, res) => {
    const { username, password } = req.body || {};
    const normalizedUsername = String(username || '').trim().toLowerCase();
    if (!normalizedUsername || !password) {
        return res.status(400).json({ success: false, error: 'Username and password required!' });
    }

    const user = USERS[normalizedUsername];
    if (!user) {
        return res.status(401).json({ success: false, error: 'Invalid username!' });
    }

    const isValid = await bcrypt.compare(password, user.passwordHash);
    if (!isValid) {
        return res.status(401).json({ success: false, error: 'Incorrect password!' });
    }

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

app.post('/api/verify-pass', authenticateToken, authorizeRoles('admin', 'faculty', 'guard'), async (req, res) => {
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

        const alreadyMarked = ['Present', 'Late'].includes(status) && await findAttendanceToday(name);
        await saveAttendance({
            name,
            status,
            time: time || new Date().toLocaleTimeString()
        });

        if (alreadyMarked) {
            return res.json({ success: true, message: 'Already marked today — log synced, WhatsApp skipped.' });
        }

        const recipientPhone = formatWhatsAppNumber(phone || SECURITY_PHONE);
        const statusMsg = `📋 *NexusScan Attendance Alert*\n\n` +
            `👤 *Name:* ${name}\n` +
            `📌 *Status:* ${String(status).toUpperCase()}\n` +
            `⏰ *Time:* ${new Date().toLocaleTimeString()}`;

        if (whatsappClient.info) {
            await whatsappClient.sendMessage(recipientPhone, statusMsg);
        }
        console.log(`📩 Notification sent for ${name} (${status}) to ${recipientPhone}`);
        return res.json({ success: true, message: 'Notification sent successfully!' });
    } catch (err) {
        console.error('Attendance API Error:', err);
        return res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/api/threat-alert', authenticateToken, authorizeRoles('admin', 'guard'), async (req, res) => {
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
        console.log('🚨 Threat Alert Dispatched!');
        return res.json({ success: true, message: 'Threat alert broadcast fired!' });
    } catch (err) {
        console.error('Threat Alert Error:', err);
        return res.status(500).json({ success: false, error: err.message });
    }
});

app.get('/api/logs', authenticateToken, authorizeRoles('admin', 'faculty', 'guard'), async (req, res) => {
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
        const { question, context } = req.body || {};
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

Answer the security officer's question concisely (2-3 sentences max). Be professional and direct. If asked about locking/unlocking, explain the WhatsApp command system.`;

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
                ? `⚠️ Alert! ${threatCount} security breach attempts detected today at the main gate. All incidents have been logged and WhatsApp alerts dispatched to security personnel.`
                : `All security parameters are normal. No unauthorized threats detected at the main gate today. AI anti-spoofing and blink liveness detection are active.`;
        } else if (q.match(/lock|lockdown|shutdown/)) {
            answer = isSystemLocked
                ? `System is currently in EMERGENCY LOCKDOWN mode. All face scanning is disabled. Send 'UNLOCK' via WhatsApp to the security number to resume operations.`
                : `System is fully active. To initiate lockdown, send 'LOCK' command via WhatsApp from an authorized admin number.`;
        } else if (q.match(/status|state|running|online/)) {
            answer = `NexusScan AI is fully operational. ${presentCount} present, ${lateCount} late, ${threatCount} threats today. Database: ${mongoReady ? 'MongoDB Active' : 'Memory Mode'}. All systems nominal.`;
        } else if (q.match(/visitor|guest|pass|gate pass/)) {
            answer = `The Smart Visitor Entry system is active. Visitors submit their details at the gate, the host receives a WhatsApp approval request, and upon approval receives a NX-XXXX gate pass code for one-time entry verification.`;
        } else if (q.match(/hello|hi|hey|good morning|good evening|salaam|salam/)) {
            answer = `Hello! I am NexusScan AI Security Assistant. I can report on attendance (${presentCount} present), threats (${threatCount} today), system status, and visitor management. How can I assist you?`;
        } else if (q.match(/who|which person|name/)) {
            answer = recentNames
                ? `Recent entries today: ${recentNames}.`
                : `No entries recorded yet today. The face recognition system is scanning at the main gate.`;
        } else {
            answer = `I heard: "${question}". I can assist with: attendance counts, late arrivals, security threats, system status, visitor management, and gate pass verification. Current status: ${presentCount} present, ${threatCount} threats today.`;
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

                if (whatsappClient.info && msg.from !== guardNumber) {
                    await whatsappClient.sendMessage(guardNumber, guardAlertMsg);
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

app.listen(PORT, '127.0.0.1', () => {
    console.log(`🚀 NexusScan AI Backend Engine Running on http://127.0.0.1:${PORT}`);
});

process.on('uncaughtException', error => {
    if (error.message.includes('browser is already running for')) {
        console.warn(`⚠️ WhatsApp service unavailable: ${error.message}`);
        console.warn('Authentication and dashboard APIs remain available.');
        return;
    }
    console.error('Fatal server error:', error);
    process.exitCode = 1;
});

whatsappClient.initialize().catch(error => {
    console.warn(`⚠️ WhatsApp service unavailable: ${error.message}`);
    console.warn('Authentication and dashboard APIs remain available.');
});
