let isSystemLocked = false;
const video = document.getElementById('video');
let cameraStream = null;
const savedData = localStorage.getItem('attendance_records');
let markedAttendance = new Set(savedData ? JSON.parse(savedData) : []);
let faceMatcher = null;

let counts = { present: 0, late: 0, unknown: 0 };
let unknownDetected = false;
let lastAnnouncement = "";
let registeredDescriptors = [];
let currentUserRole = null; // 'admin' | 'faculty' | 'guard'

const API_BASE_URL = (typeof window !== 'undefined' && window.location && window.location.protocol.startsWith('http'))
    ? window.location.origin
    : 'http://127.0.0.1:3000';
function apiRequest(url, options = {}) {
    const headers = new Headers(options.headers || {});
    const token = sessionStorage.getItem('nx_token');
    if (token) headers.set('Authorization', `Bearer ${token}`);
    return fetch(url, { ...options, headers });
}

async function loginUser(event) {
    if (event) event.preventDefault();

    const username = (document.getElementById('loginUsername')?.value || '').trim();
    const password = (document.getElementById('loginPassword')?.value || '').trim();
    const errorEl = document.getElementById('loginError');
    const btnText = document.getElementById('loginBtnText');
    const btnLoader = document.getElementById('loginBtnLoader');

    if (!username || !password) return;

    if (btnText) btnText.classList.add('hidden');
    if (btnLoader) btnLoader.classList.remove('hidden');
    if (errorEl) errorEl.classList.add('hidden');

    try {
        const res = await fetch(`${API_BASE_URL}/api/auth`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });
        const data = await res.json();

        if (data.success) {
            sessionStorage.setItem('nx_token', data.token);
            sessionStorage.setItem('nx_role', data.role);
            sessionStorage.setItem('nx_user', data.username);

            showDashboard(data.role);
        } else {
            showLoginError(data.error || 'Access Denied!');
        }
    } catch (err) {
        showLoginError('Backend offline — make sure node server.js is running on port 3000!');
    } finally {
        if (btnText) btnText.classList.remove('hidden');
        if (btnLoader) btnLoader.classList.add('hidden');
    }
}

function togglePasswordVisibility() {
    const passwordInput = document.getElementById('loginPassword');
    const toggleButton = document.getElementById('togglePasswordButton');
    if (!passwordInput || !toggleButton) return;

    const isVisible = passwordInput.type === 'text';
    passwordInput.type = isVisible ? 'password' : 'text';
    toggleButton.setAttribute('aria-label', isVisible ? 'Show password' : 'Hide password');
    toggleButton.setAttribute('title', isVisible ? 'Show password' : 'Hide password');
    toggleButton.innerHTML = `<i data-lucide="${isVisible ? 'eye' : 'eye-off'}" class="w-4 h-4"></i>`;
    if (typeof lucide !== 'undefined') lucide.createIcons();
}

function showLoginError(message) {
    const errorEl = document.getElementById('loginError');
    if (errorEl) {
        errorEl.textContent = '⛔ ' + message;
        errorEl.classList.remove('hidden');
        errorEl.style.animation = 'none';
        errorEl.offsetHeight; // trigger reflow
        errorEl.style.animation = 'shake 0.4s ease';
    }
}

function showDashboard(role) {
    currentUserRole = role;

    const loginOverlay = document.getElementById('loginOverlay');
    if (loginOverlay) loginOverlay.classList.add('hidden');

    applyRoleView(role);
    updateAiAssistantAccess(role);

    startApp();
}

function handleGuardHeaderAction() {
    if (currentUserRole === 'guard') {
        logoutUser();
    } else {
        closeMobileGuardView();
    }
}

function updateAiAssistantAccess(role) {
    const titleEl = document.getElementById('aiChatTitle');
    const badgeEl = document.getElementById('aiSourceBadge');
    const welcomeTextEl = document.getElementById('aiWelcomeText');
    const chipsContainer = document.getElementById('aiSuggestedChips');

    const roleConfig = {
        guard: {
            title: '💂 GUARD AI ASSISTANT',
            badge: 'Gate Operations AI • Active',
            welcome: 'Hello Guard! I am NexusScan AI Assistant for Gate Operations. You can query gate attendance, today\'s security threats, gate pass verification, and gate vitality.',
            chips: [
                'How many present?',
                'Any threats today?',
                'System status?',
                'Verify visitor pass',
                'What are my features?'
            ]
        },
        faculty: {
            title: '🎓 FACULTY AI ASSISTANT',
            badge: 'Academic Logs AI • Active',
            welcome: 'Hello Faculty Member! I am NexusScan AI Assistant. You can query student attendance counts, late arrivals, and attendance log summaries.',
            chips: [
                'How many present today?',
                'Late arrivals count?',
                'Attendance summary',
                'System status?',
                'What are my features?'
            ]
        },
        admin: {
            title: '🛡️ NEXUSSCAN MASTER AI',
            badge: 'Full Security Engine • Active',
            welcome: 'Hello Administrator! I am NexusScan AI Security Assistant. You have full access to query attendance, threats, system vitality, lockdown status, and audit logs.',
            chips: [
                'System vitality status',
                'Any threats today?',
                'How many present?',
                'Lockdown status?',
                'What are all features?'
            ]
        }
    };

    const cfg = roleConfig[role] || roleConfig.admin;
    if (titleEl) titleEl.textContent = cfg.title;
    if (badgeEl) badgeEl.textContent = cfg.badge;
    if (welcomeTextEl) welcomeTextEl.textContent = cfg.welcome;

    if (chipsContainer) {
        chipsContainer.innerHTML = '';
        cfg.chips.forEach(chipText => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'text-[10px] bg-indigo-900/60 hover:bg-indigo-800 text-indigo-200 border border-indigo-700/60 rounded-full px-2.5 py-1 transition text-left cursor-pointer';
            btn.textContent = chipText;
            btn.onclick = () => {
                const input = document.getElementById('aiChatInput');
                if (input) {
                    input.value = chipText;
                    sendAiMessage();
                }
            };
            chipsContainer.appendChild(btn);
        });
    }
}

