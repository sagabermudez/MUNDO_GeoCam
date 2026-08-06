// Database Setup
let db;
const dbReq = indexedDB.open("MUNDOGeoCamDB", 2);
dbReq.onupgradeneeded = (e) => {
  db = e.target.result;
  if (!db.objectStoreNames.contains("captures")) {
    db.createObjectStore("captures", { keyPath: "id", autoIncrement: true });
  }
  if (!db.objectStoreNames.contains("settings")) {
    db.createObjectStore("settings", { keyPath: "key" });
  }
};
dbReq.onsuccess = (e) => { 
  db = e.target.result; 
  loadSavedSettings();
  loadLibraryThumb(); 
};

// Register Service Worker
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(console.error);
}

// State Management
const state = {
  mode: 'PHOTO', // 'PHOTO' or 'VIDEO'
  facingMode: 'environment',
  torchOn: false,
  stream: null,
  currentDeviceId: null, 
  recordedChunks: [],
  isRecording: false,
  surveyTitle: localStorage.getItem('geo_surveyTitle') || 'PROJECT',
  author: localStorage.getItem('geo_author') || '',
  defaultRemarks: localStorage.getItem('geo_defaultRemarks') || '',
  lastRemarks: localStorage.getItem('geo_defaultRemarks') || '',
  logoImgObj: null,
  lat: null,
  lng: null
};

// UI Elements
const videoEl = document.getElementById('video-preview');
const viewportEl = document.getElementById('viewport-container');
const btnShutter = document.getElementById('btn-shutter');
const modalRemarks = document.getElementById('modal-remarks');
const inputRemarks = document.getElementById('input-remarks');

let videoAnimationFrame = null;

// Load Persisted Settings & Logo on Startup
function loadSavedSettings() {
  // Update inputs
  const titleInput = document.getElementById('setting-title');
  const authorInput = document.getElementById('setting-author');
  const remarksInput = document.getElementById('setting-default-remarks');

  if (titleInput) titleInput.value = state.surveyTitle;
  if (authorInput) authorInput.value = state.author;
  if (remarksInput) remarksInput.value = state.defaultRemarks;

  // Update overlay displays
  if (document.getElementById('disp-survey-title')) {
    document.getElementById('disp-survey-title').innerText = state.surveyTitle;
  }
  if (document.getElementById('disp-author')) {
    document.getElementById('disp-author').innerText = `Photo captured by: ${state.author}`;
  }
  if (document.getElementById('disp-remarks')) {
    document.getElementById('disp-remarks').innerText = `Remarks: ${state.defaultRemarks}`;
  }

  // Load Logo from IndexedDB
  if (!db) return;
  const tx = db.transaction("settings", "readonly");
  const req = tx.objectStore("settings").get("office_logo");
  req.onsuccess = (e) => {
    if (req.result && req.result.value) {
      const dataUrl = req.result.value;
      const logoImg = document.getElementById('overlay-logo');
      if (logoImg) {
        logoImg.src = dataUrl;
        logoImg.classList.remove('hidden');
      }
      document.getElementById('logo-placeholder')?.classList.add('hidden');

      const img = new Image();
      img.src = dataUrl;
      img.onload = () => { state.logoImgObj = img; };
    }
  };
}

// Geolocation Handler
if ("geolocation" in navigator) {
  navigator.geolocation.watchPosition(
    (pos) => {
      state.lat = pos.coords.latitude.toFixed(6);
      state.lng = pos.coords.longitude.toFixed(6);
      const coordsEl = document.getElementById('disp-coords');
      if (coordsEl) coordsEl.innerText = `📍 ${state.lat}, ${state.lng}`;
    },
    (err) => console.error(err),
    { enableHighAccuracy: true, maximumAge: 1000, timeout: 5000 }
  );
}

// System Clock
setInterval(() => {
  const now = new Date().toLocaleString();
  const dateEl = document.getElementById('disp-datetime');
  if (dateEl) dateEl.innerText = now;
}, 1000);

