import { DeviceService } from './services/deviceService.js';
import { UIRenderer } from './ui/uiRenderer.js';

const AppState = { 
    devices: {},
    selectedDeviceId: null,
    isScanningWifi: false,
    latestHL7ByDevice: {}
};

function cleanupWifiScanData() {
    const devId = AppState.selectedDeviceId;
    if (!devId) return;

    DeviceService.clearWifiList(devId);

    const wifiBox = document.getElementById('scanned-wifi-list');
    if (wifiBox) {
        wifiBox.innerHTML = '<div style="color:#64748b; font-size:13px; text-align:center; padding:15px;">Phiên quét đã kết thúc. Bấm "Quét Wi-Fi" để tìm lại.</div>';
    }

    if (AppState.devices[devId]?.wifi_list) {
        delete AppState.devices[devId].wifi_list;
    }
}

function showPage(pageId) {
    if (pageId === 'device-selection-page') {
        cleanupWifiScanData();
        AppState.selectedDeviceId = null;
    }
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.getElementById(pageId).classList.add('active');
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

    // Hiển thị ngay bản ghi HL7 đã lưu gần nhất của máy này
    if (AppState.latestHL7ByDevice[id]) {
        UIRenderer.displayHL7Detail(AppState.latestHL7ByDevice[id].rawHL7, AppState.latestHL7ByDevice[id].key);
    }

    if (device && device.wifi_list) {
        UIRenderer.renderWifiList(device.wifi_list, (ssid) => {
            document.getElementById('ssid').value = ssid;
            document.getElementById('wifi-pass').focus();
        });
    }

    showPage('settings-page');
}

document.addEventListener('DOMContentLoaded', () => {
    DeviceService.subscribeDevices((data) => {
        AppState.devices = data;

        // Bắt bản tin HL7 đẩy sang Google Sheets
        Object.keys(data).forEach(deviceId => {
            const history = data[deviceId]?.history;
            if (history) {
                Object.keys(history).forEach(recordKey => {
                    const rawHL7 = history[recordKey]?.raw_hl7;
                    if (rawHL7) {
                        AppState.latestHL7ByDevice[deviceId] = { key: recordKey, rawHL7: rawHL7 };

                        if (AppState.selectedDeviceId === deviceId) {
                            UIRenderer.displayHL7Detail(rawHL7, recordKey);
                        }

                        console.log(`🚀 Bản ghi mới [${recordKey}] từ [${deviceId}], đẩy sang Sheet...`);
                        DeviceService.processAndForwardHL7(deviceId, recordKey, rawHL7).then(() => {
                            const iframe = document.getElementById('google-sheet-iframe');
                            if (iframe) {
                                iframe.src = iframe.src;
                            }
                        });
                    }
                });
            }
        });

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

    document.getElementById('search-input').addEventListener('input', (e) => {
        UIRenderer.renderDeviceList(AppState.devices, e.target.value, selectDevice);
    });

    document.getElementById('btn-back').onclick = () => showPage('device-selection-page');
    document.querySelectorAll('.nav a').forEach(a => {
        a.onclick = (e) => switchTab(e, a.dataset.tab);
    });

    const btnRefreshSheet = document.getElementById('btn-refresh-sheet');
    if (btnRefreshSheet) {
        btnRefreshSheet.onclick = () => {
            const iframe = document.getElementById('google-sheet-iframe');
            if (iframe) {
                btnRefreshSheet.textContent = "⏳ Đang tải...";
                iframe.src = iframe.src;
                setTimeout(() => {
                    btnRefreshSheet.textContent = "🔄 Tải lại dữ liệu";
                }, 1200);
            }
        };
    }

    const pingBtn = document.getElementById('btn-check-device-status');
    pingBtn.onclick = async () => {
        pingBtn.disabled = true;
        pingBtn.textContent = "⏳ Đang phát sóng...";
        await DeviceService.broadcastPing();
        pingBtn.disabled = false;
        pingBtn.textContent = "⚡ Quét Trạng Thái (Global Ping)";
    };

    const scanWifiBtn = document.getElementById('btn-scan-wifi');
    scanWifiBtn.onclick = async () => {
        const devId = AppState.selectedDeviceId;
        if (!devId) return;

        scanWifiBtn.disabled = true;
        scanWifiBtn.textContent = "⏳ Đang quét Wi-Fi (10s)...";

        const wifiBox = document.getElementById('scanned-wifi-list');
        if (wifiBox) {
            wifiBox.innerHTML = '<div style="color:#1976d2; font-size:13px; text-align:center; padding:15px;">⏳ Đang yêu cầu ESP32 quét các mạng xung quanh...</div>';
        }

        await DeviceService.triggerScanWifi(devId);

        setTimeout(() => {
            scanWifiBtn.disabled = false;
            scanWifiBtn.textContent = "🔍 Quét Wi-Fi Xung Quanh";

            const currentDev = AppState.devices[devId];
            if (!currentDev?.wifi_list || currentDev.wifi_list.length === 0) {
                if (wifiBox) {
                    wifiBox.innerHTML = '<div style="color:#d32f2f; font-size:13px; text-align:center; padding:15px;">⚠️ Hết 10s: Không nhận được phản hồi từ thiết bị hoặc không có mạng Wi-Fi nào.</div>';
                }
            }
        }, 10000);
    };

    document.getElementById('wifi-connect-form').onsubmit = async (e) => {
        e.preventDefault();
        const devId = AppState.selectedDeviceId;
        if (!devId) return;

        const ssid = document.getElementById('ssid').value.trim();
        const pass = document.getElementById('wifi-pass').value;

        const btnSubmit = e.target.querySelector('button[type="submit"]');
        btnSubmit.disabled = true;
        btnSubmit.textContent = "⏳ Đang cấu hình...";

        try {
            await DeviceService.saveWifi(devId, ssid, pass);
            document.getElementById('wifi-pass').value = '';
            alert("✅ Đã gửi lệnh lưu Wi-Fi!\n🔒 Mật khẩu sẽ tự động biến mất sau 10 giây.");
        } catch (err) {
            alert("❌ Lỗi: " + err.message);
        } finally {
            btnSubmit.disabled = false;
            btnSubmit.textContent = "💾 Lưu & Đổi Mạng Cho Máy";
        }
    };

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
            alert(`✅ Đã cập nhật thành công ${changedKeys.length} thông số!`);
        } catch (err) {
            alert("❌ Lỗi khi gửi cấu hình xuống thiết bị!");
        }
    };
});
