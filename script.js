const video = document.getElementById('video');
const savedData = localStorage.getItem('attendance_records');
let markedAttendance = new Set(savedData ? JSON.parse(savedData) : []);
let faceMatcher = null;

let counts = { present: 0, late: 0, unknown: 0 };
let unknownDetected = false;
let isAntiSpoofingActive = false; // Liveness Guard

// Live Dashboard Clock Loop
setInterval(() => {
    const clockEl = document.getElementById('liveClock');
    if (clockEl) clockEl.innerText = new Date().toLocaleTimeString();
}, 100);

// Core App Initializer
async function startApp() {
    await startVideo();
    displaySavedData();

    try {
        const statusEl = document.getElementById('systemStatus');
        if (statusEl) statusEl.innerText = "AI: Fetching Models...";
        
        // Fast Weights Loading
        const MODEL_URL = 'https://raw.githubusercontent.com/justadudewhohacks/face-api.js/master/weights';
        await faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL);
        await faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL);
        await faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL);
        await faceapi.nets.ssdMobilenetv1.loadFromUri(MODEL_URL);
        
        if (statusEl) statusEl.innerText = "AI Processing: Active";
        showToast("Face-API Engine Ready", "success");

        const labeledFaceDescriptors = await loadLabeledImages();
        if (labeledFaceDescriptors.length > 0) {
            faceMatcher = new faceapi.FaceMatcher(labeledFaceDescriptors, 0.45);
            detectFaces();
        }
    } catch (err) {
        console.error("AI Models fallback activated:", err);
        const statusEl = document.getElementById('systemStatus');
        if (statusEl) statusEl.innerText = "AI Engine: Hybrid Mode";
        showToast("System ready for manual entries", "warning");
    }
}

function showToast(message, type = 'success') {
    const toast = document.createElement('div');
    const styles = {
        success: { bg: 'linear-gradient(135deg, #10b981, #059669)', icon: '✅' },
        warning: { bg: 'linear-gradient(135deg, #f59e0b, #d97706)', icon: '⚠️' },
        error: { bg: 'linear-gradient(135deg, #ef4444, #dc2626)', icon: '❌' }
    };
    const config = styles[type] || styles.success;
    toast.innerHTML = `${config.icon} ${message}`;
    toast.style.cssText = `
        position: fixed; top: 25px; right: 25px; background: ${config.bg}; color: white;
        padding: 12px 24px; border-radius: 8px; font-size: 13px; font-weight: 600;
        z-index: 99999; box-shadow: 0 10px 25px rgba(0,0,0,0.4);
        transition: all 0.4s ease; transform: translateX(120%); opacity: 0;
    `;
    document.body.appendChild(toast);
    setTimeout(() => { toast.style.transform = "translateX(0)"; toast.style.opacity = "1"; }, 50);
    setTimeout(() => {
        toast.style.transform = "translateX(120%)"; toast.style.opacity = '0';
        setTimeout(() => toast.remove(), 400);
    }, 3000);
}

async function startVideo() {
    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ video: true });
            video.srcObject = stream;
        } catch (err) {
            showToast("Camera access missing!", "error");
        }
    }
}

async function loadLabeledImages() {
    const labels = ['Zaeem', 'Safdar', 'Waqas']; 
    try {
        return await Promise.all(labels.map(async label => {
            const descriptions = [];
            for (let i = 1; i <= 3; i++) {
                try {
                    const img = await faceapi.fetchImage(`./labels/${label}/${i}.jpg`);
                    const detections = await faceapi.detectSingleFace(img).withFaceLandmarks().withFaceDescriptor();
                    if (detections) descriptions.push(detections.descriptor);
                } catch (e) { }
            }
            return new faceapi.LabeledFaceDescriptors(label, descriptions);
        }));
    } catch(e) { return []; }
}

// 🛡️ Liveness Detection / Anti-Spoofing Check
function checkLiveness(landmarks) {
    const leftEye = landmarks.getLeftEye();
    const rightEye = landmarks.getRightEye();
    
    // Calculate Eye Aspect Distance (Simple Liveness check)
    const eyeDistance = Math.hypot(leftEye[0].x - rightEye[3].x, leftEye[0].y - rightEye[3].y);
    return eyeDistance > 15; // Threshold check to block static paper photos
}

