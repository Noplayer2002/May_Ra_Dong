import { DeviceService } from './services/deviceService.js';
import { UIRenderer } from './ui/uiRenderer.js';

const AppState = { 
    devices: {},
    selectedDeviceId: null,
    isScanningWifi: false,
    latestHL7ByDevice: {} // Cache dữ liệu HL7 mới nhất theo từng deviceId
};

// Dọn dẹp danh sách Wi-Fi khi người dùng rời khỏi trang chi tiết máy
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

// Chuyển trang (Màn hình chọn máy <-> Màn hình cấu hình máy)
function showPage(pageId) {
    if (pageId === 'device-selection-page') {
        cleanupWifiScanData();
        AppState.selectedDeviceId = null;
    }
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    const targetPage = document.getElementById(pageId);
    if (targetPage) targetPage.classList.add('active');
}

// Chuyển Tab bên trong màn hình cấu hình máy
function switchTab(e, tabId) {
    document.querySelectorAll('.tab-content, .nav a').forEach(el => el.classList.remove('active'));
    const targetTab = document.getElementById(tabId);
    if (targetTab) targetTab.classList.add('active');
    e.target.classList.add('active');
}

// Cập nhật giao diện chi tiết HL7 (Zone A, Zone B và 16 barcode dọc)
function renderCurrentDeviceHL7(deviceId) {
    const cached = AppState.latestHL7ByDevice[deviceId];
    if (cached && cached.raw) {
        UIRenderer.displayHL7Detail(cached.raw, cached.key);
    } else {
        const dev = AppState.devices[deviceId];
        if (dev?.last_hl7?.raw) {
            UIRenderer.displayHL7Detail(dev.last_hl7.raw, dev.last_hl7.key);
        }
    }
}

// Chọn một máy từ danh sách
function selectDevice(id) {
    AppState.selectedDeviceId = id;
    document.getElementById('selected-device-name').textContent = id;
    const device = AppState.devices[id] || {};
    
    // 1. Cập nhật thông tin phần cứng & cấu hình
    UIRenderer.updateDeviceDetails(device);

    // 2. Cập nhật danh sách Wi-Fi (nếu đã quét trước đó)
    if (device.wifi_list) {
        UIRenderer.renderWifiList(device.wifi_list, (ssid) => {
            document.getElementById('ssid').value = ssid;
            document.getElementById('wifi-pass').focus();
        });
    }

    // 3. Hiển thị thông tin HL7 (Nhiệt độ cuối Zone A/B & 16 dòng Barcode)
    renderCurrentDeviceHL7(id);

    // 4. Chuyển sang màn hình quản trị máy
    showPage('settings-page');
}

