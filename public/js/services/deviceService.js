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
    // Bản an toàn tuyệt đối: Không Listener ngầm, không quét mảng
    async broadcastPing() {
        const pingId = Date.now().toString();
        console.log("Phát Ping:", pingId);
        // Chỉ ghi 1 giá trị duy nhất lên node ping rồi thôi
        return db.ref('esp32/global_command/ping').set(pingId);
    }
}
