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

    // TĂNG LÊN 5000ms (5 GIÂY) ĐỂ ĐỢI VÒNG LẶP 2500ms CỦA ESP32 CHẠY XONG
    setTimeout(async () => {
        // Đọc trực tiếp dữ liệu mới nhất vừa hạ cánh xuống Firebase
        const snap = await db.ref('esp32/devices').once('value');
        const latestData = snap.val() || {};
        const updates = {};

        Object.keys(latestData).forEach(deviceId => {
            const dev = latestData[deviceId];
            const info = (dev && dev.info) ? dev.info : {};
            const pongValue = (info.pong || '').toString().trim();
            const currentStatus = (info.status || '').toLowerCase();

            // Nếu ESP32 đã trả lời đúng mã Ping HOẶC đang báo online/running:
            if (pongValue === currentPing || currentStatus === 'online' || currentStatus === 'running') {
                return; // Giữ nguyên trạng thái, KHÔNG ĐƯỢC ĐÈ OFFLINE
            }

            // Chỉ những máy không hề có phản hồi mới bị gán offline
            updates[`${deviceId}/info/status`] = 'offline';
        });

        if (Object.keys(updates).length > 0) {
            await db.ref('esp32/devices').update(updates);
        }

        btn.disabled = false;
        btn.textContent = "⚡ Quét Trạng Thái (Global Ping)";
    }, 5000);
};
