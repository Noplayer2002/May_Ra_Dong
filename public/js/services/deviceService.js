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

    // 1. LƯU LẠI PONG CŨ CỦA TẤT CẢ THIẾT BỊ TRƯỚC KHI PING
    const oldPongs = {};
    Object.keys(devicesDataCache).forEach(id => {
        const info = devicesDataCache[id].info || {};
        oldPongs[id] = (info.pong || '').toString();
    });

    // 2. Gửi lệnh Ping để đánh thức ESP32
    db.ref('esp32/global_command/ping').set(Date.now().toString());

    // 3. Chờ 3 giây
    setTimeout(() => {
        const updates = {};
        
        Object.keys(devicesDataCache).forEach(deviceId => {
            const dev = devicesDataCache[deviceId];
            const info = dev?.info || {};
            
            const currentStatus = (info.status || '').toLowerCase();
            const newPong = (info.pong || '').toString();

            // LOGIC CỦA BẠN: 
            // - Nếu Pong MỚI khác Pong CŨ (tức là ESP32 có cập nhật dữ liệu)
            // - HOẶC thiết bị đang báo Online / Running
            // -> LÀ THIẾT BỊ SỐNG -> BỎ QUA KHÔNG LÀM GÌ CẢ!
            if (newPong !== oldPongs[deviceId] || currentStatus === 'online' || currentStatus === 'running') {
                return; 
            }

            // Chỉ con nào PONG KHÔNG ĐỔI và cũng KHÔNG ONLINE mới bị ép về offline
            updates[`${deviceId}/info/status`] = 'offline';
        });

        // 4. Đẩy lệnh offline lên Firebase cho các máy đã chết
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
