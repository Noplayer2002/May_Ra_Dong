import { DeviceService } from './services/deviceService.js';
import { UIRenderer } from './ui/uiRenderer.js';

// Central State
const AppState = {
    devices: {},
    selectedDeviceId: null,
    isScanningWifi: false,
    currentDeviceRecords: {}
};

// UI Page Navigations
function showPage(pageId) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.getElementById(pageId).classList.add('active');
    if (pageId === 'device-selection-page') AppState.selectedDeviceId = null;
}

function switchTab(e, tabId) {
    document.querySelectorAll('.tab-content, .nav a').forEach(el => el.classList.remove('active'));
    document.getElementById(tabId).classList.add('active');
    e.target.classList.add('active');
}

function selectDevice(id) {
    AppState.selectedDeviceId = id;
    document.getElementById('selected-device-name').textContent = id;
    const device = AppState.devices[id];
    
    UIRenderer.updateDeviceDetails(device);
    if (device.wifi_list) UIRenderer.renderWifiList(device.wifi_list, (ssid) => {
        document.getElementById('ssid').value = ssid;
        document.getElementById('wifi-pass').focus();
    });

    renderHL7Dropdown(device);
    showPage('settings-page');
}

function renderHL7Dropdown(device) {
    const selectEl = document.getElementById('record-select');
    selectEl.innerHTML = '<option value="">-- Chọn mã bản tin --</option>';
    AppState.currentDeviceRecords = {};

    const historyNode = device.history || {};
    const keys = Object.keys(historyNode).sort().reverse();
    
    keys.forEach(key => {
        if (historyNode[key]?.raw_hl7) {
            AppState.currentDeviceRecords[key] = historyNode[key].raw_hl7;
            const opt = document.createElement('option');
            opt.value = key;
            opt.textContent = `📋 ${key}`;
            selectEl.appendChild(opt);
        }
    });

    const firstKey = keys.find(k => AppState.currentDeviceRecords[k]);
    if (firstKey) {
        selectEl.value = firstKey;
        UIRenderer.displayHL7Detail(AppState.currentDeviceRecords[firstKey], firstKey);
    } else {
        document.getElementById('record-empty-state').style.display = 'block';
        document.getElementById('record-detail-view').style.display = 'none';
    }
}

