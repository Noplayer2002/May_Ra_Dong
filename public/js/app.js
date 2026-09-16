import { DeviceService } from './services/deviceService.js';
import { UIRenderer } from './ui/uiRenderer.js';

// Central State
const AppState = { 
    devices: {},
    selectedDeviceId: null,
    isScanningWifi: false,
    currentDeviceRecords: {}
};
// Hàm tự động dọn sạch wifi_list khi người dùng rời khỏi giao diện Wi-Fi
function cleanupWifiScanData() {
    const devId = AppState.selectedDeviceId;
    if (!devId) return;

    // 1. Xóa ngay lập tức trên Firebase
    DeviceService.clearWifiList(devId);

    // 2. Dọn sạch giao diện hiển thị danh sách Wi-Fi
    const wifiBox = document.getElementById('scanned-wifi-list');
    if (wifiBox) {
        wifiBox.innerHTML = '<div style="color:#64748b; font-size:13px; text-align:center; padding:15px;">Phiên quét đã kết thúc. Bấm "Quét Wi-Fi" để tìm lại.</div>';
    }

    // 3. Xóa cache trong bộ nhớ tạm AppState
    if (AppState.devices[devId]?.wifi_list) {
        delete AppState.devices[devId].wifi_list;
    }
    console.log(`🧹 Đã tự động dọn sạch wifi_list của ${devId} do người dùng rời tab Wi-Fi.`);
}
// UI Page Navigations
function showPage(pageId) {
    // Nếu người dùng bấm quay lại màn hình chọn thiết bị
    if (pageId === 'device-selection-page') {
        cleanupWifiScanData(); // Xóa sạch wifi_list trước khi thoát
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
    if (device.wifi_list) UIRenderer.renderWifiList(device.wifi_list, (ssid) => {
        document.getElementById('ssid').value = ssid;
        document.getElementById('wifi-pass').focus();
    });

    showPage('settings-page');
}

function renderHL7Dropdown(device) {
    const selectEl = document.getElementById('record-select');
    selectEl.innerHTML = '<option value="">-- Chọn mã bản tin --</option>';
    AppState.currentDeviceRecords = {};
    // Nút tải lại bảng tính Google Sheets ngay trên giao diện
    const btnRefreshSheet = document.getElementById('btn-refresh-sheet');
    if (btnRefreshSheet) {
        btnRefreshSheet.onclick = () => {
            const iframe = document.getElementById('google-sheet-iframe');
            if (iframe) {
                iframe.src = iframe.src; // Ép iframe tải lại dữ liệu mới nhất
            }
        };
    }
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

    // 5. Action: Scan Wifi (Đồng bộ 10s)
    const scanWifiBtn = document.getElementById('btn-scan-wifi');
    scanWifiBtn.onclick = async () => {
        const devId = AppState.selectedDeviceId;
        if (!devId) return;

        scanWifiBtn.disabled = true;
        scanWifiBtn.textContent = "⏳ Đang quét Wi-Fi (10s)...";

        // Hiển thị trạng thái đang chờ dữ liệu trên UI
        const wifiBox = document.getElementById('scanned-wifi-list');
        if (wifiBox) {
            wifiBox.innerHTML = '<div style="color:#1976d2; font-size:13px; text-align:center; padding:15px;">⏳ Đang yêu cầu ESP32 quét các mạng xung quanh...</div>';
        }

        // Kích hoạt quét (Firebase sẽ tự chuyển về false sau 10s)
        await DeviceService.triggerScanWifi(devId);

        // Đếm ngược 10s trên giao diện
        setTimeout(() => {
            scanWifiBtn.disabled = false;
            scanWifiBtn.textContent = "🔍 Quét Wi-Fi Xung Quanh";

            // Kiểm tra xem sau 10s đã có dữ liệu trả về chưa
            const currentDev = AppState.devices[devId];
            if (!currentDev?.wifi_list || currentDev.wifi_list.length === 0) {
                if (wifiBox) {
                    wifiBox.innerHTML = '<div style="color:#d32f2f; font-size:13px; text-align:center; padding:15px;">⚠️ Hết 10s: Không nhận được phản hồi từ thiết bị hoặc không có mạng Wi-Fi nào.</div>';
                }
            }
        }, 10000);
    };

   // 6. Action: Forms Submit - Lưu Wi-Fi & Dọn dẹp
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
            // Gửi cấu hình (hàm này sẽ tự động xóa node wifi_list trên Firebase)
            await DeviceService.saveWifi(devId, ssid, pass);

            // 1. Xóa sạch mật khẩu vừa nhập trên giao diện
            document.getElementById('wifi-pass').value = '';

            // 2. Dọn sạch danh sách Wi-Fi đang hiển thị trên giao diện Web
            const wifiBox = document.getElementById('scanned-wifi-list');
            if (wifiBox) {
                wifiBox.innerHTML = '<div style="color:#2e7d32; font-size:13px; text-align:center; padding:15px;">✅ Đã cấu hình mạng xong. Danh sách quét đã được đóng.</div>';
            }

            alert("✅ Đã gửi lệnh lưu Wi-Fi!\n🧹 Danh sách quét Wi-Fi đã được xóa khỏi Database.\n🔒 Mật khẩu sẽ tự động biến mất sau 10 giây.");
        } catch (err) {
            alert("❌ Lỗi: " + err.message);
        } finally {
            btnSubmit.disabled = false;
            btnSubmit.textContent = "💾 Lưu & Đổi Mạng Cho Thiết Bị";
        }
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

    // XUẤT THỦ CÔNG (Nếu người dùng muốn bấm chủ động): Gửi xong -> Xóa trên Firebase -> Cập nhật giao diện
    const exportBtn = document.getElementById('btn-export-sheet');
    if (exportBtn) {
        exportBtn.onclick = async () => {
            const selectedKey = document.getElementById('record-select').value;
            const devId = AppState.selectedDeviceId;
            
            if (!devId) {
                alert("⚠️ Bạn chưa chọn thiết bị!");
                return;
            }
            if (!selectedKey) {
                alert("⚠️ Vui lòng chọn một bản tin ở danh sách trên trước khi xuất!");
                return;
            }

            try {
                exportBtn.textContent = "⏳ Đang gửi & xóa...";
                exportBtn.disabled = true;

                // Hàm này sẽ tự GỬI và TỰ XÓA trên Firebase
                await DeviceService.exportHL7ToGoogleSheet(devId, selectedKey);
                
                alert("✅ Đã gửi lên Google Sheet và xóa bản ghi khỏi Database thành công!");

                // Xóa khỏi cache local & refresh dropdown
                delete AppState.currentDeviceRecords[selectedKey];
                const optToRemove = document.querySelector(`#record-select option[value="${selectedKey}"]`);
                if (optToRemove) optToRemove.remove();

                // Đưa về trạng thái rỗng nếu hết bản ghi
                if (Object.keys(AppState.currentDeviceRecords).length === 0) {
                    document.getElementById('record-empty-state').style.display = 'block';
                    document.getElementById('record-detail-view').style.display = 'none';
                }
            } catch (err) {
                alert("❌ Lỗi khi xuất: " + err.message);
            } finally {
                exportBtn.textContent = "📊 Xuất Google Sheets";
                exportBtn.disabled = false;
            }
        };
    }
});
