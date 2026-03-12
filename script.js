/*********************************************************
 MQTT CONFIG
*********************************************************/
const client = mqtt.connect(
  "wss://d8b9ac96f2374248a0784545f5e59901.s1.eu.hivemq.cloud:8884/mqtt",
  {
    username: "Penyiraman_Otomatis",
    password: "Pro111816",
    reconnectPeriod: 2000,
    clean: true
  }
);

/*********************************************************
 ELEMENT
*********************************************************/
const mqttStatus = document.getElementById("mqttStatus");
const espStatus  = document.getElementById("espStatus");
const lastUpdate = document.getElementById("lastUpdate");

const soilEl       = document.getElementById("soil");
const battVoltEl   = document.getElementById("battVolt");
const battCurrEl   = document.getElementById("battCurr");
const battPowerEl  = document.getElementById("battPower");

const panelVoltEl  = document.getElementById("panelVolt");
const panelCurrEl  = document.getElementById("panelCurr");
const panelPowerEl = document.getElementById("panelPower");

const modeEl  = document.getElementById("mode");
const pompaEl = document.getElementById("pompa");

// Elemen baru untuk baterai dan solar
const batteryPercentEl = document.getElementById("batteryPercent");
const batteryProgressBar = document.getElementById("batteryProgressBar");
const lightIntensityEl = document.getElementById("lightIntensity");

/*********************************************************
 THRESHOLD VARIABLES
*********************************************************/
let pumpOnThreshold = 50;  // nilai default
let pumpOffThreshold = 80; // nilai default

/*********************************************************
 HEARTBEAT SYSTEM
*********************************************************/
let lastHeartbeat = 0;
let everOnline = false;
const HEARTBEAT_TIMEOUT = 4000;
const pageStart = Date.now();

/*********************************************************
 HISTORICAL DATA STORAGE
*********************************************************/
// Data historis detail (setiap 5 menit)
const STORAGE_KEY_DETAIL = 'soil_history_detail';
const MAX_HISTORY_DAYS = 30; // Menyimpan 30 hari
const DETAIL_INTERVAL = 300000; // 5 menit dalam milidetik

// Struktur data: { timestamp: number, value: number }[]
let soilDetailHistory = loadDetailHistory();

/*********************************************************
 CHART INITIALIZATION
*********************************************************/

// Chart realtime
const ctx = document.getElementById("soilChart").getContext("2d");
const soilChart = new Chart(ctx, {
  type: "line",
  data: {
    labels: [],
    datasets: [{
      label: "Kelembapan Real-time (%)",
      data: [],
      borderColor: "#2ecc71",
      backgroundColor: "rgba(46,204,113,0.25)",
      tension: 0.4,
      fill: true,
      pointRadius: 3,
      pointHoverRadius: 5
    }]
  },
  options: {
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    scales: {
      y: {
        min: 0,
        max: 100,
        title: { display: true, text: "Kelembapan (%)" },
        grid: { color: "rgba(0,0,0,0.05)" }
      },
      x: {
        title: { display: true, text: "Waktu (Jam:Menit:Detik)" },
        grid: { display: false }
      }
    },
    plugins: {
      tooltip: {
        callbacks: {
          label: (context) => `Kelembapan: ${context.raw}%`
        }
      }
    }
  }
});

// Chart historis detail (24 jam per 5 menit)
const detailedCtx = document.getElementById("detailedHistoryChart").getContext("2d");
const detailedChart = new Chart(detailedCtx, {
  type: "line",
  data: {
    datasets: [{
      label: "Kelembapan Tanah (%)",
      data: [],
      borderColor: "#27ae60",
      backgroundColor: "rgba(39,174,96,0.1)",
      tension: 0.3,
      fill: true,
      pointRadius: 3,
      pointHoverRadius: 5
    }]
  },
  options: {
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    scales: {
      x: {
        type: 'time',
        time: {
          unit: 'hour',
          displayFormats: {
            hour: 'HH:mm'
          },
          tooltipFormat: 'HH:mm'
        },
        title: { display: true, text: 'Waktu (Jam:Menit)' },
        grid: { display: false }
      },
      y: {
        min: 0,
        max: 100,
        title: { display: true, text: 'Kelembapan (%)' },
        grid: { color: "rgba(0,0,0,0.05)" }
      }
    },
    plugins: {
      tooltip: {
        callbacks: {
          label: (context) => `Kelembapan: ${context.raw}%`
        }
      }
    }
  }
});

