// js/parsers/hl7Parser.js

export function parseHL7String(raw) {
    if (!raw) return null;

    // 1. Tách các phân đoạn dính liền
    const normalized = raw.replace(/\r\n/g, '\n')
                          .replace(/\r/g, '\n')
                          .replace(/(MSH|PID|OBR|NTE|OBX)\|/g, '\n$1|')
                          .trim();
                          
    const lines = normalized.split('\n').map(l => l.trim()).filter(Boolean);

    const result = {
        msh: { sender: '', msgId: '', timestamp: '' },
        pid: { batchId: '' },
        zoneA: { temp: '' },
        zoneB: { temp: '' },
        slots: Array.from({ length: 16 }, (_, i) => ({
            slot: i + 1,
            barcode: ''
        }))
    };

    lines.forEach(line => {
        const parts = line.split('|');
        const seg = parts[0] ? parts[0].trim() : '';

        if (seg === 'MSH') {
            result.msh.sender = parts[2] || '';       // THAWER_16
            result.msh.timestamp = parts[6] || '';    // 20260917111837
            result.msh.msgId = parts[9] || '';        // MSG_20260917111837
        } 
        else if (seg === 'PID') {
            result.pid.batchId = parts[3] || '';      // BATCH_01
        } 
        else if (seg === 'NTE') {
            const comment = parts.slice(3).join('|').toUpperCase();
            const tempMatch = comment.match(/([-+]?[0-9]*\.?[0-9]+)\s*C/i);
            const tempVal = tempMatch ? `${tempMatch[1]} °C` : '';

            if (comment.includes('ZONE_A')) result.zoneA.temp = tempVal;
            if (comment.includes('ZONE_B')) result.zoneB.temp = tempVal;
        } 
        else if (seg === 'OBX') {
            // Lấy vị trí túi từ parts[3] hoặc parts[1]
            const bagIndex = parseInt(parts[3], 10) || parseInt(parts[1], 10);
            const barcode = parts[5] ? parts[5].trim() : '';

            if (bagIndex >= 1 && bagIndex <= 16) {
                result.slots[bagIndex - 1].barcode = barcode;
            }
        }
    });

    return { parsed: result, raw: normalized };
}