function applyRoleView(role) {
    const badge = document.getElementById('roleBadge');
    if (badge) {
        badge.classList.remove('hidden');
        const roleConfig = {
            admin: { text: '🛡️ ADMIN', border: 'border-[#38bdf8]', bg: 'bg-[#38bdf8]/10', color: 'text-[#38bdf8]' },
            faculty: { text: '🎓 FACULTY', border: 'border-violet-500', bg: 'bg-violet-500/10', color: 'text-violet-400' },
            guard: { text: '💂 GUARD', border: 'border-emerald-500', bg: 'bg-emerald-500/10', color: 'text-emerald-400' }
        };
        const cfg = roleConfig[role] || roleConfig.admin;
        badge.textContent = cfg.text;
        badge.className = `text-[10px] font-bold tracking-widest px-2.5 py-1 rounded-full border ${cfg.border} ${cfg.bg} ${cfg.color}`;
    }

    // 100% RBAC on all elements with data-role
    document.querySelectorAll('[data-role]').forEach(el => {
        const allowedRoles = el.getAttribute('data-role').split(',').map(r => r.trim());
        if (allowedRoles.includes(role)) {
            el.classList.remove('hidden');
            el.style.display = '';
        } else {
            el.classList.add('hidden');
            el.style.display = 'none';
        }
    });

    const dashboard = document.getElementById('mainDashboard');
    const guardOverlay = document.getElementById('mobileGuardOverlay');
    const guardBtn = document.getElementById('guardHeaderActionBtn');

    if (role === 'guard') {
        // Guard ONLY has Guard Console
        if (dashboard) dashboard.classList.add('hidden');
        if (guardOverlay) guardOverlay.classList.remove('hidden');

        if (guardBtn) {
            guardBtn.setAttribute('title', 'Logout');
            guardBtn.setAttribute('aria-label', 'Logout');
            guardBtn.className = 'guard-close-button bg-rose-950/60 border border-rose-500/50 hover:bg-rose-900/80 text-rose-400';
            guardBtn.innerHTML = '<i data-lucide="log-out" class="w-4 h-4"></i>';
        }

        const mgVideo = document.getElementById('mgVideo');
        attachCameraStream(mgVideo);
    } else {
        // Faculty & Admin use Desktop Dashboard
        if (dashboard) dashboard.classList.remove('hidden');
        if (guardOverlay) guardOverlay.classList.add('hidden');

        if (guardBtn) {
            guardBtn.setAttribute('title', 'Return to Admin Console');
            guardBtn.setAttribute('aria-label', 'Close Guard View');
            guardBtn.className = 'guard-close-button bg-slate-800 border border-slate-600 hover:bg-slate-700 text-slate-200';
            guardBtn.innerHTML = '<i data-lucide="x" class="w-4 h-4"></i>';
        }
    }

    if (typeof lucide !== 'undefined') lucide.createIcons();
}

async function logoutUser() {
    if (!await showAppDialog({ title: 'END SESSION', message: 'Logout from NexusScan AI?', confirmLabel: 'LOG OUT', cancelLabel: 'CANCEL', danger: true })) return;

    sessionStorage.removeItem('nx_token');
    sessionStorage.removeItem('nx_role');
    sessionStorage.removeItem('nx_user');
    currentUserRole = null;

    const loginOverlay = document.getElementById('loginOverlay');
    const dashboard = document.getElementById('mainDashboard');
    const guardOverlay = document.getElementById('mobileGuardOverlay');
    if (loginOverlay) loginOverlay.classList.remove('hidden');
    if (dashboard) dashboard.classList.add('hidden');
    if (guardOverlay) guardOverlay.classList.add('hidden');

    closeAiPanel();

    const usernameEl = document.getElementById('loginUsername');
    const passwordEl = document.getElementById('loginPassword');
    const errorEl = document.getElementById('loginError');
    if (usernameEl) usernameEl.value = '';
    if (passwordEl) passwordEl.value = '';
    if (errorEl) errorEl.classList.add('hidden');
}

async function checkExistingSession() {
    const token = sessionStorage.getItem('nx_token');
    if (!token) return false;
    try {
        const response = await apiRequest(`${API_BASE_URL}/api/auth/me`);
        if (!response.ok) throw new Error('Session expired');
        const data = await response.json();
        sessionStorage.setItem('nx_role', data.role);
        sessionStorage.setItem('nx_user', data.username);
        showDashboard(data.role);
        return true;
    } catch (error) {
        sessionStorage.removeItem('nx_token');
        sessionStorage.removeItem('nx_role');
        sessionStorage.removeItem('nx_user');
        return false;
    }
}


setInterval(() => {
    const clockEl = document.getElementById('liveClock');
    if (clockEl) clockEl.innerText = new Date().toLocaleTimeString();

    const mgClockEl = document.getElementById('mobileGuardClock');
    if (mgClockEl) mgClockEl.innerText = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}, 1000);