/*********************************************************
 FUNGSI KONVERSI BATERAI
*********************************************************/

// Konversi tegangan baterai ke persentase
// 0% = 10V, 100% = 14.3V
function voltageToBatteryPercent(voltage) {
  const minVolt = 10;
  const maxVolt = 14.3;
  
  // Jika voltage di luar range, clamp ke batas
  if (voltage <= minVolt) return 0;
  if (voltage >= maxVolt) return 100;
  
  // Hitung persentase linear
  const percent = ((voltage - minVolt) / (maxVolt - minVolt)) * 100;
  return Math.round(percent);
}

// Update tampilan baterai
function updateBatteryDisplay(voltage) {
  const voltValue = parseFloat(voltage) || 0;
  const percent = voltageToBatteryPercent(voltValue);
  
  // Update persentase
  if (batteryPercentEl) {
    batteryPercentEl.textContent = percent + '%';
  }
  
  // Update progress bar
  if (batteryProgressBar) {
    batteryProgressBar.style.width = percent + '%';
    
    // Ubah warna berdasarkan level
    if (percent <= 20) {
      batteryProgressBar.style.background = 'linear-gradient(90deg, #ef4444, #dc2626)';
    } else if (percent <= 50) {
      batteryProgressBar.style.background = 'linear-gradient(90deg, #f59e0b, #d97706)';
    } else {
      batteryProgressBar.style.background = 'linear-gradient(90deg, #10b981, #059669)';
    }
  }
}

/*********************************************************
 FUNGSI KONVERSI INTENSITAS CAHAYA
*********************************************************/

// Konversi tegangan panel surya ke intensitas cahaya
// 0V = 0 W/m², 12V = 100 W/m², 18V = 1000 W/m²
function voltageToLightIntensity(voltage) {
  const voltValue = parseFloat(voltage) || 0;
  
  // Jika tegangan 0 atau sangat kecil, intensitas 0
  if (voltValue <= 0.1) return 0;
  
  // Untuk tegangan antara 0-12V
  if (voltValue < 12) {
    const intensity = (voltValue / 12) * 100;
    return Math.round(intensity);
  }
  
  // Untuk tegangan antara 12-18V
  if (voltValue >= 12 && voltValue <= 18) {
    const intensity = 100 + ((voltValue - 12) / 6) * 900;
    return Math.round(intensity);
  }
  
  // Untuk tegangan di atas 18V, maksimum 1000 W/m²
  if (voltValue > 18) {
    return 1000;
  }
  
  return 0;
}

// Update tampilan intensitas cahaya
function updateLightIntensityDisplay(voltage) {
  const voltValue = parseFloat(voltage) || 0;
  const intensity = voltageToLightIntensity(voltValue);
  
  if (lightIntensityEl) {
    lightIntensityEl.textContent = intensity + ' W/m²';
  }
}

/*********************************************************
 FUNGSI THRESHOLD DISPLAY
*********************************************************/

// Update tampilan threshold
function updateThresholdDisplay() {
  // Update label
  const onLabel = document.querySelector('.pump-on-label .threshold-value');
  const offLabel = document.querySelector('.pump-off-label .threshold-value');
  
  if (onLabel) onLabel.textContent = `≤${pumpOnThreshold}%`;
  if (offLabel) offLabel.textContent = `≥${pumpOffThreshold}%`;
  
  // Update deskripsi
  const desc = document.querySelector('.threshold-description');
  if (desc) {
    desc.innerHTML = `
      <i class="fas fa-info-circle"></i>
      <span>Pompa <strong>ON</strong> jika kelembapan <strong>≤${pumpOnThreshold}%</strong> • 
             Pompa <strong>OFF</strong> jika kelembapan <strong>≥${pumpOffThreshold}%</strong></span>
    `;
  }
  
  // Update lebar zona di threshold bar
  const onRange = document.querySelector('.pump-on-range');
  const optimalRange = document.querySelector('.optimal-range');
  const offRange = document.querySelector('.pump-off-range');
  
  if (onRange && optimalRange && offRange) {
    const onPercent = pumpOnThreshold;
    const offPercent = 100 - pumpOffThreshold;
    const optimalPercent = 100 - onPercent - offPercent;
    
    onRange.style.width = onPercent + '%';
    optimalRange.style.width = optimalPercent + '%';
    offRange.style.width = offPercent + '%';
    
    // Update label di dalam range
    const onLabelRange = onRange.querySelector('.range-label');
    const optimalLabelRange = optimalRange.querySelector('.range-label');
    const offLabelRange = offRange.querySelector('.range-label');
    
    if (onLabelRange) onLabelRange.textContent = `ON ≤${pumpOnThreshold}%`;
    if (optimalLabelRange) optimalLabelRange.textContent = 'Optimal';
    if (offLabelRange) offLabelRange.textContent = `OFF ≥${pumpOffThreshold}%`;
  }
}

