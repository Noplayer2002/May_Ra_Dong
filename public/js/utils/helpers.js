export function parseStatusInfo(statusRaw) {
    const s = (statusRaw || 'offline').toString().toLowerCase();
    switch (s) {
        case 'running':
            return { label: 'Running (Đang chạy)', cls: 'running', textCls: 'running-text' };
        case 'error':
            return { label: 'Error (Lỗi)', cls: 'error', textCls: 'error-text' };
        case 'online':
            return { label: 'Online (Chờ)', cls: 'online', textCls: 'online-text' };
        default:
            return { label: 'Offline (Mất kết nối)', cls: 'offline', textCls: 'offline-text' };
    }
}

export function getBatteryPercentage(voltage) {
    const curve = [
        { v: 12.15, p: 100 }, { v: 11.85, p: 90 }, { v: 11.60, p: 80 },
        { v: 11.35, p: 70 },  { v: 11.10, p: 60 }, { v: 10.95, p: 50 },
        { v: 10.80, p: 40 },  { v: 10.70, p: 30 }, { v: 10.60, p: 20 },
        { v: 10.50, p: 10 },  { v: 10.10, p: 5 },  { v: 9.60,  p: 0 }
    ];
    if (voltage >= curve[0].v) return 100;
    if (voltage <= curve[curve.length - 1].v) return 0;
    
    for (let i = 0; i < curve.length - 1; i++) {
        if (voltage <= curve[i].v && voltage >= curve[i + 1].v) {
            const { v: v_max, p: p_max } = curve[i];
            const { v: v_min, p: p_min } = curve[i + 1];
            return Math.round(p_min + ((voltage - v_min) / (v_max - v_min)) * (p_max - p_min));
        }
    }
    return 0;
}

export function formatHL7Date(str) {
    if (!str || str.length < 8) return str || 'N/A';
    const y = str.substr(0, 4), m = str.substr(4, 2), d = str.substr(6, 2);
    const time = str.length >= 14 ? ` ${str.substr(8, 2)}:${str.substr(10, 2)}:${str.substr(12, 2)}` : '';
    return `${d}/${m}/${y}${time}`;
}