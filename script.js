let isSystemLocked = false;
const video = document.getElementById('video');
let counts = { present: 0, late: 0, unknown: 0 };
let unknownDetected = false;
let lastAnnouncement = "";
let currentUser = null;
let statsChartInstance = null;
let detecting = false;

// API Base URL
const API_BASE_URL = 'http://127.0.0.1:3000';

// Live Dashboard Clock Loop
setInterval(() => {
    const clockEl = document.getElementById('liveClock');
    if (clockEl) clockEl.innerText = new Date().toLocaleTimeString();
    
    const mgClockEl = document.getElementById('mobileGuardClock');
    if (mgClockEl) mgClockEl.innerText = new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
}, 1000);

// ============================================================
// 🔐 Authentication & Role-Based Access Control (RBAC)
// ============================================================
async function initAuth() {
    const token = sessionStorage.getItem('nexus_token');
    const overlay = document.getElementById('loginOverlay');
    
    if (!token) {
        if (overlay) overlay.classList.remove('hidden');
        return false;
    }

    try {
        const res = await fetch(`${API_BASE_URL}/api/auth/me`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await res.json();
        if (data.success && data.user) {
            currentUser = data.user;
            updateAuthUI(data.user);
            if (overlay) overlay.classList.add('hidden');
            startApp();
            return true;
        } else {
            sessionStorage.removeItem('nexus_token');
            if (overlay) overlay.classList.remove('hidden');
            return false;
        }
    } catch (e) {
        const saved = sessionStorage.getItem('nexus_user');
        if (saved) {
            currentUser = JSON.parse(saved);
            updateAuthUI(currentUser);
            if (overlay) overlay.classList.add('hidden');
            startApp();
            return true;
        }
        if (overlay) overlay.classList.remove('hidden');
        return false;
    }
}

function updateAuthUI(user) {
    const nameEl = document.getElementById('headerUserName');
    const roleEl = document.getElementById('headerUserRole');
    const indicatorEl = document.getElementById('userRoleIndicator');

    if (nameEl) nameEl.textContent = user.name || user.username;
    if (roleEl) {
        roleEl.textContent = user.role.toUpperCase();
        if (user.role === 'admin') roleEl.className = "text-[10px] bg-cyan-950 text-cyan-400 border border-cyan-700 font-bold px-1.5 py-0.5 rounded uppercase font-mono";
        else if (user.role === 'faculty') roleEl.className = "text-[10px] bg-indigo-950 text-indigo-400 border border-indigo-700 font-bold px-1.5 py-0.5 rounded uppercase font-mono";
        else roleEl.className = "text-[10px] bg-emerald-950 text-emerald-400 border border-emerald-700 font-bold px-1.5 py-0.5 rounded uppercase font-mono";
    }
    if (indicatorEl) {
        indicatorEl.className = user.role === 'admin' ? "w-2 h-2 rounded-full bg-cyan-400" : (user.role === 'faculty' ? "w-2 h-2 rounded-full bg-indigo-400" : "w-2 h-2 rounded-full bg-emerald-400");
    }

    applyRolePermissions(user.role);
}

// 🛡️ DYNAMIC ROLE-BASED ACCESS CONTROL (RBAC) UI ENGINE
function applyRolePermissions(role) {
    if (!role) role = 'guard';
    const userRole = role.toLowerCase();

    // Select all role-guarded elements
    const roleElements = document.querySelectorAll('[data-roles]');
    roleElements.forEach(el => {
        const rawRoles = el.getAttribute('data-roles') || '';
        const allowedRoles = rawRoles.split(',').map(r => r.trim().toLowerCase());
        const isAllowed = allowedRoles.includes(userRole);

        const pill = el.querySelector('.role-pill');
        let lockBadge = el.querySelector('.lock-badge');

        if (isAllowed) {
            // ✅ ENABLED: Full interactive state
            el.classList.remove('opacity-25', 'grayscale', 'cursor-not-allowed', 'pointer-events-none');
            el.removeAttribute('disabled');
            el.removeAttribute('title');
            if (el.tagName === 'A') el.style.pointerEvents = 'auto';

            if (pill) pill.classList.remove('hidden');
            if (lockBadge) lockBadge.remove();
        } else {
            // ⛔ DISABLED: Visually locked and non-interactive
            el.classList.add('opacity-25', 'grayscale', 'cursor-not-allowed', 'pointer-events-none');
            el.setAttribute('disabled', 'true');
            el.setAttribute('title', `🔒 Restricted: Requires [${allowedRoles.join('/')}] permissions`);
            if (el.tagName === 'A') el.style.pointerEvents = 'none';

            if (pill) pill.classList.add('hidden');
            if (!lockBadge) {
                lockBadge = document.createElement('span');
                lockBadge.className = 'lock-badge text-[9px] bg-slate-900 border border-slate-700 text-slate-500 px-1 py-0.5 rounded font-mono';
                lockBadge.innerText = '🔒 LOCKED';
                el.appendChild(lockBadge);
            }
        }
    });

    // Faculty Controls Sidebar Section
    const facultySection = document.getElementById('facultySection');
    if (facultySection) {
        if (['faculty', 'admin'].includes(userRole)) {
            facultySection.classList.remove('hidden');
        } else {
            facultySection.classList.add('hidden');
        }
    }

    // Top Header Navigation Tabs
    const navFaculty = document.getElementById('navFacultyView');
    if (navFaculty) {
        if (['faculty', 'admin'].includes(userRole)) {
            navFaculty.classList.remove('hidden');
        } else {
            navFaculty.classList.add('hidden');
        }
    }
}

async function handleLoginSubmit(event) {
    if (event) event.preventDefault();
    const usernameInput = document.getElementById('loginUsername');
    const passwordInput = document.getElementById('loginPassword');
    const errEl = document.getElementById('loginError');

    const username = usernameInput?.value?.trim();
    const password = passwordInput?.value?.trim();

    if (!username || !password) return;

    await performLogin(username, password, errEl);
}

async function quickLogin(username, password) {
    const errEl = document.getElementById('loginError');
    await performLogin(username, password, errEl);
}

async function performLogin(username, password, errEl) {
    if (errEl) errEl.classList.add('hidden');
    try {
        const res = await fetch(`${API_BASE_URL}/api/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });
        const data = await res.json();
        if (data.success && data.token) {
            sessionStorage.setItem('nexus_token', data.token);
            sessionStorage.setItem('nexus_user', JSON.stringify(data.user));
            currentUser = data.user;
            updateAuthUI(data.user);
            
            const overlay = document.getElementById('loginOverlay');
            if (overlay) overlay.classList.add('hidden');
            
            showToast(`Authenticated as ${data.user.name || data.user.username} (${data.user.role.toUpperCase()})`, 'success');
            startApp();
        } else {
            if (errEl) {
                errEl.textContent = data.error || "Authentication failed.";
                errEl.classList.remove('hidden');
            }
        }
    } catch (err) {
        if (errEl) {
            errEl.textContent = "Server unreachable. Make sure 'node server.js' is running.";
            errEl.classList.remove('hidden');
        }
    }
}

function logoutUser() {
    sessionStorage.removeItem('nexus_token');
    sessionStorage.removeItem('nexus_user');
    currentUser = null;
    const overlay = document.getElementById('loginOverlay');
    if (overlay) overlay.classList.remove('hidden');
    showToast("Logged out successfully.", "warning");
}

// ============================================================
// 🚀 Core App Initializer
// ============================================================
async function startApp() {
    await startVideo();
    startSecondaryCamera();

    try {
        const statusEl = document.getElementById('systemStatus');
        if (statusEl) statusEl.innerText = "AI: Loading Local Models...";

        const LOCAL_MODELS = './models';
        const CDN_MODELS = 'https://raw.githubusercontent.com/justadudewhohacks/face-api.js/master/weights';
        const nets = [
            faceapi.nets.tinyFaceDetector,
            faceapi.nets.faceLandmark68Net,
            faceapi.nets.faceRecognitionNet,
            faceapi.nets.ssdMobilenetv1
        ];
        for (const net of nets) {
            try { await net.loadFromUri(LOCAL_MODELS); }
            catch { await net.loadFromUri(CDN_MODELS); }
        }

        if (statusEl) statusEl.innerText = "Server Decision Engine: ACTIVE";
        showToast("Biometric Vector Extractor Active", "success");

        await restoreLogsFromServer();
        initStatsChart();
        detectFaces();
    } catch (err) {
        console.error("AI Models fallback activated:", err);
        const statusEl = document.getElementById('systemStatus');
        if (statusEl) statusEl.innerText = "Engine: Ready (Manual Mode)";
        showToast("Camera Active - Manual Mode Enabled", "warning");
        initStatsChart();
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
    const overlay = document.getElementById('cameraOffline');
    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ video: true });
            if (video) video.srcObject = stream;
            if (overlay) overlay.classList.add('hidden');
        } catch (err) {
            console.error("Camera Error:", err);
            if (overlay) overlay.classList.remove('hidden');
        }
    }
}

function startSecondaryCamera() {
    const secVideo = document.getElementById('secondaryVideo');
    if (!secVideo) return;
    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        navigator.mediaDevices.getUserMedia({ video: true })
            .then(stream => { secVideo.srcObject = stream; })
            .catch(() => {});
    }
}

// ============================================================
// 📸 Server-Side Biometric Enrollment
// ============================================================
async function enrollNewFace() {
    if (!currentUser || currentUser.role !== 'admin') {
        showToast("⛔ Access Denied: Admin role required for Biometric Enrollment.", "error");
        return;
    }

    const name = prompt("Enter full name for new biometric enrollment:");
    if (!name || !name.trim()) return;
    const label = name.trim();

    if (!video || video.paused || video.ended) {
        showToast("Camera not active — cannot enroll!", "error");
        return;
    }

    showToast(`📸 Enrolling ${label} — Look directly at camera...`, "warning");
    const samples = [];
    for (let i = 0; i < 6; i++) {
        try {
            const det = await faceapi
                .detectSingleFace(video, new faceapi.TinyFaceDetectorOptions({ scoreThreshold: 0.25 }))
                .withFaceLandmarks().withFaceDescriptor();
            if (det && det.descriptor) {
                samples.push(Array.from(det.descriptor));
            }
        } catch (e) { }
        await new Promise(r => setTimeout(r, 350));
    }

    if (samples.length < 3) {
        showToast(`❌ Enrollment failed — captured ${samples.length}/6 samples. Adjust lighting and retry.`, "error");
        return;
    }

    const token = sessionStorage.getItem('nexus_token');
    try {
        const res = await fetch(`${API_BASE_URL}/api/biometrics/enroll`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ name: label, descriptors: samples, role: 'Student' })
        });
        const data = await res.json();
        if (data.success) {
            showToast(`✅ ${label} enrolled securely on server (${samples.length} vectors)!`, "success");
            speak(`${label} enrolled successfully on server database`);
        } else {
            showToast(data.error || "Enrollment failed on server.", "error");
        }
    } catch (e) {
        showToast("Network error saving biometric to server.", "error");
    }
}

// 📐 Geometry & Liveness Check (Blink / Eye Aspect Ratio)
function hasValidGeometry(landmarks) {
    if (!landmarks) return false;
    const leftEye = landmarks.getLeftEye();
    const rightEye = landmarks.getRightEye();
    if (!leftEye || !rightEye || !leftEye[0] || !rightEye[3]) return false;
    const eyeDistance = Math.hypot(leftEye[0].x - rightEye[3].x, leftEye[0].y - rightEye[3].y);
    return eyeDistance > 12;
}

const livenessTracks = [];

function pointDist(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y);
}

function eyeAspectRatio(eye) {
    const v1 = pointDist(eye[1], eye[5]);
    const v2 = pointDist(eye[2], eye[4]);
    const h = pointDist(eye[0], eye[3]);
    if (h === 0) return 0.3;
    return (v1 + v2) / (2 * h);
}

function updateLiveness(box, landmarks) {
    if (!landmarks) return false;
    const leftEye = landmarks.getLeftEye();
    const rightEye = landmarks.getRightEye();
    if (!leftEye || !rightEye || leftEye.length < 6 || rightEye.length < 6) return false;

    const ear = (eyeAspectRatio(leftEye) + eyeAspectRatio(rightEye)) / 2;
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    const now = Date.now();

    let track = livenessTracks.find(t => Math.hypot(t.x - cx, t.y - cy) < Math.max(box.width, box.height) * 0.6);
    if (!track) {
        track = {
            id: Math.random().toString(36).slice(2, 7),
            x: cx, y: cy,
            history: [],
            blinkCount: 0,
            inBlink: false,
            verifiedAt: 0
        };
        livenessTracks.push(track);
        if (livenessTracks.length > 8) livenessTracks.shift();
    }

    track.x = cx;
    track.y = cy;
    track.history.push({ t: now, ear });
    track.history = track.history.filter(h => now - h.t < 2500);

    const BLINK_THRESH = 0.22;
    const OPEN_THRESH = 0.27;

    if (ear < BLINK_THRESH && !track.inBlink) {
        track.inBlink = true;
    } else if (ear > OPEN_THRESH && track.inBlink) {
        track.inBlink = false;
        track.blinkCount++;
        track.verifiedAt = now;
    }

    const ears = track.history.map(h => h.ear);
    const earMin = Math.min(...ears);
    const earMax = Math.max(...ears);
    const variance = earMax - earMin;

    return (now - track.verifiedAt < 3000) || (track.blinkCount >= 1 && variance > 0.05);
}

// ============================================================
// 🛡️ SERVER-DRIVEN FACE DETECTION & DECISION LOOP
// ============================================================
function detectFaces() {
    const container = document.getElementById('cameraContainer');
    const existingCanvas = container?.querySelector('canvas');
    if (existingCanvas) existingCanvas.remove();

    const canvas = faceapi.createCanvasFromMedia(video);
    if (container) container.append(canvas);

    const displaySize = { width: video.offsetWidth || 640, height: video.offsetHeight || 480 };
    faceapi.matchDimensions(canvas, displaySize);

    setInterval(async () => {
        if (detecting) return;
        detecting = true;
        try {
            if (video.paused || video.ended || isSystemLocked) {
                detecting = false;
                return;
            }

            const detections = await faceapi.detectAllFaces(video, new faceapi.TinyFaceDetectorOptions({ scoreThreshold: 0.25 }))
                .withFaceLandmarks().withFaceDescriptors();

            const resizedDetections = faceapi.resizeResults(detections, displaySize);
            const ctx = canvas.getContext('2d');
            ctx.clearRect(0, 0, canvas.width, canvas.height);

            const livenessEl = document.getElementById('livenessStatus');

            for (const detection of resizedDetections) {
                const landmarks = detection.landmarks;
                const geometryOk = hasValidGeometry(landmarks);
                const isLive = geometryOk && updateLiveness(detection.detection.box, landmarks);

                // 🟢 Render 68-Point Vector Mesh
                if (landmarks && landmarks.positions) {
                    const meshColor = isLive ? "rgba(57, 255, 20, 0.7)" : "rgba(239, 68, 68, 0.9)";
                    ctx.fillStyle = meshColor;
                    ctx.strokeStyle = meshColor;
                    ctx.lineWidth = 0.8;

                    const positions = landmarks.positions;
                    positions.forEach(point => {
                        ctx.beginPath();
                        ctx.arc(point.x, point.y, 1.5, 0, 2 * Math.PI);
                        ctx.fill();
                    });

                    for (let i = 0; i < positions.length - 1; i++) {
                        if (i % 3 === 0) {
                            ctx.beginPath();
                            ctx.moveTo(positions[i].x, positions[i].y);
                            ctx.lineTo(positions[i + 1].x, positions[i + 1].y);
                            ctx.stroke();
                        }
                    }
                }

                // 🚀 Send vector descriptor to Node.js Server Decision Engine
                let serverDecision = { decision: 'UNAUTHORIZED', label: 'unknown', distance: '1.00', message: 'Scanning...' };
                try {
                    const response = await fetch(`${API_BASE_URL}/api/biometrics/verify`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            descriptor: Array.from(detection.descriptor),
                            isLive: isLive
                        })
                    });
                    serverDecision = await response.json();
                } catch (e) {
                    serverDecision = { decision: 'UNAUTHORIZED', label: 'unknown', distance: '-', message: 'Server Offline' };
                }

                // 🎨 Render UI from Server's Strict Decision
                let boxColor = "#ef4444";
                let statusText = serverDecision.message || `UNAUTHORIZED [${serverDecision.distance}]`;

                if (!geometryOk) {
                    boxColor = "#f59e0b";
                    statusText = "TOO FAR — MOVE CLOSER";
                } else if (serverDecision.decision === 'GRANTED') {
                    boxColor = "#39FF14";
                    statusText = `VERIFIED: ${serverDecision.label.toUpperCase()} [${serverDecision.distance}]`;

                    if (serverDecision.newlyMarked) {
                        counts.present++;
                        if (serverDecision.status === 'Late') counts.late++;
                        updateStatsUI();
                        addTableRow(serverDecision.label, serverDecision.time || new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}), serverDecision.status || 'Present');
                        speak(`Welcome ${serverDecision.label}, entry verified`);
                    }
                } else if (serverDecision.decision === 'SPOOF_BLOCKED') {
                    boxColor = "#f59e0b";
                    statusText = `BLINK TO VERIFY: ${serverDecision.label.toUpperCase()} [${serverDecision.distance}]`;
                } else if (serverDecision.decision === 'LOCKED') {
                    boxColor = "#ef4444";
                    statusText = "🚨 EMERGENCY LOCKDOWN ACTIVE";
                } else {
                    boxColor = "#ef4444";
                    statusText = `UNAUTHORIZED SUSPECT [${serverDecision.distance}]`;
                }

                const box = detection.detection.box;
                ctx.strokeStyle = boxColor;
                ctx.lineWidth = 2;
                ctx.strokeRect(box.x, box.y, box.width, box.height);

                ctx.fillStyle = boxColor;
                ctx.fillRect(box.x, box.y - 22, box.width, 22);

                ctx.fillStyle = "#000000";
                ctx.font = "bold 10px monospace";
                ctx.fillText(statusText, box.x + 4, box.y - 6);

                if (livenessEl) {
                    livenessEl.innerText = isLive ? "ACTIVE — BLINK VERIFIED" : "SCANNING LIVENESS...";
                    livenessEl.className = isLive
                        ? "text-emerald-400 font-bold"
                        : "text-amber-400 font-bold animate-pulse";
                }

                if (serverDecision.decision === 'UNAUTHORIZED' && geometryOk && !unknownDetected) {
                    counts.unknown++;
                    updateStatsUI();
                    unknownDetected = true;

                    const isSpoof = !isLive;
                    const threatMsg = isSpoof
                        ? "SPOOF ATTACK BLOCKED: Photo/Video replay detected (no blink liveness) at Main Gate!"
                        : "Unauthorized Suspect Scanned at Main Gate!";

                    addTableRow(
                        isSpoof ? "Spoof Attempt" : "Unknown Suspect",
                        new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                        "Denied"
                    );
                    triggerThreatUI(threatMsg, captureThreatSnapshot());
                    setTimeout(() => { unknownDetected = false; }, 30000);
                }
            }
        } catch (e) {
            console.error("Inference loop err:", e);
        } finally {
            detecting = false;
        }
    }, 200);
}

// 🔊 Audio Voice Synthesis
function speak(text) {
    if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.rate = 1.0;
        utterance.pitch = 1.0;
        window.speechSynthesis.speak(utterance);
    }
}

// 📊 Chart.js Live Analytics
function initStatsChart() {
    const canvas = document.getElementById('statsChart');
    if (!canvas || typeof Chart === 'undefined') return;

    const ctx = canvas.getContext('2d');
    if (statsChartInstance) statsChartInstance.destroy();

    statsChartInstance = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: ['Present', 'Late', 'Threats'],
            datasets: [{
                data: [counts.present || 0, counts.late || 0, counts.unknown || 0],
                backgroundColor: ['#10b981', '#f59e0b', '#ef4444'],
                borderColor: '#0f172a',
                borderWidth: 2,
                hoverOffset: 4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '72%',
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: { color: '#94a3b8', font: { size: 9, family: 'monospace' }, boxWidth: 10, padding: 6 }
                }
            }
        }
    });
}

function updateStatsChart() {
    if (!statsChartInstance) return;
    statsChartInstance.data.datasets[0].data = [counts.present, counts.late, counts.unknown];
    statsChartInstance.update();
}

function updateStatsUI() {
    const presentEl = document.getElementById('presentStat');
    const lateEl = document.getElementById('lateStat');
    const unknownEl = document.getElementById('unknownStat');

    if (presentEl) presentEl.innerText = counts.present;
    if (lateEl) lateEl.innerText = counts.late;
    if (unknownEl) unknownEl.innerText = counts.unknown;

    const mgPres = document.getElementById('mgPresent');
    const mgLate = document.getElementById('mgLate');
    const mgThreat = document.getElementById('mgThreats');
    if (mgPres) mgPres.innerText = counts.present;
    if (mgLate) mgLate.innerText = counts.late;
    if (mgThreat) mgThreat.innerText = counts.unknown;

    updateStatsChart();
}

function addTableRow(name, time, status) {
    const logContainer = document.getElementById('attendanceBody');
    if (!logContainer) return;

    const row = document.createElement('div');
    row.className = "log-row flex justify-between items-center py-1.5 border-b border-slate-800/50 text-xs";

    const isBad = status === "Late" || status === "Denied" || status === "Leave";
    const pillClass = isBad ? "bg-rose-950/80 text-rose-400 border border-rose-500/20" : "bg-emerald-950/80 text-emerald-400 border border-emerald-500/20";
    const badge = status === "Leave" ? "● Leave" : (isBad ? "● Deny" : "● Pres");

    row.innerHTML = `
        <span class="text-slate-200 font-medium">${name}</span>
        <span class="text-slate-400 text-[11px]">${time}</span>
        <div class="text-right"><span class="text-[10px] px-2 py-0.5 rounded-full ${pillClass}">${badge}</span></div>
    `;
    logContainer.insertBefore(row, logContainer.firstChild);

    // Mobile Feed update
    const mgFeed = document.getElementById('mgFeed');
    if (mgFeed) {
        if (mgFeed.innerHTML.includes('Scanning for activity')) mgFeed.innerHTML = '';
        const mgRow = document.createElement('div');
        mgRow.className = "flex justify-between items-center bg-slate-800/40 p-2 rounded border border-slate-700/50 text-[11px] mb-1.5";
        mgRow.innerHTML = `
            <div class="flex items-center gap-2">
                <div class="w-1.5 h-1.5 rounded-full ${isBad ? 'bg-rose-500' : 'bg-emerald-500'} animate-pulse"></div>
                <span class="${isBad ? 'text-rose-400 font-bold' : 'text-emerald-300'}">${name}</span>
            </div>
            <div class="text-slate-500 text-[9px]">${time}</div>
        `;
        mgFeed.insertBefore(mgRow, mgFeed.firstChild);
    }
}

// 🚨 Threat Handling
function captureThreatSnapshot() {
    if (!video || video.paused || video.ended) return null;
    const c = document.createElement('canvas');
    c.width = video.videoWidth || 640;
    c.height = video.videoHeight || 480;
    const ctx = c.getContext('2d');
    ctx.drawImage(video, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.85);
}

function triggerThreatUI(message, snapshot = null) {
    const banner = document.getElementById('threatBanner');
    const details = document.getElementById('threatDetails');

    if (banner && details) {
        details.innerText = message;
        banner.classList.remove('hidden');
        speak("Security Alert! Unauthorized Person Detected");
        setTimeout(() => banner.classList.add('hidden'), 6000);
    }

    fetch(`${API_BASE_URL}/api/threat-alert`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: message, snapshot })
    }).catch(() => {});
}

function triggerEmergencyAlert() {
    if (!currentUser || !['guard', 'admin'].includes(currentUser.role)) {
        showToast("⛔ Access Denied: Guard or Admin role required for Emergency Alert.", "error");
        return;
    }
    if (confirm("DANGER: Trigger Campus Emergency WhatsApp Red Alert?")) {
        triggerThreatUI("PANIC BUTTON TRIGGERED BY OPERATOR", captureThreatSnapshot());
        showToast("Emergency WhatsApp Broadcast Fired!", "error");
    }
}

async function restoreLogsFromServer() {
    try {
        const res = await fetch(`${API_BASE_URL}/api/logs`);
        const data = await res.json();
        const logContainer = document.getElementById('attendanceBody');
        if (logContainer) logContainer.innerHTML = "";
        
        if (data.attendance) {
            const rows = (data.attendance || []).slice().reverse();
            rows.forEach(r => addTableRow(r.name, r.time, r.status));
        }
        if (data.counts) {
            counts.present = data.counts.present || 0;
            counts.late = data.counts.late || 0;
        }
        counts.unknown = data.threats || 0;
        isSystemLocked = data.locked || false;
        updateStatsUI();
    } catch (e) {}
}

// 🎫 Gate Pass Verification
function openPassModal() {
    if (!currentUser || !['guard', 'admin'].includes(currentUser.role)) {
        showToast("⛔ Access Denied: Guard or Admin role required.", "error");
        return;
    }
    const modal = document.getElementById('passModal');
    const result = document.getElementById('passResult');
    const input = document.getElementById('passCodeInput');
    if (result) result.innerHTML = "";
    if (input) input.value = "";
    if (modal) modal.classList.remove('hidden');
}

function closePassModal() {
    const modal = document.getElementById('passModal');
    if (modal) modal.classList.add('hidden');
}

async function verifyGatePass(event) {
    if (event) event.preventDefault();
    const code = (document.getElementById('passCodeInput')?.value || '').trim().toUpperCase();
    const result = document.getElementById('passResult');
    if (!code) return;

    try {
        const response = await fetch(`${API_BASE_URL}/api/verify-pass`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ passCode: code })
        });
        const data = await response.json();

        if (data.success) {
            if (result) result.innerHTML = `
                <div class="bg-emerald-950/80 border border-emerald-500 text-emerald-300 p-3 rounded text-center">
                    <div class="text-lg font-bold">✅ ENTRY GRANTED</div>
                    <div class="text-xs mt-1">${data.visitor} — ${data.purpose || 'Visitor'}</div>
                </div>`;
            speak("Gate pass verified. Entry granted.");
        } else {
            if (result) result.innerHTML = `
                <div class="bg-rose-950/80 border border-rose-500 text-rose-300 p-3 rounded text-center">
                    <div class="text-lg font-bold">⛔ ENTRY DENIED</div>
                    <div class="text-xs mt-1">${data.error || 'Invalid pass code'}</div>
                </div>`;
            speak("Gate pass rejected.");
        }
    } catch (err) {
        if (result) result.innerHTML = `<div class="bg-rose-950/80 border border-rose-500 text-rose-300 p-3 rounded text-center text-xs">❌ Backend offline</div>`;
    }
}

// 👤 Visitor Request Modal
function openVisitorModal() {
    if (!currentUser || !['guard', 'admin'].includes(currentUser.role)) {
        showToast("⛔ Access Denied: Guard or Admin role required.", "error");
        return;
    }
    const modal = document.getElementById('visitorModal');
    if (modal) modal.classList.remove('hidden');
}

function closeVisitorModal() {
    const modal = document.getElementById('visitorModal');
    if (modal) modal.classList.add('hidden');
}

async function sendVisitorRequest(event) {
    if (event) event.preventDefault();

    const visitorName = (document.getElementById('visName')?.value || '').trim();
    const cnic = (document.getElementById('visCNIC')?.value || '').trim();
    const hostPhone = (document.getElementById('hostPhone')?.value || '').trim();
    const purpose = (document.getElementById('visPurpose')?.value || '').trim();

    if (!visitorName || !cnic || !hostPhone || !purpose) {
        alert('⚠️ Tamam fields fill karein!');
        return;
    }

    try {
        const response = await fetch(`${API_BASE_URL}/api/visitor-request`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ visitorName, cnic, hostPhone, purpose })
        });
        const data = await response.json();

        if (response.ok && data.success) {
            alert('✅ Success! Request Host WhatsApp par dispatch ho gayi.');
            closeVisitorModal();
        } else {
            alert('❌ Error: ' + (data.error || 'Request failed.'));
        }
    } catch (err) {
        alert('❌ Network Alert: Check node server.js running on Port 3000.');
    }
}

// ⌨️ Manual Attendance Modal Handlers
function openManualModal() {
    if (!currentUser || !['guard', 'admin'].includes(currentUser.role)) {
        showToast("⛔ Access Denied: Guard or Admin role required.", "error");
        return;
    }
    const modal = document.getElementById('manualModal');
    const input = document.getElementById('manualPersonName');
    if (input) input.value = "";
    if (modal) modal.classList.remove('hidden');
}

function closeManualModal() {
    const modal = document.getElementById('manualModal');
    if (modal) modal.classList.add('hidden');
}

async function submitManualEntry(event) {
    if (event) event.preventDefault();
    const nameInput = document.getElementById('manualPersonName');
    const statusInput = document.getElementById('manualPersonStatus');
    const studentName = (nameInput?.value || '').trim();
    const statusType = statusInput?.value || 'Present';

    if (!studentName) return;

    const timeString = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    counts.present++;
    if (statusType === 'Late') counts.late++;
    updateStatsUI();
    addTableRow(studentName, timeString, statusType);
    showToast(`${studentName} marked ${statusType} (Manual)`, "success");
    closeManualModal();

    try {
        await fetch(`${API_BASE_URL}/api/attendance`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: studentName, status: statusType, time: timeString })
        });
    } catch (e) {
        console.warn("Could not sync attendance to server:", e);
    }
}

// 🏖️ Mark Leave Modal Handlers
function openLeaveModal() {
    if (!currentUser || currentUser.role !== 'admin') {
        showToast("⛔ Access Denied: Admin role required to Mark Leave.", "error");
        return;
    }
    const modal = document.getElementById('leaveModal');
    const input = document.getElementById('leavePersonName');
    if (input) input.value = "";
    if (modal) modal.classList.remove('hidden');
}

function closeLeaveModal() {
    const modal = document.getElementById('leaveModal');
    if (modal) modal.classList.add('hidden');
}

async function submitLeaveEntry(event) {
    if (event) event.preventDefault();
    const nameInput = document.getElementById('leavePersonName');
    const studentName = (nameInput?.value || '').trim();

    if (!studentName) return;

    const timeString = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    addTableRow(studentName, timeString, "Leave");
    showToast(`${studentName} marked on Leave`, "warning");
    closeLeaveModal();

    try {
        await fetch(`${API_BASE_URL}/api/attendance`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: studentName, status: 'Leave', time: timeString })
        });
    } catch (e) {
        console.warn("Could not sync leave to server:", e);
    }
}

function manualEntry() {
    openManualModal();
}

function markLeaveEntry() {
    openLeaveModal();
}

function clearDatabase() {
    if (!currentUser || currentUser.role !== 'admin') {
        showToast("⛔ Access Denied: Admin role required to Clear Logs.", "error");
        return;
    }
    if (confirm("Are you sure you want to clear session logs?")) {
        const logContainer = document.getElementById('attendanceBody');
        if (logContainer) logContainer.innerHTML = "";
        counts = { present: 0, late: 0, unknown: 0 };
        updateStatsUI();
        showToast("Session logs cleared.", "success");
    }
}

function downloadCSV() {
    window.location.href = `${API_BASE_URL}/api/export/excel`;
}

// 🎓 Faculty View
function accessFacultyView() {
    if (!currentUser || !['faculty', 'admin'].includes(currentUser.role)) {
        showToast("⛔ Access Denied: Faculty or Admin role required.", "error");
        return;
    }
    showToast(`Access Granted: ${currentUser.name} (${currentUser.role.toUpperCase()})`, "success");
    const container = document.getElementById('facultyControlsContainer');
    if (container) container.classList.toggle('hidden');
}

// 🤖 AI Chat Assistant Logic
function openAiPanel() {
    const p = document.getElementById('aiChatPanel');
    if (p) p.classList.remove('hidden');
}

function closeAiPanel() {
    const p = document.getElementById('aiChatPanel');
    if (p) p.classList.add('hidden');
}

async function sendAiMessage() {
    const input = document.getElementById('aiChatInput');
    const question = input?.value?.trim();
    if (!question) return;

    input.value = '';
    appendAiMessage(question, 'user');
    const typingEl = appendTypingIndicator();

    try {
        const response = await fetch(`${API_BASE_URL}/api/ask-ai`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ question })
        });
        const data = await response.json();
        if (typingEl) typingEl.remove();

        if (data.success) {
            appendAiMessage(data.answer, 'ai', data.source);
            speak(data.answer);
        } else {
            appendAiMessage('Error contacting AI engine.', 'ai');
        }
    } catch (err) {
        if (typingEl) typingEl.remove();
        appendAiMessage('Backend server unreachable on port 3000.', 'ai');
    }
}

function appendAiMessage(text, role, source) {
    const container = document.getElementById('aiChatMessages');
    if (!container) return;

    const div = document.createElement('div');
    div.className = "flex gap-2 " + (role === 'user' ? 'justify-end' : 'justify-start');

    if (role === 'user') {
        div.innerHTML = `<div class="bg-indigo-600 text-white rounded-xl rounded-tr-none px-3 py-2 text-slate-100 max-w-[85%]">${text}</div>`;
    } else {
        div.innerHTML = `
            <div class="w-6 h-6 rounded-full bg-indigo-700 flex-shrink-0 flex items-center justify-center text-[10px]">🤖</div>
            <div class="bg-indigo-950/60 border border-indigo-800/40 rounded-xl rounded-tl-none px-3 py-2 text-slate-300 max-w-[85%]">
                ${text}
                <div class="text-[9px] text-slate-500 mt-1 font-mono">${source === 'gemini' ? 'Google Gemini' : 'Local AI'}</div>
            </div>
        `;
    }
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
}

function appendTypingIndicator() {
    const container = document.getElementById('aiChatMessages');
    if (!container) return null;
    const div = document.createElement('div');
    div.className = "flex gap-2 items-center text-slate-500 text-xs italic";
    div.innerHTML = `🤖 Thinking...`;
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
    return div;
}

function startAiVoiceInput() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
        showToast('Speech recognition requires Chrome!', 'error');
        return;
    }
    const recognition = new SpeechRecognition();
    recognition.lang = 'en-US';
    showToast('🎤 Listening... Speak your question', 'warning');
    recognition.start();

    recognition.onresult = (event) => {
        const transcript = event.results[0][0].transcript;
        const input = document.getElementById('aiChatInput');
        if (input) input.value = transcript;
        sendAiMessage();
    };
}

// 📱 Mobile Guard View
function openMobileGuardView() {
    const overlay = document.getElementById('mobileGuardOverlay');
    if (overlay) {
        overlay.classList.remove('hidden');
        const mainVideo = document.getElementById('video');
        const mgVideo = document.getElementById('mgVideo');
        if (mainVideo && mgVideo && mainVideo.srcObject) {
            mgVideo.srcObject = mainVideo.srcObject;
        }
    }
}

function closeMobileGuardView() {
    const overlay = document.getElementById('mobileGuardOverlay');
    if (overlay) overlay.classList.add('hidden');
}

// Search logs listener
if (document.getElementById('logSearch')) {
    document.getElementById('logSearch').addEventListener('keyup', function () {
        let filter = this.value.toUpperCase();
        document.querySelectorAll(".log-row").forEach(row => {
            let name = row.querySelector("span")?.textContent.toUpperCase() || '';
            row.style.display = name.includes(filter) ? "" : "none";
        });
    });
}

// 🔒 Remote Lockdown & WhatsApp Announcement Polling
setInterval(async () => {
    try {
        const response = await fetch(`${API_BASE_URL}/api/system-status`);
        const data = await response.json();

        const videoOverlay = document.getElementById('video');
        const statusEl = document.getElementById('systemStatus');

        isSystemLocked = data.locked;

        if (isSystemLocked) {
            if (videoOverlay) videoOverlay.style.filter = "grayscale(100%) brightness(20%)";
            if (statusEl) statusEl.innerText = "🚨 LOCKDOWN MODE (Remote Override)";
        } else {
            if (videoOverlay) videoOverlay.style.filter = "none";
            if (statusEl && statusEl.innerText.includes("LOCKDOWN")) statusEl.innerText = "Server Decision Engine: ACTIVE";
        }

        if (data.announcement && data.announcement !== lastAnnouncement) {
            lastAnnouncement = data.announcement;
            speak(`Attention please. ${data.announcement}`);
            showToast(`📢 Broadcast: ${data.announcement}`, "warning");
        }
        if (!data.announcement) lastAnnouncement = "";
    } catch (e) { }
}, 1500);

// Kickoff
if (typeof lucide !== 'undefined') lucide.createIcons();
initAuth();