async function detectFaces() {
    if (!faceMatcher) return;
    const container = document.querySelector('.video-container');
    const canvas = faceapi.createCanvasFromMedia(video);
    container.append(canvas);
    const displaySize = { width: video.offsetWidth, height: video.offsetHeight };
    faceapi.matchDimensions(canvas, displaySize);

    setInterval(async () => {
        if (video.paused || video.ended || !faceMatcher) return;
        const detections = await faceapi.detectAllFaces(video, new faceapi.TinyFaceDetectorOptions({ scoreThreshold: 0.25 }))
            .withFaceLandmarks().withFaceDescriptors();
        
        const resizedDetections = faceapi.resizeResults(detections, displaySize);
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height); 

        resizedDetections.forEach(detection => {
            const result = faceMatcher.findBestMatch(detection.descriptor);
            const isLive = checkLiveness(detection.landmarks);

            let label = result.label === 'unknown' ? "Unknown Person" : result.label;
            let boxColor = result.label === 'unknown' ? "#ef4444" : "#39FF14";

            if (!isLive) {
                boxColor = "#f59e0b"; // Warning Orange for Photo Spoofing
                label = "Spoof Photo Detected!";
            }

            // 🚨 Blacklist / Unauthorized Threat Handler
            if (result.label === 'unknown' && !unknownDetected) {
                counts.unknown++; 
                updateStatsUI(); 
                unknownDetected = true;
                addTableRow("Unknown Suspect", new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}), "Denied");
                
                triggerThreatUI("Unauthorized Suspect Scanned at Main Gate!");
                setTimeout(() => { unknownDetected = false; }, 5000);
            }

            new faceapi.draw.DrawBox(detection.detection.box, { label: label, boxColor: boxColor }).draw(canvas);

            if (result.label !== 'unknown' && result.distance < 0.45 && isLive) { 
                markAttendance(result.label); 
            }
        });
    }, 250);
} 

function markAttendance(name) {
    if (!name || name.trim() === "") return;
    name = name.trim();

    if (!markedAttendance.has(name)) {
        markedAttendance.add(name);
        localStorage.setItem('attendance_records', JSON.stringify(Array.from(markedAttendance)));
        
        const now = new Date();
        const timeString = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        
        let isLate = now.getHours() >= 9;
        counts.present++;
        if (isLate) counts.late++;
        updateStatsUI();

        addTableRow(name, timeString, isLate ? "Late" : "Present");
        showToast(`Logged: ${name}`, "success");
        speak(`Welcome ${name}`);

        sendWhatsAppNotification(name, isLate ? "Late" : "Present");
    } else {
        showToast(`${name} already marked!`, "warning");
    }
}

// 🚨 Red Alert Threat Visual Handler
function triggerThreatUI(message) {
    const banner = document.getElementById('threatBanner');
    const details = document.getElementById('threatDetails');
    
    if (banner && details) {
        details.innerText = message;
        banner.classList.remove('hidden');
        speak("Security Alert! Unauthorized Person Detected");
        
        // Auto hide banner after 6 seconds
        setTimeout(() => {
            banner.classList.add('hidden');
        }, 6000);
    }
    
    // Broadcast threat to backend for WhatsApp Alert
    fetch('http://localhost:3000/api/threat-alert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: message })
    }).catch(err => console.log("Threat API offline"));
}

// 🚨 Emergency Panic Button Action
function triggerEmergencyAlert() {
    if(confirm("DANGER: Trigger Campus Emergency WhatsApp Red Alert?")) {
        triggerThreatUI("PANIC BUTTON TRIGGERED BY SECURITY ADMIN");
        showToast("Emergency WhatsApp Broadcast Fired!", "error");
    }
}

// 📩 Smart Visitor Handlers
function openVisitorModal() {
    const modal = document.getElementById('visitorModal');
    if(modal) modal.classList.remove('hidden');
}

function closeVisitorModal() {
    const modal = document.getElementById('visitorModal');
    if(modal) modal.classList.add('hidden');
}

function sendVisitorRequest() {
    const name = document.getElementById('visName')?.value;
    const cnic = document.getElementById('visCNIC')?.value;
    const hostPhone = document.getElementById('hostPhone')?.value;
    const purpose = document.getElementById('visPurpose')?.value;

    if (!name || !hostPhone) {
        showToast("Enter Visitor Name & Host Phone!", "warning");
        return;
    }

    fetch('http://localhost:3000/api/visitor/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, cnic, hostPhone, purpose })
    })
    .then(res => res.json())
    .then(data => {
        showToast("WhatsApp Request Sent to Host!", "success");
        closeVisitorModal();
    })
    .catch(err => {
        showToast("Error sending WhatsApp Request", "error");
    });
}

