import { DeviceService } from './services/deviceService.js';
import { UIRenderer } from './ui/uiRenderer.js';

// Trạng thái ứng dụng
const AppState = { 
    devices: {},
    selectedDeviceId: null,
    isScanningWifi: false,
    lastHL7: {}, // Lưu bản ghi HL7 mới nhất theo deviceId
    historyBatches: [], // Lịch sử các mẻ rã đông từ Google Sheets
    selectedHistoryBatchId: null
};

// 1. TẢI VÀ LỌC LỊCH SỬ MẺ RÃ ĐÔNG TỪ GOOGLE SHEETS
async function loadSheetHistory() {
    const listContainer = document.getElementById('hl7-history-list');
    if (listContainer) {
        listContainer.innerHTML = '<div class="history-loading">Đang tải lịch sử từ Google Sheets...</div>';
    }

    const batches = await DeviceService.fetchHistoryFromSheet();
    if (batches && Array.isArray(batches) && batches.length > 0) {
        AppState.historyBatches = batches;
        filterAndRenderHistory();

        // Nếu màn hình chính chưa hiển thị bản ghi nào (hoặc F5 lại trang)
        // -> Tự động nạp mẻ mới nhất từ Google Sheets!
        const devId = AppState.selectedDeviceId;
        const currentHL7 = devId ? AppState.lastHL7[devId] : null;
        if (!currentHL7 && !AppState.selectedHistoryBatchId) {
            const devBatch = batches.find(b => b.deviceId === devId) || batches[0];
            if (devBatch) {
                AppState.selectedHistoryBatchId = devBatch.batchId || devBatch.msgId;
                UIRenderer.displayBatchData(devBatch, '', `Mẻ gần nhất: ${devBatch.batchId}`);
                filterAndRenderHistory();
            }
        }
    } else {
        if (listContainer) {
            listContainer.innerHTML = '<div class="history-empty">Chưa có kết nối tới Google Sheets hoặc không có bản ghi nào.</div>';
        }
    }
}

