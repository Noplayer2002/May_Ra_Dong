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
        
        console.log("🚀 [PING PHÁT ĐI]:", currentPing);
        await db.ref('esp32/global_command/ping').set(currentPing);

        return new Promise((resolve) => {
            setTimeout(async () => {
                const snapshot = await db.ref('esp32/devices').once('value');
                const freshDevices = snapshot.val() || {};

                const updates = {};
                Object.keys(freshDevices).forEach(deviceId => {
                    const dev = freshDevices[deviceId];
                    let rawPong = dev?.info?.pong ? dev.info.pong.toString() : '';

                    // 1. LÀM SẠCH CHUỖI: Xóa toàn bộ dấu ngoặc kép ", ', dấu cách, xuống dòng \r \n
                    const cleanPong = rawPong.replace(/["'\r\n\s]/g, '');
                    const cleanPing = currentPing.replace(/["'\r\n\s]/g, '');

                    console.log(`🔍 So sánh máy [${deviceId}]:`);
                    console.log(`   - Ping Web phát : [${cleanPing}]`);
                    console.log(`   - Pong DB nhận  : [${cleanPong}]`);

                    // 2. SO SÁNH SAU KHI ĐÃ LÀM SẠCH
                    if (cleanPong === cleanPing) {
                        console.log(`   => ✅ KHỚP 100%! GIỮ NGUYÊN ONLINE.`);
                    } else {
                        console.log(`   => ❌ KHÔNG KHỚP! Chuyển thành Offline.`);
                        updates[`${deviceId}/info/status`] = 'offline';
                    }
                });

                if (Object.keys(updates).length > 0) {
                    await db.ref('esp32/devices').update(updates);
                }
                resolve();
            }, 4000);
        });
    }
