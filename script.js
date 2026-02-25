
const SUPABASE_URL = 'https://rtmbetaxgpqivnwvfnch.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ0bWJldGF4Z3BxaXZud3ZmbmNoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE1OTM5MzUsImV4cCI6MjA4NzE2OTkzNX0.0NIEEnDYm3mmKbDIyTSKQb_zy2hIeRi3q0zZ24e1uBs';


const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Global variables
let nodes = [];                
let selectedNodeId = null;     
let temperatureData = [];
let gasData = [];
let timestamps = [];
let isDanger = false;
let unreadAlerts = 0;
let tempChart, gasChart;

// Settings (defaults)
let settings = {
    gasWarning: 300,
    tempWarning: 40,
    flameDanger: true
};

// DOM elements
const nodeListEl = document.getElementById('nodeList');
const tempValueEl = document.getElementById('tempValue');
const humidityValueEl = document.getElementById('humidityValue');
const gasValueEl = document.getElementById('gasValue');
const flameValueEl = document.getElementById('flameValue');
const dangerOverlay = document.getElementById('dangerOverlay');
const ambientBg = document.getElementById('ambientBg');
const notificationBadge = document.getElementById('notificationBadge');
const alertListEl = document.getElementById('alertList');
const settingsModal = document.getElementById('settingsModal');
const settingsIcon = document.getElementById('settingsIcon');
const closeSettings = document.getElementById('closeSettings');
const saveSettings = document.getElementById('saveSettings');
const gasThresholdInput = document.getElementById('gasThreshold');
const tempThresholdInput = document.getElementById('tempThreshold');
const flameModeSelect = document.getElementById('flameMode');
const dashboardContent = document.getElementById('dashboardContent');
const lastUpdateEl = document.getElementById('lastUpdate');
const sidebar = document.getElementById('sidebar');

// ========== INIT ==========
async function init() {
    await fetchNodes();
    if (nodes.length > 0) {
        selectedNodeId = nodes[0].id;
        renderNodeList();
        await loadInitialHistory();
        initCharts();
        setupEventListeners();

        // Real‑time subscription
        supabaseClient
            .channel('sensor_data_changes')
            .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'sensor_data' }, handleNewData)
            .subscribe();

        sidebar.classList.remove('hidden');
    } else {
        dashboardContent.innerHTML = '<p class="text-center text-gray-400 mt-10">No systems found. Please add nodes in Supabase.</p>';
    }
}

// ========== FETCH NODES ==========
async function fetchNodes() {
    const { data, error } = await supabaseClient
        .from('nodes')
        .select('*')
        .order('name');
    if (error) {
        console.error('Error fetching nodes:', error);
        nodes = [];
    } else {
        nodes = data;
    }
}

// ========== RENDER NODE LIST ==========
function renderNodeList() {
    nodeListEl.innerHTML = '';
    nodes.forEach(node => {
        const li = document.createElement('li');
        li.className = `p-2 rounded cursor-pointer transition flex items-center space-x-2 ${node.id === selectedNodeId ? 'bg-gray-700' : 'hover:bg-gray-700'}`;
        li.dataset.id = node.id;
        li.innerHTML = `
            <span class="w-3 h-3 rounded-full bg-gray-500" id="status-${node.id}"></span>
            <span>${node.name}</span>
            <span class="text-xs text-gray-400 ml-auto">${node.location}</span>
        `;
        li.addEventListener('click', () => selectNode(node.id));
        nodeListEl.appendChild(li);
    });
}

// ========== SELECT NODE ==========
async function selectNode(nodeId) {
    if (nodeId === selectedNodeId) return;
    dashboardContent.classList.add('fade-out');
    selectedNodeId = nodeId;
    renderNodeList();
    await loadInitialHistory();
    dashboardContent.classList.remove('fade-out');
}