// Fungsi untuk update threshold indicator berdasarkan nilai soil
function updateSoilThresholdIndicator(soilValue) {
  const pumpOnRange = document.querySelector('.pump-on-range');
  const optimalRange = document.querySelector('.optimal-range');
  const pumpOffRange = document.querySelector('.pump-off-range');
  
  // Hapus class highlight yang ada
  document.querySelectorAll('.threshold-range').forEach(el => {
    el.classList.remove('active-threshold');
  });
  
  // Tambah highlight berdasarkan nilai soil
  if (soilValue <= pumpOnThreshold) {
    pumpOnRange.classList.add('active-threshold');
  } else if (soilValue >= pumpOffThreshold) {
    pumpOffRange.classList.add('active-threshold');
  } else {
    optimalRange.classList.add('active-threshold');
  }
}

/*********************************************************
 FUNGSI MANAJEMEN HISTORI DETAIL
*********************************************************/

// Load detail history dari localStorage
function loadDetailHistory() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY_DETAIL);
    if (stored) {
      const parsed = JSON.parse(stored);
      // Filter data yang tidak lebih dari MAX_HISTORY_DAYS
      const cutoff = Date.now() - (MAX_HISTORY_DAYS * 24 * 60 * 60 * 1000);
      return parsed.filter(item => item.timestamp > cutoff);
    }
  } catch (e) {
    console.error('Gagal load detail history:', e);
  }
  return [];
}

// Simpan detail history ke localStorage
function saveDetailHistory() {
  try {
    // Batasi jumlah data yang disimpan
    const cutoff = Date.now() - (MAX_HISTORY_DAYS * 24 * 60 * 60 * 1000);
    soilDetailHistory = soilDetailHistory.filter(item => item.timestamp > cutoff);
    localStorage.setItem(STORAGE_KEY_DETAIL, JSON.stringify(soilDetailHistory));
  } catch (e) {
    console.error('Gagal save detail history:', e);
  }
}

// Tambah data detail (dipanggil setiap 5 menit)
function addDetailData(value) {
  const now = Date.now();
  const lastEntry = soilDetailHistory[soilDetailHistory.length - 1];
  
  // Cek apakah sudah 5 menit dari entry terakhir
  if (!lastEntry || (now - lastEntry.timestamp) >= DETAIL_INTERVAL) {
    soilDetailHistory.push({
      timestamp: now,
      value: value
    });
    
    // Hapus data lama
    const cutoff = now - (MAX_HISTORY_DAYS * 24 * 60 * 60 * 1000);
    soilDetailHistory = soilDetailHistory.filter(item => item.timestamp > cutoff);
    
    saveDetailHistory();
  }
}

/*********************************************************
 FUNGSI KALENDER
*********************************************************/