// Initialize Camera Stream
async function initCamera() {
  // 1. Fully release active stream tracks
  if (state.stream) {
    state.stream.getTracks().forEach(track => track.stop());
    videoEl.srcObject = null;
  }

  // 2. Build constraints based on facingMode or explicit deviceId
  let videoConstraints = {};

videoConstraints = {
    facingMode: state.facingMode
};

  // Add resolution preferences
  videoConstraints.width = { ideal: 1920 };
  videoConstraints.height = { ideal: 1080 };

  try {
    state.stream = await navigator.mediaDevices.getUserMedia({
      video: videoConstraints,
      audio: state.mode === 'VIDEO'
    });

    videoEl.srcObject = state.stream;
    await videoEl.play();

    const track = state.stream.getVideoTracks()[0];
console.log("Current Camera Settings:", track.getSettings());

    // Store active deviceId
    const currentTrack = state.stream.getVideoTracks()[0];
    if (currentTrack && currentTrack.getSettings) {
      state.currentDeviceId = currentTrack.getSettings().deviceId;
    }
  } catch (err) {
    console.warn("Primary camera constraint failed, attempting basic fallback:", err);
    try {
      // General fallback if exact deviceId or ideal facingMode fails
      state.stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: state.facingMode },
        audio: state.mode === 'VIDEO'
      });
      videoEl.srcObject = state.stream;
      await videoEl.play();
    } catch (fallbackErr) {
      alert("Unable to access camera: " + fallbackErr.message);
    }
  }
}

// Safe Event Listener Helper
const safeAddListener = (id, event, handler) => {
  const el = document.getElementById(id);
  if (el) el.addEventListener(event, handler);
};

// Setup Event Listeners
window.addEventListener('DOMContentLoaded', () => {
  initCamera();

  // Torch Toggle
  safeAddListener('btn-torch', 'click', async () => {
    if (!state.stream) return;
    const track = state.stream.getVideoTracks()[0];
    const capabilities = track.getCapabilities ? track.getCapabilities() : {};
    if (capabilities.torch) {
      state.torchOn = !state.torchOn;
      await track.applyConstraints({ advanced: [{ torch: state.torchOn }] });
    } else {
      alert("Torch not supported on this camera/device.");
    }
  });

  // Switch Mode
  safeAddListener('mode-photo', 'click', (e) => setMode('PHOTO', e.target));
  safeAddListener('mode-video', 'click', (e) => setMode('VIDEO', e.target));

  function setMode(mode, target) {
    state.mode = mode;
    document.querySelectorAll('.mode-opt').forEach(el => el.classList.remove('active'));
    target.classList.add('active');
    initCamera();
  }

  // Shutter Press
  safeAddListener('btn-shutter', 'click', () => {
    if (state.mode === 'PHOTO') {
      videoEl.pause();
      inputRemarks.value = state.lastRemarks;
      modalRemarks.classList.remove('hidden');
    } else {
      toggleVideoRecording();
    }
  });

  // Modal Cancel
  safeAddListener('btn-cancel-capture', 'click', () => {
    modalRemarks.classList.add('hidden');
    videoEl.play();
  });

  // Modal Save
  safeAddListener('btn-confirm-capture', 'click', () => {
    modalRemarks.classList.add('hidden');
    state.lastRemarks = inputRemarks.value;
    const remarksEl = document.getElementById('disp-remarks');
    if (remarksEl) remarksEl.innerText = `Remarks: ${state.lastRemarks}`;
    
    processAndSavePhoto();
    videoEl.play();
  });

 // Switch Facing Camera Handler
safeAddListener('btn-switch-cam', 'click', async () => {

    alert("Switch button clicked!");

});

  // Navigation Screens
  safeAddListener('btn-settings', 'click', () => switchScreen('settings-screen'));
  safeAddListener('btn-close-settings', 'click', () => switchScreen('camera-screen'));
  safeAddListener('btn-library', 'click', () => {
    renderLibrary();
    switchScreen('library-screen');
  });
  safeAddListener('btn-close-lib', 'click', () => switchScreen('camera-screen'));

  // Save Settings & Logo persistently
  safeAddListener('btn-save-settings', 'click', () => {
    const titleInput = document.getElementById('setting-title');
    const authorInput = document.getElementById('setting-author');
    const remarksInput = document.getElementById('setting-default-remarks');

    if (titleInput) {
      state.surveyTitle = titleInput.value.toUpperCase();
      localStorage.setItem('geo_surveyTitle', state.surveyTitle);
    }
    if (authorInput) {
      state.author = authorInput.value;
      localStorage.setItem('geo_author', state.author);
    }
    if (remarksInput) {
      state.defaultRemarks = remarksInput.value;
      localStorage.setItem('geo_defaultRemarks', state.defaultRemarks);
    }
    state.lastRemarks = state.defaultRemarks;

    if (document.getElementById('disp-survey-title')) {
      document.getElementById('disp-survey-title').innerText = state.surveyTitle;
    }
    if (document.getElementById('disp-author')) {
      document.getElementById('disp-author').innerText = `Photo captured by: ${state.author}`;
    }
    if (document.getElementById('disp-remarks')) {
      document.getElementById('disp-remarks').innerText = `Remarks: ${state.defaultRemarks}`;
    }

    const logoFile = document.getElementById('setting-logo-file')?.files[0];
    if (logoFile) {
      const reader = new FileReader();
      reader.onload = (e) => {
        const dataUrl = e.target.result;
        const logoImg = document.getElementById('overlay-logo');
        if (logoImg) {
          logoImg.src = dataUrl;
          logoImg.classList.remove('hidden');
        }
        document.getElementById('logo-placeholder')?.classList.add('hidden');

        const img = new Image();
        img.src = dataUrl;
        img.onload = () => { state.logoImgObj = img; };

        // Store Logo Data in IndexedDB
        if (db) {
          const tx = db.transaction("settings", "readwrite");
          tx.objectStore("settings").put({ key: "office_logo", value: dataUrl });
        }
      };
      reader.readAsDataURL(logoFile);
    }

    switchScreen('camera-screen');
  });

  // Data Export Buttons
  safeAddListener('btn-export-csv', 'click', exportCSV);
  safeAddListener('btn-export-geojson', 'click', exportGeoJSON);
});

function switchScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

// Canvas Watermarking & Viewport-Matched Photo Capture
function processAndSavePhoto() {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');

  const viewport = viewportEl || document.getElementById('viewport-container');
  const viewportRect = viewport.getBoundingClientRect();
  const targetAspect = viewportRect.width / viewportRect.height;

  if (targetAspect >= 1) {
    canvas.width = 1920;
    canvas.height = Math.round(1920 / targetAspect);
  } else {
    canvas.height = 1920;
    canvas.width = Math.round(1920 * targetAspect);
  }

  const videoWidth = videoEl.videoWidth || 1920;
  const videoHeight = videoEl.videoHeight || 1080;
  const videoAspect = videoWidth / videoHeight;

  let sx, sy, sWidth, sHeight;

  if (videoAspect > targetAspect) {
    sHeight = videoHeight;
    sWidth = videoHeight * targetAspect;
    sx = (videoWidth - sWidth) / 2;
    sy = 0;
  } else {
    sWidth = videoWidth;
    sHeight = videoWidth / targetAspect;
    sx = 0;
    sy = (videoHeight - sHeight) / 2;
  }

  ctx.drawImage(videoEl, sx, sy, sWidth, sHeight, 0, 0, canvas.width, canvas.height);

  const scale = canvas.width / viewportRect.width;

  // Top Brand Tag
  const tagX = 15 * scale;
  const tagY = 15 * scale;
  const tagWidth = 160 * scale;
  const tagHeight = 36 * scale;

  ctx.fillStyle = "rgba(40, 40, 40, 0.85)";
  ctx.roundRect(tagX, tagY, tagWidth, tagHeight, 18 * scale);
  ctx.fill();
  ctx.font = `bold ${16 * scale}px -apple-system, sans-serif`;
  ctx.fillStyle = "#4CAF50";
  ctx.fillText("MUNDO GeoCam", tagX + (16 * scale), tagY + (24 * scale));

  // Bottom Overlay Panel
  const panelHeight = 110 * scale;
  const panelY = canvas.height - panelHeight;

  ctx.fillStyle = "rgba(0, 0, 0, 0.75)";
  ctx.fillRect(0, panelY, canvas.width, panelHeight);

  let textXOffset = 20 * scale;

  if (state.logoImgObj) {
    const logoSize = 70 * scale;
    const logoY = panelY + ((panelHeight - logoSize) / 2);
    ctx.drawImage(state.logoImgObj, textXOffset, logoY, logoSize, logoSize);
    textXOffset += logoSize + (15 * scale);
  }

  const timestamp = new Date().toLocaleString();
  
  ctx.fillStyle = "#FFFFFF";
  ctx.font = `bold ${15 * scale}px -apple-system, sans-serif`;
  ctx.fillText(state.surveyTitle, textXOffset, panelY + (28 * scale));

  ctx.fillStyle = "#76FF03";
  ctx.font = `bold ${14 * scale}px -apple-system, sans-serif`;
  ctx.fillText(`📍 ${state.lat || '0.000000'}, ${state.lng || '0.000000'}`, textXOffset, panelY + (52 * scale));

  ctx.fillStyle = "#DDDDDD";
  ctx.font = `${12 * scale}px -apple-system, sans-serif`;
  ctx.fillText(`Remarks: ${state.lastRemarks}`, textXOffset, panelY + (74 * scale));

  ctx.fillStyle = "#AAAAAA";
  ctx.font = `${10 * scale}px -apple-system, sans-serif`;
  ctx.fillText(`Photo captured by: ${state.author} | ${timestamp}`, textXOffset, panelY + (94 * scale));

  const dataUrl = canvas.toDataURL('image/jpeg', 0.95);
  const record = {
    type: 'image',
    blobUrl: dataUrl,
    title: state.surveyTitle,
    lat: state.lat,
    lng: state.lng,
    remarks: state.lastRemarks,
    author: state.author,
    timestamp: timestamp
  };

  saveToDB(record);
  downloadFile(dataUrl, `MUNDO_${Date.now()}.jpg`);
}

