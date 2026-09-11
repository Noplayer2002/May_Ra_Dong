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

    async broadcastPing(devicesCache) {
        const currentPing = Date.now().toString();
        await db.ref('esp32/global_command/ping').set(currentPing);

        return new Promise((resolve) => {
            setTimeout(async () => {
                const updates = {};
                Object.keys(devicesCache).forEach(deviceId => {
                    const device = devicesCache[deviceId];
                    const pongValue = device?.info?.pong?.toString() || '';
                    if (pongValue !== currentPing) {
                        updates[`${deviceId}/info/status`] = 'offline';
                    }
                });

                if (Object.keys(updates).length > 0) {
                    await db.ref('esp32/devices').update(updates);
                }
                resolve();
            }, 3000);
        });
    }
    async broadcastPing() {
        const currentPing = Date.now().toString();
        
        await db.ref('esp32/global_command/ping').set(currentPing);

        return new Promise((resolve) => {
            setTimeout(async () => {
                // 2. TỰ LẤY DỮ LIỆU TƯƠI MỚI NHẤT TỪ SERVER (Không phụ thuộc vào biến truyền vào)
                const snapshot = await db.ref('esp32/devices').once('value');
                const freshDevices = snapshot.val() || {};

                const updates = {};
                Object.keys(freshDevices).forEach(deviceId => {
                    const dev = freshDevices[deviceId];
                    const pongValue = dev?.info?.pong ? dev.info.pong.toString() : '';
                    // So sánh trực tiếp với dữ liệu trên Server
                    if (pongValue !== currentPing) {
                        updates[`${deviceId}/info/status`] = 'offline';
                    }
                });

                if (Object.keys(updates).length > 0) {
                    await db.ref('esp32/devices').update(updates);
                }
                resolve();
            }, 4000); // Tăng lên 4000ms để ESP32 có đủ thời gian hoàn tất SSL
        });
    }
};
