import { db } from '../config/firebase.js';
import { parseHL7String } from '../parsers/hl7Parser.js';

const GOOGLE_SHEET_WEBHOOK_URL = "https://script.google.com/macros/s/AKfycbyNcSlXiOoCCAe9ZuEMQDi-ZID4O9t_KV2Vd_HYy5uXyQdBKFbjegzZjgWirnBlNWoB/exec";

export const DeviceService = {
    /**
     * Lắng nghe toàn bộ danh sách thiết bị theo thời gian thực từ Firebase
     */
    subscribeDevices(callback) {
        const devicesRef = db.ref('esp32/devices');
        devicesRef.on('value', snap => callback(snap.val() || {}));
        return () => devicesRef.off();
    },

    /**
     * Kích hoạt chế độ quét Wi-Fi trên ESP32
     * Xóa danh sách cũ, bật flag scan_wifi=true và tự động reset về false sau 10s
     */
    async triggerScanWifi(deviceId) {
        if (!deviceId) return;

        const scanCmdRef = db.ref(`esp32/devices/${deviceId}/command/scan_wifi`);

        // 1. Xóa danh sách Wi-Fi đã quét lần trước
        await db.ref(`esp32/devices/${deviceId}/wifi_list`).remove();

        // 2. Bật cờ scan_wifi cho ESP32 bắt đầu quét
        await scanCmdRef.set(true);

        // 3. Tự động trả cờ về false sau 10 giây
        setTimeout(async () => {
            try {
                await scanCmdRef.set(false);
                console.log(`⏱️ Đã reset cờ scan_wifi về false cho [${deviceId}]`);
            } catch (err) {
                console.warn("Lỗi khi reset cờ scan_wifi:", err);
            }
        }, 10000);

        return true;
    },

    /**
     * Xóa danh sách Wi-Fi đã quét của một thiết bị
     */
    clearWifiList(deviceId) {
        if (!deviceId) return Promise.resolve();
        return db.ref(`esp32/devices/${deviceId}/wifi_list`).remove();
    },

    /**
     * Gửi cấu hình Wi-Fi mới xuống ESP32
     * Ghi vào node wifi, xóa wifi_list ngay lập tức và tự xóa node wifi sau timeoutMs (mặc định 10s)
     */
    async saveWifi(deviceId, ssid, pass, timeoutMs = 10000) {
        if (!deviceId || !ssid) throw new Error("Thiếu deviceId hoặc SSID");

        const wifiRef = db.ref(`esp32/devices/${deviceId}/wifi`);

        // 1. Ghi cấu hình mới cho ESP32 nhận
        await wifiRef.set({ ssid, pass });

        // 2. Xóa sạch kết quả quét Wi-Fi cũ
        await db.ref(`esp32/devices/${deviceId}/wifi_list`).remove();

        // 3. Tự động xóa thông tin mật khẩu sau timeoutMs để bảo mật
        setTimeout(async () => {
            try {
                await wifiRef.remove();
                console.log(`🔒 Đã dọn dẹp node mật khẩu Wi-Fi của [${deviceId}]`);
            } catch (err) {
                console.warn("Lỗi khi xóa node wifi:", err);
            }
        }, timeoutMs);

        return true;
    },

    saveWifiCommandAndCleanup(deviceId, ssid, pass, timeoutMs) {
        return this.saveWifi(deviceId, ssid, pass, timeoutMs);
    },

    /**
     * Cập nhật thông số kết nối TCP Server
     */
    updateTcp(deviceId, changedData) {
        if (!deviceId || !changedData) return Promise.resolve();
        return db.ref(`esp32/devices/${deviceId}/tcp`).update(changedData);
    },

    /**
     * Cập nhật thông số nhiệt độ & hệ số PID Plasma
     */
    updatePlasma(deviceId, changedData) {
        if (!deviceId || !changedData) return Promise.resolve();
        return db.ref(`esp32/devices/${deviceId}/plasma`).update(changedData);
    },

    /**
     * Phát lệnh Ping toàn hệ thống và đánh dấu offline các máy không phản hồi sau 3s
     */
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

// XỬ lý bản tin HL

async processAndForwardHL7(deviceId, recordKey, rawHL7Text) {
    if (!rawHL7Text) return null;

    const parseResult = parseHL7String(rawHL7Text);
    const { msh, pid, slots, zoneA, zoneB } = parseResult ? parseResult.parsed : { 
        msh: {}, pid: {}, slots: [], zoneA: {}, zoneB: {} 
    };

    // Chuẩn hóa mảng 16 barcode đúng thứ tự slot 1 -> 16
    const slotBarcodes = slots && slots.length === 16 
        ? slots.map(s => s.barcode || "")
        : Array(16).fill("");

    // Đếm số túi thực tế có barcode
    const actualTotalBags = slotBarcodes.filter(b => b.trim() !== "").length;

    const payload = {
        deviceId: deviceId,
        msgId: msh.msgId || recordKey,
        batchId: pid.batchId || 'N/A',
        hl7Time: msh.timestamp || '',
        tempZoneA: zoneA.temp || 'N/A',
        statusZoneA: zoneA.status || 'N/A',
        tempZoneB: zoneB.temp || 'N/A',
        statusZoneB: zoneB.status || 'N/A',
        totalBags: actualTotalBags,
        slots: slotBarcodes, // Mảng 16 phần tử cho 16 cột
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
        console.log(`📊 Đã đẩy HL7 [${recordKey}] gồm Zone A/B và 16 túi sang Google Sheets`);
    } catch (err) {
        console.error("Lỗi khi gửi Google Sheet:", err);
    }

    // Xóa bản ghi đã xử lý trên Firebase để giải phóng bộ nhớ
    await db.ref(`esp32/devices/${deviceId}/history/${recordKey}`).remove();
    console.log(`🧹 Đã giải phóng bộ nhớ: Xóa ${recordKey} trên Firebase`);

    return { parsed: parseResult.parsed, raw: rawHL7Text };
}

        // Lưu bản ghi mới nhất vào node `last_hl7` để UI luôn có dữ liệu hiển thị (kể cả sau F5)
        try {
            await db.ref(`esp32/devices/${deviceId}/last_hl7`).set({
                key: recordKey,
                raw: rawHL7Text,
                updatedAt: Date.now()
            });
        } catch (err) {
            console.warn("Không thể lưu cache last_hl7:", err);
        }

        // Xóa bản ghi trong hàng đợi history trên Firebase
        try {
            await db.ref(`esp32/devices/${deviceId}/history/${recordKey}`).remove();
            console.log(`🧹 Đã dọn dẹp bản ghi history/${recordKey} trên Firebase`);
        } catch (err) {
            console.warn("Lỗi khi dọn dẹp history:", err);
        }

        return { parsed, raw: rawHL7Text };
    },

    /**
     * Dọn sạch toàn bộ thư mục history cũ
     */
    clearAllHistory(deviceId) {
        if (!deviceId) return Promise.resolve();
        return db.ref(`esp32/devices/${deviceId}/history`).remove();
    }
};
