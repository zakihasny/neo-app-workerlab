const $ = id => document.getElementById(id);
let token = '', session = 0, currentDetail = null, refreshing = false;
const date = value => value ? new Date(value).toLocaleString('id-ID') : '—';
const node = (tag, text, className) => { const element = document.createElement(tag); if (text !== undefined) element.textContent = String(text); if (className) element.className = className; return element; };
function notice(text) { $('notice').textContent = text; $('notice').hidden = !text; }
function statusPill(status) { return node('span', status, `pill ${status === 'failed' ? 'bad' : ['queued','retrying','processing','stale'].includes(status) ? 'warn' : ''}`); }

async function api(path, options = {}) {
  const requestSession = session;
  const response = await fetch(path, { ...options, headers: { Authorization: `Bearer ${token}`, ...options.headers }, signal: AbortSignal.timeout(10000) });
  const body = await response.json();
  if (requestSession !== session) throw new Error('SESSION_CHANGED');
  if (!response.ok) throw new Error(body.error || 'REQUEST_FAILED');
  return body;
}

function logout() {
  token = ''; session++; currentDetail = null;
  $('workspace').hidden = true; $('login-panel').hidden = false; $('logout').hidden = true;
  $('connection').textContent = 'Belum masuk'; $('api-token').value = '';
  $('job-rows').replaceChildren(); $('worker-list').replaceChildren(); $('detail-body').replaceChildren();
  for (const id of ['metric-backlog','metric-completed','metric-failed','metric-duration','outbox-count','processing-count','worker-count']) $(id).textContent = '—';
  $('db-status').textContent = 'Tidak diketahui'; $('queue-status').textContent = 'Tidak diketahui'; $('updated').textContent = 'Belum ada pembaruan';
  $('job-detail').close(); notice(''); $('api-token').focus();
}

function showTab(name, focus = false) {
  for (const tab of ['overview','jobs','scenarios']) {
    const active = tab === name;
    $(`tab-${tab}`).setAttribute('aria-selected', String(active));
    $(`tab-${tab}`).tabIndex = active ? 0 : -1;
    $(tab).hidden = !active;
  }
  if (focus) $(`tab-${name}`).focus();
}

function updateFields() {
  const type = $('job-type').value;
  $('text-field').hidden = !['echo','sha256'].includes(type);
  $('delay-field').hidden = type !== 'delay';
  $('failures-field').hidden = type !== 'fail-first';
}
function newKey() { $('idempotency-key').value = crypto.randomUUID(); }

function renderSummary(summary, workers) {
  $('metric-backlog').textContent = summary.counts.queued + summary.counts.retrying;
  $('metric-completed').textContent = summary.counts.completed;
  $('metric-failed').textContent = summary.counts.failed;
  $('metric-duration').textContent = summary.averageDurationMs === null ? '—' : `${(summary.averageDurationMs / 1000).toFixed(1)}s`;
  $('outbox-count').textContent = summary.pendingOutbox; $('processing-count').textContent = summary.counts.processing;
  $('db-status').textContent = summary.preview ? 'Fixture UI · tanpa koneksi' : summary.dependencies.database === 'connected' ? 'Terhubung' : 'Tidak terhubung';
  $('queue-status').textContent = summary.preview ? 'Fixture UI · tanpa koneksi' : summary.dependencies.queue === 'connected' ? 'Terhubung' : 'Tidak terhubung';
  $('worker-count').textContent = `${workers.filter(worker => worker.fresh).length} aktif`;
  $('worker-list').replaceChildren();
  if (!workers.length) $('worker-list').append(node('p','Belum ada Worker terdaftar. Jalankan service Worker, lalu tunggu heartbeat.','empty'));
  for (const worker of workers) {
    const row = node('div', undefined, 'worker-row'), description = node('div');
    description.append(node('code', worker.id), node('small', `Heartbeat ${date(worker.heartbeat_at)} · concurrency ${worker.concurrency}`));
    row.append(description, statusPill(worker.fresh ? 'online' : worker.status === 'stopped' ? 'stopped' : 'stale'));
    $('worker-list').append(row);
  }
  $('connection').textContent = summary.preview ? 'UI PREVIEW · bukan runtime' : 'Backend terhubung';
  $('updated').textContent = `Diperbarui ${new Date().toLocaleTimeString('id-ID')}`;
}

function renderJobs(jobs) {
  $('job-rows').replaceChildren(); $('jobs-empty').hidden = jobs.length > 0;
  for (const job of jobs) {
    const row = node('tr'), idCell = node('td');
    idCell.append(node('code',job.id.slice(0,8)),node('small',date(job.created_at)));
    const state = node('td'); state.append(statusPill(job.status));
    const action = node('td'), button = node('button','Detail','quiet'); button.addEventListener('click', () => detail(job.id)); action.append(button);
    row.append(idCell,node('td',job.type),state,node('td',`${job.attempt_count}/3`),action); $('job-rows').append(row);
  }
}