// Isi dropdown tanggal, bulan, tahun
function populateDatePicker() {
  const daySelect = document.getElementById('daySelect');
  const monthSelect = document.getElementById('monthSelect');
  const yearSelect = document.getElementById('yearSelect');
  
  const now = new Date();
  const currentYear = now.getFullYear();
  
  // Tahun (5 tahun ke belakang)
  yearSelect.innerHTML = '';
  for (let year = currentYear; year >= currentYear - 2; year--) {
    const option = document.createElement('option');
    option.value = year;
    option.textContent = year;
    yearSelect.appendChild(option);
  }
  
  // Bulan
  monthSelect.innerHTML = '';
  const bulan = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 
                 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
  for (let i = 0; i < 12; i++) {
    const option = document.createElement('option');
    option.value = i + 1;
    option.textContent = bulan[i];
    monthSelect.appendChild(option);
  }
  
  // Set ke bulan dan tahun sekarang
  monthSelect.value = now.getMonth() + 1;
  yearSelect.value = currentYear;
  
  // Isi tanggal berdasarkan bulan dan tahun yang dipilih
  updateDaySelect();
  
  // Event listener untuk update tanggal
  monthSelect.addEventListener('change', updateDaySelect);
  yearSelect.addEventListener('change', updateDaySelect);
}

// Update jumlah hari dalam bulan
function updateDaySelect() {
  const daySelect = document.getElementById('daySelect');
  const month = parseInt(document.getElementById('monthSelect').value);
  const year = parseInt(document.getElementById('yearSelect').value);
  
  const daysInMonth = new Date(year, month, 0).getDate();
  
  daySelect.innerHTML = '';
  for (let day = 1; day <= daysInMonth; day++) {
    const option = document.createElement('option');
    option.value = day;
    option.textContent = day;
    daySelect.appendChild(option);
  }
  
  // Set ke tanggal sekarang jika valid
  const now = new Date();
  if (now.getMonth() + 1 === month && now.getFullYear() === year) {
    daySelect.value = now.getDate();
  } else {
    daySelect.value = 1;
  }
}

/*********************************************************
 FUNGSI LOAD DATA HISTORIS
*********************************************************/

// Load data untuk tanggal yang dipilih
function loadHistoricalData() {
  const day = parseInt(document.getElementById('daySelect').value);
  const month = parseInt(document.getElementById('monthSelect').value);
  const year = parseInt(document.getElementById('yearSelect').value);
  
  // Buat range tanggal (00:00 - 23:59)
  const startDate = new Date(year, month - 1, day, 0, 0, 0);
  const endDate = new Date(year, month - 1, day, 23, 59, 59);
  
  const startTimestamp = startDate.getTime();
  const endTimestamp = endDate.getTime();
  
  // Filter data dalam range tanggal
  const filteredData = soilDetailHistory
    .filter(item => item.timestamp >= startTimestamp && item.timestamp <= endTimestamp)
    .sort((a, b) => a.timestamp - b.timestamp);
  
  // Format data untuk chart
  const chartData = filteredData.map(item => ({
    x: new Date(item.timestamp),
    y: item.value
  }));
  
  // Update chart
  detailedChart.data.datasets[0].data = chartData;
  detailedChart.update();
  
  // Update info
  const formattedDate = `${day} ${getMonthName(month)} ${year}`;
  const selectedDateEl = document.getElementById('selectedDate');
  const dataPointCountEl = document.getElementById('dataPointCount');
  
  if (selectedDateEl) selectedDateEl.textContent = formattedDate;
  if (dataPointCountEl) dataPointCountEl.textContent = filteredData.length;
  
  // Tampilkan container chart
  const chartContainer = document.getElementById('detailedChartContainer');
  if (chartContainer) chartContainer.classList.remove('hidden');
}

// Helper: dapatkan nama bulan
function getMonthName(month) {
  const bulan = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 
                 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
  return bulan[month - 1];
}

/*********************************************************
 FUNGSI TOGGLE HISTORY PANEL
*********************************************************/

// Toggle panel history
function toggleHistoryPanel() {
  const panel = document.getElementById('historyPanel');
  const gridContainer = document.getElementById('dataGridContainer');
  const historyBtnIcon = document.querySelector('.history-btn i:last-child');
  
  if (panel.classList.contains('hidden')) {
    panel.classList.remove('hidden');
    // Pindahkan grid container ke dalam panel
    if (gridContainer && panel) {
      panel.appendChild(gridContainer);
    }
    // Ubah icon chevron
    if (historyBtnIcon) {
      historyBtnIcon.className = 'fas fa-chevron-up';
    }
  } else {
    panel.classList.add('hidden');
    // Kembalikan grid container ke posisi semula
    const container = document.querySelector('.container');
    if (gridContainer && container) {
      container.insertBefore(gridContainer, document.querySelector('.card.control-card'));
    }
    // Sembunyikan juga chart detail
    closeDetailedChart();
    // Ubah icon chevron
    if (historyBtnIcon) {
      historyBtnIcon.className = 'fas fa-chevron-down';
    }
  }
}