async function startApp() {
    await startVideo();
    startSecondaryCamera();

    try {
        const statusEl = document.getElementById('systemStatus');
        if (statusEl) statusEl.innerText = "AI: Loading Models...";

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

        if (statusEl) statusEl.innerText = "AI Processing: Active";
        showToast("Face-API Engine Ready (Local Models)", "success");

        await restoreLogsFromServer();

        baseDescriptors = await loadLabeledImages();
        await rebuildFaceMatcher();
        showToast(
            baseDescriptors.length
                ? `Face Registry Loaded: ${baseDescriptors.length} persons`
                : "Face Registry Empty — use 'Enroll New Face' to add people",
            baseDescriptors.length ? "success" : "warning"
        );
        detectFaces();
        initStatsChart();
    } catch (err) {
        console.error("AI Models fallback activated:", err);
        const statusEl = document.getElementById('systemStatus');
        if (statusEl) statusEl.innerText = "AI Engine: Ready (Manual Mode)";
        showToast("Camera Active - Manual Fallback Enabled", "warning");
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

let activeDialogResolver = null;
let activeDialogHasInput = false;

function showAppDialog({ title = 'SYSTEM MESSAGE', message = '', inputLabel = '', placeholder = '', confirmLabel = 'OK', cancelLabel = '', danger = false }) {
    return new Promise(resolve => {
        const modal = document.getElementById('appDialog');
        const panel = document.getElementById('appDialogPanel');
        const titleEl = document.getElementById('appDialogTitle');
        const messageEl = document.getElementById('appDialogMessage');
        const form = document.getElementById('appDialogForm');
        const label = document.getElementById('appDialogInputLabel');
        const input = document.getElementById('appDialogInput');
        const cancel = document.getElementById('appDialogCancel');
        const confirm = document.getElementById('appDialogConfirm');
        const icon = document.getElementById('appDialogIcon');
        if (!modal || !panel || !titleEl || !messageEl || !form || !input || !cancel || !confirm) return resolve(false);

        activeDialogResolver = resolve;
        activeDialogHasInput = Boolean(inputLabel);
        titleEl.textContent = title;
        messageEl.textContent = message;
        form.classList.toggle('hidden', !activeDialogHasInput);
        label.textContent = inputLabel || 'VALUE';
        input.value = '';
        input.placeholder = placeholder;
        cancel.textContent = cancelLabel || 'CANCEL';
        cancel.classList.toggle('hidden', !cancelLabel);
        confirm.textContent = confirmLabel;
        panel.classList.toggle('is-danger', danger);
        icon.innerHTML = `<i data-lucide="${danger ? 'triangle-alert' : activeDialogHasInput ? 'user-plus' : 'info'}" class="w-4 h-4"></i>`;
        modal.classList.remove('hidden');
        if (typeof lucide !== 'undefined') lucide.createIcons();
        setTimeout(() => (activeDialogHasInput ? input : confirm).focus(), 0);
    });
}

function submitAppDialog(event) {
    if (event) event.preventDefault();
    if (!activeDialogResolver) return;
    const result = activeDialogHasInput ? (document.getElementById('appDialogInput')?.value || '').trim() : true;
    closeAppDialog(result);
}

function closeAppDialog(result = false) {
    const modal = document.getElementById('appDialog');
    if (modal) modal.classList.add('hidden');
    const resolver = activeDialogResolver;
    activeDialogResolver = null;
    activeDialogHasInput = false;
    if (resolver) resolver(result);
}

document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && activeDialogResolver) closeAppDialog(false);
});

async function startVideo() {
    const overlay = document.getElementById('cameraOffline');
    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        try {
            cameraStream = await navigator.mediaDevices.getUserMedia({ video: true });
            attachCameraStream(video);
            attachCameraStream(document.getElementById('mgVideo'));
            if (overlay) overlay.classList.add('hidden');
        } catch (err) {
            console.error("Camera access failed:", err);
            if (overlay) overlay.classList.remove('hidden');
            showToast("Camera access missing!", "error");
        }
    } else {
        if (overlay) overlay.classList.remove('hidden');
    }
}

function attachCameraStream(target) {
    if (!target || !cameraStream) return;
    if (target.srcObject !== cameraStream) target.srcObject = cameraStream;
    const playPromise = target.play();
    if (playPromise) playPromise.catch(() => { });
}

async function startSecondaryCamera() {
    try {
        if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return;
        const devices = await navigator.mediaDevices.enumerateDevices();
        const cams = devices.filter(d => d.kind === 'videoinput');
        if (cams.length < 2) return;

        const stream = await navigator.mediaDevices.getUserMedia({
            video: { deviceId: { exact: cams[1].deviceId } }
        });
        const cam2 = document.getElementById('video2');
        const pip = document.getElementById('cam2Pip');
        if (cam2 && pip) {
            cam2.srcObject = stream;
            pip.classList.remove('hidden');
        }
    } catch (e) {
        console.warn('Secondary camera unavailable:', e);
    }
}

async function loadLabeledImages() {
    let labels = [];
    try {
        const res = await apiRequest(`${API_BASE_URL}/api/labels`);
        const data = await res.json();
        labels = data.labels || [];
    } catch (e) {
        labels = ['Zaeem', 'Safdar', 'Waqas']; // offline fallback
    }

    try {
        const descriptors = await Promise.all(labels.map(async label => {
            const descriptions = [];
            for (let i = 1; i <= 6; i++) {
                try {
                    const img = await faceapi.fetchImage(`./labels/${encodeURIComponent(label)}/${i}.jpg`);
                    const detections = await faceapi.detectSingleFace(img).withFaceLandmarks().withFaceDescriptor();
                    if (detections) descriptions.push(detections.descriptor);
                } catch (e) { }
            }
            return descriptions.length
                ? new faceapi.LabeledFaceDescriptors(label, descriptions)
                : null;
        }));
        return descriptors.filter(Boolean);
    } catch (e) { return []; }
}

