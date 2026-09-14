import { db } from '../config/firebase.js';
import { parseHL7String } from '../parsers/hl7Parser.js';
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

    // Dùng .update() thay vì .set() để chỉ đổi trường được chỉ định
    updateTcp(deviceId, changedData) {
        return db.ref(`esp32/devices/${deviceId}/tcp`).update(changedData);
    },

    // Dùng .update() thay vì .set() để chỉ đổi đúng các tham số thay đổi
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
    }
    async saveHL7Record(deviceId, rawHL7Text) {
        if (!deviceId || !rawHL7Text) throw new Error("Thiếu deviceId hoặc rawHL7Text");

        // Gọi hàm parse sẵn có (không sửa logic hàm này)
        const parseResult = parseHL7String(rawHL7Text);
        if (!parseResult) throw new Error("Chuỗi HL7 không hợp lệ");

        const { parsed, raw } = parseResult;
        
        // Tạo mã bản ghi chuẩn: YYYYMMDDHHMMSS_MsgID (dễ sort và tìm kiếm)
        const timePart = parsed.msh.timestamp || Date.now().toString();
        const msgId = parsed.msh.msgId || Math.random().toString(36).substring(2, 7);
        const recordKey = `${timePart}_${msgId}`;

        // Cấu trúc lưu trữ nâng cấp
        const recordData = {
            raw_hl7: raw,                               // Phục vụ UI hiển thị hiện tại
            meta: {
                msg_id: parsed.msh.msgId || '',
                batch_id: parsed.pid.batchId || 'UNKNOWN',
                timestamp: parsed.msh.timestamp || '',
                sender: parsed.msh.sender || '',
                total_bags: parsed.obxList.length || 0,
                // Lưu danh sách barcode thu gọn để tìm kiếm nhanh
                barcodes: parsed.obxList.map(b => b.barcode).filter(Boolean),
                saved_at: firebase.database.ServerValue.TIMESTAMP // Timestamp server
            }
        };

        // Lưu vào đường dẫn history
        await db.ref(`esp32/devices/${deviceId}/history/${recordKey}`).set(recordData);
        return { recordKey, recordData };
    }
};
};
