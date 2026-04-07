interface Env {
  GITHUB_OWNER: string;
  GITHUB_REPO: string;
  GITHUB_WORKFLOW_FILE: string;
  GITHUB_REF: string;
  GITHUB_TOKEN: string;
  TRIGGER_SECRET: string;
  NOTIFY_SECRET: string;
  REPORT_EMAIL_TO: string;
  EMAIL_FROM?: string;
  RESEND_API_KEY: string;
}

type DispatchInputs = {
  reason?: string;
  suite?: string;
  source?: 'scheduled' | 'manual';
};

const json = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body, null, 2), {
    ...init,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      ...(init.headers ?? {}),
    },
  });

const htmlPage = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Zenos E2E Trigger</title>
    <style>
      body { font-family: ui-sans-serif, system-ui, sans-serif; background: #f7f7f7; color: #111; margin: 0; }
      .wrap { max-width: 720px; margin: 40px auto; background: #fff; border: 1px solid #ddd; border-radius: 12px; padding: 24px; }
      h1 { margin: 0 0 8px; }
      p { color: #444; }
      label { display: block; margin: 12px 0 6px; font-weight: 600; }
      input, select { width: 100%; box-sizing: border-box; padding: 10px; border-radius: 8px; border: 1px solid #ccc; }
      button { margin-top: 16px; border: 0; background: #0b7a52; color: #fff; padding: 10px 16px; border-radius: 8px; font-weight: 700; cursor: pointer; }
      pre { margin-top: 14px; background: #111; color: #cde6dc; border-radius: 8px; padding: 12px; min-height: 48px; overflow: auto; }
      .hint { font-size: 12px; color: #666; }
    </style>
  </head>
  <body>
    <div class="wrap">
      <h1>Zenos E2E Smoke Trigger</h1>
      <p>Run smoke E2E now. Weekly scheduled run happens every Thursday 12:00 AM IST via Worker cron.</p>

      <label>Trigger Secret</label>
      <input id="secret" type="password" placeholder="Enter TRIGGER_SECRET" />

      <label>Reason</label>
      <input id="reason" value="manual dashboard trigger" />

      <label>Suite</label>
      <select id="suite">
        <option value="smoke">smoke</option>
      </select>

      <button id="run">Run Smoke Tests</button>
      <div class="hint">Tip: protect this route behind Cloudflare Access for team-only button access.</div>
      <pre id="out"></pre>
    </div>

    <script>
      const out = document.getElementById('out');
      document.getElementById('run').addEventListener('click', async () => {
        out.textContent = 'Triggering...';
        const secret = document.getElementById('secret').value;
        const reason = document.getElementById('reason').value;
        const suite = document.getElementById('suite').value;
        try {
          const res = await fetch('/trigger', {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              'x-trigger-secret': secret,
            },
            body: JSON.stringify({ reason, suite, source: 'manual' }),
          });
          const data = await res.json();
          out.textContent = JSON.stringify(data, null, 2);
        } catch (error) {
          out.textContent = String(error);
        }
      });
    </script>
  </body>
</html>`;

function hasValidSecret(req: Request, expected: string): boolean {
  const bearer = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim();
  const header = req.headers.get('x-trigger-secret')?.trim();
  return !!expected && (bearer === expected || header === expected);
}

async function dispatchWorkflow(env: Env, inputs: DispatchInputs): Promise<void> {
  const response = await fetch(
    `https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/actions/workflows/${env.GITHUB_WORKFLOW_FILE}/dispatches`,
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${env.GITHUB_TOKEN}`,
        accept: 'application/vnd.github+json',
        'content-type': 'application/json',
        'user-agent': 'zenos-e2e-worker',
      },
      body: JSON.stringify({
        ref: env.GITHUB_REF,
        inputs: {
          reason: inputs.reason ?? 'scheduled cloudflare cron',
          suite: inputs.suite ?? 'smoke',
          source: inputs.source ?? 'scheduled',
        },
      }),
    },
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Workflow dispatch failed (${response.status}): ${text}`);
  }
}

async function sendEmail(env: Env, subject: string, html: string, text: string): Promise<void> {
  const from = env.EMAIL_FROM ?? 'Zenos E2E <noreply@updates.zenos.work>';
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${env.RESEND_API_KEY}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: [env.REPORT_EMAIL_TO],
      subject,
      html,
      text,
    }),
  });

  if (!response.ok) {
    const textBody = await response.text();
    throw new Error(`Email send failed (${response.status}): ${textBody}`);
  }
}

export default {
  async scheduled(_controller: unknown, env: Env): Promise<void> {
    await dispatchWorkflow(env, {
      reason: 'weekly thursday midnight ist smoke run',
      suite: 'smoke',
      source: 'scheduled',
    });
  },

  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);

    if (req.method === 'GET' && url.pathname === '/') {
      return new Response(htmlPage, {
        headers: { 'content-type': 'text/html; charset=utf-8' },
      });
    }

    if (req.method === 'GET' && url.pathname === '/health') {
      return json({ ok: true, service: 'zenos-e2e-trigger-worker' });
    }

    if (req.method === 'POST' && url.pathname === '/trigger') {
      if (!hasValidSecret(req, env.TRIGGER_SECRET)) {
        return json({ ok: false, error: 'unauthorized' }, { status: 401 });
      }

      const body = (await req.json().catch(() => ({}))) as DispatchInputs;
      await dispatchWorkflow(env, {
        reason: body.reason ?? 'manual worker trigger',
        suite: body.suite ?? 'smoke',
        source: 'manual',
      });

      return json({
        ok: true,
        message: 'Smoke workflow dispatched',
        repo: `${env.GITHUB_OWNER}/${env.GITHUB_REPO}`,
        workflow: env.GITHUB_WORKFLOW_FILE,
        ref: env.GITHUB_REF,
      });
    }

    if (req.method === 'POST' && url.pathname === '/notify') {
      if (!hasValidSecret(req, env.NOTIFY_SECRET)) {
        return json({ ok: false, error: 'unauthorized' }, { status: 401 });
      }

      const payload = await req.json().catch(() => null) as {
        subject?: string;
        html?: string;
        text?: string;
      } | null;

      if (!payload?.subject || !payload?.html || !payload?.text) {
        return json({ ok: false, error: 'subject, html, text are required' }, { status: 400 });
      }

      await sendEmail(env, payload.subject, payload.html, payload.text);
      return json({ ok: true });
    }

    return json({ ok: false, error: 'not_found' }, { status: 404 });
  },
};