// Video Canvas Frame Renderer
function drawVideoFrameToCanvas(canvas, ctx) {
  const viewport = viewportEl || document.getElementById('viewport-container');
  const viewportRect = viewport.getBoundingClientRect();
  const targetAspect = viewportRect.width / viewportRect.height;

  if (targetAspect >= 1) {
    canvas.width = 1280;
    canvas.height = Math.round(1280 / targetAspect);
  } else {
    canvas.height = 1280;
    canvas.width = Math.round(1280 * targetAspect);
  }

  const videoWidth = videoEl.videoWidth || 1280;
  const videoHeight = videoEl.videoHeight || 720;
  const videoAspect = videoWidth / videoHeight;

  let sx, sy, sWidth, sHeight;

  if (videoAspect > targetAspect) {
    sHeight = videoHeight;
    sWidth = videoHeight * targetAspect;
    sx = (videoWidth - sWidth) / 2;
    sy = 0;
  } else {
    sWidth = videoWidth;
    sHeight = videoWidth / targetAspect;
    sx = 0;
    sy = (videoHeight - sHeight) / 2;
  }

  ctx.drawImage(videoEl, sx, sy, sWidth, sHeight, 0, 0, canvas.width, canvas.height);

  const scale = canvas.width / viewportRect.width;

  const tagX = 15 * scale;
  const tagY = 15 * scale;
  const tagWidth = 160 * scale;
  const tagHeight = 36 * scale;

  ctx.fillStyle = "rgba(40, 40, 40, 0.85)";
  ctx.roundRect(tagX, tagY, tagWidth, tagHeight, 18 * scale);
  ctx.fill();
  ctx.font = `bold ${16 * scale}px -apple-system, sans-serif`;
  ctx.fillStyle = "#4CAF50";
  ctx.fillText("MUNDO GeoCam", tagX + (16 * scale), tagY + (24 * scale));

  const panelHeight = 110 * scale;
  const panelY = canvas.height - panelHeight;

  ctx.fillStyle = "rgba(0, 0, 0, 0.75)";
  ctx.fillRect(0, panelY, canvas.width, panelHeight);

  let textXOffset = 20 * scale;

  if (state.logoImgObj) {
    const logoSize = 65 * scale;
    const logoY = panelY + ((panelHeight - logoSize) / 2);
    ctx.drawImage(state.logoImgObj, textXOffset, logoY, logoSize, logoSize);
    textXOffset += logoSize + (15 * scale);
  }

  const timestamp = new Date().toLocaleString();

  ctx.fillStyle = "#FFFFFF";
  ctx.font = `bold ${18 * scale}px -apple-system, sans-serif`;
  ctx.fillText(state.surveyTitle, textXOffset, panelY + (28 * scale));

  ctx.fillStyle = "#76FF03";
  ctx.font = `bold ${16 * scale}px -apple-system, sans-serif`;
  ctx.fillText(`📍 ${state.lat || '0.000000'}, ${state.lng || '0.000000'}`, textXOffset, panelY + (52 * scale));

  ctx.fillStyle = "#DDDDDD";
  ctx.font = `${14 * scale}px -apple-system, sans-serif`;
  ctx.fillText(`Remarks: ${state.lastRemarks || state.defaultRemarks}`, textXOffset, panelY + (74 * scale));

  ctx.fillStyle = "#AAAAAA";
  ctx.font = `${12 * scale}px -apple-system, sans-serif`;
  ctx.fillText(`Recorded by: ${state.author} | ${timestamp}`, textXOffset, panelY + (94 * scale));

  if (state.isRecording) {
    videoAnimationFrame = requestAnimationFrame(() => drawVideoFrameToCanvas(canvas, ctx));
  }
}

