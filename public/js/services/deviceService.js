import { db } from '../config/firebase.js';
import { parseHL7String } from '../parsers/hl7Parser.js';

const GOOGLE_SHEET_WEBHOOK_URL = "https://script.google.com/macros/s/AKfycbwnjxvLfXqW4ql9yDpvSmr05VHzikT5aljv9zUjTTtmQXyRqt7cQYPJuTSXWYXSXKqz/exec";
export const GOOGLE_SHEET_SECRET_TOKEN = "MayRaDong_Secure_Token_2026_xyz";

export const DeviceService = {
    subscribeDevices(callback) {
        return db.ref('esp32/devices').on('value', snap => callback(snap.val() || {}));
    },

    subscribeHistory(callback) {
        return db.ref('esp32/history').on('value', snap => callback(snap.val() || {}));
    },

    async triggerScanWifi(deviceId) {
        if (!deviceId) return;

        const scanCmdRef = db.ref(`esp32/devices/${deviceId}/command/scan_wifi`);
        await db.ref(`esp32/devices/${deviceId}/wifi_list`).remove();
        await scanCmdRef.set(true);

        setTimeout(async () => {
            try {
                await scanCmdRef.set(false);
                console.log(`Đã tự động trả cờ scan_wifi về false cho ${deviceId}`);
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
                console.log(`Đã xóa node wifi: esp32/devices/${deviceId}/wifi`);
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
            token: GOOGLE_SHEET_SECRET_TOKEN,
            hl7Time: msh.timestamp || '',
            deviceId: deviceId || msh.sender || 'THAWER_16',
            msgId: msh.msgId || recordKey || '',
            batchId: pid.batchId || '',
            tempZoneA: zoneA.temp || 'N/A',
            tempZoneB: zoneB.temp || 'N/A',
            slots: slots
        };

        console.log("Dữ liệu gửi sang Google Sheets:", payload);

        try {
            await fetch(GOOGLE_SHEET_WEBHOOK_URL, {
                method: 'POST',
                mode: 'no-cors',
                headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                body: JSON.stringify(payload)
            });
            console.log("Đã gửi bản ghi sang Google Sheets thành công!");
        } catch (err) {
            console.error("Lỗi gửi Google Sheet:", err);
        }


        // Xóa bản ghi trong hàng đợi history trên Firebase để tránh gửi lặp lại
        await db.ref(`esp32/history/${deviceId}/${recordKey}`).remove();

        return true;
    },

    clearAllHistory(deviceId) {
        return db.ref(`esp32/history/${deviceId}`).remove();
    },

    async fetchHistoryFromSheet() {
        const SHEET_ID = "1jaLfUghym0DGokRXKbHBB35qx9IXLwIW4DnyRnJkThg";
        const csvUrl = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&_t=${Date.now()}`;
        
        // 1. Thử đọc trực tiếp qua CSV Export (Nhanh, hỗ trợ CORS gốc, không cần Apps Script)
        try {
            const res = await fetch(csvUrl, { method: 'GET' });
            if (res.ok) {
                const text = await res.text();
                const batches = parseGoogleSheetCSV(text);
                if (batches && batches.length > 0) {
                    return batches;
                }
            }
        } catch (csvErr) {
            console.warn("Lỗi đọc Google Sheet CSV, thử qua Webhook Apps Script:", csvErr);
        }

        // 2. Dự phòng: Đọc qua Webhook Apps Script nếu có action=getHistory
        const apiUrl = `${GOOGLE_SHEET_WEBHOOK_URL}?action=getHistory&token=${encodeURIComponent(GOOGLE_SHEET_SECRET_TOKEN)}&_t=${Date.now()}`;
        try {
            const res = await fetch(apiUrl, { method: 'GET' });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            if (data.status === 'SUCCESS' && Array.isArray(data.batches)) {
                return data.batches;
            }
        } catch (apiErr) {
            console.warn("Không thể tải lịch sử từ Google Sheets API:", apiErr);
        }

        return null;
    }
};

function parseCSVLine(line) {
    const values = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
        const char = line[i];
        if (char === '"') {
            if (inQuotes && line[i + 1] === '"') {
                current += '"';
                i++;
            } else {
                inQuotes = !inQuotes;
            }
        } else if (char === ',' && !inQuotes) {
            values.push(current.trim());
            current = '';
        } else {
            current += char;
        }
    }
    values.push(current.trim());
    return values;
}

export function parseGoogleSheetCSV(text) {
    if (!text) return [];
    const lines = text.trim().split(/\r?\n/);
    if (lines.length < 2) return [];

    const batchesMap = new Map();

    for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        const cols = parseCSVLine(line);
        if (cols.length < 7) continue;

        const hl7Time = (cols[0] || '').trim();
        const deviceId = (cols[1] || '').trim();
        const msgId = (cols[2] || '').trim();
        const batchId = (cols[3] || '').trim();
        const zone = (cols[4] || '').trim();
        const temp = (cols[5] || '').trim();
        const barcodeRaw = (cols[6] || '').replace(/^['"]|['"]$/g, '').trim();
        const barcode = (barcodeRaw === 'NO_BARCODE' ? '' : barcodeRaw);

        if (!batchId || batchId === 'TEST_BATCH') continue;

        const key = `${batchId}___${msgId || hl7Time}`;
        if (!batchesMap.has(key)) {
            batchesMap.set(key, {
                batchId,
                msgId,
                deviceId,
                hl7Time,
                tempZoneA: zone === 'Zone A' ? temp : '',
                tempZoneB: zone === 'Zone B' ? temp : '',
                slots: []
            });
        }

        const b = batchesMap.get(key);
        if (zone === 'Zone A' && temp && (!b.tempZoneA || b.tempZoneA === '0.0 °C')) b.tempZoneA = temp;
        if (zone === 'Zone B' && temp && (!b.tempZoneB || b.tempZoneB === '0.0 °C')) b.tempZoneB = temp;

        b.slots.push({
            slot: (b.slots.length % 16) + 1,
            barcode,
            zone,
            temp
        });
    }

    const batches = Array.from(batchesMap.values()).reverse().map(b => {
        if (b.slots.length > 16) {
            b.slots = b.slots.slice(-16).map((s, idx) => ({ ...s, slot: idx + 1 }));
        }
        while (b.slots.length < 16) {
            const nextSlot = b.slots.length + 1;
            b.slots.push({
                slot: nextSlot,
                barcode: '',
                zone: nextSlot <= 8 ? 'Zone A' : 'Zone B',
                temp: nextSlot <= 8 ? b.tempZoneA : b.tempZoneB
            });
        }
        return b;
    });

    return batches;
}