let baseDescriptors = [];

function loadCustomFaces() {
    try {
        const raw = JSON.parse(localStorage.getItem('custom_faces') || '{}');
        return Object.entries(raw)
            .filter(([, arrs]) => Array.isArray(arrs) && arrs.length)
            .map(([label, arrs]) => new faceapi.LabeledFaceDescriptors(
                label, arrs.map(a => new Float32Array(a))
            ));
    } catch (e) { return []; }
}

async function rebuildFaceMatcher() {
    const all = [...baseDescriptors, ...loadCustomFaces()];
    faceMatcher = all.length ? new faceapi.FaceMatcher(all, 0.5) : null;
    registeredDescriptors = all;
}

async function enrollNewFace() {
    if (currentUserRole !== 'admin') {
        showToast('Only administrators can enroll faces.', 'error');
        return;
    }
    const name = await showAppDialog({ title: 'ENROLL NEW FACE', message: 'Enter the person\'s name to create a biometric profile.', inputLabel: 'PERSON NAME', placeholder: 'e.g. Aoun', confirmLabel: 'CONTINUE', cancelLabel: 'CANCEL' });
    if (!name || !name.trim()) return;
    const label = name.trim();

    if (!video || video.paused || video.ended) {
        showToast("Camera not active — cannot enroll!", "error");
        return;
    }

    showToast(`📸 Enrolling ${label} — face the camera steadily...`, "warning");
    const samples = [];
    for (let i = 0; i < 6; i++) {
        try {
            const det = await faceapi
                .detectSingleFace(video, new faceapi.TinyFaceDetectorOptions({ scoreThreshold: 0.25 }))
                .withFaceLandmarks().withFaceDescriptor();
            if (det) samples.push(Array.from(det.descriptor));
        } catch (e) { }
        await new Promise(r => setTimeout(r, 350));
    }

    if (samples.length < 3) {
        showToast(`❌ Enrollment failed — only ${samples.length}/6 captures. Improve lighting & position, try again.`, "error");
        return;
    }

    try {
        const store = JSON.parse(localStorage.getItem('custom_faces') || '{}');
        store[label] = samples;
        localStorage.setItem('custom_faces', JSON.stringify(store));
    } catch (e) {
        showToast("Storage error during enrollment!", "error");
        return;
    }

    await rebuildFaceMatcher();
    showToast(`✅ ${label} enrolled with ${samples.length} biometric samples!`, "success");
    speak(`${label} enrolled successfully`);
}

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

function earStdDev(history) {
    if (history.length < 8) return 0;
    const mean = history.reduce((a, b) => a + b, 0) / history.length;
    const variance = history.reduce((a, b) => a + (b - mean) ** 2, 0) / history.length;
    return Math.sqrt(variance);
}

function getLivenessTrack(cx, cy) {
    const now = Date.now();
    for (let i = livenessTracks.length - 1; i >= 0; i--) {
        if (now - livenessTracks[i].lastSeen > 3000) livenessTracks.splice(i, 1);
    }
    let best = null, bestDist = 90;
    for (const t of livenessTracks) {
        const d = Math.hypot(t.cx - cx, t.cy - cy);
        if (d < bestDist) { best = t; bestDist = d; }
    }
    if (!best) {
        best = { cx, cy, closed: false, lastBlink: 0, firstSeen: now, lastSeen: now, earHistory: [] };
        livenessTracks.push(best);
    }
    return best;
}

function updateLiveness(box, landmarks) {
    const now = Date.now();
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    const track = getLivenessTrack(cx, cy);

    track.cx = track.cx * 0.5 + cx * 0.5;
    track.cy = track.cy * 0.5 + cy * 0.5;
    track.lastSeen = now;

    const left = landmarks.getLeftEye();
    const right = landmarks.getRightEye();
    const ear = (eyeAspectRatio(left) + eyeAspectRatio(right)) / 2;

    track.earHistory.push(ear);
    if (track.earHistory.length > 24) track.earHistory.shift();

    if (ear < 0.22) {
        track.closed = true;
    } else if (ear > 0.26 && track.closed) {
        track.closed = false;
        track.lastBlink = now; // blink completed → proof of life
    }

    const blinkLive = track.lastBlink > 0 && (now - track.lastBlink) < 6000;
    const motionLive = (now - track.firstSeen) > 6000 && earStdDev(track.earHistory) > 0.012;

    return blinkLive || motionLive;
}

function captureThreatSnapshot() {
    try {
        if (!video || !video.videoWidth) return null;
        const c = document.createElement('canvas');
        const w = 480;
        const scale = w / video.videoWidth;
        c.width = w;
        c.height = Math.round(video.videoHeight * scale);
        c.getContext('2d').drawImage(video, 0, 0, c.width, c.height);
        return c.toDataURL('image/jpeg', 0.7);
    } catch (e) { return null; }
}