// Tutup chart detail
function closeDetailedChart() {
  const chartContainer = document.getElementById('detailedChartContainer');
  if (chartContainer) {
    chartContainer.classList.add('hidden');
  }
  detailedChart.data.datasets[0].data = [];
  detailedChart.update();
}

/*********************************************************
 FUNGSI REAL-TIME CHART
*********************************************************/
function addSoilData(val) {
  const time = new Date().toLocaleTimeString();
  soilChart.data.labels.push(time);
  soilChart.data.datasets[0].data.push(val);

  if (soilChart.data.labels.length > 20) {
    soilChart.data.labels.shift();
    soilChart.data.datasets[0].data.shift();
  }

  soilChart.update();
  lastUpdate.textContent = time;
  
  // Tambah ke history detail (setiap 5 menit)
  addDetailData(val);
}

/*********************************************************
 MQTT EVENTS
*********************************************************/
client.on("connect", () => {
  mqttStatus.textContent = "CONNECTED";
  mqttStatus.className = "ok";
  client.subscribe("irrigation/#");
  console.log("MQTT Connected - Subscribed to irrigation/#");
});

client.on("offline", () => {
  mqttStatus.textContent = "DISCONNECTED";
  mqttStatus.className = "bad";
  console.log("MQTT Offline");
});

client.on("error", (err) => {
  console.error("MQTT Error:", err);
});

/*********************************************************
 MESSAGE HANDLER
*********************************************************/
client.on("message", (topic, message) => {
  const data = message.toString();

  // Heartbeat
  if (topic === "irrigation/heartbeat") {
    lastHeartbeat = Date.now();
    everOnline = true;
    espStatus.textContent = "ONLINE";
    espStatus.className = "ok";
    return;
  }

  // Threshold values
  if (topic === "irrigation/threshold/pompa_on") {
  pumpOnThreshold = parseInt(data) || 50;
  console.log("Pompa ON threshold:", pumpOnThreshold);
  updateThresholdDisplay();
  return;
}

if (topic === "irrigation/threshold/pompa_off") {
  pumpOffThreshold = parseInt(data) || 80;
  console.log("Pompa OFF threshold:", pumpOffThreshold);
  updateThresholdDisplay();
  return;
}

// Fungsi untuk update tampilan threshold
function updateThresholdDisplay() {
  // Update label
  const onLabel = document.querySelector('.pump-on-label .threshold-value');
  const offLabel = document.querySelector('.pump-off-label .threshold-value');
  
  if (onLabel) onLabel.textContent = `≤${pumpOnThreshold}%`;
  if (offLabel) offLabel.textContent = `≥${pumpOffThreshold}%`;
  
  // Update deskripsi - PERBAIKI LOGIKA
  const desc = document.querySelector('.threshold-description');
  if (desc) {
    desc.innerHTML = `
      <i class="fas fa-info-circle"></i>
      <span>Pompa <strong>ON</strong> jika kelembapan <strong>≤${pumpOnThreshold}%</strong> • 
             Pompa <strong>OFF</strong> jika kelembapan <strong>≥${pumpOffThreshold}%</strong></span>
    `;
  }
  
  // Update lebar zona di threshold bar
  const onRange = document.querySelector('.pump-on-range');
  const optimalRange = document.querySelector('.optimal-range');
  const offRange = document.querySelector('.pump-off-range');
  
  if (onRange && optimalRange && offRange) {
    const onPercent = pumpOnThreshold;
    const offPercent = 100 - pumpOffThreshold;
    const optimalPercent = 100 - onPercent - offPercent;
    
    onRange.style.width = onPercent + '%';
    optimalRange.style.width = optimalPercent + '%';
    offRange.style.width = offPercent + '%';
    
    // Update label di dalam range - PERBAIKI LABEL
    const onLabelRange = onRange.querySelector('.range-label');
    const optimalLabelRange = optimalRange.querySelector('.range-label');
    const offLabelRange = offRange.querySelector('.range-label');
    
    if (onLabelRange) onLabelRange.textContent = `ON ≤${pumpOnThreshold}%`;
    if (optimalLabelRange) optimalLabelRange.textContent = 'Optimal';
    if (offLabelRange) offLabelRange.textContent = `OFF ≥${pumpOffThreshold}%`;
  }
}

  // Soil moisture
  if (topic === "irrigation/soil") {
    const soilValue = Number(data);
    soilEl.textContent = soilValue;
    const soilProgress = document.getElementById('soilProgress');
    if (soilProgress) soilProgress.style.width = soilValue + '%';
    addSoilData(soilValue);
    
    // Update visual indicator berdasarkan threshold
    updateSoilThresholdIndicator(soilValue);
    return;
  }

  // Battery data
  if (topic === "irrigation/battery/voltage") {
    battVoltEl.textContent = data;
    updateBatteryDisplay(data);
    return;
  }
  
  if (topic === "irrigation/battery/current") {
    battCurrEl.textContent = data;
    return;
  }
  
  if (topic === "irrigation/battery/power") {
    battPowerEl.textContent = data;
    return;
  }

  // Solar panel data
  if (topic === "irrigation/panel/voltage") {
    panelVoltEl.textContent = data;
    updateLightIntensityDisplay(data);
    return;
  }
  
  if (topic === "irrigation/panel/current") {
    panelCurrEl.textContent = data;
    return;
  }
  
  if (topic === "irrigation/panel/power") {
    panelPowerEl.textContent = data;
    return;
  }

  // Mode and pump status
  if (topic === "irrigation/mode") {
    modeEl.textContent = data === "1" ? "AUTO" : "MANUAL";
    return;
  }

  if (topic === "irrigation/pump") {
    pompaEl.textContent = data === "1" ? "ON" : "OFF";
    return;
  }
});

