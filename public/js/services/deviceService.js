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

    // Dùng .update() thay vì .set() để chỉ đổi trường được chỉ định
    updateTcp(deviceId, changedData) {
        return db.ref(`esp32/devices/${deviceId}/tcp`).update(changedData);
    },

    // Dùng .update() thay vì .set() để chỉ đổi đúng các tham số thay đổi
    updatePlasma(deviceId, changedData) {
        return db.ref(`esp32/devices/${deviceId}/plasma`).update(changedData);
    },

    async broadcastPing() {
        const currentPing = Date.now().toString();
        await db.ref('esp32/global_command/ping').set(currentPing);

        return new Promise((resolve) => {
            setTimeout(async () => {
                const snap = await db.ref('esp32/devices').once('value');
                const latestDevices = snap.val() || {};

                const updates = {};
                Object.keys(latestDevices).forEach(deviceId => {
                    const device = latestDevices[deviceId];
                    const pongValue = (device.info && device.info.pong) ? device.info.pong.toString() : '';

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
};