// ========== LOAD INITIAL HISTORY ==========
async function loadInitialHistory() {
    const { data, error } = await supabaseClient
        .from('sensor_data')
        .select('*')
        .eq('node_id', selectedNodeId)
        .order('timestamp', { ascending: false })
        .limit(20);

    if (error) {
        console.error('Error loading history:', error);
        return;
    }

    const readings = data.reverse(); // chronological order
    temperatureData = readings.map(r => r.temperature);
    gasData = readings.map(r => r.gas);
    timestamps = readings.map(r => new Date(r.timestamp).toLocaleTimeString());

    updateCharts();

    if (readings.length > 0) {
        const latest = readings[readings.length - 1];
        updateCurrentValues(latest);
        checkDanger(latest);
        updateLastUpdate(latest.timestamp);
    }
}

// ========== HANDLE NEW DATA (REAL‑TIME) ==========
function handleNewData(payload) {
    const newReading = payload.new;
    if (newReading.node_id !== selectedNodeId) return;

    // Pulse cards
    document.querySelectorAll('.sensor-card').forEach(card => {
        card.classList.add('card-pulse');
        setTimeout(() => card.classList.remove('card-pulse'), 300);
    });

    updateCurrentValues(newReading);
    checkDanger(newReading);
    updateLastUpdate(newReading.timestamp);

    // Update chart data
    temperatureData.push(newReading.temperature);
    gasData.push(newReading.gas);
    timestamps.push(new Date(newReading.timestamp).toLocaleTimeString());
    if (temperatureData.length > 20) {
        temperatureData.shift();
        gasData.shift();
        timestamps.shift();
    }
    updateCharts();

    // Handle danger alert
    if (newReading.danger) {
        addAlert('Danger detected at ' + new Date(newReading.timestamp).toLocaleTimeString());
        unreadAlerts++;
        updateNotificationBadge();

        const audio = document.getElementById('alertSound');
        audio.play().catch(e => console.log('Audio play failed:', e));
    }
}

// ========== UPDATE CURRENT VALUES ==========
function updateCurrentValues(reading) {
    tempValueEl.textContent = reading.temperature + '°C';
    humidityValueEl.textContent = reading.humidity + '%';
    gasValueEl.textContent = reading.gas + ' ppm';
    flameValueEl.textContent = reading.flame ? '🔥 DETECTED' : '✓ SAFE';
}

// ========== CHECK DANGER ==========
function checkDanger(reading) {
    const gasDanger = reading.gas > settings.gasWarning;
    const tempDanger = reading.temperature > settings.tempWarning;
    const flameDanger = settings.flameDanger && reading.flame;
    const newDanger = gasDanger || tempDanger || flameDanger;

    if (newDanger !== isDanger) {
        isDanger = newDanger;
        if (isDanger) {
            dangerOverlay.classList.remove('hidden');
            ambientBg.style.background = 'radial-gradient(circle at top left, #3a1a1a, #1a0a0a)';
        } else {
            dangerOverlay.classList.add('hidden');
            ambientBg.style.background = 'radial-gradient(circle at top left, #1a2a3a, #0a0f14)';
        }
    }

    // Update node status color
    const statusEl = document.getElementById(`status-${selectedNodeId}`);
    if (statusEl) {
        if (isDanger) statusEl.className = 'w-3 h-3 rounded-full bg-red-500';
        else if (reading.temperature > settings.tempWarning * 0.8 || reading.gas > settings.gasWarning * 0.8)
            statusEl.className = 'w-3 h-3 rounded-full bg-yellow-500';
        else
            statusEl.className = 'w-3 h-3 rounded-full bg-green-500';
    }
}

// ========== UPDATE LAST UPDATE TIMESTAMP ==========
function updateLastUpdate(timestamp) {
    const now = new Date();
    const diffMs = now - new Date(timestamp);
    const diffSec = Math.floor(diffMs / 1000);
    const diffMin = Math.floor(diffSec / 60);
    let text;
    if (diffSec < 5) text = 'just now';
    else if (diffSec < 60) text = `${diffSec} seconds ago`;
    else if (diffMin < 60) text = `${diffMin} minute${diffMin > 1 ? 's' : ''} ago`;
    else text = new Date(timestamp).toLocaleTimeString();
    lastUpdateEl.innerHTML = `Last update: ${text}`;
}

