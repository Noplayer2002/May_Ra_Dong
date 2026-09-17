// js/parsers/hl7Parser.js

export function parseHL7String(raw) {
    if (!raw) return null;

    // 1. Tách các segment bị dính liền thành từng dòng riêng biệt
    const normalized = raw
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n')
        .replace(/(MSH|PID|OBR|NTE|OBX)\|/g, '\n$1|') // Tách dính liền: PASSEDNTE| -> \nNTE|, FOBX| -> \nOBX|
        .trim();

    const lines = normalized.split('\n').map(l => l.trim()).filter(Boolean);

    const result = {
        msh: {},
        pid: {},
        zoneA: { temp: '0.0 °C', status: 'PASSED', duration: '' },
        zoneB: { temp: '0.0 °C', status: 'PASSED', duration: '' },
        slots: Array.from({ length: 16 }, (_, i) => ({
            slot: i + 1,
            zone: (i < 8) ? 'Zone A' : 'Zone B',
            barcode: '',
            status: 'Trống'
        }))
    };

    lines.forEach(line => {
        const parts = line.split('|');
        const seg = parts[0];

        // Header MSH
        if (seg === 'MSH') {
            result.msh = {
                sender: parts[2] || '',
                facility: parts[3] || '',
                timestamp: parts[6] || '',
                msgType: parts[8] || '',
                msgId: parts[9] || ''
            };
        } 
        // Batch PID
        else if (seg === 'PID') {
            result.pid = {
                batchId: parts[3] || 'N/A',
                batchType: parts[5] || ''
            };
        } 
        // Nhiệt độ Zone (NTE)
        else if (seg === 'NTE') {
            // Nối lại toàn bộ nội dung phía sau vì bản tin có dấu | bên trong nội dung
            const fullComment = parts.slice(3).join('|').trim(); 
            const upper = fullComment.toUpperCase();

            // Trích xuất nhiệt độ (VD: "ZONE_A: 0.0 C" -> lấy "0.0 °C")
            const tempMatch = fullComment.match(/(?:ZONE_[AB]:\s*)([-+]?[0-9]+(?:\.[0-9]+)?)\s*°?C/i) 
                           || fullComment.match(/([-+]?[0-9]+(?:\.[0-9]+)?)\s*°?C/i);
            const tempVal = tempMatch ? `${tempMatch[1]} °C` : '--.- °C';

            // Trích xuất Duration (VD: "15m18s")
            const durMatch = fullComment.match(/DURATION:\s*([0-9a-zA-Z]+)/i);
            const durVal = durMatch ? durMatch[1] : '';

            const statusVal = upper.includes('FAIL') ? 'FAILED' : 'PASSED';

            if (upper.includes('ZONE_A') || upper.includes('ZONE A')) {
                result.zoneA.temp = tempVal;
                result.zoneA.status = statusVal;
                result.zoneA.duration = durVal;
            } else if (upper.includes('ZONE_B') || upper.includes('ZONE B')) {
                result.zoneB.temp = tempVal;
                result.zoneB.status = statusVal;
                result.zoneB.duration = durVal;
            }
        } 
        // 16 Túi Barcode (OBX)
        else if (seg === 'OBX') {
            // Format: OBX|1|ST|1||24330B0BD3|||||F
            const bagIndex = parseInt(parts[3] || parts[1], 10);
            const barcodeVal = parts[5] || '';
            const statusVal = (parts[11] === 'F' || parts[11] === 'OK') ? 'PASSED' : (parts[11] || 'PASSED');

            if (bagIndex >= 1 && bagIndex <= 16) {
                result.slots[bagIndex - 1].barcode = barcodeVal;
                result.slots[bagIndex - 1].status = barcodeVal ? statusVal : 'Trống';
            }
        }
    });

    return { parsed: result, raw: normalized };
}