let detecting = false;
async function detectFaces() {
    if (!video) return;
    const container = document.querySelector('.video-container');

    const existingCanvas = container ? container.querySelector('canvas') : null;
    if (existingCanvas) existingCanvas.remove();

    const canvas = faceapi.createCanvasFromMedia(video);
    if (container) container.append(canvas);

    const displaySize = { width: video.offsetWidth || 640, height: video.offsetHeight || 480 };
    faceapi.matchDimensions(canvas, displaySize);

    setInterval(async () => {
        if (detecting) return; // prevent overlapping inference passes
        detecting = true;
        try {
            if (video.paused || video.ended || isSystemLocked) return;

            const detections = await faceapi.detectAllFaces(video, new faceapi.TinyFaceDetectorOptions({ scoreThreshold: 0.25 }))
                .withFaceLandmarks().withFaceDescriptors();

            const resizedDetections = faceapi.resizeResults(detections, displaySize);
            const ctx = canvas.getContext('2d');
            ctx.clearRect(0, 0, canvas.width, canvas.height);

            const livenessEl = document.getElementById('livenessStatus');

            resizedDetections.forEach(detection => {
                const result = faceMatcher
                    ? faceMatcher.findBestMatch(detection.descriptor)
                    : { label: 'unknown', distance: 1 };
                const landmarks = detection.landmarks;
                const geometryOk = hasValidGeometry(landmarks);
                const isLive = geometryOk && updateLiveness(detection.detection.box, landmarks);
                const isKnown = result.label !== 'unknown' && result.distance < 0.5;

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

                const dist = typeof result.distance === 'number' ? result.distance.toFixed(2) : '-';
                let boxColor, statusText;
                if (!geometryOk) {
                    boxColor = "#f59e0b";
                    statusText = "TOO FAR — MOVE CLOSER";
                } else if (isKnown && isLive) {
                    boxColor = "#39FF14";
                    statusText = `VERIFIED: ${result.label.toUpperCase()} [${dist}]`;
                } else if (isKnown && !isLive) {
                    boxColor = "#f59e0b";
                    statusText = `BLINK TO VERIFY: ${result.label.toUpperCase()} [${dist}]`;
                } else if (isLive) {
                    boxColor = "#ef4444";
                    statusText = `UNAUTHORIZED SUSPECT [${dist}]`;
                } else {
                    boxColor = "#ef4444";
                    statusText = `🚨 SPOOF BLOCKED [${dist}]`;
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

                if (result.label === 'unknown' && geometryOk && !unknownDetected) {
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

                if (isKnown && isLive) {
                    markAttendance(result.label);
                }
            });
        } catch (e) {
            console.error("Detection Frame Error:", e);
        } finally {
            detecting = false;
        }
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
    }
}

function triggerThreatUI(message, snapshot = null) {
    const banner = document.getElementById('threatBanner');
    const details = document.getElementById('threatDetails');

    if (banner && details) {
        details.innerText = message;
        banner.classList.remove('hidden');
        speak("Security Alert! Unauthorized Person Detected");

        setTimeout(() => {
            banner.classList.add('hidden');
        }, 30000);
    }

    apiRequest(`${API_BASE_URL}/api/threat-alert`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: message, snapshot })
    }).catch(err => console.log("Threat API offline"));
}

async function triggerEmergencyAlert() {
    if (!['admin', 'guard'].includes(currentUserRole)) {
        showToast('This action is not available for your role.', 'error');
        return;
    }
    if (await showAppDialog({ title: 'EMERGENCY RED ALERT', message: 'Trigger the campus emergency WhatsApp broadcast now?', confirmLabel: 'TRIGGER ALERT', cancelLabel: 'CANCEL', danger: true })) {
        triggerThreatUI("PANIC BUTTON TRIGGERED BY SECURITY ADMIN", captureThreatSnapshot());
        showToast("Emergency WhatsApp Broadcast Fired!", "error");
    }
}

