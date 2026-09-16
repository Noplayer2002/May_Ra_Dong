import { db } from '../config/firebase.js';
import { parseHL7String } from '../parsers/hl7Parser.js';

const GOOGLE_SHEET_WEBHOOK_URL = "https://script.google.com/macros/s/AKfycbyNcSlXiOoCCAe9ZuEMQDi-ZID4O9t_KV2Vd_HYy5uXyQdBKFbjegzZjgWirnBlNWoB/exec";

export const DeviceService = {
    subscribeDevices(callback) {
        return db.ref('esp32/devices').on('value', snap => callback(snap.val() || {}));
    },

    // Quét Wi-Fi: Xóa danh sách cũ trước khi quét mới
// Quét Wi-Fi: Xóa dữ liệu cũ, bật cờ true và TỰ ĐỘNG RESET về false sau 10s
    async triggerScanWifi(deviceId) {
        if (!deviceId) return;

        const scanCmdRef = db.ref(`esp32/devices/${deviceId}/command/scan_wifi`);

        // 1. Xóa danh sách Wi-Fi cũ trên Firebase
        await db.ref(`esp32/devices/${deviceId}/wifi_list`).remove();

        // 2. Bật cờ quét lên true
        await scanCmdRef.set(true);

        // 3. ĐÚNG 10 GIÂY SAU: Tự động chuyển về false dù có nhận được dữ liệu hay không
        setTimeout(async () => {
            try {
                await scanCmdRef.set(false);
                console.log(`⏱️ Đã tự động trả cờ scan_wifi về false cho ${deviceId}`);
            } catch (err) {
                console.warn("Lỗi khi reset cờ scan_wifi:", err);
            }
        }, 10000);

        return true;
    },

    // Hàm xóa danh sách Wi-Fi
    clearWifiList(deviceId) {
        return db.ref(`esp32/devices/${deviceId}/wifi_list`).remove();
    },

    // Lưu Wi-Fi: Xóa wifi_list ngay lập tức, xóa wifi sau 10s
    async saveWifi(deviceId, ssid, pass, timeoutMs = 10000) {
        if (!deviceId || !ssid) throw new Error("Thiếu deviceId hoặc SSID");

        const wifiRef = db.ref(`esp32/devices/${deviceId}/wifi`);

        // 1. Ghi đúng vào node: esp32/devices/{deviceId}/wifi
        await wifiRef.set({ ssid, pass });

        // 2. XÓA NGAY LẬP TỨC THƯ MỤC wifi_list
        await db.ref(`esp32/devices/${deviceId}/wifi_list`).remove();
        console.log(`🧹 Đã xóa sạch thư mục wifi_list của ${deviceId}`);

        // 3. Tự động xóa node wifi sau 10 giây
        setTimeout(async () => {
            try {
                await wifiRef.remove();
                console.log(`🧹 Đã xóa sạch node wifi tại: esp32/devices/${deviceId}/wifi`);
            } catch (err) {
                console.warn("Lỗi khi xóa node wifi:", err);
            }
        }, timeoutMs);

        return true;
    },

    // Alias dự phòng tránh lệch tên hàm với app.js
    saveWifiCommandAndCleanup(deviceId, ssid, pass, timeoutMs) {
        return this.saveWifi(deviceId, ssid, pass, timeoutMs);
    },

    updateTcp(deviceId, changedData) {
        return db.ref(`esp32/devices/${deviceId}/tcp`).update(changedData);
    },

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
    },

// 1. Tự động đẩy HL7 sang Google Sheet và XÓA NGAY LẬP TỨC trên Firebase
    async processAndForwardHL7(deviceId, recordKey, rawHL7Text) {
        if (!rawHL7Text) return null;

        const parseResult = parseHL7String(rawHL7Text);
        const { msh, pid, obxList } = parseResult ? parseResult.parsed : { msh:{}, pid:{}, obxList:[] };

        const payload = {
            deviceId: deviceId,
            msgId: msh.msgId || recordKey,
            batchId: pid.batchId || 'N/A',
            hl7Time: msh.timestamp || '',
            totalBags: obxList.length,
            barcodes: obxList.map(b => b.barcode),
            rawHL7: rawHL7Text
        };

        // Gửi sang Webhook Google Sheet
        try {
            await fetch(GOOGLE_SHEET_WEBHOOK_URL, {
                method: 'POST',
                mode: 'no-cors',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            console.log(`📊 Đã tự động đẩy HL7 [${recordKey}] sang Google Sheets`);
        } catch (err) {
            console.error("Lỗi khi gửi Google Sheet:", err);
        }

        // XÓA NGAY KHỎI DATABASE FIREBASE (Không lưu trữ)
        await db.ref(`esp32/devices/${deviceId}/history/${recordKey}`).remove();
        console.log(`🧹 Đã giải phóng bộ nhớ: Xóa ${recordKey} trên Firebase`);

        return { parsed: parseResult.parsed, raw: rawHL7Text };
    },

    // 2. Hàm dọn sạch toàn bộ thư mục history cũ còn tồn đọng trên DB
    clearAllHistory(deviceId) {
        return db.ref(`esp32/devices/${deviceId}/history`).remove();
    }
};
