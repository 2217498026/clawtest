/**
 * Gateway 连接诊断页面
 */
import { api, isTauriRuntime } from '../lib/tauri-api.js'
import { toast } from '../components/toast.js'
import { t } from '../lib/i18n.js'

const STEP_LABELS = {
  config: () => t('diagnose.stepConfig'),
  device_key: () => t('diagnose.stepDeviceKey'),
  allowed_origins: () => t('diagnose.stepOrigins'),
  tcp_port: () => t('diagnose.stepTcp'),
  http_health: () => t('diagnose.stepHttp'),
  err_log: () => t('diagnose.stepErrLog'),
}

export async function render() {
  const page = document.createElement('div')
  page.className = 'page'

  page.innerHTML = `
    <div class="page-header">
      <h1 class="page-title">${t('diagnose.title')}</h1>
      <p class="page-desc">${t('diagnose.desc')}</p>
    </div>
    <div style="margin-bottom:16px">
      <button class="btn btn-primary" id="btn-diagnose">${t('diagnose.runDiagnose')}</button>
    </div>
    <div id="diagnose-summary" style="margin-bottom:16px"></div>
    <div id="diagnose-steps" class="card-grid" style="margin-bottom:24px">
      <div class="empty-state" style="padding:32px;text-align:center;color:var(--text-tertiary)">${t('diagnose.noData')}</div>
    </div>
    <div id="diagnose-env" style="display:none">
      <h3 style="margin-bottom:12px">${t('diagnose.envInfo')}</h3>
      <div class="stat-card" id="env-content" style="font-size:var(--font-size-sm);overflow-x:auto"></div>
    </div>
  `

  const btnDiagnose = page.querySelector('#btn-diagnose')

  btnDiagnose.onclick = async () => {
    btnDiagnose.disabled = true
    btnDiagnose.textContent = t('diagnose.running')
    page.querySelector('#diagnose-summary').innerHTML = ''
    page.querySelector('#diagnose-steps').innerHTML = '<div class="stat-card loading-placeholder" style="height:40px;margin:8px 0"></div>'.repeat(6)

    try {
      const result = await api.diagnoseGatewayConnection()
      renderResult(page, result)
    } catch (e) {
      toast.error(`${t('diagnose.diagnoseFailed')}: ${e}`)
      page.querySelector('#diagnose-steps').innerHTML = `<div class="empty-state" style="padding:32px;color:var(--text-error)">${t('diagnose.diagnoseFailed')}: ${e}</div>`
    } finally {
      btnDiagnose.disabled = false
      btnDiagnose.textContent = t('diagnose.runDiagnose')
    }
  }

  return page
}

function renderResult(page, result) {
  // Summary
  const summaryEl = page.querySelector('#diagnose-summary')
  if (result.overallOk) {
    summaryEl.innerHTML = `<div class="stat-card" style="background:var(--success-bg,#f0fdf4);border:1px solid var(--success-border,#86efac);padding:12px 16px">${t('diagnose.allPassed')}</div>`
  } else {
    summaryEl.innerHTML = `<div class="stat-card" style="background:var(--error-bg,#fef2f2);border:1px solid var(--error-border,#fca5a5);padding:12px 16px">⚠️ ${result.summary}</div>`
  }

  // Steps
  const stepsEl = page.querySelector('#diagnose-steps')
  stepsEl.innerHTML = result.steps.map(step => {
    const label = STEP_LABELS[step.name]?.() || step.name
    const icon = step.ok ? '✅' : '❌'
    const status = step.ok ? t('diagnose.passed') : t('diagnose.failed')
    const bgColor = step.ok ? 'var(--bg-secondary,#f9fafb)' : 'var(--error-bg,#fef2f2)'
    return `
      <div class="stat-card" style="background:${bgColor};padding:12px 16px;margin-bottom:8px">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:12px">
          <div style="display:flex;align-items:center;gap:8px;min-width:0">
            <span>${icon}</span>
            <strong style="white-space:nowrap">${label}</strong>
          </div>
          <span style="font-size:var(--font-size-xs);color:var(--text-tertiary);white-space:nowrap">${step.durationMs}ms</span>
        </div>
        <div style="margin-top:6px;font-size:var(--font-size-sm);color:var(--text-secondary);word-break:break-all">${escHtml(step.message)}</div>
      </div>`
  }).join('')

  // Env info
  const envEl = page.querySelector('#diagnose-env')
  envEl.style.display = ''
  const env = result.env
  const rows = [
    [t('diagnose.openclawDir'), env.openclawDir],
    [t('diagnose.port'), env.port],
    [t('diagnose.authMode'), env.authMode],
    [t('diagnose.deviceKey'), env.deviceKeyExists ? '✅' : '❌'],
  ]
  let html = '<table style="width:100%;border-collapse:collapse">'
  for (const [k, v] of rows) {
    html += `<tr><td style="padding:4px 12px 4px 0;font-weight:600;white-space:nowrap;color:var(--text-secondary)">${k}</td><td style="padding:4px 0;word-break:break-all">${escHtml(String(v))}</td></tr>`
  }
  html += '</table>'

  if (env.errLogExcerpt) {
    html += `<details style="margin-top:12px"><summary style="cursor:pointer;font-weight:600;color:var(--text-secondary)">${t('diagnose.errLogExcerpt')}</summary><pre style="margin-top:8px;font-size:12px;max-height:200px;overflow:auto;background:var(--bg-tertiary,#1e1e1e);color:var(--text-primary);padding:8px;border-radius:6px">${escHtml(env.errLogExcerpt)}</pre></details>`
  }

  page.querySelector('#env-content').innerHTML = html
}

function escHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
