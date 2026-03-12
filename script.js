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
      fill: true
    }]
  },
  options: {
    responsive: true,
    animation: false,
    scales: {
      y: {
        min: 0,
        max: 100,
        title: { display: true, text: "Kelembapan (%)" }
      },
      x: {
        title: { display: true, text: "Waktu (Jam:Menit:Detik)" }
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
        title: { display: true, text: 'Waktu (Jam:Menit)' }
      },
      y: {
        min: 0,
        max: 100,
        title: { display: true, text: 'Kelembapan (%)' }
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
  document.getElementById('selectedDate').textContent = formattedDate;
  document.getElementById('dataPointCount').textContent = filteredData.length;
  
  // Tampilkan container chart
  document.getElementById('detailedChartContainer').classList.remove('hidden');
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
  
  if (panel.classList.contains('hidden')) {
    panel.classList.remove('hidden');
    // Pindahkan grid container ke dalam panel
    document.querySelector('.history-panel').appendChild(gridContainer);
  } else {
    panel.classList.add('hidden');
    // Kembalikan grid container ke posisi semula
    document.querySelector('.container').insertBefore(
      gridContainer, 
      document.querySelector('.card:last-child')
    );
    // Sembunyikan juga chart detail
    closeDetailedChart();
  }
}

// Tutup chart detail
function closeDetailedChart() {
  document.getElementById('detailedChartContainer').classList.add('hidden');
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
});

client.on("offline", () => {
  mqttStatus.textContent = "DISCONNECTED";
  mqttStatus.className = "bad";
});

/*********************************************************
 MESSAGE HANDLER
*********************************************************/
client.on("message", (topic, message) => {
  const data = message.toString();

  if (topic === "irrigation/heartbeat") {
    lastHeartbeat = Date.now();
    everOnline = true;
    espStatus.textContent = "ONLINE";
    espStatus.className = "ok";
    return;
  }

  if (topic === "irrigation/soil") {
  const soilValue = Number(data);
  soilEl.textContent = soilValue;
  document.getElementById('soilProgress').style.width = soilValue + '%';
  addSoilData(soilValue);
  addDetailData(soilValue);
  }
  function updateBatteryPercent() {
    const battVolt = parseFloat(document.getElementById('battVolt').textContent) || 12.7;
    // Simulasi persentase berdasarkan voltase (asumsi baterai 12V penuh di 13.8V)
    const percent = Math.min(100, Math.max(0, ((battVolt - 11) / (13.8 - 11)) * 100));
    const percentRounded = Math.round(percent);
    document.getElementById('batteryPercent').textContent = percentRounded + '%';
    document.getElementById('batteryProgressBar').style.width = percentRounded + '%';
  }

  if (topic === "irrigation/battery/voltage") {
  battVoltEl.textContent = data;
  updateBatteryPercent();
  }

  if (topic === "irrigation/battery/voltage") battVoltEl.textContent = data;
  if (topic === "irrigation/battery/current") battCurrEl.textContent = data;
  if (topic === "irrigation/battery/power")   battPowerEl.textContent = data;

  if (topic === "irrigation/panel/voltage") panelVoltEl.textContent = data;
  if (topic === "irrigation/panel/current") panelCurrEl.textContent = data;
  if (topic === "irrigation/panel/power")   panelPowerEl.textContent = data;

  if (topic === "irrigation/mode")
    modeEl.textContent = data === "1" ? "AUTO" : "MANUAL";

  if (topic === "irrigation/pump")
    pompaEl.textContent = data === "1" ? "ON" : "OFF";
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
  }
}, 1000);

/*********************************************************
 CONTROL BUTTON
*********************************************************/
function toggleMode() {
  client.publish("irrigation/cmd/mode", "TOGGLE");
}

function setPump(state) {
  client.publish("irrigation/cmd/pump", state);
}

/*********************************************************
 INITIALIZATION
*********************************************************/

// Populate date picker
populateDatePicker();

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
}

// Uncomment untuk menambah data demo (jika history kosong)
if (soilDetailHistory.length === 0) {
  addDemoDetailData();
}