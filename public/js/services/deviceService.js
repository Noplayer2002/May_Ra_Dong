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

async broadcastPing() {
    const currentPing = Date.now().toString();
    
    // 1. Gửi lệnh ping lên Firebase
    await db.ref('esp32/global_command/ping').set(currentPing);

    return new Promise((resolve) => {
        setTimeout(async () => {
            // 2. Kéo dữ liệu thực tế tại thời điểm sau 3 giây từ Firebase về
            const snap = await db.ref('esp32/devices').once('value');
            const devices = snap.val() || {};
            const updates = {};

            Object.keys(devices).forEach(deviceId => {
                const dev = devices[deviceId];
                const info = dev?.info || {};

                const currentStatus = (info.status || '').toLowerCase();
                const pongValue = (info.pong || '').toString().trim();

                // KIỂM TRA THỰC TẾ:
                // Thiết bị được coi là CÒN SỐNG nếu:
                // - ESP32 đã trả về pong khớp mã
                // - HOẶC trạng thái của nó đang là 'online' hoặc 'running'
                const isAlive = (pongValue === currentPing) || 
                                (currentStatus === 'online') || 
                                (currentStatus === 'running');

                if (!isAlive) {
                    // Chỉ những thiết bị THỰC SỰ im lặng mới bị gán offline
                    updates[`${deviceId}/info/status`] = 'offline';
                }
            });

            // 3. Ghi đè trạng thái offline cho các máy không phản hồi
            if (Object.keys(updates).length > 0) {
                await db.ref('esp32/devices').update(updates);
            }

            resolve();
        }, 3000);
    });
}
}
};