function openPassModal() {
    if (!['admin', 'guard'].includes(currentUserRole)) {
        showToast('Gate pass verification is restricted to Guards and Administrators.', 'error');
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
    if (!['admin', 'guard'].includes(currentUserRole)) {
        showToast('Access Denied: Only Guards and Administrators can verify gate passes.', 'error');
        return;
    }
    const code = (document.getElementById('passCodeInput')?.value || '').trim().toUpperCase();
    const result = document.getElementById('passResult');
    if (!code) return;

    try {
        const response = await apiRequest(`${API_BASE_URL}/api/verify-pass`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ passCode: code })
        });
        const data = await response.json();

        if (data.success) {
            if (result) result.innerHTML = `
                <div class="bg-emerald-950/80 border border-emerald-500 text-emerald-300 p-3 rounded text-center">
                    <div class="text-lg font-bold">✅ ENTRY GRANTED</div>
                    <div class="text-xs mt-1">${data.visitor} — ${data.purpose}</div>
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
        if (result) result.innerHTML = `
            <div class="bg-rose-950/80 border border-rose-500 text-rose-300 p-3 rounded text-center text-xs">
                ❌ Backend offline — verify server is running on port 3000.
            </div>`;
    }
}

function openVisitorModal() {
    if (!['admin', 'guard'].includes(currentUserRole)) {
        showToast('Visitor management is restricted to Gate Operators.', 'error');
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
        await showAppDialog({ title: 'MISSING INFORMATION', message: 'Please complete all visitor fields before dispatching the request.', confirmLabel: 'OK' });
        return;
    }

    try {
        const response = await apiRequest(`${API_BASE_URL}/api/visitor-request`, {
            method: 'POST',
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ visitorName, cnic, hostPhone, purpose })
        });

        const data = await response.json();

        if (response.ok && data.success) {
            await showAppDialog({ title: 'REQUEST DISPATCHED', message: 'The visitor request was sent to the host on WhatsApp.', confirmLabel: 'DONE' });
            closeVisitorModal();
        } else {
            await showAppDialog({ title: 'BACKEND ERROR', message: data.error || 'The visitor request could not be sent.', confirmLabel: 'CLOSE', danger: true });
        }
    } catch (err) {
        console.error('API Handshake Error:', err);
        await showAppDialog({ title: 'NETWORK ALERT', message: 'The server is unavailable. Check that node server.js is running on port 3000.', confirmLabel: 'CLOSE', danger: true });
    }
}

async function markLeaveEntry() {
    if (currentUserRole !== 'admin') {
        showToast('Only administrators can record leave entries.', 'error');
        return;
    }
    const name = await showAppDialog({ title: 'MARK LEAVE', message: 'Enter the student name to record a leave entry.', inputLabel: 'STUDENT NAME', placeholder: 'e.g. Maryam', confirmLabel: 'MARK LEAVE', cancelLabel: 'CANCEL' });
    if (name && name.trim() !== "") {
        const studentName = name.trim();
        const timeString = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

        addTableRow(studentName, timeString, "Leave");
        showToast(`${studentName} marked on Leave`, "warning");
        sendWhatsAppNotification(studentName, "Leave");
    }
}

function updateStatsUI() {
    if (document.getElementById('presentStat')) document.getElementById('presentStat').innerText = counts.present;
    if (document.getElementById('lateStat')) document.getElementById('lateStat').innerText = counts.late;
    if (document.getElementById('unknownStat')) document.getElementById('unknownStat').innerText = counts.unknown;

    if (document.getElementById('mgPresent')) document.getElementById('mgPresent').innerText = counts.present;
    if (document.getElementById('mgLate')) document.getElementById('mgLate').innerText = counts.late;
    if (document.getElementById('mgThreats')) document.getElementById('mgThreats').innerText = counts.unknown;

    updateStatsChart();
}

async function restoreLogsFromServer() {
    const logContainer = document.getElementById('attendanceBody');
    try {
        const res = await apiRequest(`${API_BASE_URL}/api/logs`);
        const data = await res.json();

        if (logContainer) logContainer.innerHTML = "";
        const rows = (data.attendance || []).slice().reverse(); // oldest first, insertBefore flips order
        rows.forEach(r => addTableRow(r.name, r.time, r.status));

        counts.present = data.counts?.present || 0;
        counts.late = data.counts?.late || 0;
        counts.unknown = data.threats || 0;
        updateStatsUI();

        markedAttendance = new Set();
        (data.attendance || [])
            .filter(r => ['Present', 'Late'].includes(r.status))
            .forEach(r => markedAttendance.add(r.name));
        localStorage.setItem('attendance_records', JSON.stringify(Array.from(markedAttendance)));
    } catch (e) {
        displaySavedData();
    }
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

    const isBad = status === "Late" || status === "Denied" || status === "Leave";
    const pillClass = isBad ? "bg-rose-950/80 text-rose-400 border border-rose-500/20" : "bg-emerald-950/80 text-emerald-400 border border-emerald-500/20";
    const badge = status === "Leave" ? "● Leave" : (isBad ? "● Deny" : "● Pres");

    row.innerHTML = `
        <span class="text-slate-200 font-medium">${name}</span>
        <span class="text-slate-400 text-[11px]">${time}</span>
        <div class="text-right"><span class="text-[10px] px-2 py-0.5 rounded-full ${pillClass}">${badge}</span></div>
    `;
    logContainer.insertBefore(row, logContainer.firstChild);

    const mgFeed = document.getElementById('mgFeed');
    if (mgFeed) {
        if (mgFeed.innerHTML.includes('Scanning for activity')) {
            mgFeed.innerHTML = '';
        }
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

async function manualEntry() {
    if (currentUserRole !== 'admin') {
        showToast('Only administrators can manually mark attendance.', 'error');
        return;
    }
    const name = await showAppDialog({ title: 'MANUAL ATTENDANCE', message: 'Enter the student name for a manual attendance record.', inputLabel: 'STUDENT NAME', placeholder: 'e.g. Safdar', confirmLabel: 'MARK PRESENT', cancelLabel: 'CANCEL' });
    if (name && name.trim() !== "") {
        markAttendance(name.trim());
    }
}

async function clearDatabase() {
    if (currentUserRole !== 'admin') {
        showToast('Only administrators can clear logs.', 'error');
        return;
    }
    if (await showAppDialog({ title: 'CLEAR SESSION LOGS', message: 'Are you sure you want to clear local session logs? This cannot be undone.', confirmLabel: 'CLEAR LOGS', cancelLabel: 'CANCEL', danger: true })) {
        localStorage.removeItem('attendance_records');
        markedAttendance.clear();
        displaySavedData();
        showToast("Local Session Cleared", "success");
    }
}

function sendWhatsAppNotification(studentName, statusType) {
    apiRequest(`${API_BASE_URL}/api/attendance`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            name: studentName,
            status: statusType
        })
    })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                showToast(`WhatsApp ${statusType} Alert Sent!`, "success");
            }
        })
        .catch(err => {
            console.error("Backend Connection Offline:", err);
        });
}

async function exportLogs() {
    if (!['admin', 'faculty'].includes(currentUserRole)) {
        showToast('Log export is not available for your role.', 'error');
        return;
    }

    try {
        const response = await apiRequest(`${API_BASE_URL}/api/export/excel`);
        if (!response.ok) throw new Error('Export request failed');
        const blob = await response.blob();
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `NexusScan_Report_${new Date().toISOString().slice(0, 10)}.xlsx`;
        link.click();
        URL.revokeObjectURL(link.href);
    } catch (error) {
        showToast('Unable to export logs. Please try again.', 'error');
    }
}

function downloadCSV() {
    let csv = "Name,Time,Status\n";
    document.querySelectorAll(".log-row").forEach(row => {
        const spans = row.querySelectorAll("span");
        if (spans.length >= 3) csv += `${spans[0].innerText},${spans[1].innerText},${spans[2].innerText}\n`;
    });
    const blob = new Blob([csv], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = window.URL.createObjectURL(blob);
    a.download = `NexusScan_Report_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
}

