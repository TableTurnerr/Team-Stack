/**
 * Injects a 1x1 tracking pixel at the end of the HTML body.
 */
export function injectTrackingPixel(html: string, trackingId: string, appUrl: string): string {
  const pixelUrl = `${appUrl}/api/email-tracking/open/${trackingId}`;
  const pixel = `<img src="${pixelUrl}" width="1" height="1" alt="" style="display:block;width:1px;height:1px;border:0;" />`;

  // Insert before </body> if present, otherwise append
  if (html.includes('</body>')) {
    return html.replace('</body>', `${pixel}</body>`);
  }
  return html + pixel;
}

/**
 * Rewrites all <a href="..."> links in the HTML to route through the click tracker.
 * Excludes unsubscribe links and mailto: links.
 */
export function rewriteLinks(html: string, trackingId: string, appUrl: string): string {
  return html.replace(
    /<a\s([^>]*?)href="([^"]+)"([^>]*?)>/gi,
    (_match, before: string, url: string, after: string) => {
      // Skip mailto, tel, and unsubscribe links (already tracked separately)
      if (
        url.startsWith('mailto:') ||
        url.startsWith('tel:') ||
        url.includes('/email-tracking/unsubscribe/')
      ) {
        return _match;
      }
      const encodedUrl = btoa(url);
      const trackedUrl = `${appUrl}/api/email-tracking/click/${trackingId}?url=${encodedUrl}`;
      return `<a ${before}href="${trackedUrl}"${after}>`;
    }
  );
}

/**
 * Wraps HTML content in a responsive email layout with basic reset styles.
 */
export function wrapInEmailLayout(bodyContent: string, previewText?: string): string {
  const previewHtml = previewText
    ? `<div style="display:none;font-size:1px;color:#ffffff;line-height:1px;max-height:0px;max-width:0px;opacity:0;overflow:hidden;">${previewText}</div>`
    : '';

  return `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="X-UA-Compatible" content="IE=edge" />
  <title></title>
  <style>
    body, table, td, a { -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
    table, td { mso-table-lspace: 0pt; mso-table-rspace: 0pt; }
    img { -ms-interpolation-mode: bicubic; border: 0; height: auto; line-height: 100%; outline: none; text-decoration: none; }
    body { margin: 0; padding: 0; width: 100% !important; height: 100% !important; background-color: #f4f4f7; }
  </style>
</head>
<body style="margin:0;padding:0;background-color:#f4f4f7;">
  ${previewHtml}
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f7;">
    <tr>
      <td align="center" style="padding:24px 16px;">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background-color:#ffffff;border-radius:8px;overflow:hidden;">
          <tr>
            <td style="padding:32px 24px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:16px;line-height:1.6;color:#333333;">
              ${bodyContent}
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/**
 * Generates a plain-text preview snippet from HTML content.
 */
export function generatePreviewText(html: string, maxLength = 150): string {
  // Strip HTML tags
  const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength).trim() + '...';
}
