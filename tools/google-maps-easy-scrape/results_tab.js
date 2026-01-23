document.addEventListener('DOMContentLoaded', function () {
    const table = document.getElementById('resultsTable');
    const tbody = table.querySelector('tbody');
    const stats = document.getElementById('stats');
    const exportBtn = document.getElementById('exportBtn');
    
    // Ignore lists
    let ignoreNamesSet = new Set();
    let ignoreIndustriesSet = new Set();

    function loadData() {
        chrome.storage.local.get(['gmes_results', 'gmes_ignore_names', 'gmes_ignore_industries'], function (data) {
            // Update ignore sets
            ignoreNamesSet.clear();
            (data.gmes_ignore_names || []).forEach(s => ignoreNamesSet.add(String(s).toLowerCase().trim()));
            
            ignoreIndustriesSet.clear();
            (data.gmes_ignore_industries || []).forEach(s => ignoreIndustriesSet.add(String(s).toLowerCase().trim()));

            const items = Array.isArray(data.gmes_results) ? data.gmes_results : [];
            renderTable(items);
        });
    }

    function itemIsIgnored(item) {
        if (!item) return false;
        if (item.title) {
            const title = String(item.title).toLowerCase();
            for (let ig of ignoreNamesSet) {
                if (!ig) continue;
                if (title === ig || title.includes(ig)) return true;
            }
        }
        if (item.industry) {
            const industry = String(item.industry).toLowerCase();
            for (let ig of ignoreIndustriesSet) {
                if (!ig) continue;
                if (industry === ig || industry.includes(ig)) return true;
            }
        }
        return false;
    }

    function renderTable(items) {
        tbody.innerHTML = '';
        let count = 0;
        const seen = new Set();

        items.forEach(item => {
            const key = item.href || (item.title + '|' + item.address);
            if (!key || seen.has(key)) return;
            if (itemIsIgnored(item)) return;
            
            seen.add(key);
            count++;
            
            const tr = document.createElement('tr');
            
            // Columns matching popup.js order
            const cols = ['title', 'note', 'closedStatus', 'rating', 'reviewCount', 'phone', 'industry', 'expensiveness', 'city', 'address', 'companyUrl', 'instaSearch', 'href'];
            
            cols.forEach(colKey => {
                const td = document.createElement('td');
                const val = item[colKey] || '';
                
                if (colKey === 'companyUrl') {
                   let finalUrl = val;
                   if (!val || val.startsWith('https://www.google.com/maps')) {
                       finalUrl = `https://www.google.com/search?q=${encodeURIComponent((item.title || '') + ' ' + (item.city || '') + ' Website')}`;
                   }
                   td.innerHTML = `<a href="${finalUrl}" target="_blank">${finalUrl}</a>`;
                } else if (colKey === 'href') {
                    if (val) td.innerHTML = `<a href="${val}" target="_blank">${val}</a>`;
                } else if (colKey === 'instaSearch') {
                    if (val) td.innerHTML = `<a href="${val}" target="_blank">${val}</a>`;
                } else if (colKey === 'reviewCount') {
                    td.textContent = val.replace(/[()]/g, '');
                } else {
                    td.textContent = val;
                }
                tr.appendChild(td);
            });
            tbody.appendChild(tr);
        });
        
        stats.textContent = `Total Leads: ${count}`;
    }

    // Initial load
    loadData();

    // Live updates
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'local' && (changes.gmes_results || changes.gmes_ignore_names || changes.gmes_ignore_industries)) {
            loadData();
        }
    });

    // Export functionality - HTML-based .xls for link preservation
    exportBtn.addEventListener('click', () => {
        try {
            const headers = Array.from(table.querySelectorAll('thead th'));
            const rows = Array.from(table.querySelectorAll('tbody tr'));

            let html = '<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>';
            html += '<table border="1" style="border-collapse:collapse;">';

            // Headers
            html += '<thead><tr>';
            headers.forEach(h => { html += '<th>' + (h.innerText || '') + '</th>'; });
            html += '</tr></thead>';

            // Body
            html += '<tbody>';
            rows.forEach(tr => {
                html += '<tr>';
                const cols = Array.from(tr.querySelectorAll('td'));
                cols.forEach(td => {
                    // Use innerText to get the plain text (URLs) and remove anchor tags for the sheet
                    const cellText = td.innerText || '';
                    html += '<td>' + cellText + '</td>';
                });
                html += '</tr>';
            });
            html += '</tbody></table></body></html>';

            const blob = new Blob([html], { type: 'application/vnd.ms-excel' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'google-maps-data.xls';
            document.body.appendChild(a);
            a.click();
            setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1000);
        } catch (e) {
            console.error('Failed to export XLS', e);
            alert('Export failed: ' + (e && e.message ? e.message : e));
        }
    });
});