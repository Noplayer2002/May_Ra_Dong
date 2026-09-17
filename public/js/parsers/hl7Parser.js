export function parseHL7String(raw) {
    if (!raw) return null;

    // 1. Tách các segment bị dính chữ (VD: FOBX|1 -> F \n OBX|1)
    const normalized = raw.replace(/\r\n/g, '\n')
                          .replace(/\r/g, '\n')
                          .replace(/(MSH|PID|OBR|NTE|OBX)\|/g, '\n$1|') 
                          .trim();
                          
    const lines = normalized.split('\n').map(l => l.trim()).filter(Boolean);

    const result = {
        msh: {}, pid: {},
        zoneA: { temp: '', status: '' },
        zoneB: { temp: '', status: '' },
        slots: Array.from({ length: 16 }, (_, i) => ({
            slot: i + 1,
            barcode: '',
            status: ''
        }))
    };

    lines.forEach(line => {
        const parts = line.split('|');
        const seg = parts[0];

        if (seg === 'MSH') {
            result.msh.timestamp = parts[6] || '';
            result.msh.msgId = parts[9] || '';
        } 
        else if (seg === 'PID') {
            result.pid.batchId = parts[3] || '';
        } 
        else if (seg === 'NTE') {
            // FIX LỖI: Nối lại toàn bộ nội dung do dấu | sinh ra lỗi bên trong câu
            const comment = parts.slice(3).join('|').toUpperCase();

            // Rút trích nhiệt độ (Lọc số đứng trước chữ C)
            const tempMatch = comment.match(/([-+]?[0-9]*\.?[0-9]+)\s*C/i);
            const tempVal = tempMatch ? `${tempMatch[1]} °C` : '';

            if (comment.includes('ZONE_A')) {
                result.zoneA.temp = tempVal;
            } 
            else if (comment.includes('ZONE_B')) {
                result.zoneB.temp = tempVal;
            }
        } 
        else if (seg === 'OBX') {
            const bagIndex = parseInt(parts[3], 10);
            const barcode = parts[5] || '';
            const status = parts[11] || '';

            if (bagIndex >= 1 && bagIndex <= 16) {
                result.slots[bagIndex - 1].barcode = barcode;
                result.slots[bagIndex - 1].status = status;
            }
        }
    });

    return { parsed: result, raw: normalized };
}