// ========== ADD ALERT ==========
function addAlert(message) {
    const li = document.createElement('li');
    li.className = 'text-red-400 flex items-center gap-2';
    li.innerHTML = `<i class="fas fa-exclamation-triangle"></i>${message}`;
    alertListEl.prepend(li);
    if (alertListEl.children.length > 5) {
        alertListEl.removeChild(alertListEl.lastChild);
    }
}

// ========== UPDATE NOTIFICATION BADGE ==========
function updateNotificationBadge() {
    if (unreadAlerts > 0) {
        notificationBadge.textContent = unreadAlerts;
        notificationBadge.classList.remove('hidden');
    } else {
        notificationBadge.classList.add('hidden');
    }
}

// ========== INIT CHARTS (with proper sizing) ==========
function initCharts() {
    const tempCtx = document.getElementById('tempChart').getContext('2d');
    tempChart = new Chart(tempCtx, {
        type: 'line',
        data: {
            labels: timestamps,
            datasets: [{
                label: 'Temperature (°C)',
                data: temperatureData,
                borderColor: '#3b82f6',
                backgroundColor: 'rgba(59,130,246,0.1)',
                tension: 0.2,
                pointBackgroundColor: '#3b82f6',
                pointBorderColor: '#fff',
                borderWidth: 2
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            aspectRatio: 2, 
            scales: {
                y: {
                    beginAtZero: false,
                    grid: { color: '#374151' },
                    ticks: { maxTicksLimit: 5 }
                },
                x: {
                    ticks: {
                        maxRotation: 45,
                        minRotation: 30,
                        font: { size: 10 }
                    }
                }
            },
            plugins: {
                legend: { labels: { color: '#9ca3af', font: { size: 12 } } }
            }
        }
    });

    const gasCtx = document.getElementById('gasChart').getContext('2d');
    gasChart = new Chart(gasCtx, {
        type: 'bar',
        data: {
            labels: timestamps,
            datasets: [{
                label: 'Gas (ppm)',
                data: gasData,
                backgroundColor: 'rgba(239,68,68,0.6)',
                borderRadius: 4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            aspectRatio: 2,
            scales: {
                y: {
                    beginAtZero: true,
                    grid: { color: '#374151' },
                    ticks: { maxTicksLimit: 5 }
                },
                x: {
                    ticks: {
                        maxRotation: 45,
                        minRotation: 30,
                        font: { size: 10 }
                    }
                }
            },
            plugins: {
                legend: { labels: { color: '#9ca3af', font: { size: 12 } } }
            }
        }
    });
}

// ========== UPDATE CHARTS ==========
function updateCharts() {
    if (tempChart) {
        tempChart.data.labels = timestamps;
        tempChart.data.datasets[0].data = temperatureData;
        tempChart.update();
    }
    if (gasChart) {
        gasChart.data.labels = timestamps;
        gasChart.data.datasets[0].data = gasData;
        gasChart.update();
    }
}

// ========== SETUP EVENT LISTENERS ==========
function setupEventListeners() {
    settingsIcon.addEventListener('click', () => {
        settingsModal.classList.remove('hidden');
    });

    closeSettings.addEventListener('click', () => {
        settingsModal.classList.add('hidden');
    });

    saveSettings.addEventListener('click', () => {
        settings.gasWarning = parseInt(gasThresholdInput.value) || 300;
        settings.tempWarning = parseInt(tempThresholdInput.value) || 40;
        settings.flameDanger = flameModeSelect.value === 'true';
        settingsModal.classList.add('hidden');
    });

    document.getElementById('notificationBell').addEventListener('click', () => {
        unreadAlerts = 0;
        updateNotificationBadge();
    });
}

// Start the app
init();