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

   // 6. Action: Forms Submit
    document.getElementById('wifi-connect-form').onsubmit = async (e) => {
        e.preventDefault();
        await DeviceService.saveWifi(AppState.selectedDeviceId, 
            document.getElementById('ssid').value, 
            document.getElementById('wifi-pass').value
        );
        alert("✅ Đã gửi lệnh lưu Wi-Fi!");
    };

    // Cập nhật TCP chính xác theo trường thay đổi
    document.getElementById('tcp-form').onsubmit = async (e) => {
        e.preventDefault();
        const devId = AppState.selectedDeviceId;
        if (!devId) return;

        const currentTcp = AppState.devices[devId]?.tcp || {};
        const newIp = document.getElementById('server_ip').value.trim();
        const newPort = parseInt(document.getElementById('server_port').value);

        const diffTcp = {};
        if (newIp !== (currentTcp.server_ip || '')) diffTcp.server_ip = newIp;
        if (!isNaN(newPort) && newPort !== currentTcp.server_port) diffTcp.server_port = newPort;

        if (Object.keys(diffTcp).length === 0) {
            alert("ℹ️ Không có thông số TCP nào thay đổi!");
            return;
        }

        await DeviceService.updateTcp(devId, diffTcp);
        alert(`✅ Đã cập nhật TCP: ${Object.keys(diffTcp).join(', ')}`);
    };

    // Cập nhật CẤU HÌNH PLASMA: Chỉ gửi các trường có giá trị thay đổi
    document.getElementById('plasma-form').onsubmit = async (e) => {
        e.preventDefault();
        const devId = AppState.selectedDeviceId;
        if (!devId) return;

        const currentPlasma = AppState.devices[devId]?.plasma || {};
        const plasmaFields = [
            'sp_t_operator', 'sp_t_hot', 'sp_fan', 't_max', 't_min', 
            't_offset_1', 'r_cal_1', 't_offset_2', 'r_cal_2', 
            't_offset_3', 'r_cal_3', 't_offset_4', 'r_cal_4', 
            'pid_kp', 'pid_ti', 'pid_td'
        ];

        const diffPayload = {};
        plasmaFields.forEach(f => {
            const inputEl = document.getElementById(f);
            if (inputEl && inputEl.value.trim() !== '') {
                const newVal = parseFloat(inputEl.value);
                const oldVal = currentPlasma[f] !== undefined ? parseFloat(currentPlasma[f]) : null;

                // Kiểm tra xem giá trị có bị sửa đổi hay không (sai số làm tròn 0.0001)
                if (oldVal === null || Math.abs(newVal - oldVal) > 0.0001) {
                    diffPayload[f] = newVal;
                }
            }
        });

        const changedKeys = Object.keys(diffPayload);

        if (changedKeys.length === 0) {
            alert("ℹ️ Không có thông số nào thay đổi, không cần lưu!");
            return;
        }

        try {
            await DeviceService.updatePlasma(devId, diffPayload);
            alert(`✅ Đã cập nhật thành công ${changedKeys.length} thông số:\n👉 ${changedKeys.join(', ')}`);
        } catch (err) {
            console.error(err);
            alert("❌ Lỗi khi gửi cấu hình xuống thiết bị!");
        }
    };

// Dùng cơ chế bắt sự kiện toàn cục: Bấm là 100% ăn lệnh, không bao giờ bị liệt
    document.addEventListener('click', async (e) => {
        if (e.target && e.target.id === 'btn-export-sheet') {
            const btn = e.target;
            const selectedKey = document.getElementById('record-select').value;
            
            if (!AppState.selectedDeviceId) {
                alert("⚠️ Bạn chưa chọn thiết bị!");
                return;
            }
            if (!selectedKey) {
                alert("⚠️ Vui lòng chọn một bản tin ở danh sách trên trước khi xuất!");
                return;
            }

            try {
                btn.textContent = "⏳ Đang gửi sang Sheets...";
                btn.disabled = true;

                await DeviceService.exportHL7ToGoogleSheet(AppState.selectedDeviceId, selectedKey);
                
                alert("✅ Dữ liệu đã được đẩy lên Google Sheet thành công!");
            } catch (err) {
                alert("❌ Lỗi khi xuất: " + err.message);
            } finally {
                btn.textContent = "📊 Xuất Google Sheets";
                btn.disabled = false;
            }
        }
    });
});
