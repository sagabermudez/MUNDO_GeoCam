// Database Setup
let db;
const dbReq = indexedDB.open("MUNDOGeoCamDB", 1);
dbReq.onupgradeneeded = (e) => {
  db = e.target.result;
  if (!db.objectStoreNames.contains("captures")) {
    db.createObjectStore("captures", { keyPath: "id", autoIncrement: true });
  }
};
dbReq.onsuccess = (e) => { db = e.target.result; loadLibraryThumb(); };

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
  mediaRecorder: null,
  recordedChunks: [],
  isRecording: false,
  surveyTitle: 'CROC SURVEY',
  author: 'Inspector',
  defaultRemarks: 'Field observation clear.',
  lastRemarks: 'Field observation clear.',
  logoImgObj: null,
  lat: null,
  lng: null,
  heading: 0,
  cardinal: 'N'
};

// UI Elements
const videoEl = document.getElementById('video-preview');
const btnShutter = document.getElementById('btn-shutter');
const btnTorch = document.getElementById('btn-torch');
const modalRemarks = document.getElementById('modal-remarks');
const inputRemarks = document.getElementById('input-remarks');

// Orientation / Compass Handler
function handleOrientation(e) {
  let compassHeading = null;
  if (e.webkitCompassHeading) {
    compassHeading = e.webkitCompassHeading;
  } else if (e.alpha !== null) {
    compassHeading = 360 - e.alpha;
  }

  if (compassHeading !== null) {
    state.heading = Math.round(compassHeading);
    state.cardinal = getCardinal(state.heading);
    document.getElementById('compass-arrow').style.transform = `rotate(${state.heading}deg)`;
    document.getElementById('disp-compass').innerText = `${state.cardinal} ${state.heading}°`;
  }
}

function getCardinal(deg) {
  const directions = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return directions[Math.round(deg / 45) % 8];
}

// Request iOS Orientation Permission
document.getElementById('btn-grant-sensors').addEventListener('click', async () => {
  if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
    try {
      const res = await DeviceOrientationEvent.requestPermission();
      if (res === 'granted') {
        window.addEventListener('deviceorientation', handleOrientation, true);
        alert("Sensor permission granted.");
      }
    } catch (err) { alert("Permission error: " + err); }
  } else {
    alert("Standard orientation listener active.");
  }
});

// Geolocation Handler
if ("geolocation" in navigator) {
  navigator.geolocation.watchPosition(
    (pos) => {
      state.lat = pos.coords.latitude.toFixed(6);
      state.lng = pos.coords.longitude.toFixed(6);
      document.getElementById('disp-coords').innerText = `📍 ${state.lat}, ${state.lng}`;
    },
    (err) => console.error(err),
    { enableHighAccuracy: true, maximumAge: 1000, timeout: 5000 }
  );
}

// System Clock
setInterval(() => {
  const now = new Date().toLocaleString();
  document.getElementById('disp-datetime').innerText = now;
}, 1000);

// Initialize Camera
async function initCamera() {
  if (state.stream) {
    state.stream.getTracks().forEach(t => t.stop());
  }

  const constraints = {
    video: {
      facingMode: state.facingMode,
      width: { ideal: 1920 },
      height: { ideal: 1080 }
    },
    audio: state.mode === 'VIDEO'
  };

  try {
    state.stream = await navigator.mediaDevices.getUserMedia(constraints);
    videoEl.srcObject = state.stream;
  } catch (err) {
    alert("Camera Access Error: " + err.message);
  }
}