document.addEventListener('DOMContentLoaded', () => {
    // =========================================================================
    // 1. LẮNG NGHE DỮ LIỆU REALTIME TỪ FIREBASE
    // =========================================================================
    DeviceService.subscribeDevices((data) => {
        AppState.devices = data;

        // Xử lý các bản tin HL7 mới xuất hiện trong node `history`
        Object.keys(data).forEach(deviceId => {
            const dev = data[deviceId];

            // Cache lại bản tin `last_hl7` đã lưu từ trước (nếu có)
            if (dev?.last_hl7?.raw && !AppState.latestHL7ByDevice[deviceId]) {
                AppState.latestHL7ByDevice[deviceId] = {
                    key: dev.last_hl7.key || 'LAST',
                    raw: dev.last_hl7.raw
                };
            }

            const history = dev?.history;
            if (history) {
                Object.keys(history).forEach(recordKey => {
                    const rawHL7 = history[recordKey]?.raw_hl7;
                    if (rawHL7) {
                        console.log(`🚀 Phát hiện bản ghi mới [${recordKey}] từ máy [${deviceId}]`);

                        // Lưu ngay vào cache của client
                        AppState.latestHL7ByDevice[deviceId] = { key: recordKey, raw: rawHL7 };

                        // Nếu người dùng đang mở đúng máy này -> cập nhật UI HL7 ngay lập tức
                        if (AppState.selectedDeviceId === deviceId) {
                            UIRenderer.displayHL7Detail(rawHL7, recordKey);
                        }

                        // Đẩy sang Google Sheets và dọn dẹp hàng đợi Firebase
                        DeviceService.processAndForwardHL7(deviceId, recordKey, rawHL7).then(() => {
                            const iframe = document.getElementById('google-sheet-iframe');
                            if (iframe) iframe.src = iframe.src;
                        });
                    }
                });
            }
        });

        // Cập nhật danh sách máy nếu đang ở trang chủ
        if (document.getElementById('device-selection-page').classList.contains('active')) {
            const query = document.getElementById('search-input').value;
            UIRenderer.renderDeviceList(AppState.devices, query, selectDevice);
        }

        // Cập nhật chi tiết nếu đang ở màn hình xem máy
        if (AppState.selectedDeviceId && AppState.devices[AppState.selectedDeviceId]) {
            const currentDev = AppState.devices[AppState.selectedDeviceId];
            UIRenderer.updateDeviceDetails(currentDev);

            if (currentDev.wifi_list) {
                UIRenderer.renderWifiList(currentDev.wifi_list, (ssid) => {
                    document.getElementById('ssid').value = ssid;
                    document.getElementById('wifi-pass').focus();
                });
            }

            // Đảm bảo dữ liệu bản ghi HL7 luôn được hiển thị
            renderCurrentDeviceHL7(AppState.selectedDeviceId);
        }
    });

    // =========================================================================
    // 2. TÌM KIẾM MÁY
    // =========================================================================
    document.getElementById('search-input').addEventListener('input', (e) => {
        UIRenderer.renderDeviceList(AppState.devices, e.target.value, selectDevice);
    });

    // =========================================================================
    // 3. ĐIỀU HƯỚNG QUAY LẠI & CHUYỂN TAB
    // =========================================================================
    document.getElementById('btn-back').onclick = () => showPage('device-selection-page');
    document.querySelectorAll('.nav a').forEach(a => {
        a.onclick = (e) => switchTab(e, a.dataset.tab);
    });

    // =========================================================================
    // 4. LÀM MỚI BẢNG TÍNH GOOGLE SHEETS
    // =========================================================================
    const btnRefreshSheet = document.getElementById('btn-refresh-sheet');
    if (btnRefreshSheet) {
        btnRefreshSheet.onclick = () => {
            const iframe = document.getElementById('google-sheet-iframe');
            if (iframe) {
                btnRefreshSheet.textContent = "⏳ Đang tải...";
                iframe.src = iframe.src;
                setTimeout(() => {
                    btnRefreshSheet.textContent = "🔄 Tải lại dữ liệu";
                }, 1000);
            }
        };
    }

    // =========================================================================
    // 5. GLOBAL PING (QUÉT TRẠNG THÁI TOÀN HỆ THỐNG)
    // =========================================================================
    const pingBtn = document.getElementById('btn-check-device-status');
    pingBtn.onclick = async () => {
        pingBtn.disabled = true;
        pingBtn.textContent = "⏳ Đang phát sóng...";
        try {
            await DeviceService.broadcastPing();
        } catch (err) {
            console.error("Lỗi khi ping:", err);
        } finally {
            pingBtn.disabled = false;
            pingBtn.textContent = "⚡ Quét Trạng Thái (Global Ping)";
        }
    };

    // =========================================================================
    // 6. QUÉT WI-FI XUNG QUANH MÁY
    // =========================================================================
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

    // =========================================================================
    // 7. LƯU CẤU HÌNH WI-FI
    // =========================================================================
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

            const wifiBox = document.getElementById('scanned-wifi-list');
            if (wifiBox) {
                wifiBox.innerHTML = '<div style="color:#2e7d32; font-size:13px; text-align:center; padding:15px;">✅ Đã cấu hình mạng xong.</div>';
            }

            alert("✅ Đã gửi lệnh lưu Wi-Fi!\n🔒 Mật khẩu sẽ tự động biến mất sau 10 giây.");
        } catch (err) {
            alert("❌ Lỗi: " + err.message);
        } finally {
            btnSubmit.disabled = false;
            btnSubmit.textContent = "💾 Lưu & Đổi Mạng Cho Máy";
        }
    };

    // =========================================================================
    // 8. LƯU CẤU HÌNH TCP SERVER
    // =========================================================================
    document.getElementById('tcp-form').onsubmit = async (e) => {
        e.preventDefault();
        const devId = AppState.selectedDeviceId;
        if (!devId) return;

        const currentTcp = AppState.devices[devId]?.tcp || {};
        const newIp = document.getElementById('server_ip').value.trim();
        const newPort = parseInt(document.getElementById('server_port').value, 10);

        const diffTcp = {};
        if (newIp !== (currentTcp.server_ip || '')) diffTcp.server_ip = newIp;
        if (!isNaN(newPort) && newPort !== currentTcp.server_port) diffTcp.server_port = newPort;

        if (Object.keys(diffTcp).length === 0) {
            alert("ℹ️ Không có thông số TCP nào thay đổi!");
            return;
        }

        try {
            await DeviceService.updateTcp(devId, diffTcp);
            alert(`✅ Đã cập nhật TCP: ${Object.keys(diffTcp).join(', ')}`);
        } catch (err) {
            alert("❌ Lỗi khi cập nhật TCP: " + err.message);
        }
    };

    // =========================================================================
    // 9. LƯU CẤU HÌNH PLASMA (NHIỆT ĐỘ & PID)
    // =========================================================================
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
            alert("❌ Lỗi khi gửi cấu hình xuống thiết bị: " + err.message);
        }
    };
});