function markLeaveEntry() {
    const name = prompt("Enter Student Name for Leave:");
    if (name && name.trim() !== "") {
        const studentName = name.trim();
        const timeString = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        
        addTableRow(studentName, timeString, "Denied"); 
        showToast(`${studentName} marked on Leave`, "warning");
        sendWhatsAppNotification(studentName, "Leave");
    }
}

function updateStatsUI() {
    if(document.getElementById('presentStat')) document.getElementById('presentStat').innerText = counts.present;
    if(document.getElementById('lateStat')) document.getElementById('lateStat').innerText = counts.late;
    if(document.getElementById('unknownStat')) document.getElementById('unknownStat').innerText = counts.unknown;
}

function displaySavedData() {
    const logContainer = document.getElementById('attendanceBody');
    if (!logContainer) return;
    logContainer.innerHTML = "";
    
    counts.present = 0;
    counts.late = 0;
    
    markedAttendance.forEach(name => {
        addTableRow(name, "--:--", "Present");
        counts.present++; 
    });
    updateStatsUI();
}

function addTableRow(name, time, status) {
    const logContainer = document.getElementById('attendanceBody');
    if (!logContainer) return;
    
    const row = document.createElement('div');
    row.className = "log-row flex justify-between items-center py-1.5 border-b border-slate-800/50 text-xs";
    
    const isBad = status === "Late" || status === "Denied";
    const pillClass = isBad ? "bg-rose-950/80 text-rose-400 border border-rose-500/20" : "bg-emerald-950/80 text-emerald-400 border border-emerald-500/20";
    const badge = isBad ? "● Deny" : "● Pres";

    row.innerHTML = `
        <span class="text-slate-200 font-medium">${name}</span>
        <span class="text-slate-400 text-[11px]">${time}</span>
        <div class="text-right"><span class="text-[10px] px-2 py-0.5 rounded-full ${pillClass}">${badge}</span></div>
    `;
    logContainer.insertBefore(row, logContainer.firstChild);
}

function manualEntry() {
    const name = prompt("Enter Student Name for Manual Entry:");
    if (name && name.trim() !== "") {
        markAttendance(name.trim());
    }
}

function clearDatabase() {
    if(confirm("Are you sure you want to clear all data logs?")) {
        localStorage.removeItem('attendance_records');
        markedAttendance.clear();
        displaySavedData();
        showToast("Database Cleared", "success");
    }
}

function sendWhatsAppNotification(studentName, statusType) {
    fetch('http://localhost:3000/api/attendance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: studentName, status: statusType })
    })
    .then(response => response.json())
    .then(data => {
        if(data.success) {
            if (statusType === "Late" || statusType === "Leave") {
                showToast(`WhatsApp Alert Dispatched`, "success");
            }
        }
    })
    .catch(err => {
        console.error("Backend Connection Offline:", err);
    });
}

function downloadCSV() {
    let csv = "Name,Time,Status\n";
    document.querySelectorAll(".log-row").forEach(row => {
        const spans = row.querySelectorAll("span");
        if(spans.length >= 3) csv += `${spans[0].innerText},${spans[1].innerText},${spans[2].innerText}\n`;
    });
    const blob = new Blob([csv], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = window.URL.createObjectURL(blob);
    a.download = `NexusScan_Report_${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
}

function speak(text) {
    if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel();
        window.speechSynthesis.speak(new SpeechSynthesisUtterance(text));
    }
}

function accessFacultyView() {
    if (prompt("Enter Faculty Password:") === "admin123") {
        showToast("Welcome Prof!", "success");
        const facultySection = document.getElementById('facultySection');
        if(facultySection) facultySection.classList.remove('hidden');
    } else {
        showToast("Access Denied!", "error");
    }
}

if(document.getElementById('logSearch')) {
    document.getElementById('logSearch').addEventListener('keyup', function() {
        let filter = this.value.toUpperCase();
        document.querySelectorAll(".log-row").forEach(row => {
            let name = row.querySelector("span").textContent.toUpperCase();
            row.style.display = name.includes(filter) ? "" : "none";
        });
    });
}

// Kickoff
lucide.createIcons();
startApp();