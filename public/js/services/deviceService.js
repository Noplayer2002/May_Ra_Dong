import { db } from '../config/firebase.js';
import { parseHL7String } from '../parsers/hl7Parser.js';

const GOOGLE_SHEET_WEBHOOK_URL = "https://script.google.com/macros/s/AKfycbyNcSlXiOoCCAe9ZuEMQDi-ZID4O9t_KV2Vd_HYy5uXyQdBKFbjegzZjgWirnBlNWoB/exec";

export const DeviceService = {
    subscribeDevices(callback) {
        return db.ref('esp32/devices').on('value', snap => callback(snap.val() || {}));
    },

    triggerScanWifi(deviceId) {
        return db.ref(`esp32/devices/${deviceId}/command/scan_wifi`).set(true);
    },

    // GHI ĐÚNG ĐƯỜNG DẪN CŨ VÀ XÓA ĐÚNG NODE CŨ
    async saveWifi(deviceId, ssid, pass, timeoutMs = 10000) {
        if (!deviceId || !ssid) throw new Error("Thiếu deviceId hoặc SSID");

        const wifiRef = db.ref(`esp32/devices/${deviceId}/wifi`);

        // 1. Ghi đúng vào node: esp32/devices/{deviceId}/wifi
        await wifiRef.set({ ssid, pass });

        // 2. Tự động xóa đúng node: esp32/devices/{deviceId}/wifi sau 10 giây
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

    async saveHL7Record(deviceId, rawHL7Text) {
        if (!deviceId || !rawHL7Text) throw new Error("Thiếu deviceId hoặc rawHL7Text");

        const parseResult = parseHL7String(rawHL7Text);
        if (!parseResult) throw new Error("Chuỗi HL7 không hợp lệ");

        const { parsed, raw } = parseResult;
        
        const timePart = parsed.msh.timestamp || Date.now().toString();
        const msgId = parsed.msh.msgId || Math.random().toString(36).substring(2, 7);
        const recordKey = `${timePart}_${msgId}`;

        const recordData = {
            raw_hl7: raw,
            meta: {
                msg_id: parsed.msh.msgId || '',
                batch_id: parsed.pid.batchId || 'UNKNOWN',
                timestamp: parsed.msh.timestamp || '',
                sender: parsed.msh.sender || '',
                total_bags: parsed.obxList.length || 0,
                barcodes: parsed.obxList.map(b => b.barcode).filter(Boolean),
                saved_at: firebase.database.ServerValue.TIMESTAMP
            }
        };

        await db.ref(`esp32/devices/${deviceId}/history/${recordKey}`).set(recordData);
        return { recordKey, recordData };
    },

    async exportHL7ToGoogleSheet(deviceId, recordKey) {
        const snap = await db.ref(`esp32/devices/${deviceId}/history/${recordKey}`).once('value');
        const record = snap.val();
        if (!record) throw new Error("Không tìm thấy bản ghi HL7 này trên Database");

        const parseResult = parseHL7String(record.raw_hl7);
        const { msh, pid, obxList } = parseResult ? parseResult.parsed : { msh:{}, pid:{}, obxList:[] };

        const payload = {
            deviceId: deviceId,
            msgId: record.meta?.msg_id || msh.msgId || recordKey,
            batchId: record.meta?.batch_id || pid.batchId || 'N/A',
            hl7Time: msh.timestamp || '',
            totalBags: obxList.length,
            barcodes: obxList.map(b => b.barcode),
            rawHL7: record.raw_hl7
        };

        await fetch(GOOGLE_SHEET_WEBHOOK_URL, {
            method: 'POST',
            mode: 'no-cors',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        return true;
    }
    // xóa cache ssid và password
    // 1. Khi quét Wi-Fi: Xóa danh sách cũ trước khi kích hoạt cờ quét
    async triggerScanWifi(deviceId) {
        await db.ref(`esp32/devices/${deviceId}/wifi_list`).remove();
        return db.ref(`esp32/devices/${deviceId}/command/scan_wifi`).set(true);
    },

    // 2. Hàm chuyên dụng để xóa danh sách Wi-Fi
    clearWifiList(deviceId) {
        return db.ref(`esp32/devices/${deviceId}/wifi_list`).remove();
    },

    // 3. Cập nhật hàm saveWifi: Xóa ngay wifi_list sau khi người dùng gửi pass
    async saveWifi(deviceId, ssid, pass, timeoutMs = 10000) {
        if (!deviceId || !ssid) throw new Error("Thiếu deviceId hoặc SSID");

        const wifiRef = db.ref(`esp32/devices/${deviceId}/wifi`);

        // Ghi thông tin mạng vào node wifi
        await wifiRef.set({ ssid, pass });

        // XÓA NGAY LẬP TỨC THƯ MỤC wifi_list TRÊN FIREBASE
        await db.ref(`esp32/devices/${deviceId}/wifi_list`).remove();
        console.log(`🧹 Đã xóa sạch thư mục wifi_list của ${deviceId}`);

        // Tự động xóa node wifi sau timeout (10 giây)
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

    // Giữ alias dự phòng để không bao giờ bị lỗi gọi hàm
    saveWifiCommandAndCleanup(deviceId, ssid, pass, timeoutMs) {
        return this.saveWifi(deviceId, ssid, pass, timeoutMs);
    },
};