/*********************************************************
 ONLINE CHECK
*********************************************************/
setInterval(() => {
  const now = Date.now();

  if (!everOnline && now - pageStart > 4000) {
    espStatus.textContent = "OFFLINE";
    espStatus.className = "bad";
  }

  if (everOnline && now - lastHeartbeat > HEARTBEAT_TIMEOUT) {
    espStatus.textContent = "OFFLINE";
    espStatus.className = "bad";
    everOnline = false;
  }
}, 1000);

/*********************************************************
 CONTROL BUTTON
*********************************************************/
function toggleMode() {
  client.publish("irrigation/cmd/mode", "TOGGLE");
  console.log("Toggle mode command sent");
}

function setPump(state) {
  client.publish("irrigation/cmd/pump", state);
  console.log("Pump command sent:", state);
}

/*********************************************************
 INITIALIZATION
*********************************************************/

// Populate date picker
populateDatePicker();

// Set initial threshold display
updateThresholdDisplay();

// Set initial battery display (default 12.7V)
updateBatteryDisplay(12.7);

// Set initial light intensity (default 9.7V)
updateLightIntensityDisplay(9.7);

// Simulasi data demo (untuk testing)
function addDemoDetailData() {
  const now = Date.now();
  const oneDay = 24 * 60 * 60 * 1000;
  
  // Buat data 3 hari terakhir dengan interval 5 menit
  for (let day = 0; day < 3; day++) {
    for (let minute = 0; minute < 24 * 60; minute += 5) {
      const timestamp = now - (day * oneDay) - (minute * 60 * 1000);
      // Simulasi pola kelembapan (lebih rendah di siang hari)
      const hour = new Date(timestamp).getHours();
      let baseValue = 50;
      if (hour >= 10 && hour <= 16) {
        baseValue = 35 + Math.random() * 15; // Lebih kering di siang
      } else {
        baseValue = 55 + Math.random() * 20; // Lebih basah di malam
      }
      
      soilDetailHistory.push({
        timestamp: timestamp,
        value: Math.round(baseValue * 10) / 10
      });
    }
  }
  
  saveDetailHistory();
  console.log("Demo data added:", soilDetailHistory.length, "points");
}

// Uncomment untuk menambah data demo (jika history kosong)
if (soilDetailHistory.length === 0) {
  addDemoDetailData();
}
