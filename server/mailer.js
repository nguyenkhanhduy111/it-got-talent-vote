// Gửi email: ưu tiên cầu nối PHP trên máy chủ DirectAdmin (MAIL_BRIDGE_URL), nếu không có thì dùng Brevo (HTTPS API).
// Render gói miễn phí chặn cổng SMTP nên không dùng SMTP trực tiếp.
import { HttpError } from './util.js';

export function makeMailer(config) {
  return {
    configured: !!((config.mailBridgeUrl && config.mailBridgeToken) || (config.brevoApiKey && config.mailFrom)),
    async send({ to, subject, text, html }) {
      if (config.mailBridgeUrl && config.mailBridgeToken) {
        const ctl = new AbortController();
        const timer = setTimeout(() => ctl.abort(), 15000);
        try {
          const res = await fetch(config.mailBridgeUrl, {
            method: 'POST', signal: ctl.signal,
            headers: { 'content-type': 'application/json', 'x-token': config.mailBridgeToken },
            body: JSON.stringify({ to, subject, text }),
          });
          if (!res.ok) { console.error('Cầu nối email lỗi', res.status, (await res.text()).slice(0, 300)); throw new HttpError(502, 'MAIL_FAIL', 'Không gửi được email. Hãy kiểm tra lại Gmail hoặc thử lại sau ít phút.'); }
          return;
        } catch (e) {
          if (e instanceof HttpError) throw e;
          console.error('Gửi email (cầu nối) lỗi', e.message);
          throw new HttpError(502, 'MAIL_FAIL', 'Không gửi được email. Hãy thử lại sau ít phút.');
        } finally { clearTimeout(timer); }
      }
      if (!config.brevoApiKey || !config.mailFrom) {
        if (config.mailDebug) { console.log(`[MAIL_DEBUG] tới ${to}: ${subject}\n${text}`); return; }
        throw new HttpError(503, 'MAIL_NOT_CONFIGURED', 'Hệ thống chưa cấu hình gửi email. Vui lòng báo ban tổ chức.');
      }
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 12000);
      try {
        const res = await fetch('https://api.brevo.com/v3/smtp/email', {
          method: 'POST', signal: ctl.signal,
          headers: { 'api-key': config.brevoApiKey, 'content-type': 'application/json', accept: 'application/json' },
          body: JSON.stringify({ sender: { name: config.mailFromName, email: config.mailFrom }, to: [{ email: to }], subject, textContent: text, htmlContent: html }),
        });
        if (!res.ok) { console.error('Brevo lỗi', res.status, (await res.text()).slice(0, 300)); throw new HttpError(502, 'MAIL_FAIL', 'Không gửi được email. Hãy kiểm tra lại Gmail hoặc thử lại sau ít phút.'); }
      } catch (e) {
        if (e instanceof HttpError) throw e;
        console.error('Gửi email lỗi', e.message);
        throw new HttpError(502, 'MAIL_FAIL', 'Không gửi được email. Hãy thử lại sau ít phút.');
      } finally { clearTimeout(timer); }
    },
  };
}