// Setup Event Listeners
window.addEventListener('DOMContentLoaded', () => {
  initCamera();
  if (window.DeviceOrientationEvent && !DeviceOrientationEvent.requestPermission) {
    window.addEventListener('deviceorientation', handleOrientation, true);
  }

  // Torch Toggle
  btnTorch.addEventListener('click', async () => {
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
  document.getElementById('mode-photo').addEventListener('click', (e) => {
    setMode('PHOTO', e.target);
  });
  document.getElementById('mode-video').addEventListener('click', (e) => {
    setMode('VIDEO', e.target);
  });

  function setMode(mode, target) {
    state.mode = mode;
    document.querySelectorAll('.mode-opt').forEach(el => el.classList.remove('active'));
    target.classList.add('active');
    initCamera();
  }

  // Shutter Press
  btnShutter.addEventListener('click', () => {
    if (state.mode === 'PHOTO') {
      inputRemarks.value = state.lastRemarks;
      modalRemarks.classList.remove('hidden');
    } else {
      toggleVideoRecording();
    }
  });

  // Modal Buttons
  document.getElementById('btn-cancel-capture').addEventListener('click', () => {
    modalRemarks.classList.add('hidden');
  });

  document.getElementById('btn-confirm-capture').addEventListener('click', () => {
    modalRemarks.classList.add('hidden');
    state.lastRemarks = inputRemarks.value;
    document.getElementById('disp-remarks').innerText = `Remarks: ${state.lastRemarks}`;
    processAndSavePhoto();
  });

  // Switch Facing Camera
  document.getElementById('btn-switch-cam').addEventListener('click', () => {
    state.facingMode = state.facingMode === 'environment' ? 'user' : 'environment';
    initCamera();
  });

  // Navigation Screens
  document.getElementById('btn-settings').addEventListener('click', () => switchScreen('settings-screen'));
  document.getElementById('btn-close-settings').addEventListener('click', () => switchScreen('camera-screen'));
  document.getElementById('btn-library').addEventListener('click', () => {
    renderLibrary();
    switchScreen('library-screen');
  });
  document.getElementById('btn-close-lib').addEventListener('click', () => switchScreen('camera-screen'));

  // Save Settings & Logo
  document.getElementById('btn-save-settings').addEventListener('click', () => {
    state.surveyTitle = document.getElementById('setting-title').value.toUpperCase();
    state.author = document.getElementById('setting-author').value;
    state.defaultRemarks = document.getElementById('setting-default-remarks').value;
    state.lastRemarks = state.defaultRemarks;

    document.getElementById('disp-survey-title').innerText = state.surveyTitle;
    document.getElementById('disp-author').innerText = `Photo captured by: ${state.author}`;
    document.getElementById('disp-remarks').innerText = `Remarks: ${state.defaultRemarks}`;

    const logoFile = document.getElementById('setting-logo-file').files[0];
    if (logoFile) {
      const reader = new FileReader();
      reader.onload = (e) => {
        const logoImg = document.getElementById('overlay-logo');
        logoImg.src = e.target.result;
        logoImg.classList.remove('hidden');
        document.getElementById('logo-placeholder').classList.add('hidden');

        // Create HTMLImageElement for direct canvas context rendering
        const img = new Image();
        img.src = e.target.result;
        img.onload = () => { state.logoImgObj = img; };
      };
      reader.readAsDataURL(logoFile);
    }
    switchScreen('camera-screen');
  });

  // Data Export
  document.getElementById('btn-export-csv').addEventListener('click', exportCSV);
  document.getElementById('btn-export-geojson').addEventListener('click', exportGeoJSON);
});

function switchScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

// Canvas Watermarking & Uncropped Full 16:9 Capture
// Canvas Watermarking & Viewport-Matched Capture
function processAndSavePhoto() {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');

  // 1. Get real-time viewport aspect ratio
  const viewportRect = viewportEl.getBoundingClientRect();
  const targetAspect = viewportRect.width / viewportRect.height;

  // 2. Set Canvas high-resolution dimensions matching viewport aspect ratio
  if (targetAspect >= 1) {
    canvas.width = 1920;
    canvas.height = Math.round(1920 / targetAspect);
  } else {
    canvas.height = 1920;
    canvas.width = Math.round(1920 * targetAspect);
  }

  // 3. Compute cropping parameters (Object-Fit: Cover algorithm)
  const videoWidth = videoEl.videoWidth || 1920;
  const videoHeight = videoEl.videoHeight || 1080;
  const videoAspect = videoWidth / videoHeight;

  let sx, sy, sWidth, sHeight;

  if (videoAspect > targetAspect) {
    // Video stream is wider than viewport -> Crop sides
    sHeight = videoHeight;
    sWidth = videoHeight * targetAspect;
    sx = (videoWidth - sWidth) / 2;
    sy = 0;
  } else {
    // Video stream is taller than viewport -> Crop top/bottom
    sWidth = videoWidth;
    sHeight = videoWidth / targetAspect;
    sx = 0;
    sy = (videoHeight - sHeight) / 2;
  }

  // 4. Draw cropped stream onto canvas
  ctx.drawImage(
    videoEl,
    sx, sy, sWidth, sHeight,  // Source crop area
    0, 0, canvas.width, canvas.height // Canvas destination area
  );

  // 5. Calculate proportional overlay styling relative to high-res canvas
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

  // Draw Office Logo if uploaded
  if (state.logoImgObj) {
    const logoSize = 65 * scale;
    const logoY = panelY + ((panelHeight - logoSize) / 2);
    ctx.drawImage(state.logoImgObj, textXOffset, logoY, logoSize, logoSize);
    textXOffset += logoSize + (15 * scale);
  }

  // Text Metadata Output
  const timestamp = new Date().toLocaleString();
  
  ctx.fillStyle = "#FFFFFF";
  ctx.font = `bold ${18 * scale}px -apple-system, sans-serif`;
  ctx.fillText(state.surveyTitle, textXOffset, panelY + (28 * scale));

  ctx.fillStyle = "#76FF03";
  ctx.font = `bold ${16 * scale}px -apple-system, sans-serif`;
  ctx.fillText(`📍 ${state.lat || '0.000000'}, ${state.lng || '0.000000'} | ${state.cardinal} ${state.heading}°`, textXOffset, panelY + (52 * scale));

  ctx.fillStyle = "#DDDDDD";
  ctx.font = `${14 * scale}px -apple-system, sans-serif`;
  ctx.fillText(`Remarks: ${state.lastRemarks}`, textXOffset, panelY + (74 * scale));

  ctx.fillStyle = "#AAAAAA";
  ctx.font = `${12 * scale}px -apple-system, sans-serif`;
  ctx.fillText(`Photo captured by: ${state.author} | ${timestamp}`, textXOffset, panelY + (94 * scale));

  // 6. Save and Download
  const dataUrl = canvas.toDataURL('image/jpeg', 0.95);
  const record = {
    type: 'image',
    blobUrl: dataUrl,
    title: state.surveyTitle,
    lat: state.lat,
    lng: state.lng,
    heading: state.heading,
    cardinal: state.cardinal,
    remarks: state.lastRemarks,
    author: state.author,
    timestamp: timestamp
  };

  saveToDB(record);
  downloadFile(dataUrl, `MUNDO_${Date.now()}.jpg`);
}

// Video Recording Operations
function toggleVideoRecording() {
  if (!state.isRecording) {
    state.recordedChunks = [];
    state.mediaRecorder = new MediaRecorder(state.stream, { mimeType: 'video/webm' });
    state.mediaRecorder.ondataavailable = (e) => state.recordedChunks.push(e.data);
    state.mediaRecorder.onstop = saveVideo;
    state.mediaRecorder.start();
    state.isRecording = true;
    btnShutter.classList.add('recording');
  } else {
    state.mediaRecorder.stop();
    state.isRecording = false;
    btnShutter.classList.remove('recording');
  }
}

function saveVideo() {
  const blob = new Blob(state.recordedChunks, { type: 'video/webm' });
  const videoUrl = URL.createObjectURL(blob);
  const timestamp = new Date().toLocaleString();

  const record = {
    type: 'video',
    blobUrl: videoUrl,
    title: state.surveyTitle,
    lat: state.lat,
    lng: state.lng,
    heading: state.heading,
    cardinal: state.cardinal,
    remarks: state.lastRemarks || state.defaultRemarks,
    author: state.author,
    timestamp: timestamp
  };

  saveToDB(record);
  downloadFile(videoUrl, `MUNDO_${Date.now()}.webm`);
}

// IndexedDB Persistence
function saveToDB(record) {
  const tx = db.transaction("captures", "readwrite");
  tx.objectStore("captures").add(record);
  tx.oncomplete = () => loadLibraryThumb();
}

function loadLibraryThumb() {
  if (!db) return;
  const tx = db.transaction("captures", "readonly");
  const store = tx.objectStore("captures");
  const req = store.openCursor(null, 'prev');
  req.onsuccess = (e) => {
    const cursor = e.target.result;
    if (cursor) {
      document.getElementById('btn-library').style.backgroundImage = `url(${cursor.value.blobUrl})`;
    }
  };
}

function renderLibrary() {
  const grid = document.getElementById('library-grid');
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
        : `<video src="${item.blobUrl}"></video>`;
      
      el.innerHTML = `
        ${mediaHtml}
        <div class="grid-info">
          <strong>${item.title}</strong><br>
          ${item.timestamp}<br>
          📍 ${item.lat || '0'}, ${item.lng || '0'}
        </div>
      `;
      grid.appendChild(el);
      cursor.continue();
    }
  };
}

// File Downloads & Exports
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
      let csv = "ID,Type,Title,Latitude,Longitude,Heading,Cardinal,Remarks,Author,Timestamp\n";
      records.forEach(r => {
        csv += `"${r.id}","${r.type}","${r.title}","${r.lat}","${r.lng}","${r.heading}","${r.cardinal}","${r.remarks}","${r.author}","${r.timestamp}"\n`;
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
            heading: r.heading,
            cardinal: r.cardinal,
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