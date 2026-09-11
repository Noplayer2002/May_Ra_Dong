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
// js/services/deviceService.js

    async broadcastPing() {
        const pingId = Date.now().toString();
        console.log("🚀 [PHÁT PING TOÀN MẠNG]: Mã =", pingId);

        // 1. Lấy danh sách tất cả các ID thiết bị hiện có đưa vào DANH SÁCH CHỜ
        const snapshot = await db.ref('esp32/devices').once('value');
        const allDevices = snapshot.val() || {};
        
        // Tạo một Set chứa ID của tất cả máy cần kiểm tra
        const pendingDevices = new Set(Object.keys(allDevices));

        // 2. MỞ CỔNG LẮNG NGHE TỨC THÌ (Ai trả lời là gạch tên ngay)
        const devicesRef = db.ref('esp32/devices');
        
        const pongListener = devicesRef.on('child_changed', (childSnap) => {
            const devId = childSnap.key;
            const devData = childSnap.val() || {};
            
            // Lấy pong và làm sạch dấu cách/ngoặc kép nếu có
            const incomingPong = devData.info?.pong ? devData.info.pong.toString().replace(/["'\s]/g, '') : '';

            // Nếu thiết bị này phản hồi đúng mã Ping vừa gửi
            if (incomingPong === pingId) {
                console.log(`🎯 [NHẬN PHẢN HỒI] Máy [${devId}] phản hồi thành công! Trạng thái: ${devData.info?.status}`);
                
                // GẠCH TÊN NGAY LẬP TỨC KHỎI DANH SÁCH CHỜ PHẠT
                pendingDevices.delete(devId);
            }
        });

        // 3. Phát mã Ping lên Firebase để kích hoạt ESP32
        await db.ref('esp32/global_command/ping').set(pingId);

        // 4. CHỜ HẠN CHÓT (4.5 Giây)
        return new Promise((resolve) => {
            setTimeout(async () => {
                // Tắt cổng lắng nghe để không làm chậm bộ nhớ
                devicesRef.off('child_changed', pongListener);

                const updates = {};
                
                // 5. CHỈ PHẠT NHỮNG MÁY CÒN KẸT LẠI TRONG DANH SÁCH CHỜ
                pendingDevices.forEach(deadDeviceId => {
                    console.warn(`💀 [TIMEOUT] Máy [${deadDeviceId}] KHÔNG phản hồi -> Gán Offline`);
                    updates[`${deadDeviceId}/info/status`] = 'offline';
                });

                // Cập nhật lên Firebase nếu có máy thực sự chết
                if (Object.keys(updates).length > 0) {
                    await db.ref('esp32/devices').update(updates);
                }

                console.log("🏁 [HOÀN TẤT QUÉT] Kiểm tra kết thúc.");
                resolve();
            }, 4500); // 4.5 giây là thời gian vàng đủ cho mạng Wi-Fi và SSL
        });
    }
}