// Video Recording Operations
function toggleVideoRecording() {
  if (!state.isRecording) {
    state.recordedChunks = [];

    const recordCanvas = document.createElement('canvas');
    const ctx = recordCanvas.getContext('2d');
    state.isRecording = true;

    drawVideoFrameToCanvas(recordCanvas, ctx);

    const canvasStream = recordCanvas.captureStream(30);

    if (state.stream && state.stream.getAudioTracks().length > 0) {
      canvasStream.addTrack(state.stream.getAudioTracks()[0]);
    }

    const mimeType = MediaRecorder.isTypeSupported('video/mp4') 
      ? 'video/mp4' 
      : 'video/webm';

    state.mediaRecorder = new MediaRecorder(canvasStream, { mimeType });
    state.mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) state.recordedChunks.push(e.data);
    };
    state.mediaRecorder.onstop = saveVideo;
    state.mediaRecorder.start();

    btnShutter.classList.add('recording');
  } else {
    state.isRecording = false;
    if (videoAnimationFrame) cancelAnimationFrame(videoAnimationFrame);
    state.mediaRecorder.stop();
    btnShutter.classList.remove('recording');
  }
}

function saveVideo() {
  const mimeType = state.mediaRecorder.mimeType || 'video/webm';
  const ext = mimeType.includes('mp4') ? 'mp4' : 'webm';
  const blob = new Blob(state.recordedChunks, { type: mimeType });
  const videoUrl = URL.createObjectURL(blob);
  const timestamp = new Date().toLocaleString();

  const record = {
    type: 'video',
    blobUrl: videoUrl,
    title: state.surveyTitle,
    lat: state.lat,
    lng: state.lng,
    remarks: state.lastRemarks || state.defaultRemarks,
    author: state.author,
    timestamp: timestamp
  };

  saveToDB(record);
  downloadFile(videoUrl, `MUNDO_${Date.now()}.${ext}`);
}