// Global Setup
document.addEventListener('DOMContentLoaded', () => {
    // 1. Subscribe to Firebase Data
    DeviceService.subscribeDevices((data) => {
        AppState.devices = data;
        if (document.getElementById('device-selection-page').classList.contains('active')) {
            const query = document.getElementById('search-input').value;
            UIRenderer.renderDeviceList(AppState.devices, query, selectDevice);
        }
        if (AppState.selectedDeviceId && AppState.devices[AppState.selectedDeviceId]) {
            const currentDev = AppState.devices[AppState.selectedDeviceId];
            UIRenderer.updateDeviceDetails(currentDev);
            if (currentDev.wifi_list) {
                UIRenderer.renderWifiList(currentDev.wifi_list, (ssid) => {
                    document.getElementById('ssid').value = ssid;
                    document.getElementById('wifi-pass').focus();
                });
            }
        }
    });

    // 2. Search Box Filter
    document.getElementById('search-input').addEventListener('input', (e) => {
        UIRenderer.renderDeviceList(AppState.devices, e.target.value, selectDevice);
    });

    // 3. Navigation Events
    document.getElementById('btn-back').onclick = () => showPage('device-selection-page');
    document.querySelectorAll('.nav a').forEach(a => {
        a.onclick = (e) => switchTab(e, a.dataset.tab);
    });

    // 4. Action: Global Ping
    const pingBtn = document.getElementById('btn-check-device-status');
    pingBtn.onclick = async () => {
        pingBtn.disabled = true;
        pingBtn.textContent = "⏳ Đang phát sóng...";
        
        // KHÔNG truyền AppState.devices vào nữa
        await DeviceService.broadcastPing(); 
        
        pingBtn.disabled = false;
        pingBtn.textContent = "⚡ Quét Trạng Thái (Global Ping)";
    };

    // 5. Action: Scan Wifi
    const scanWifiBtn = document.getElementById('btn-scan-wifi');
    scanWifiBtn.onclick = async () => {
        if (!AppState.selectedDeviceId) return;
        scanWifiBtn.disabled = true;
        scanWifiBtn.textContent = "⏳ Đang quét Wi-Fi...";
        await DeviceService.triggerScanWifi(AppState.selectedDeviceId);
        setTimeout(() => {
            scanWifiBtn.disabled = false;
            scanWifiBtn.textContent = "🔍 Quét Wi-Fi Xung Quanh";
        }, 8000);
    };

    // 6. Action: Forms Submit - CHỈ GỬI CÁC THAM SỐ THỰC SỰ THAY ĐỔI

    // FORM WIFI
    document.getElementById('wifi-connect-form').onsubmit = async (e) => {
        e.preventDefault();
        const devId = AppState.selectedDeviceId;
        if (!devId) return;

        const currentDevice = AppState.devices[devId] || {};
        const currentWifi = currentDevice.wifi || {};

        const newSsid = document.getElementById('ssid').value.trim();
        const newPass = document.getElementById('wifi-pass').value;

        const changedFields = {};
        if (newSsid !== (currentWifi.ssid || '')) {
            changedFields['ssid'] = newSsid;
        }
        if (newPass && newPass !== (currentWifi.pass || '')) {
            changedFields['pass'] = newPass;
        }

        if (Object.keys(changedFields).length === 0) {
            alert("ℹ️ Thông tin Wi-Fi không có thay đổi nào!");
            return;
        }

        await DeviceService.updateWifi(devId, changedFields);
        alert(`✅ Đã cập nhật Wi-Fi (${Object.keys(changedFields).join(', ')})!`);
    };

    // FORM TCP
    document.getElementById('tcp-form').onsubmit = async (e) => {
        e.preventDefault();
        const devId = AppState.selectedDeviceId;
        if (!devId) return;

        const currentDevice = AppState.devices[devId] || {};
        const currentTcp = currentDevice.tcp || {};

        const newIp = document.getElementById('server_ip').value.trim();
        const newPort = parseInt(document.getElementById('server_port').value);

        const changedFields = {};
        if (newIp !== (currentTcp.server_ip || '')) {
            changedFields['server_ip'] = newIp;
        }
        if (!isNaN(newPort) && newPort !== Number(currentTcp.server_port)) {
            changedFields['server_port'] = newPort;
        }

        if (Object.keys(changedFields).length === 0) {
            alert("ℹ️ Cấu hình TCP không có thay đổi nào!");
            return;
        }

        await DeviceService.updateTcp(devId, changedFields);
        alert(`✅ Đã cập nhật TCP (${Object.keys(changedFields).join(', ')})!`);
    };

    // FORM PLASMA THAWER
    document.getElementById('plasma-form').onsubmit = async (e) => {
        e.preventDefault();
        const devId = AppState.selectedDeviceId;
        if (!devId) return;

        const currentDevice = AppState.devices[devId] || {};
        const currentPlasma = currentDevice.plasma || {};

        const plasmaFields = [
            'sp_t_operator', 'sp_t_hot', 'sp_fan', 't_max', 't_min', 
            't_offset_1', 'r_cal_1', 't_offset_2', 'r_cal_2', 
            't_offset_3', 'r_cal_3', 't_offset_4', 'r_cal_4', 
            'pid_kp', 'pid_ti', 'pid_td'
        ];

        const changedFields = {};

        plasmaFields.forEach(field => {
            const inputVal = document.getElementById(field).value;
            if (inputVal === '') return;

            const newVal = parseFloat(inputVal);
            const origVal = currentPlasma[field] !== undefined ? parseFloat(currentPlasma[field]) : null;

            // Kiểm tra xem trường này có bị sửa đổi hay chưa từng tồn tại
            if (origVal === null || Math.abs(newVal - origVal) > 0.0001) {
                changedFields[field] = newVal;
            }
        });

        if (Object.keys(changedFields).length === 0) {
            alert("ℹ️ Cấu hình Plasma không có thay đổi nào!");
            return;
        }

        await DeviceService.updatePlasma(devId, changedFields);
        alert(`✅ Đã cập nhật ${Object.keys(changedFields).length} thông số Plasma:\n${Object.keys(changedFields).join(', ')}`);
    };

    // 7. HL7 Record Select & Copy
    document.getElementById('record-select').onchange = (e) => {
        const val = e.target.value;
        if (val && AppState.currentDeviceRecords[val]) {
            UIRenderer.displayHL7Detail(AppState.currentDeviceRecords[val], val);
        }
    };

    document.getElementById('btn-copy-hl7').onclick = () => {
        const raw = document.getElementById('hl7-raw-content').textContent;
        if (raw) {
            navigator.clipboard.writeText(raw).then(() => alert("📋 Đã sao chép HL7!"));
        }
    };
});
