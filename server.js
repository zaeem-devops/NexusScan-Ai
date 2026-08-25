const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const XLSX = require('xlsx');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

// 🗄️ 1. MongoDB Database Connection
const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/nexusScanAI';

mongoose.connect(MONGO_URI)
  .then(() => console.log('✅ MongoDB Connected Successfully!'))
  .catch(err => console.error('❌ MongoDB Connection Error:', err));

// Database Schemas
const attendanceSchema = new mongoose.Schema({
  name: String,
  status: String,
  time: { type: Date, default: Date.now },
  fine: { type: Number, default: 0 }
});

const visitorSchema = new mongoose.Schema({
  name: String,
  cnic: String,
  hostPhone: String,
  purpose: String,
  status: { type: String, default: 'PENDING' },
  checkIn: { type: Date, default: Date.now }
});

const Attendance = mongoose.model('Attendance', attendanceSchema);
const Visitor = mongoose.model('Visitor', visitorSchema);

// 🤖 2. WhatsApp Web Client Setup
const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-extensions',
            '--disable-dev-shm-usage',
            '--use-gl=desktop'
        ],
    }
});

client.on('qr', (qr) => {
    console.log('⚠️ SCAN THIS QR CODE WITH UNIVERSITY WHATSAPP PHONE:');
    qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
    console.log('✅ NexusScan AI WhatsApp Engine is READY and Authenticated!');
});

// Helper Function for Phone Formatting
async function sendWhatsAppMsg(rawNumber, messageText) {
    try {
        let formattedNumber = rawNumber.replace(/[^0-9]/g, '');
        if (!formattedNumber.startsWith('92')) {
            if (formattedNumber.startsWith('0')) {
                formattedNumber = '92' + formattedNumber.substring(1);
            } else {
                formattedNumber = '92' + formattedNumber;
            }
        }
        const numberDetails = await client.getNumberId(formattedNumber);
        if (numberDetails) {
            await client.sendMessage(numberDetails._serialized, messageText);
            return true;
        }
        return false;
    } catch (e) {
        console.error("WhatsApp Send Failed:", e);
        return false;
    }
}

// 💬 Interactive Host Approval Listener (Replies check karne ke liye)
client.on('message', async (msg) => {
    const text = msg.body.trim().toLowerCase();
    
    if (text === '1' || text === 'yes') {
        const pendingVisitor = await Visitor.findOneAndUpdate(
            { status: 'PENDING' },
            { status: 'APPROVED' },
            { sort: { checkIn: -1 } }
        );
        if (pendingVisitor) {
            await msg.reply(`✅ Entry APPROVED for Visitor: *${pendingVisitor.name}*`);
            console.log(`[Visitor System] ${pendingVisitor.name} Approved by Host.`);
        }
    } else if (text === '2' || text === 'no') {
        const pendingVisitor = await Visitor.findOneAndUpdate(
            { status: 'PENDING' },
            { status: 'REJECTED' },
            { sort: { checkIn: -1 } }
        );
        if (pendingVisitor) {
            await msg.reply(`❌ Entry REJECTED for Visitor: *${pendingVisitor.name}*`);
            console.log(`[Visitor System] ${pendingVisitor.name} Rejected by Host.`);
        }
    }
});

client.initialize();

// Student Fallback Database Map
const studentDatabase = {
    "Zaeem": { parentPhone: "923236404459" }, 
    "anas": { parentPhone: "923356925491" },
    "Waqas": { parentPhone: "923040821476" }
};

// 📌 API Route 1: Mark Attendance & Save to DB
app.post('/api/attendance', async (req, res) => {
    const { name, status } = req.body;
    
    try {
        const lateFine = status === "Late" ? 200 : 0; // Rs 200 Late Fine
        const newRecord = new Attendance({ name, status, fine: lateFine });
        await newRecord.save();

        const student = studentDatabase[name];
        if (student) {
            let msgBody = "";
            if (status === "Late") { 
                msgBody = ` Alert: Dear Parent, *${name}* is LATE today! Fine of Rs.200 applied.`;
            } else if (status === "Leave") {
                msgBody = ` Notice: Dear Parent, *${name}* is marked on LEAVE today.`;
            }
            if (msgBody !== "") {
                await sendWhatsAppMsg(student.parentPhone, msgBody);
            }
        }

        return res.json({ success: true, message: "Attendance Saved & Processed" });
    } catch (err) {
        console.error("Attendance API Error:", err);
        return res.status(500).json({ success: false, error: err.message });
    }
});

// 📌 API Route 2: Smart Visitor Request (Host Alert)
app.post('/api/visitor/request', async (req, res) => {
    const { name, cnic, hostPhone, purpose } = req.body;

    try {
        const visitor = new Visitor({ name, cnic, hostPhone, purpose });
        await visitor.save();

        const hostMsg = `🚨 *NexusScan Visitor Approval Request*\n\n` +
                        `👤 *Visitor:* ${name}\n` +
                        `🪪 *CNIC:* ${cnic}\n` +
                        `🎯 *Purpose:* ${purpose}\n\n` +
                        `Reply *1* or *YES* to Approve Entry.\n` +
                        `Reply *2* or *NO* to Deny Entry.`;

        const sent = await sendWhatsAppMsg(hostPhone, hostMsg);
        
        if (sent) {
            return res.json({ success: true, message: "WhatsApp Alert Dispatched to Host" });
        } else {
            return res.status(400).json({ success: false, message: "Host Number Not Registered" });
        }
    } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
    }
});

// 📌 API Route 3: Emergency Red Alert Broadcast
app.post('/api/threat-alert', async (req, res) => {
    const { reason } = req.body;
    
    // Security Heads Numbers List
    const securityHeads = ["923236404459"]; 
    const alertMsg = `⚠️ *SECURITY THREAT EMERGENCY ALERT*\n\n` +
                     `*Details:* ${reason || 'Unauthorized Security Breach'}\n` +
                     `*Location:* Main Gate Scanner\n` +
                     `*Action Required:* Immediate Intervention!`;

    for (let phone of securityHeads) {
        await sendWhatsAppMsg(phone, alertMsg);
    }

    return res.json({ success: true, message: "Red Alert Broadcast Fired!" });
});

// 📌 API Route 4: Excel (.xlsx) Report Generator
app.get('/api/export/excel', async (req, res) => {
    try {
        const logs = await Attendance.find().lean();
        
        const formattedData = logs.map(item => ({
            "Student Name": item.name,
            "Status": item.status,
            "Date & Time": new Date(item.time).toLocaleString(),
            "Late Fine (PKR)": item.fine
        }));

        const worksheet = XLSX.utils.json_to_sheet(formattedData);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, "Attendance Report");

        const filePath = `./Attendance_Report.xlsx`;
        XLSX.writeFile(workbook, filePath);

        res.download(filePath);
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

const PORT = 3000;
app.listen(PORT, () => console.log(`🚀 NexusScan AI Backend Engine Running on Port ${PORT}`));
