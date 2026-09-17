import { db } from '../config/firebase.js';
import { parseHL7String } from '../parsers/hl7Parser.js';

const GOOGLE_SHEET_WEBHOOK_URL = "https://script.google.com/macros/s/AKfycbwnjxvLfXqW4ql9yDpvSmr05VHzikT5aljv9zUjTTtmQXyRqt7cQYPJuTSXWYXSXKqz/exec";

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
                console.log(`🧹 Đã xóa node wifi: esp32/devices/${deviceId}/wifi`);
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

        const parseResult = parseHL7String(rawHL7Text);
        const parsedData = parseResult ? parseResult.parsed : null;
        if (!parsedData) return null;
        
        const { msh, pid, slots, zoneA, zoneB } = parsedData;

        const payload = {
            hl7Time: msh.timestamp || '',
            deviceId: deviceId || msh.sender || 'THAWER_16',
            msgId: msh.msgId || recordKey || '',
            batchId: pid.batchId || '',
            tempZoneA: zoneA.temp || 'N/A',
            tempZoneB: zoneB.temp || 'N/A',
            slots: slots
        };

        console.log("📦 Dữ liệu gửi đi:", payload);

        try {
            await fetch(GOOGLE_SHEET_WEBHOOK_URL, {
                method: 'POST',
                mode: 'no-cors',
                headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                body: JSON.stringify(payload)
            });
            console.log("✅ Đã gửi bản ghi sang Google Sheets thành công!");
        } catch (err) {
            console.error("❌ Lỗi gửi Google Sheet:", err);
        }

        // Tạm thời comment dòng này lại để test, khi nào sheet ghi ngon lành thì mở ra
        /await db.ref(`esp32/devices/${deviceId}/history/${recordKey}`).remove();

        return true;
    },

    clearAllHistory(deviceId) {
        return db.ref(`esp32/devices/${deviceId}/history`).remove();
    }
};
