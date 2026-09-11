import { db } from '../config/firebase.js';

export const DeviceService = {
    subscribeDevices(callback) {
        return db.ref('esp32/devices').on('value', snap => callback(snap.val() || {}));
    },

    triggerScanWifi(deviceId) {
        return db.ref(`esp32/devices/${deviceId}/command/scan_wifi`).set(true);
    },

    saveWifi(deviceId, ssid, pass) {
        return db.ref(`esp32/devices/${deviceId}/wifi`).set({ ssid, pass });
    },

    saveTcp(deviceId, server_ip, server_port) {
        return db.ref(`esp32/devices/${deviceId}/tcp`).set({ server_ip, server_port });
    },

    savePlasma(deviceId, plasmaData) {
        return db.ref(`esp32/devices/${deviceId}/plasma`).set(plasmaData);
    },

    // deviceService.js

function broadcastPing() {
    const btn = document.getElementById('btn-check-device-status');
    btn.disabled = true;
    btn.textContent = "⏳ Đang phát sóng...";

    const currentPing = Date.now().toString();
    db.ref('esp32/global_command/ping').set(currentPing);

    setTimeout(() => {
        const updates = {};
        
        Object.keys(devicesDataCache).forEach(deviceId => {
            const device = devicesDataCache[deviceId];
            const info = (device && device.info) ? device.info : {};
            
            const currentStatus = (info.status || '').toLowerCase();
            const pongValue = (info.pong || '').toString().trim();

            // ==============================================================
            // NẾU THIẾT BỊ ĐÃ LÊN 'ONLINE' HOẶC 'RUNNING' (HOẶC PONG KHỚP):
            // -> NÓ ĐÃ SỐNG! BỎ QUA NGAY, GIỮ NGUYÊN TRẠNG THÁI CHO NÓ!
            // ==============================================================
            if (currentStatus === 'online' || currentStatus === 'running' || pongValue === currentPing) {
                return; // Thoát ra, không thêm vào danh sách bị đè offline
            }

            // CHỈ NHỮNG THIẾT BỊ KHÔNG HỀ PHẢN HỒI GÌ MỚI BỊ ÉP VỀ OFFLINE
            updates[`${deviceId}/info/status`] = 'offline';
        });

        // Chỉ gửi cập nhật nếu có thiết bị thực sự chết
        if (Object.keys(updates).length > 0) {
            db.ref('esp32/devices').update(updates).then(() => {
                btn.disabled = false;
                btn.textContent = "⚡ Quét Trạng Thái (Global Ping)";
            });
        } else {
            btn.disabled = false;
            btn.textContent = "⚡ Quét Trạng Thái (Global Ping)";
        }
    }, 3000);
};
