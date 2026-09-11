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
        obxList: []
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
            result.notes.push(parts[3] || '');
        } else if (seg === 'OBX') {
            result.obxList.push({
                seq: parts[1] || '',
                bagIndex: parts[3] || '',
                barcode: parts[5] || '',
                status: parts[11] || 'F'
            });
        }
    });

    return { parsed: result, raw: normalized };
}