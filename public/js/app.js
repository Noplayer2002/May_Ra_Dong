import { DeviceService } from './services/deviceService.js';
import { UIRenderer } from './ui/uiRenderer.js';

// Trạng thái ứng dụng
const AppState = { 
    devices: {},
    selectedDeviceId: null,
    isScanningWifi: false
};

// 1. HÀM ÉP LÀM MỚI BẢNG TÍNH GOOGLE SHEETS (VƯỢT BỘ NHỚ ĐỆM CACHE)
function refreshSheetIframe() {
    const iframe = document.getElementById('google-sheet-iframe');
    if (iframe) {
        const baseUrl = "https://docs.google.com/spreadsheets/d/1jaLfUghym0DGokRXKbHBB35qx9IXLwIW4DnyRnJkThg/htmlembed?gid=0&widget=false&chrome=false";
        // Thêm tham số thời gian Date.now() để trình duyệt bắt buộc kéo dữ liệu mới nhất từ máy chủ Google
        iframe.src = `${baseUrl}&_t=${Date.now()}`;
    }
}

// 2. DỌN DẸP DỮ LIỆU QUÉT WI-FI KHI THOÁT TRANG
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

// 3. ĐIỀU HƯỚNG CHUYỂN TRANG
function showPage(pageId) {
    if (pageId === 'device-selection-page') {
        cleanupWifiScanData();
        AppState.selectedDeviceId = null;
    }
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.getElementById(pageId).classList.add('active');
}

// 4. CHUYỂN TAB VÀ TỰ ĐỘNG LÀM MỚI DỮ LIỆU
function switchTab(e, tabId) {
    document.querySelectorAll('.tab-content, .nav a').forEach(el => el.classList.remove('active'));
    document.getElementById(tabId).classList.add('active');
    e.target.classList.add('active');

    // Tự động tải lại Google Sheets khi người dùng bấm vào Tab Bản ghi
    if (tabId === 'records') {
        refreshSheetIframe();
    }
}

// 5. CHỌN MÁY ĐỂ XEM CHI TIẾT
function selectDevice(id) {
    AppState.selectedDeviceId = id;
    document.getElementById('selected-device-name').textContent = id;
    const device = AppState.devices[id];
    
    UIRenderer.updateDeviceDetails(device);

    if (device && device.wifi_list) {
        UIRenderer.renderWifiList(device.wifi_list, (ssid) => {
            document.getElementById('ssid').value = ssid;
            document.getElementById('wifi-pass').focus();
        });
    }

    showPage('settings-page');
}

// KHỞI CHẠY KHI TRANG SẴN SÀNG
document.addEventListener('DOMContentLoaded', () => {
    // 1. LẮNG NGHE DỮ LIỆU THỜI GIAN THỰC TỪ FIREBASE
    DeviceService.subscribeDevices((data) => {
        AppState.devices = data;

        // Tự động bắt bản tin HL7 đẩy lên Google Sheets
        Object.keys(data).forEach(deviceId => {
            const history = data[deviceId]?.history;
            if (history) {
                Object.keys(history).forEach(recordKey => {
                    const rawHL7 = history[recordKey]?.raw_hl7;
                    if (rawHL7) {
                        console.log(`🚀 Bắt được bản ghi [${recordKey}] từ máy [${deviceId}], đang gửi lên Google Sheets...`);
                        
                        DeviceService.processAndForwardHL7(deviceId, recordKey, rawHL7).then(() => {
                            // Đợi đúng 2.5 giây cho Google Sheets ghi hoàn tất vào bảng tính rồi mới tải lại Iframe
                            console.log("⏳ Chờ Google Sheets ghi dữ liệu...");
                            setTimeout(() => {
                                refreshSheetIframe();
                                console.log("🔄 Đã cập nhật xong dữ liệu mới trên bảng tính!");
                            }, 2500);
                        });
                    }
                });
            }
        });

        // Cập nhật danh sách máy nếu đang ở trang chọn thiết bị
        if (document.getElementById('device-selection-page').classList.contains('active')) {
            const query = document.getElementById('search-input').value;
            UIRenderer.renderDeviceList(AppState.devices, query, selectDevice);
        }

        // Cập nhật thông số máy nếu đang xem chi tiết thiết bị đó
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

    // 2. TÌM KIẾM THIẾT BỊ
    document.getElementById('search-input').addEventListener('input', (e) => {
        UIRenderer.renderDeviceList(AppState.devices, e.target.value, selectDevice);
    });

    // 3. NÚT QUAY LẠI & SỰ KIỆN CHUYỂN TAB
    document.getElementById('btn-back').onclick = () => showPage('device-selection-page');
    document.querySelectorAll('.nav a').forEach(a => {
        a.onclick = (e) => switchTab(e, a.dataset.tab);
    });

    // 4. NÚT TẢI LẠI DỮ LIỆU GOOGLE SHEETS BẰNG TAY
    const btnRefreshSheet = document.getElementById('btn-refresh-sheet');
    if (btnRefreshSheet) {
        btnRefreshSheet.onclick = () => {
            btnRefreshSheet.textContent = "⏳ Đang tải...";
            refreshSheetIframe();
            setTimeout(() => {
                btnRefreshSheet.textContent = "🔄 Tải lại dữ liệu";
            }, 1200);
        };
    }

    // 5. QUÉT TRẠNG THÁI TOÀN HỆ THỐNG (GLOBAL PING)
    const pingBtn = document.getElementById('btn-check-device-status');
    pingBtn.onclick = async () => {
        pingBtn.disabled = true;
        pingBtn.textContent = "⏳ Đang phát sóng...";
        await DeviceService.broadcastPing();
        pingBtn.disabled = false;
        pingBtn.textContent = "⚡ Quét Trạng Thái (Global Ping)";
    };

    // 6. QUÉT WI-FI XUNG QUANH
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

    // 7. LƯU CẤU HÌNH WI-FI
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

    // 8. LƯU CẤU HÌNH TCP SERVER
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

    // 9. LƯU CẤU HÌNH NHIỆT ĐỘ & PID (PLASMA THAWER)
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