async function refresh() {
  if (!token || refreshing) return;
  refreshing = true; const refreshSession = session; $('refresh').disabled = true;
  try {
    const [summary, workers, jobs] = await Promise.all([api('/api/summary'),api('/api/workers'),api(`/api/jobs?status=${encodeURIComponent($('status-filter').value)}`)]);
    if (refreshSession !== session) return;
    renderSummary(summary,workers.items); renderJobs(jobs.items); notice('');
  } catch(error) {
    if (refreshSession !== session) return;
    $('connection').textContent = 'Monitoring tidak tersedia';
    $('db-status').textContent = 'Tidak diketahui'; $('queue-status').textContent = 'Tidak diketahui';
    $('worker-count').textContent = 'Tidak diketahui';
    notice(`Pembaruan gagal: ${error.message}. Data yang terlihat mungkin sudah tidak mutakhir.`);
  } finally { refreshing = false; $('refresh').disabled = false; }
}

async function detail(id) {
  const detailSession = session;
  try {
    const job = await api(`/api/jobs/${id}`);
    if (detailSession !== session) return;
    currentDetail = job; const body = $('detail-body'); body.replaceChildren();
    body.append(statusPill(job.status),node('pre',`Job ID: ${job.id}\nWorker: ${job.worker_id || '—'}\nAttempts: ${job.attempt_count}/3\nEffect count: ${job.effectCount}\nCreated: ${date(job.created_at)}\nFinished: ${date(job.finished_at)}\nRetry of: ${job.retry_of || '—'}`));
    for (const [title,value] of [['Payload',job.payload],['Result / error',job.result || { error: job.error_code }],['Dead letter',job.deadLetter || { status: 'Belum ada dead letter' }]]) body.append(node('p',title,'detail-label'),node('pre',JSON.stringify(value,null,2)));
    body.append(node('p','Attempts','detail-label'),node('pre',JSON.stringify(job.attempts,null,2)),node('p','Event timeline','detail-label'));
    const list = node('ol',undefined,'timeline');
    for (const event of job.events) list.append(node('li',`${date(event.created_at)} — ${event.kind}${event.code ? ` (${event.code})` : ''}`));
    body.append(list); $('retry-job').hidden = job.status !== 'failed';
    if (!$('job-detail').open) $('job-detail').showModal();
  } catch(error) { if (detailSession === session) notice(`Detail tidak tersedia: ${error.message}`); }
}

$('login-form').addEventListener('submit', async event => {
  event.preventDefault(); token = $('api-token').value.trim(); session++; const loginSession = session;
  try { await api('/api/summary'); if (loginSession !== session) return; $('api-token').value = ''; $('workspace').hidden = false; $('login-panel').hidden = true; $('logout').hidden = false; await refresh(); }
  catch(error) { if (loginSession === session) { token = ''; notice(`Tidak dapat masuk: ${error.message}`); } }
});
$('logout').addEventListener('click',logout);
$('refresh').addEventListener('click',refresh);
$('status-filter').addEventListener('change',refresh);
$('job-type').addEventListener('change',updateFields);
$('new-key').addEventListener('click',newKey);
for (const name of ['overview','jobs','scenarios']) {
  $(`tab-${name}`).addEventListener('click',() => showTab(name));
  $(`tab-${name}`).addEventListener('keydown',event => {
    const tabs = ['overview','jobs','scenarios'], current = tabs.indexOf(name);
    const target = event.key === 'ArrowRight' ? (current+1)%3 : event.key === 'ArrowLeft' ? (current+2)%3 : event.key === 'Home' ? 0 : event.key === 'End' ? 2 : null;
    if (target !== null) { event.preventDefault(); showTab(tabs[target],true); }
  });
}
$('job-form').addEventListener('submit',async event => {
  event.preventDefault(); $('submit-job').disabled = true; const submitSession = session;
  const type = $('job-type').value;
  const payload = ['echo','sha256'].includes(type) ? { text: $('job-text').value } : type === 'delay' ? { seconds: Number($('job-delay').value) } : type === 'fail-first' ? { failures: Number($('job-failures').value) } : {};
  try {
    const response = await api('/api/jobs',{ method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':$('idempotency-key').value},body:JSON.stringify({ type,payload }) });
    await refresh(); if (submitSession === session) notice(`${response.duplicate ? 'Request duplikat, job tetap sama' : 'Job diterima'}: ${response.job.id}. Gunakan Key baru untuk job berikutnya.`);
  } catch(error) { if (submitSession === session) notice(`Job tidak terkirim: ${error.message}`); }
  finally { $('submit-job').disabled = false; }
});
$('close-detail').addEventListener('click',() => $('job-detail').close());
$('retry-job').addEventListener('click',async () => {
  if (!currentDetail) return;
  $('retry-job').disabled = true; const retrySession = session;
  try { const response = await api(`/api/jobs/${currentDetail.id}/retry`,{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':crypto.randomUUID()},body:'{}'}); if (retrySession !== session) return; $('job-detail').close(); await refresh(); if (retrySession === session) notice(`Retry dibuat sebagai job baru: ${response.job.id}`); }
  catch(error) { if (retrySession === session) notice(`Retry gagal: ${error.message}`); }
  finally { $('retry-job').disabled = false; }
});
for (const button of document.querySelectorAll('.scenario-job')) button.addEventListener('click',() => { $('job-type').value = button.dataset.job; $('job-failures').value = '2'; updateFields(); newKey(); showTab('jobs',true); });
newKey(); updateFields();
setInterval(() => { if (!document.hidden) refresh(); },5000);
