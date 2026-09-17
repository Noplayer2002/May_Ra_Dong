// js/parsers/hl7Parser.js

export function parseHL7String(raw) {
    if (!raw) return null;
    const normalized = raw.replace(/\r\n/g, '\n')
                          .replace(/\r/g, '\n')
                          .replace(/(MSH|PID|OBR|NTE|OBX)\|/g, '\n$1|')
                          .trim();
                          
    const lines = normalized.split('\n').map(l => l.trim()).filter(Boolean);

    const result = {
        msh: {},
        pid: {},
        notes: [],
        rawObxList: [],
        zoneA: { temp: 'N/A', status: 'N/A', note: '' },
        zoneB: { temp: 'N/A', status: 'N/A', note: '' },
        slots: Array.from({ length: 16 }, (_, i) => ({
            slot: i + 1,
            zone: i < 8 ? 'A' : 'B',
            barcode: '',
            status: 'Trống'
        }))
    };

    lines.forEach(line => {
        const parts = line.split('|');
        const seg = parts[0];

        if (seg === 'MSH') {
            result.msh = {
                sender: parts[2] || '',
                facility: parts[3] || '',
                timestamp: parts[6] || '',
                msgType: parts[8] || '',
                msgId: parts[9] || ''
            };
        } else if (seg === 'PID') {
            result.pid = {
                batchId: parts[3] || '',
                batchType: parts[5] || ''
            };
        } else if (seg === 'NTE') {
            const comment = parts[3] || '';
            result.notes.push(comment);

            // Bóc tách nhiệt độ cuối Zone A & Zone B
            // Hỗ trợ các định dạng thường gặp: "Zone A: 37.0 C", "ZONE A TEMP=37.2", "ZONE A PASSED 37.1C"
            const upper = comment.toUpperCase();
            const tempMatch = comment.match(/([-+]?[0-9]*\.?[0-9]+)\s*°?C?/i);
            const tempVal = tempMatch ? `${tempMatch[1]} °C` : '';

            if (upper.includes('ZONE A') || upper.includes('ZONE_A')) {
                result.zoneA.note = comment;
                result.zoneA.temp = tempVal || 'Đã ghi nhận';
                result.zoneA.status = upper.includes('PASS') ? 'PASSED' : (upper.includes('FAIL') ? 'FAILED' : 'HOÀN TẤT');
            } else if (upper.includes('ZONE B') || upper.includes('ZONE_B')) {
                result.zoneB.note = comment;
                result.zoneB.temp = tempVal || 'Đã ghi nhận';
                result.zoneB.status = upper.includes('PASS') ? 'PASSED' : (upper.includes('FAIL') ? 'FAILED' : 'HOÀN TẤT');
            }
        } else if (seg === 'OBX') {
            const seq = parseInt(parts[1], 10);
            const bagIndex = parseInt(parts[3], 10) || seq;
            const barcode = parts[5] || '';
            const status = parts[11] || 'OK';

            result.rawObxList.push({ seq, bagIndex, barcode, status });

            // Gán vào đúng slot từ 1 đến 16
            if (bagIndex >= 1 && bagIndex <= 16) {
                result.slots[bagIndex - 1].barcode = barcode;
                result.slots[bagIndex - 1].status = status === 'F' ? 'Hoàn tất' : status;
            }
        }
    });

    return { parsed: result, raw: normalized };
}