function speak(text) {
    if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel();
        window.speechSynthesis.speak(new SpeechSynthesisUtterance(text));
    }
}

async function accessFacultyView() {
    showToast('Use the login system to access Faculty View!', 'warning');
}

if (document.getElementById('logSearch')) {
    document.getElementById('logSearch').addEventListener('keyup', function () {
        let filter = this.value.toUpperCase();
        document.querySelectorAll(".log-row").forEach(row => {
            let name = row.querySelector("span").textContent.toUpperCase();
            row.style.display = name.includes(filter) ? "" : "none";
        });
    });
}

setInterval(async () => {
    try {
        const response = await apiRequest(`${API_BASE_URL}/api/system-status`);
        const data = await response.json();

        const videoOverlay = document.getElementById('video');
        const statusEl = document.getElementById('systemStatus');

        isSystemLocked = data.locked;

        if (isSystemLocked) {
            if (videoOverlay) videoOverlay.style.filter = "grayscale(100%) brightness(20%)";
            if (statusEl) statusEl.innerText = "🚨 LOCKDOWN MODE (Remote Override)";
        } else {
            if (videoOverlay) videoOverlay.style.filter = "none";
            if (statusEl && statusEl.innerText.includes("LOCKDOWN")) statusEl.innerText = "AI Processing: Active";
        }

        if (data.announcement && data.announcement !== lastAnnouncement) {
            lastAnnouncement = data.announcement;
            speak(`Attention please. ${data.announcement}`);
            showToast(`📢 Broadcast: ${data.announcement}`, "warning");
        }
        if (!data.announcement) lastAnnouncement = "";
    } catch (e) { }
}, 1500);

let statsChartInstance = null;

function initStatsChart() {
    const canvas = document.getElementById('statsChart');
    if (!canvas || typeof Chart === 'undefined') return;

    Chart.defaults.color = '#94a3b8';
    statsChartInstance = new Chart(canvas, {
        type: 'doughnut',
        data: {
            labels: ['Present', 'Late', 'Threats'],
            datasets: [{
                data: [0, 0, 0],
                backgroundColor: [
                    'rgba(52, 211, 153, 0.85)',
                    'rgba(251, 191, 36, 0.85)',
                    'rgba(239, 68, 68, 0.85)'
                ],
                borderColor: [
                    'rgba(52, 211, 153, 1)',
                    'rgba(251, 191, 36, 1)',
                    'rgba(239, 68, 68, 1)'
                ],
                borderWidth: 1.5,
                hoverOffset: 6
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '68%',
            animation: { duration: 600, easing: 'easeInOutQuart' },
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: {
                        font: { size: 9, family: 'Poppins' },
                        color: '#94a3b8',
                        padding: 8,
                        boxWidth: 10
                    }
                },
                tooltip: {
                    callbacks: {
                        label: ctx => ` ${ctx.label}: ${ctx.raw}`
                    }
                }
            }
        }
    });
}

function updateStatsChart() {
    if (!statsChartInstance) return;
    const present = counts.present - counts.late; // pure present (not late)
    const late = counts.late;
    const threats = counts.unknown;
    const total = present + late + threats;
    statsChartInstance.data.datasets[0].data = total > 0
        ? [present, late, threats]
        : [1, 0, 0]; // show empty state gracefully
    statsChartInstance.data.labels = total > 0
        ? ['Present', 'Late', 'Threats']
        : ['No Data Yet'];
    if (total === 0) {
        statsChartInstance.data.datasets[0].backgroundColor = ['rgba(30,41,59,0.8)'];
        statsChartInstance.data.datasets[0].borderColor = ['rgba(51,65,85,1)'];
    } else {
        statsChartInstance.data.datasets[0].backgroundColor = [
            'rgba(52, 211, 153, 0.85)',
            'rgba(251, 191, 36, 0.85)',
            'rgba(239, 68, 68, 0.85)'
        ];
        statsChartInstance.data.datasets[0].borderColor = [
            'rgba(52, 211, 153, 1)',
            'rgba(251, 191, 36, 1)',
            'rgba(239, 68, 68, 1)'
        ];
    }
    statsChartInstance.update();
}

function openAiPanel(event) {
    if (event) {
        event.preventDefault();
        event.stopPropagation();
    }

    updateAiAssistantAccess(currentUserRole || 'guard');

    const panel = document.getElementById('aiChatPanel');
    if (panel) {
        panel.classList.remove('hidden');
        setTimeout(() => document.getElementById('aiChatInput')?.focus(), 100);
        if (typeof lucide !== 'undefined') lucide.createIcons();
    }
}

function closeAiPanel() {
    const panel = document.getElementById('aiChatPanel');
    if (panel) panel.classList.add('hidden');
}

document.addEventListener('click', (e) => {
    const panel = document.getElementById('aiChatPanel');
    if (panel && e.target === panel) closeAiPanel();
});

