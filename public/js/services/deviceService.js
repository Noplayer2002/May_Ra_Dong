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

    // 1. Tạo mã Ping duy nhất cho lần quét này
    const currentPing = Date.now().toString();
    db.ref('esp32/global_command/ping').set(currentPing);

    // 2. Chờ 3 giây cho ESP32 nhận và đẩy Pong lên
    setTimeout(() => {
        const updates = {};

        Object.keys(devicesDataCache).forEach(deviceId => {
            const dev = devicesDataCache[deviceId];
            const pongData = (dev?.info?.pong || '').toString();

            // KIỂM TRA: Pong có chứa mã Ping vừa phát hay không?
            if (pongData.includes(currentPing)) {
                // -> ESP32 CÓ PHẢN HỒI (CÒN SỐNG) -> BỎ QUA, GIỮ NGUYÊN!
                return;
            }

            // -> ESP32 KHÔNG PHẢN HỒI (ĐÃ CHẾT) -> ĐỘC QUYỀN GÁN OFFLINE
            updates[`${deviceId}/info/status`] = 'offline';
        });

        // 3. Ghi đè offline cho các máy chết lên Firebase
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
}
