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

    setTimeout(() => {
        // KHÓA HOÀN TOÀN KHÔNG CHO PHÉP GHI BẤT KỲ CHỮ 'OFFLINE' NÀO LÊN FIREBASE
        btn.disabled = false;
        btn.textContent = "⚡ Quét Trạng Thái (Global Ping)";

        // In ra màn hình kiểm tra xem sau 3s thiết bị đang lưu cái gì
        Object.keys(devicesDataCache).forEach(deviceId => {
            const dev = devicesDataCache[deviceId];
            console.log("DỮ LIỆU THỰC TẾ SAU 3S CỦA [" + deviceId + "]:", dev.info);
            alert("THIẾT BỊ: " + deviceId + 
                  "\n- Status hiện tại: " + (dev.info ? dev.info.status : "không có") + 
                  "\n- Pong hiện tại: " + (dev.info ? dev.info.pong : "không có"));
        });

    }, 3000);
};
