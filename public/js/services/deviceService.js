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

    async broadcastPing() {
    const currentPing = Date.now().toString();
    // 1. Gửi lệnh Ping
    await db.ref('esp32/global_command/ping').set(currentPing);

    return new Promise((resolve) => {
        setTimeout(async () => {
            // 2. LẤY DỮ LIỆU MỚI NHẤT VỪA CẬP NHẬT TRÊN FIREBASE (Không dùng cache cũ)
            const snap = await db.ref('esp32/devices').once('value');
            const devices = snap.val() || {};
            
            const updates = {};

            Object.keys(devices).forEach(deviceId => {
                const dev = devices[deviceId];
                const pong = dev?.info?.pong?.toString() || '';

                // 3. Nếu pong khớp -> Giữ nguyên (hoặc set online), nếu KHÔNG khớp mới set offline
                if (pong !== currentPing) {
                    updates[`${deviceId}/info/status`] = 'offline';
                }
            });

            // 4. Cập nhật
            if (Object.keys(updates).length > 0) {
                await db.ref('esp32/devices').update(updates);
            }
            resolve();
        }, 3000);
    });
}
};
