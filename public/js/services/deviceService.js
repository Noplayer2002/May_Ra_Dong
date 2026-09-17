import { db } from '../config/firebase.js';
import { parseHL7String } from '../parsers/hl7Parser.js';

const GOOGLE_SHEET_WEBHOOK_URL = "https://script.google.com/macros/s/AKfycbyNcSlXiOoCCAe9ZuEMQDi-ZID4O9t_KV2Vd_HYy5uXyQdBKFbjegzZjgWirnBlNWoB/exec";

export const DeviceService = {
    subscribeDevices(callback) {
        return db.ref('esp32/devices').on('value', snap => callback(snap.val() || {}));
    },

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
                console.log(`🧹 Đã xóa sạch node wifi tại: esp32/devices/${deviceId}/wifi`);
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

// js/services/deviceService.js

async processAndForwardHL7(deviceId, recordKey, rawHL7Text) {
        if (!rawHL7Text) return null;

        // Parse bản tin thô
        const parseResult = parseHL7String(rawHL7Text);
        const parsed = parseResult ? parseResult.parsed : null;
        if (!parsed) return null;

        const payload = {
            deviceId: deviceId,
            msgId: parsed.msh.msgId || recordKey,
            batchId: parsed.pid.batchId || 'N/A',
            hl7Time: parsed.msh.timestamp || '',
            tempZoneA: parsed.zoneA.temp || '0.0 °C',
            statusZoneA: parsed.zoneA.status || 'PASSED',
            tempZoneB: parsed.zoneB.temp || '0.0 °C',
            statusZoneB: parsed.zoneB.status || 'PASSED',
            slots: parsed.slots // Mảng đủ 16 phần tử slot từ 1 đến 16
        };

        // Gửi sang Webhook Google Sheet
        try {
            await fetch(GOOGLE_SHEET_WEBHOOK_URL, {
                method: 'POST',
                mode: 'no-cors',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            console.log(`📊 Đã đẩy thành công 16 dòng của lô [${payload.batchId}] lên Google Sheets`);
        } catch (err) {
            console.error("Lỗi khi gửi Google Sheet:", err);
        }

        // Xóa sạch trên Firebase để không bị lưu rác
        try {
            await db.ref(`esp32/devices/${deviceId}/history/${recordKey}`).remove();
        } catch (e) {}

        return { parsed: parsed, raw: rawHL7Text };
    },

// ... (Giữ nguyên các hàm bên dưới)

    clearAllHistory(deviceId) {
        return db.ref(`esp32/devices/${deviceId}/history`).remove();
    }
};