function appendAiMessage(text, sender = 'ai', source = 'local-ai') {
    const container = document.getElementById('aiChatMessages');
    if (!container) return;

    const isAi = sender === 'ai';
    const msgDiv = document.createElement('div');
    msgDiv.className = `flex gap-2 ${isAi ? '' : 'flex-row-reverse'}`;

    const sourceLabel = source === 'gemini'
        ? '<span class="text-indigo-400">Gemini AI</span>'
        : '<span class="text-slate-600">Smart AI</span>';

    if (isAi) {
        msgDiv.innerHTML = `
            <div class="w-6 h-6 rounded-full bg-indigo-700 flex-shrink-0 flex items-center justify-center text-[10px]">🤖</div>
            <div class="bg-indigo-950/60 border border-indigo-800/40 rounded-xl rounded-tl-none px-3 py-2 text-slate-300 max-w-[85%] text-xs">
                ${text}
                <div class="text-[9px] mt-1 text-slate-600">${sourceLabel} · ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
            </div>`;
    } else {
        msgDiv.innerHTML = `
            <div class="bg-slate-800/80 border border-slate-700/40 rounded-xl rounded-tr-none px-3 py-2 text-slate-200 max-w-[85%] text-xs">
                ${text}
                <div class="text-[9px] mt-1 text-slate-500">You · ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
            </div>
            <div class="w-6 h-6 rounded-full bg-slate-700 flex-shrink-0 flex items-center justify-center text-[10px]">👮</div>`;
    }

    container.appendChild(msgDiv);
    container.scrollTop = container.scrollHeight;
}

function appendTypingIndicator() {
    const container = document.getElementById('aiChatMessages');
    if (!container) return null;
    const typingDiv = document.createElement('div');
    typingDiv.id = 'aiTypingIndicator';
    typingDiv.className = 'flex gap-2';
    typingDiv.innerHTML = `
        <div class="w-6 h-6 rounded-full bg-indigo-700 flex-shrink-0 flex items-center justify-center text-[10px]">🤖</div>
        <div class="bg-indigo-950/60 border border-indigo-800/40 rounded-xl rounded-tl-none px-4 py-3">
            <div class="flex gap-1 items-center">
                <span class="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce" style="animation-delay:0ms"></span>
                <span class="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce" style="animation-delay:150ms"></span>
                <span class="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce" style="animation-delay:300ms"></span>
            </div>
        </div>`;
    container.appendChild(typingDiv);
    container.scrollTop = container.scrollHeight;
    return typingDiv;
}

async function sendAiMessage() {
    const input = document.getElementById('aiChatInput');
    const question = input?.value?.trim();
    if (!question) return;

    input.value = '';
    appendAiMessage(question, 'user');

    const typingEl = appendTypingIndicator();

    try {
        const response = await apiRequest(`${API_BASE_URL}/api/ask-ai`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ question })
        });
        const data = await response.json();

        if (typingEl) typingEl.remove();

        if (data.success) {
            appendAiMessage(data.answer, 'ai', data.source);
            speak(data.answer);

            const badge = document.getElementById('aiSourceBadge');
            if (badge) {
                badge.textContent = data.source === 'gemini'
                    ? '✨ Gemini AI • Active'
                    : '🧠 Smart Local AI • Active';
            }
        } else {
            appendAiMessage('Sorry, I encountered an error. Please check if the backend server is running on port 3000.', 'ai');
        }
    } catch (err) {
        if (typingEl) typingEl.remove();
        appendAiMessage('⚠️ Cannot reach backend server. Make sure <b>node server.js</b> is running on port 3000.', 'ai');
    }
}

function startAiVoiceInput() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
        showToast('⚠️ Speech recognition: Chrome only!', 'error');
        return;
    }

    const voiceBtn = document.getElementById('voiceBtn');
    const input = document.getElementById('aiChatInput');
    if (voiceBtn) voiceBtn.classList.add('bg-indigo-500', 'border-indigo-400');

    const recognition = new SpeechRecognition();
    recognition.lang = 'en-US';
    recognition.continuous = false;
    recognition.interimResults = false;

    showToast('🎤 Listening... Speak your security question!', 'warning');

    recognition.start();

    recognition.onresult = (event) => {
        const transcript = event.results[0][0].transcript;
        if (input) input.value = transcript;
        if (voiceBtn) voiceBtn.classList.remove('bg-indigo-500', 'border-indigo-400');
        sendAiMessage();
    };

    recognition.onerror = () => {
        if (voiceBtn) voiceBtn.classList.remove('bg-indigo-500', 'border-indigo-400');
        showToast('Mic timeout — click mic again to retry!', 'error');
    };
}

function startVoiceAssistant() { openAiPanel(); }

function openMobileGuardView() {
    if (currentUserRole !== 'admin' && currentUserRole !== 'guard') {
        showToast('Guard view is restricted to Security Guards and Administrators.', 'error');
        return;
    }
    const overlay = document.getElementById('mobileGuardOverlay');
    if (overlay) {
        overlay.classList.remove('hidden');

        const mgVideo = document.getElementById('mgVideo');
        attachCameraStream(mgVideo);
    }
}

function closeMobileGuardView() {
    if (currentUserRole === 'guard') {
        // Guards are strictly bound to the Guard Console; they cannot close to the admin dashboard
        return;
    }
    const overlay = document.getElementById('mobileGuardOverlay');
    if (overlay) overlay.classList.add('hidden');
}

if (typeof lucide !== 'undefined') lucide.createIcons();

(async () => {
    if (!await checkExistingSession()) {
        setTimeout(() => document.getElementById('loginUsername')?.focus(), 300);
    }
})();
