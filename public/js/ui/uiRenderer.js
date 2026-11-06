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

    // js/ui/uiRenderer.js

    // js/ui/uiRenderer.js

    renderWifiList(wifiList, onSelectSSID) {
        const listEl = document.getElementById('scanned-wifi-list');
        if (!listEl) return;

        // Chuẩn hóa Object / Array thành mảng chuẩn
        let list = [];
        if (Array.isArray(wifiList)) {
            list = wifiList.filter(Boolean);
        } else if (typeof wifiList === 'object' && wifiList !== null) {
            list = Object.values(wifiList).filter(Boolean);
        }

        // Thông báo khi không có Wi-Fi (Chữ trắng mờ dễ đọc)
        if (list.length === 0) {
            listEl.innerHTML = '<div style="color:#cbd5e1; font-size:13px; text-align:center; padding:15px;">Không tìm thấy mạng Wi-Fi nào.</div>';
            return;
        }

        console.log(`Đã nhận ${list.length} mạng Wi-Fi:`, list);

        // Render danh sách với CHỮ TRẮNG NỔI BẬT TRÊN NỀN ĐEN
        listEl.innerHTML = list.map(item => {
            let ssid = '';
            let rssi = -75;

            if (typeof item === 'string') {
                ssid = item;
            } else if (typeof item === 'object' && item !== null) {
                ssid = item.ssid || item.SSID || item.name || '';
                rssi = item.rssi !== undefined ? Number(item.rssi) : (item.RSSI !== undefined ? Number(item.RSSI) : -75);
            }

            if (!ssid || ssid.trim() === '') return '';

            let dotColor = rssi >= -65 ? '#22c55e' : (rssi >= -75 ? '#eab308' : '#ef4444');

            return `
                <div class="wifi-item" data-ssid="${ssid}" style="cursor:pointer; display:flex; justify-content:space-between; align-items:center; padding:11px 14px; border-bottom:1px solid rgba(255,255,255,0.12); transition:background 0.2s;">
                    <!-- TÊN WI-FI MÀU TRẮNG TINH -->
                    <div class="wifi-ssid" style="font-weight:600; font-size:14px; color:#ffffff; letter-spacing:0.3px;">${ssid}</div>
                    
                    <!-- CHỈ SỐ DBM VÀ CHẤM SÓNG -->
                    <div style="display:flex; align-items:center; gap:8px;">
                        <span style="font-size:12px; color:#94a3b8; font-family:monospace;">${rssi} dBm</span>
                        <div style="width:10px; height:10px; border-radius:50%; background-color:${dotColor}; box-shadow:0 0 6px ${dotColor};" title="Tín hiệu: ${rssi} dBm"></div>
                    </div>
                </div>
            `;
        }).filter(Boolean).join('');

        // Gắn sự kiện click và hover trên nền tối
        listEl.querySelectorAll('.wifi-item').forEach(el => {
            el.onclick = () => {
                const selectedSsid = el.dataset.ssid;
                if (onSelectSSID) onSelectSSID(selectedSsid);
            };
            // Khi rê chuột vào: sáng nhẹ lên
            el.onmouseenter = () => el.style.backgroundColor = 'rgba(255, 255, 255, 0.1)';
            el.onmouseleave = () => el.style.backgroundColor = 'transparent';
        });
    },

    updateDeviceDetails(device) {
        if (!device) return;
        const { info = {}, tcp = {}, plasma = {} } = device;

        const st = parseStatusInfo(info.status);
        const stEl = document.getElementById('network-status');
        if (stEl) {
            stEl.textContent = st.label;
            stEl.className = 'info-value ' + st.textCls;
        }

        const fsmEl = document.getElementById('lpc-fsm');
        if (fsmEl) fsmEl.textContent = info.lpc_fsm !== undefined ? `0x${Number(info.lpc_fsm).toString(16).toUpperCase()}` : 'N/A';

        const errVal = Number(info.lpc_err || 0);
        const errEl = document.getElementById('lpc-err');
        if (errEl) {
            errEl.textContent = `0x${errVal.toString(16).toUpperCase().padStart(4, '0')}`;
            errEl.style.color = (errVal !== 0) ? '#f44336' : '#333';
        }

        const ipEl = document.getElementById('ip-address');
        if (ipEl) ipEl.textContent = info.ip || 'N/A';

        const macEl = document.getElementById('mac-address');
        if (macEl) macEl.textContent = info.mac || 'N/A';

        if (document.activeElement !== document.getElementById('ssid')) {
            const el = document.getElementById('ssid');
            if (el) el.value = info.ssid || '';
        }
        if (document.activeElement !== document.getElementById('server_ip')) {
            const el = document.getElementById('server_ip');
            if (el) el.value = tcp.server_ip || '';
        }
        if (document.activeElement !== document.getElementById('server_port')) {
            const el = document.getElementById('server_port');
            if (el) el.value = tcp.server_port || '';
        }

        const plasmaFields = ['sp_t_operator', 'sp_t_hot', 'sp_fan', 't_max', 't_min', 
                              't_offset_1', 'r_cal_1', 't_offset_2', 'r_cal_2', 
                              't_offset_3', 'r_cal_3', 't_offset_4', 'r_cal_4', 
                              'pid_kp', 'pid_ti', 'pid_td'];
        plasmaFields.forEach(field => {
            const inputEl = document.getElementById(field);
            if (inputEl && document.activeElement !== inputEl) {
                inputEl.value = plasma[field] ?? '';
            }
        });
    },

    displayBatchData(batchData, rawContent = '', sourceLabel = 'Bản ghi mới nhất') {
        if (!batchData) return;

        const setTxt = (id, val) => {
            const el = document.getElementById(id);
            if (el) el.textContent = val;
        };

        const batchId = batchData.pid?.batchId || batchData.batchId || 'N/A';
        const msgId = batchData.msh?.msgId || batchData.msgId || 'N/A';
        const sender = batchData.msh?.sender || batchData.deviceId || 'THAWER_16';
        const timeRaw = batchData.msh?.timestamp || batchData.hl7Time || '';
        const timeFormatted = timeRaw.length === 14 ? formatHL7Date(timeRaw) : (timeRaw || 'N/A');

        setTxt('hl7-batch-id', batchId);
        setTxt('hl7-msg-id', msgId);
        setTxt('hl7-sender', sender);
        setTxt('hl7-timestamp', timeFormatted);
        setTxt('hl7-timestamp-badge', `Bản ghi: ${timeFormatted}`);

        const tagEl = document.getElementById('hl7-source-tag');
        if (tagEl) tagEl.textContent = sourceLabel;

        const tempA = batchData.zoneA?.temp || batchData.tempZoneA || '--.- °C';
        const tempB = batchData.zoneB?.temp || batchData.tempZoneB || '--.- °C';
        setTxt('zone-a-temp', tempA);
        setTxt('zone-a-status', 'Đạt');
        setTxt('zone-b-temp', tempB);
        setTxt('zone-b-status', 'Đạt');

        const slots = batchData.slots || Array.from({ length: 16 }, (_, i) => ({ slot: i + 1, barcode: '' }));

        const renderSlotRows = (slotList) => {
            return slotList.map(item => {
                const hasBarcode = Boolean(item.barcode && String(item.barcode).trim() !== '');
                const rowBg = item.slot % 2 === 0 ? 'rgba(255,255,255,0.02)' : 'transparent';
                return `
                    <tr style="background:${rowBg}; border-bottom:1px solid rgba(255,255,255,0.04);">
                        <td style="text-align:center; font-weight:700; color:#94a3b8; padding:3px 6px; font-size:11.5px;">#${String(item.slot).padStart(2, '0')}</td>
                        <td style="padding:3px 8px;">
                            ${hasBarcode 
                                ? `<span style="font-family:monospace; font-weight:700; color:#38bdf8; font-size:12px;">${item.barcode}</span>`
                                : `<span style="color:#64748b; font-style:italic; font-size:11.5px;">(Trống)</span>`
                            }
                        </td>
                        <td style="text-align:center; padding:3px 6px;">
                            <span style="font-weight:600; font-size:11px; color:${hasBarcode ? '#10b981' : '#475569'};">
                                ${hasBarcode ? 'Đạt' : '---'}
                            </span>
                        </td>
                    </tr>
                `;
            }).join('');
        };

        const zoneASlots = slots.slice(0, 8);
        const zoneBSlots = slots.slice(8, 16);

        const tbodyA = document.getElementById('hl7-zone-a-slots-body');
        if (tbodyA) tbodyA.innerHTML = renderSlotRows(zoneASlots);

        const tbodyB = document.getElementById('hl7-zone-b-slots-body');
        if (tbodyB) tbodyB.innerHTML = renderSlotRows(zoneBSlots);

        const rawEl = document.getElementById('hl7-raw-content');
        if (rawEl) rawEl.textContent = rawContent || JSON.stringify(batchData, null, 2);
    },

    displayHL7Detail(rawString, key, sourceLabel = 'Bản ghi mới nhất') {
        if (!rawString) return;
        const data = parseHL7String(rawString);
        if (!data) return;
        this.displayBatchData(data.parsed, data.raw, sourceLabel);
    },

    renderHistoryList(batches, selectedBatchId, onSelectBatch) {
        const container = document.getElementById('hl7-history-list');
        if (!container) return;

        if (!Array.isArray(batches) || batches.length === 0) {
            container.innerHTML = '<div class="history-empty">Chưa có mẻ rã đông nào trong sổ nhật ký.</div>';
            return;
        }

        container.innerHTML = batches.map(b => {
            const isSelected = b.batchId === selectedBatchId || b.msgId === selectedBatchId;
            const validBags = (b.slots || []).filter(s => s && s.barcode && String(s.barcode).trim() !== '').length;
            const bagText = b.bagCount !== undefined ? `${b.bagCount}/16 túi` : `${validBags}/16 túi`;

            return `
                <div class="history-item ${isSelected ? 'active' : ''}" data-batch-id="${b.batchId || b.msgId}">
                    <div class="history-item-top">
                        <span class="history-batch-id">🏷️ ${b.batchId || 'Không tên'}</span>
                        <span class="history-time">${b.hl7Time || ''}</span>
                    </div>
                    <div class="history-item-bottom">
                        <span class="history-temps">❄️ A: ${b.tempZoneA || '--'} | B: ${b.tempZoneB || '--'}</span>
                        <span class="history-bag-count">${bagText}</span>
                    </div>
                </div>
            `;
        }).join('');

        container.querySelectorAll('.history-item').forEach((itemEl, idx) => {
            itemEl.onclick = () => {
                const batch = batches[idx];
                if (onSelectBatch) onSelectBatch(batch);
            };
        });
    }
};
