import { parseStatusInfo, getBatteryPercentage, formatHL7Date } from '../utils/helpers.js';
import { parseHL7String } from '../parsers/hl7Parser.js';

export const UIRenderer = {
    renderDeviceList(devices, filterText, onSelect) {
        const container = document.getElementById('devices-list');
        const filtered = Object.keys(devices).filter(id => id.toLowerCase().includes(filterText.toLowerCase()));

        if (filtered.length === 0) {
            container.innerHTML = '<p style="text-align:center; padding:20px; color:#999;">Không có thiết bị phù hợp</p>';
            return;
        }

        container.innerHTML = filtered.map(id => {
            const st = parseStatusInfo(devices[id]?.info?.status);
            return `
                <div class="device-row" data-id="${id}">
                    <div class="device-name">${id}</div>
                    <div class="status-badge ${st.textCls}">
                        <div class="dot ${st.cls}"></div> ${st.label}
                    </div>
                </div>
            `;
        }).join('');

        container.querySelectorAll('.device-row').forEach(row => {
            row.onclick = () => onSelect(row.dataset.id);
        });
    },

    renderWifiList(wifiList, onSelectSSID) {
        const listEl = document.getElementById('scanned-wifi-list');
        if (!wifiList || wifiList.length === 0) {
            listEl.innerHTML = '<div style="color:#999; font-size:13px; text-align:center; padding:15px;">Không có dữ liệu.</div>';
            return;
        }

        listEl.innerHTML = wifiList.map(w => {
            let sigClass = w.rssi >= -65 ? 'sig-good' : (w.rssi >= -75 ? 'sig-medium' : 'sig-weak');
            return `
                <div class="wifi-item" data-ssid="${w.ssid}">
                    <div class="wifi-ssid">📶 ${w.ssid}</div>
                    <div class="wifi-signal ${sigClass}">${w.rssi} dBm (CH:${w.channel || '?'})</div>
                </div>
            `;
        }).join('');

        listEl.querySelectorAll('.wifi-item').forEach(el => {
            el.onclick = () => onSelectSSID(el.dataset.ssid);
        });
    },

updateDeviceDetails(device) {
        if (!device) return;
        const { info = {}, tcp = {}, plasma = {}, wifi = {} } = device;

        const st = parseStatusInfo(info.status);
        const stEl = document.getElementById('network-status');
        stEl.textContent = st.label;
        stEl.className = 'info-value ' + st.textCls;

        document.getElementById('lpc-fsm').textContent = info.lpc_fsm !== undefined ? `0x${Number(info.lpc_fsm).toString(16).toUpperCase()}` : 'N/A';
        const errVal = Number(info.lpc_err || 0);
        const errEl = document.getElementById('lpc-err');
        errEl.textContent = `0x${errVal.toString(16).toUpperCase().padStart(4, '0')}`;
        errEl.style.color = (errVal !== 0) ? '#f44336' : '#333';

        document.getElementById('ip-address').textContent = info.ip || 'N/A';
        document.getElementById('mac-address').textContent = info.mac || 'N/A';

        let batteryText = 'N/A';
        if (info.pin !== undefined && info.pin !== null) {
            let raw = parseFloat(info.pin);
            let voltage = (raw > 50.0) ? (raw / 100.0) : raw;
            batteryText = `${getBatteryPercentage(voltage)}% (${voltage.toFixed(2)} V)`;
        }
        document.getElementById('battery-level').textContent = batteryText;

        // Chỉ cập nhật vào input nếu người dùng KHÔNG đang trực tiếp gõ vào ô đó
        if (document.activeElement !== document.getElementById('ssid')) {
            document.getElementById('ssid').value = wifi.ssid || info.ssid || '';
        }
        if (document.activeElement !== document.getElementById('wifi-pass')) {
            document.getElementById('wifi-pass').value = wifi.pass || '';
        }
        if (document.activeElement !== document.getElementById('server_ip')) {
            document.getElementById('server_ip').value = tcp.server_ip || '';
        }
        if (document.activeElement !== document.getElementById('server_port')) {
            document.getElementById('server_port').value = tcp.server_port || '';
        }

        const plasmaFields = ['sp_t_operator', 'sp_t_hot', 'sp_fan', 't_max', 't_min', 
                              't_offset_1', 'r_cal_1', 't_offset_2', 'r_cal_2', 
                              't_offset_3', 'r_cal_3', 't_offset_4', 'r_cal_4', 
                              'pid_kp', 'pid_ti', 'pid_td'];
        plasmaFields.forEach(field => {
            const inputEl = document.getElementById(field);
            // Giữ nguyên dữ liệu nếu người dùng đang chỉnh sửa ô này
            if (inputEl && document.activeElement !== inputEl) {
                inputEl.value = plasma[field] ?? '';
            }
        });
    },

    displayHL7Detail(rawString, key) {
        const data = parseHL7String(rawString);
        if (!data) return;

        document.getElementById('record-empty-state').style.display = 'none';
        document.getElementById('record-detail-view').style.display = 'block';

        const { msh, pid, notes, obxList } = data.parsed;
        document.getElementById('hl7-msg-id').textContent = msh.msgId || key;
        document.getElementById('hl7-batch-id').textContent = pid.batchId || 'N/A';
        document.getElementById('hl7-timestamp').textContent = formatHL7Date(msh.timestamp);
        document.getElementById('hl7-sender').textContent = `${msh.sender || 'N/A'} (${msh.facility || 'N/A'})`;

        const zoneContainer = document.getElementById('hl7-zones');
        zoneContainer.innerHTML = notes.map(note => {
            const isPass = note.includes('PASSED');
            return `<div class="zone-box ${isPass ? 'zone-pass' : 'zone-fail'}"><strong>${isPass ? '✅' : '⚠️'}</strong> ${note}</div>`;
        }).join('') || '<div style="color:#999; font-size:13px;">Không có ghi chú nhiệt độ zone.</div>';

        const bagsTbody = document.getElementById('hl7-bags-body');
        bagsTbody.innerHTML = obxList.map(item => `
            <tr>
                <td style="text-align:center; font-weight:bold; color:#555;">${item.bagIndex || item.seq}</td>
                <td style="font-family:monospace; font-weight:bold; color:#1565c0;">${item.barcode || 'N/A'}</td>
                <td style="text-align:center;"><span style="color:#2e7d32; font-weight:bold;">${item.status}</span></td>
            </tr>
        `).join('') || '<tr><td colspan="3" style="text-align:center; color:#999;">Không có thông tin túi.</td></tr>';

        document.getElementById('hl7-raw-content').textContent = data.raw;
    }
};
