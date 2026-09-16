import { db } from '../config/firebase.js';
import { parseHL7String } from '../parsers/hl7Parser.js';

const GOOGLE_SHEET_WEBHOOK_URL = "https://script.google.com/macros/s/AKfycbyNcSlXiOoCCAe9ZuEMQDi-ZID4O9t_KV2Vd_HYy5uXyQdBKFbjegzZjgWirnBlNWoB/exec";

export const DeviceService = {
    subscribeDevices(callback) {
        return db.ref('esp32/devices').on('value', snap => callback(snap.val() || {}));
    },

    // Quét Wi-Fi: Xóa dữ liệu cũ, bật cờ true và tự động reset về false sau 10s
    async triggerScanWifi(deviceId) {
        if (!deviceId) return;

        const scanCmdRef = db.ref(`esp32/devices/${deviceId}/command/scan_wifi`);
        await db.ref(`esp32/devices/${deviceId}/wifi_list`).remove();
        await scanCmdRef.set(true);

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

    clearWifiList(deviceId) {
        return db.ref(`esp32/devices/${deviceId}/wifi_list`).remove();
    },

    async saveWifi(deviceId, ssid, pass, timeoutMs = 10000) {
        if (!deviceId || !ssid) throw new Error("Thiếu deviceId hoặc SSID");

        const wifiRef = db.ref(`esp32/devices/${deviceId}/wifi`);
        await wifiRef.set({ ssid, pass });
        await db.ref(`esp32/devices/${deviceId}/wifi_list`).remove();

        setTimeout(async () => {
            try {
                await wifiRef.remove();
            } catch (err) {
                console.warn("Lỗi khi xóa node wifi:", err);
            }
        }, timeoutMs);

        return true;
    },

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

    // GỬI SANG GOOGLE SHEET VÀ TỰ ĐỘNG XÓA KHỎI FIREBASE
    async exportHL7ToGoogleSheet(deviceId, recordKey) {
        const recordRef = db.ref(`esp32/devices/${deviceId}/history/${recordKey}`);
        const snap = await recordRef.once('value');
        const record = snap.val();
        if (!record) throw new Error("Không tìm thấy bản ghi HL7 này trên Database");

        const rawContent = typeof record === 'string' ? record : record.raw_hl7;
        const parseResult = parseHL7String(rawContent);
        const { msh, pid, obxList } = parseResult ? parseResult.parsed : { msh:{}, pid:{}, obxList:[] };

        const payload = {
            deviceId: deviceId,
            msgId: record.meta?.msg_id || msh.msgId || recordKey,
            batchId: record.meta?.batch_id || pid.batchId || 'N/A',
            hl7Time: msh.timestamp || '',
            totalBags: obxList.length,
            barcodes: obxList.map(b => b.barcode),
            rawHL7: rawContent
        };

        // 1. Gửi sang Webhook Google Sheet
        await fetch(GOOGLE_SHEET_WEBHOOK_URL, {
            method: 'POST',
            mode: 'no-cors',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        // 2. XÓA BẢN GHI KHỎI FIREBASE SAU KHI ĐÃ GỬI THÀNH CÔNG
        await recordRef.remove();
        console.log(`🧹 Đã đẩy lên Sheet và xóa bản ghi ${recordKey} của ${deviceId}`);

        return true;
    }
};