function filterAndRenderHistory() {
    const query = (document.getElementById('history-search-input')?.value || '').trim().toLowerCase();
    let filtered = AppState.historyBatches;
    if (query) {
        filtered = filtered.filter(b => 
            (b.batchId && b.batchId.toLowerCase().includes(query)) ||
            (b.hl7Time && b.hl7Time.toLowerCase().includes(query)) ||
            (b.deviceId && b.deviceId.toLowerCase().includes(query))
        );
    }

    UIRenderer.renderHistoryList(filtered, AppState.selectedHistoryBatchId, (selectedBatch) => {
        AppState.selectedHistoryBatchId = selectedBatch.batchId || selectedBatch.msgId;
        UIRenderer.displayBatchData(selectedBatch, '', `Mẻ lịch sử: ${selectedBatch.batchId}`);
        filterAndRenderHistory();
    });
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

// 4. CHUYỂN TAB
function switchTab(e, tabId) {
    document.querySelectorAll('.tab-content, .nav a').forEach(el => el.classList.remove('active'));
    document.getElementById(tabId).classList.add('active');
    e.target.classList.add('active');

    if (tabId === 'records') {
        if (AppState.selectedDeviceId && AppState.lastHL7[AppState.selectedDeviceId]) {
            const id = AppState.selectedDeviceId;
            UIRenderer.displayHL7Detail(AppState.lastHL7[id].rawHL7, AppState.lastHL7[id].recordKey, 'Bản ghi mới nhất');
        }
        loadSheetHistory();
    }
}

// 5. CHỌN MÁY ĐỂ XEM CHI TIẾT
function selectDevice(id) {
    AppState.selectedDeviceId = id;
    document.getElementById('selected-device-name').textContent = id;
    const device = AppState.devices[id];
    
    UIRenderer.updateDeviceDetails(device);

    // Hiển thị bản ghi HL7 gần nhất nếu có
    if (AppState.lastHL7[id]) {
        UIRenderer.displayHL7Detail(AppState.lastHL7[id].rawHL7, AppState.lastHL7[id].recordKey);
    } else if (device?.history) {
        const historyKeys = Object.keys(device.history);
        if (historyKeys.length > 0) {
            const latestKey = historyKeys[historyKeys.length - 1];
            const raw = device.history[latestKey]?.raw_hl7;
            if (raw) {
                AppState.lastHL7[id] = { rawHL7: raw, recordKey: latestKey };
                UIRenderer.displayHL7Detail(raw, latestKey);
            }
        }
    }

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

        // Tự động bắt bản tin HL7 đẩy lên Google Sheets và hiển thị lên giao diện
        Object.keys(data).forEach(deviceId => {
            const history = data[deviceId]?.history;
            if (history) {
                Object.keys(history).forEach(recordKey => {
                    const rawHL7 = history[recordKey]?.raw_hl7;
                    if (rawHL7) {
                        AppState.lastHL7[deviceId] = { rawHL7, recordKey };
                        if (deviceId === AppState.selectedDeviceId) {
                            UIRenderer.displayHL7Detail(rawHL7, recordKey, 'Bản ghi mới nhất (Realtime)');
                        }

                        console.log(`Bắt được bản ghi [${recordKey}] từ máy [${deviceId}], đang gửi lên Google Sheets...`);
                        
                        DeviceService.processAndForwardHL7(deviceId, recordKey, rawHL7).then(() => {
                            console.log(`Chu trình hoàn tất: Đã đẩy lên Sheet & Đã tự động xóa [${recordKey}] trên Firebase.`);
                            loadSheetHistory();
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

    // 4. LỊCH SỬ GOOGLE SHEETS: NÚT TẢI LẠI & TÌM KIẾM
    const btnRefreshHistory = document.getElementById('btn-refresh-history');
    if (btnRefreshHistory) {
        btnRefreshHistory.onclick = () => loadSheetHistory();
    }

    const historySearchInput = document.getElementById('history-search-input');
    if (historySearchInput) {
        historySearchInput.addEventListener('input', () => filterAndRenderHistory());
    }

    // 5. QUÉT TRẠNG THÁI TOÀN HỆ THỐNG (GLOBAL PING)
    const pingBtn = document.getElementById('btn-check-device-status');
    pingBtn.onclick = async () => {
        pingBtn.disabled = true;
        pingBtn.textContent = "Đang phát sóng...";
        await DeviceService.broadcastPing();
        pingBtn.disabled = false;
        pingBtn.textContent = "Quét Trạng Thái (Global Ping)";
    };

    // 6. QUÉT WI-FI XUNG QUANH
    const scanWifiBtn = document.getElementById('btn-scan-wifi');
    scanWifiBtn.onclick = async () => {
        const devId = AppState.selectedDeviceId;
        if (!devId) return;

        scanWifiBtn.disabled = true;
        scanWifiBtn.textContent = "Đang quét Wi-Fi (10s)...";

        const wifiBox = document.getElementById('scanned-wifi-list');
        if (wifiBox) {
            wifiBox.innerHTML = '<div style="color:#1976d2; font-size:13px; text-align:center; padding:15px;">Đang yêu cầu ESP32 quét các mạng xung quanh...</div>';
        }

        await DeviceService.triggerScanWifi(devId);

        setTimeout(() => {
            scanWifiBtn.disabled = false;
            scanWifiBtn.textContent = "Quét Wi-Fi Xung Quanh";

            const currentDev = AppState.devices[devId];
            if (!currentDev?.wifi_list || currentDev.wifi_list.length === 0) {
                if (wifiBox) {
                    wifiBox.innerHTML = '<div style="color:#d32f2f; font-size:13px; text-align:center; padding:15px;">Hết 10s: Không nhận được phản hồi từ thiết bị hoặc không có mạng Wi-Fi nào.</div>';
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
        btnSubmit.textContent = "Đang cấu hình...";

        try {
            await DeviceService.saveWifi(devId, ssid, pass);
            document.getElementById('wifi-pass').value = '';
            alert("Đã gửi lệnh lưu Wi-Fi!\nMật khẩu sẽ tự động biến mất sau 10 giây.");
        } catch (err) {
            alert("Lỗi: " + err.message);
        } finally {
            btnSubmit.disabled = false;
            btnSubmit.textContent = "Lưu & Đổi Mạng Cho Máy";
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
            alert("Không có thông số TCP nào thay đổi!");
            return;
        }

        await DeviceService.updateTcp(devId, diffTcp);
        alert(`Đã cập nhật TCP: ${Object.keys(diffTcp).join(', ')}`);
    };

    // 9. LƯU CẤU HÌNH NHIỆT ĐỘ & PID (PLASMA THAWER)
    document.getElementById('plasma-form').onsubmit = async (e) => {
        e.preventDefault();
        const devId = AppState.selectedDeviceId;
        if (!devId) return;

        // Quy tắc an toàn ngưỡng nhiệt độ và phần cứng
        const limits = {
            sp_t_operator: { min: 35.0, max: 37.5, name: 'Nhiệt độ rã đông (sp_t_operator)' },
            sp_t_hot:      { min: 50.0, max: 95.0, name: 'Nhiệt độ gia nhiệt (sp_t_hot)' },
            sp_fan:        { min: 0,    max: 100,  name: 'Cài đặt quạt (sp_fan)' },
            t_max:         { min: 37.5, max: 42.0, name: 'Nhiệt độ ngắt Max (t_max)' },
            t_min:         { min: 20.0, max: 36.0, name: 'Nhiệt độ báo động Min (t_min)' },
            t_offset_1:    { min: -10.0, max: 10.0, name: 'Offset T1' },
            r_cal_1:       { min: 80.0,  max: 120.0, name: 'R_cal T1' },
            t_offset_2:    { min: -10.0, max: 10.0, name: 'Offset T2' },
            r_cal_2:       { min: 80.0,  max: 120.0, name: 'R_cal T2' },
            t_offset_3:    { min: -10.0, max: 10.0, name: 'Offset T3' },
            r_cal_3:       { min: 80.0,  max: 120.0, name: 'R_cal T3' },
            t_offset_4:    { min: -10.0, max: 10.0, name: 'Offset T4' },
            r_cal_4:       { min: 80.0,  max: 120.0, name: 'R_cal T4' },
            pid_kp:        { min: 0.1,   max: 50.0, name: 'Hệ số Kp' },
            pid_ti:        { min: 0.0,   max: 2000.0, name: 'Thời gian Ti' },
            pid_td:        { min: 0.0,   max: 500.0, name: 'Thời gian Td' }
        };

        // 1. Kiểm tra từng trường giá trị xem có nằm trong khoảng cho phép không
        for (const [field, rule] of Object.entries(limits)) {
            const inputEl = document.getElementById(field);
            if (inputEl && inputEl.value.trim() !== '') {
                const val = parseFloat(inputEl.value);
                if (isNaN(val) || val < rule.min || val > rule.max) {
                    alert(`[Cảnh báo an toàn]: ${rule.name} phải nằm trong khoảng từ ${rule.min} đến ${rule.max}!`);
                    inputEl.focus();
                    return;
                }
            }
        }

        // 2. Kiểm tra logic chéo an toàn nhiệt độ rã đông
        const opVal = parseFloat(document.getElementById('sp_t_operator')?.value);
        const maxVal = parseFloat(document.getElementById('t_max')?.value);
        const minVal = parseFloat(document.getElementById('t_min')?.value);

        if (!isNaN(opVal) && !isNaN(maxVal) && !isNaN(minVal)) {
            if (minVal >= opVal || opVal >= maxVal) {
                alert(`[Lỗi logic an toàn nhiệt độ]:\nBắt buộc phải thỏa mãn: Nhiệt độ Min (${minVal}°C) < Nhiệt độ rã đông (${opVal}°C) < Nhiệt độ Max (${maxVal}°C)!`);
                return;
            }
        }

        const currentPlasma = AppState.devices[devId]?.plasma || {};
        const plasmaFields = Object.keys(limits);

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
            alert("Không có thông số nào thay đổi, không cần lưu!");
            return;
        }

        try {
            await DeviceService.updatePlasma(devId, diffPayload);
            alert(`Đã cập nhật an toàn thành công ${changedKeys.length} thông số!`);
        } catch (err) {
            alert("Lỗi khi gửi cấu hình xuống thiết bị: " + (err.message || err));
        }
    };
});
