const fs = require('fs');
const path = require('path');
try {
    const reportPath = path.resolve('playwright-report/index.html');
    if (fs.existsSync(reportPath)) {
        let html = fs.readFileSync(reportPath, 'utf8');
        if (!html.includes('<!-- COPY_ERRORS_BTN -->')) {
            const btn = '<!-- COPY_ERRORS_BTN --><div style="position:fixed;bottom:20px;right:20px;z-index:99999;"><a href="./errors-summary.html" style="background:#58a6ff;color:#fff;padding:10px 15px;border-radius:8px;text-decoration:none;font-family:sans-serif;font-weight:bold;box-shadow:0 4px 6px rgba(0,0,0,0.3);font-size:14px;" target="_blank">📋 Copy All Errors</a></div>';
            html = html.replace('</body>', btn + '</body>');
            fs.writeFileSync(reportPath, html, 'utf8');
            fs.writeFileSync('result.txt', 'Successfully injected button.');
        } else {
            fs.writeFileSync('result.txt', 'Button already exists.');
        }
    } else {
        fs.writeFileSync('result.txt', 'playwright-report/index.html not found.');
    }
} catch (e) {
    fs.writeFileSync('result.txt', e.toString());
}