// IndexedDB Persistence
function saveToDB(record) {
  const tx = db.transaction("captures", "readwrite");
  tx.objectStore("captures").add(record);
  tx.oncomplete = () => loadLibraryThumb();
}

function loadLibraryThumb() {
  if (!db) return;
  const libBtn = document.getElementById('btn-library');
  if (!libBtn) return;

  const tx = db.transaction("captures", "readonly");
  const store = tx.objectStore("captures");
  const req = store.openCursor(null, 'prev');

  req.onsuccess = (e) => {
    const cursor = e.target.result;
    if (cursor) {
      libBtn.style.backgroundImage = `url(${cursor.value.blobUrl})`;
    } else {
      libBtn.style.backgroundImage = 'none';
    }
  };
}

function renderLibrary() {
  const grid = document.getElementById('library-grid');
  if (!grid) return;
  grid.innerHTML = '';

  const tx = db.transaction("captures", "readonly");
  tx.objectStore("captures").openCursor(null, 'prev').onsuccess = (e) => {
    const cursor = e.target.result;
    if (cursor) {
      const item = cursor.value;
      const el = document.createElement('div');
      el.className = 'grid-item';

      const mediaHtml = item.type === 'image' 
        ? `<img src="${item.blobUrl}">` 
        : `<video src="${item.blobUrl}" controls></video>`;

      el.innerHTML = `
        <button class="btn-delete" data-id="${item.id}">🗑️</button>
        ${mediaHtml}
        <div class="grid-info">
          <strong>${item.title}</strong><br>
          ${item.timestamp}<br>
          📍 ${item.lat || '0'}, ${item.lng || '0'}<br>
          <em>${item.remarks || ''}</em>
        </div>
      `;

      el.querySelector('.btn-delete').addEventListener('click', (ev) => {
        ev.stopPropagation();
        if (confirm("Delete this capture?")) {
          deleteCapture(item.id);
        }
      });

      grid.appendChild(el);
      cursor.continue();
    }
  };
}

function deleteCapture(id) {
  const tx = db.transaction("captures", "readwrite");
  tx.objectStore("captures").delete(id).onsuccess = () => {
    renderLibrary();
    loadLibraryThumb();
  };
}

function downloadFile(url, filename) {
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
}

function exportCSV() {
  const tx = db.transaction("captures", "readonly");
  const records = [];
  tx.objectStore("captures").openCursor().onsuccess = (e) => {
    const cursor = e.target.result;
    if (cursor) {
      records.push(cursor.value);
      cursor.continue();
    } else {
      let csv = "ID,Type,Title,Latitude,Longitude,Remarks,Author,Timestamp\n";
      records.forEach(r => {
        csv += `"${r.id}","${r.type}","${r.title}","${r.lat}","${r.lng}","${r.remarks}","${r.author}","${r.timestamp}"\n`;
      });
      const blob = new Blob([csv], { type: 'text/csv' });
      downloadFile(URL.createObjectURL(blob), `MUNDO_Export_${Date.now()}.csv`);
    }
  };
}

function exportGeoJSON() {
  const tx = db.transaction("captures", "readonly");
  const features = [];
  tx.objectStore("captures").openCursor().onsuccess = (e) => {
    const cursor = e.target.result;
    if (cursor) {
      const r = cursor.value;
      if (r.lat && r.lng) {
        features.push({
          type: "Feature",
          geometry: {
            type: "Point",
            coordinates: [parseFloat(r.lng), parseFloat(r.lat)]
          },
          properties: {
            id: r.id,
            type: r.type,
            title: r.title,
            remarks: r.remarks,
            author: r.author,
            timestamp: r.timestamp
          }
        });
      }
      cursor.continue();
    } else {
      const geojson = { type: "FeatureCollection", features: features };
      const blob = new Blob([JSON.stringify(geojson, null, 2)], { type: 'application/json' });
      downloadFile(URL.createObjectURL(blob), `MUNDO_Export_${Date.now()}.geojson`);
    }
  };
}
