'use strict';
/* ============ Utilitas ============ */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const db = {
  get: (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set: (k, v) => localStorage.setItem(k, JSON.stringify(v))
};
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const rp = n => 'Rp ' + Number(n || 0).toLocaleString('id-ID');
const num = n => Number(n || 0).toLocaleString('id-ID');
const tgl = d => d ? new Date(d).toLocaleDateString('id-ID', { day: '2-digit', month: 'long', year: 'numeric' }) : '-';

async function sha(data) {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  if (window.crypto && crypto.subtle) {
    const b = await crypto.subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
  }
  let h = 5381; for (const x of bytes) h = ((h << 5) + h + x) >>> 0; // cadangan sederhana
  return h.toString(16).padStart(8, '0').repeat(8);
}
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.remove('hidden');
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.add('hidden'), 2600);
}

/* ============ Konfigurasi kategori klaim ============ */
const JENIS_BUKTI = ['Sertifikat', 'Laporan audit energi', 'Bukti transaksi pembelian', 'Data karbon', 'Dokumen lain'];
const KATEGORI = {
  energi: { label: 'Energi terbarukan', satuan: 'kWh', wajib: ['Laporan audit energi', 'Sertifikat'],
    akun: 'Aset Tetap – Instalasi Energi Terbarukan', ket: 'Biaya instalasi/pembelian energi terbarukan yang memenuhi kriteria aset' },
  emisi: { label: 'Pengurangan emisi karbon', satuan: 'ton CO₂e', wajib: ['Data karbon', 'Sertifikat'],
    akun: 'Aset Tak Berwujud – Kredit Karbon', ket: 'Pembelian kredit karbon / offset' },
  bahan: { label: 'Bahan baku ramah lingkungan', satuan: 'kg', wajib: ['Bukti transaksi pembelian', 'Sertifikat'],
    akun: 'Persediaan Bahan Baku', ket: 'Pembelian bahan baku ramah lingkungan' },
  limbah: { label: 'Pengelolaan limbah', satuan: 'kg', wajib: ['Sertifikat', 'Bukti transaksi pembelian'],
    akun: 'Beban Pengelolaan Lingkungan', ket: 'Biaya pengelolaan limbah' },
  sertifikasi: { label: 'Sertifikasi lingkungan', satuan: 'sertifikat', wajib: ['Sertifikat'],
    akun: 'Beban Sertifikasi Lingkungan', ket: 'Biaya sertifikasi lingkungan' }
};
const KATA_UMUM = /100\s?%|zero|nol emisi|alami|\beco\b|natural|bebas polusi|sepenuhnya|carbon neutral|netral karbon/i;

/* ============ State ============ */
let session = db.get('gl_session', null);   // email
let authMode = 'login';
const getClaims = () => db.get('gl_claims_' + session, []);
const setClaims = c => db.set('gl_claims_' + session, c);

/* ============ Navigasi ============ */
function show(id) {
  $$('.view').forEach(v => v.classList.toggle('hidden', v.id !== id));
  renderNav(); window.scrollTo(0, 0);
}
function renderNav() {
  const nav = $('#topnav');
  if (session) {
    const u = db.get('gl_users', {})[session] || {};
    nav.innerHTML = `<span>${esc(u.perusahaan || session)}</span><button id="btnLogout">Keluar</button>`;
    $('#btnLogout').onclick = () => { session = null; localStorage.removeItem('gl_session'); show('landing'); };
  } else nav.innerHTML = `<button data-go="auth">Masuk</button>`;
}
document.addEventListener('click', e => {
  const go = e.target.closest('[data-go]');
  if (go) show(go.dataset.go === 'auth' && session ? 'app' : go.dataset.go);
});
$('#brand').onclick = e => { e.preventDefault(); show(session ? 'app' : 'landing'); };

/* ============ Registrasi / Login ============ */
$$('#authTabs .tab').forEach(b => b.onclick = () => {
  authMode = b.dataset.mode;
  $$('#authTabs .tab').forEach(x => x.classList.toggle('active', x === b));
  $('#lblPerusahaan').classList.toggle('hidden', authMode === 'login');
  $('#authBtn').textContent = authMode === 'login' ? 'Masuk' : 'Buat akun';
  $('#authMsg').textContent = '';
});
$('#authForm').onsubmit = async e => {
  e.preventDefault();
  const email = $('#fEmail').value.trim().toLowerCase(), pass = await sha($('#fPass').value);
  const users = db.get('gl_users', {}), msg = $('#authMsg');
  if (authMode === 'register') {
    if (users[email]) return msg.textContent = 'Email sudah terdaftar. Silakan masuk.';
    users[email] = { pass, perusahaan: $('#fPerusahaan').value.trim() || email };
    db.set('gl_users', users);
  } else if (!users[email] || users[email].pass !== pass) {
    return msg.textContent = 'Email atau kata sandi salah.';
  }
  session = email; db.set('gl_session', email); msg.textContent = '';
  e.target.reset(); enterApp();
};

/* ============ Dashboard ============ */
function enterApp() { show('app'); switchTab('klaim'); }
function switchTab(t) {
  $$('#appTabs .tab').forEach(b => b.classList.toggle('active', b.dataset.tab === t));
  $$('.panel').forEach(p => p.classList.toggle('hidden', p.id !== 'tab-' + t));
  if (t === 'klaim') renderKlaim(); if (t === 'bukti') renderBukti(); if (t === 'hasil') renderHasil();
}
$$('#appTabs .tab').forEach(b => b.onclick = () => switchTab(b.dataset.tab));

function fillSelects() {
  $('#kKategori').innerHTML = Object.entries(KATEGORI).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join('');
  $('#bJenis').innerHTML = JENIS_BUKTI.map(j => `<option>${j}</option>`).join('');
  $('#kSatuan').textContent = '(' + KATEGORI[$('#kKategori').value].satuan + ')';
}
$('#kKategori').onchange = () => $('#kSatuan').textContent = '(' + KATEGORI[$('#kKategori').value].satuan + ')';

/* ---- Menu 1: Input klaim hijau ---- */
$('#klaimForm').onsubmit = e => {
  e.preventDefault();
  if ($('#kAkhir').value < $('#kMulai').value) return toast('Periode akhir harus setelah periode mulai.');
  const c = getClaims();
  c.push({
    id: 'K' + Date.now().toString(36), nama: $('#kNama').value.trim(), kategori: $('#kKategori').value,
    nilai: +$('#kNilai').value, mulai: $('#kMulai').value, akhir: $('#kAkhir').value,
    biaya: +$('#kBiaya').value || 0, deskripsi: $('#kDesk').value.trim(), bukti: [], hasil: null
  });
  setClaims(c); e.target.reset(); $('#kBiaya').value = 0; fillSelects(); renderKlaim(); toast('Klaim ditambahkan. Lanjut unggah bukti.');
};
function statusBadge(c) {
  if (!c.hasil) return c.bukti.length ? '<span class="badge none">Belum diverifikasi</span>' : '<span class="badge none">Belum ada bukti</span>';
  const m = { 'Terverifikasi': 'ok', 'Perlu tinjauan': 'warn', 'Ditolak': 'bad' }[c.hasil.status];
  return `<span class="badge ${m}">${c.hasil.status}</span>`;
}
function renderKlaim() {
  const cs = getClaims(), box = $('#klaimList');
  box.innerHTML = cs.length ? cs.map(c => `
    <div class="card"><div class="card-head"><div>
      <h3>${esc(c.nama)}</h3>
      <div class="meta">${KATEGORI[c.kategori].label} · <span class="num">${num(c.nilai)} ${KATEGORI[c.kategori].satuan}</span> · ${tgl(c.mulai)} – ${tgl(c.akhir)}</div>
    </div>${statusBadge(c)}</div>
    <div class="actions"><button class="btn danger small" data-del="${c.id}">Hapus</button></div></div>`).join('')
    : '<div class="empty">Belum ada klaim. Isi formulir di atas lalu klik Tambah klaim baru.</div>';
  $$('[data-del]', box).forEach(b => b.onclick = () => {
    if (confirm('Hapus klaim ini beserta buktinya?')) { setClaims(getClaims().filter(x => x.id !== b.dataset.del)); renderKlaim(); }
  });
}

/* ---- Menu 2: Upload bukti ---- */
function renderBukti() {
  const cs = getClaims(), sel = $('#bKlaim'), prev = sel.value;
  sel.innerHTML = cs.length ? cs.map(c => `<option value="${c.id}">${esc(c.nama)}</option>`).join('') : '<option value="">Tambahkan klaim terlebih dahulu</option>';
  if (cs.some(c => c.id === prev)) sel.value = prev;
  updateBSatuan();
  const box = $('#buktiList');
  box.innerHTML = cs.length ? cs.map(c => `
    <div class="card"><div class="card-head"><h3>${esc(c.nama)}</h3>${statusBadge(c)}</div>
    ${c.bukti.length ? `<table class="jurnal"><tr><th>Jenis</th><th>Berkas</th><th class="r">Nilai</th><th>Tanggal</th><th></th></tr>
      ${c.bukti.map((b, i) => `<tr><td>${esc(b.jenis)}</td><td>${esc(b.nama)}<br><small class="meta num">SHA-256 ${b.hash.slice(0, 12)}…</small></td>
      <td class="r">${b.nilai !== null ? num(b.nilai) : '-'}</td><td>${tgl(b.tanggal)}</td>
      <td><button class="btn danger small" data-bdel="${c.id}|${i}">Hapus</button></td></tr>`).join('')}</table>`
      : '<p class="meta">Belum ada bukti. Tanpa bukti, sistem tidak dapat melanjutkan proses verifikasi.</p>'}
    <div class="actions"><button class="btn small" data-ver="${c.id}" ${c.bukti.length ? '' : 'disabled'}>Jalankan verifikasi</button></div></div>`).join('') : '';
  $$('[data-bdel]', box).forEach(b => b.onclick = () => {
    const [id, i] = b.dataset.bdel.split('|'), all = getClaims(), c = all.find(x => x.id === id);
    c.bukti.splice(+i, 1); c.hasil = null; setClaims(all); renderBukti();
  });
  $$('[data-ver]', box).forEach(b => b.onclick = () => { runVerify(b.dataset.ver); switchTab('hasil'); });
}
function updateBSatuan() {
  const c = getClaims().find(x => x.id === $('#bKlaim').value);
  $('#bSatuan').textContent = c ? '(' + KATEGORI[c.kategori].satuan + ')' : '';
}
$('#bKlaim').onchange = updateBSatuan;
$('#buktiForm').onsubmit = async e => {
  e.preventDefault();
  const all = getClaims(), c = all.find(x => x.id === $('#bKlaim').value);
  if (!c) return toast('Pilih klaim terlebih dahulu.');
  const f = $('#bFile').files[0]; if (!f) return;
  const hash = await sha(new Uint8Array(await f.arrayBuffer()));
  const v = $('#bNilai').value;
  c.bukti.push({ jenis: $('#bJenis').value, nilai: v === '' ? null : +v, tanggal: $('#bTanggal').value, nama: f.name, ukuran: f.size, hash });
  c.hasil = null; setClaims(all); e.target.reset(); renderBukti(); toast('Bukti diunggah.');
};

/* ============ Mesin verifikasi (cross-check klaim vs bukti) ============ */
function verify(c) {
  const k = KATEGORI[c.kategori], issues = []; let score = 100;
  const add = (sev, tipe, msg, pen) => { issues.push({ sev, tipe, msg }); score -= pen; };

  if (!c.bukti.length) {
    return { status: 'Ditolak', score: 0, issues: [{ sev: 'tinggi', tipe: 'Bukti tidak ada', msg: 'Tidak ada bukti pendukung. Verifikasi tidak dapat dilanjutkan.' }] };
  }
  // 1. Kesesuaian jenis bukti dengan kategori klaim
  const cocok = c.bukti.filter(b => k.wajib.includes(b.jenis));
  if (!cocok.length) add('tinggi', 'Ketidaksesuaian data', `Jenis bukti tidak sesuai kategori. Dibutuhkan salah satu: ${k.wajib.join(' / ')}.`, 35);

  // 2. Nilai klaim vs nilai pada bukti (greenwashing: klaim dilebihkan)
  const kuant = cocok.filter(b => b.nilai !== null && b.jenis !== 'Sertifikat');
  if (kuant.length) {
    const total = kuant.reduce((s, b) => s + b.nilai, 0), selisih = total > 0 ? (c.nilai - total) / total * 100 : 100;
    if (selisih > 10) add('tinggi', 'Indikasi greenwashing', `Klaim ${num(c.nilai)} ${k.satuan} melebihi bukti ${num(total)} ${k.satuan} (lebih tinggi ${selisih.toFixed(1)}%). Toleransi 10%.`, Math.min(50, 20 + selisih / 2));
    else if (selisih < -50) add('sedang', 'Klaim terlalu rendah', 'Nilai bukti jauh di atas klaim. Periksa apakah bukti dan klaim merujuk objek yang sama.', 10);
  } else if (cocok.length) add('sedang', 'Bukti tidak kuantitatif', 'Belum ada bukti bernilai angka (mis. audit energi, data karbon, transaksi) untuk menguji besaran klaim.', 15);

  // 3. Periode & cut-off (window dressing)
  const luar = c.bukti.filter(b => b.tanggal < c.mulai || b.tanggal > c.akhir);
  if (luar.length) add('tinggi', 'Indikasi window dressing', `${luar.length} bukti bertanggal di luar periode klaim (${tgl(c.mulai)} – ${tgl(c.akhir)}).`, 20);
  const akhir = new Date(c.akhir);
  const dekat = c.bukti.filter(b => { const d = (akhir - new Date(b.tanggal)) / 864e5; return d >= 0 && d <= 7; });
  if (dekat.length && c.biaya > 0) add('sedang', 'Cut-off mendekati tutup periode', 'Bukti transaksi bertanggal dalam 7 hari terakhir periode. Pastikan transaksi benar-benar terjadi dan bukan penumpukan di akhir periode.', 15);

  // 4. Klaim bersifat umum tanpa sertifikat
  if (KATA_UMUM.test(c.nama + ' ' + c.deskripsi) && !c.bukti.some(b => b.jenis === 'Sertifikat'))
    add('sedang', 'Klaim terlalu umum', 'Frasa seperti "100%", "zero", atau "alami" perlu didukung sertifikat dari pihak independen.', 15);

  score = Math.max(0, Math.round(score));
  const tinggi = issues.some(i => i.sev === 'tinggi');
  const status = score < 50 ? 'Ditolak' : (score >= 80 && !tinggi) ? 'Terverifikasi' : 'Perlu tinjauan';
  if (!issues.length) issues.push({ sev: 'ok', tipe: 'Sesuai', msg: 'Klaim konsisten dengan bukti pada seluruh pengujian.' });
  return { status, score, issues };
}
async function runVerify(id) {
  const all = getClaims(), c = all.find(x => x.id === id); if (!c) return;
  const r = verify(c);
  r.tanggal = new Date().toISOString().slice(0, 10);
  r.kode = 'GL-' + Date.now().toString(36).toUpperCase();
  r.hash = (await sha(JSON.stringify({ n: c.nama, k: c.kategori, v: c.nilai, b: c.bukti.map(b => b.hash), s: r.status }))).slice(0, 16);
  c.hasil = r; setClaims(all); renderHasil();
}

/* ============ Bantuan penjurnalan ============ */
function saranJurnal(c) {
  const k = KATEGORI[c.kategori], r = c.hasil;
  if (!c.biaya) return { tipe: 'info', judul: 'Tidak ada jurnal', baris: [], catatan: 'Klaim ini tidak memiliki biaya terkait. Cukup diungkapkan pada catatan laporan keberlanjutan, dengan angka sesuai bukti.' };
  const cutoff = r.issues.some(i => i.tipe.startsWith('Cut-off') || i.tipe.includes('window'));
  if (r.status === 'Terverifikasi') return {
    tipe: 'ok', judul: 'Jurnal siap diposting',
    baris: [{ akun: k.akun, d: c.biaya }, { akun: 'Kas / Bank (atau Utang Usaha)', k: c.biaya }],
    catatan: `${k.ket}. Gunakan tanggal transaksi pada bukti, bukan tanggal pelaporan. Pastikan perlakuan aset atau beban sesuai PSAK yang berlaku.`
  };
  return {
    tipe: 'hold', judul: 'Tahan label "hijau"; jangan dikapitalisasi',
    baris: [{ akun: 'Beban Operasional Umum', d: c.biaya }, { akun: 'Kas / Bank (atau Utang Usaha)', k: c.biaya }],
    catatan: 'Klaim belum terverifikasi. Jika transaksinya nyata, catat sesuai substansi sebagai beban biasa, bukan aset atau beban hijau, sampai bukti lengkap. Dengan begitu laba dan aset tidak tampak lebih "hijau" dari kenyataannya.'
      + (cutoff ? ' Ada indikasi cut-off: periksa tanggal transaksi dan jangan mengakui di periode yang salah.' : '')
  };
}
function jurnalHtml(c) {
  const j = saranJurnal(c);
  const tbl = j.baris.length ? `<table class="jurnal"><tr><th>Akun</th><th class="r">Debit</th><th class="r">Kredit</th></tr>
    ${j.baris.map(b => `<tr><td class="${b.k ? 'cr' : ''}">${esc(b.akun)}</td><td class="r">${b.d ? rp(b.d) : ''}</td><td class="r">${b.k ? rp(b.k) : ''}</td></tr>`).join('')}</table>` : '';
  return `<div class="jbox ${j.tipe === 'hold' ? 'hold' : ''}"><h4>Asisten jurnal: ${j.judul}</h4>${tbl}<p class="meta" style="margin:6px 0 0">${j.catatan}</p></div>`;
}

/* ============ Menu 3: Hasil verifikasi ============ */
function renderHasil() {
  const cs = getClaims(), box = $('#hasilList');
  if (!cs.length) return box.innerHTML = '<div class="empty">Belum ada klaim untuk diverifikasi.</div>';
  box.innerHTML = cs.map(c => {
    const r = c.hasil;
    return `<div class="card"><div class="card-head"><div><h3>${esc(c.nama)}</h3>
      <div class="meta">${KATEGORI[c.kategori].label} · <span class="num">${num(c.nilai)} ${KATEGORI[c.kategori].satuan}</span> · biaya <span class="num">${rp(c.biaya)}</span></div></div>${statusBadge(c)}</div>
      ${r ? `<div class="bar"><i style="width:${r.score}%"></i></div><div class="meta">Skor kesesuaian <b class="num">${r.score}/100</b> · kode <span class="num">${r.kode}</span></div>
      <ul class="issues">${r.issues.map(i => `<li class="${i.sev}"><b>${esc(i.tipe)}.</b> ${esc(i.msg)}</li>`).join('')}</ul>
      ${jurnalHtml(c)}` : '<p class="meta">Belum diverifikasi. Unggah bukti lalu jalankan verifikasi.</p>'}
      <div class="actions"><button class="btn small" data-v="${c.id}" ${c.bukti.length ? '' : 'disabled'}>${r ? 'Verifikasi ulang' : 'Jalankan verifikasi'}</button>
      ${r ? `<button class="btn ghost small" data-dl="${c.id}">Unduh laporan${r.status === 'Terverifikasi' ? ' + QR Code' : ''}</button>` : ''}</div></div>`;
  }).join('');
  $$('[data-v]', box).forEach(b => b.onclick = () => runVerify(b.dataset.v));
  $$('[data-dl]', box).forEach(b => b.onclick = () => downloadReport(b.dataset.dl));
}

/* ============ Laporan + QR Code transparansi ============ */
function makeQR(text) {
  return new Promise(res => {
    if (typeof QRCode === 'undefined') return res(null);
    const div = document.createElement('div');
    new QRCode(div, { text, width: 150, height: 150, correctLevel: QRCode.CorrectLevel.M });
    setTimeout(() => { const cv = div.querySelector('canvas'); res(cv ? cv.toDataURL('image/png') : null); }, 80);
  });
}
async function downloadReport(id) {
  const c = getClaims().find(x => x.id === id); if (!c || !c.hasil) return;
  const r = c.hasil, k = KATEGORI[c.kategori], ok = r.status === 'Terverifikasi';
  const qr = ok ? await makeQR(`GREENLEDGER|${r.kode}|${r.status}|${r.hash}`) : null;
  const u = db.get('gl_users', {})[session] || {};
  const html = `<!DOCTYPE html><html lang="id"><meta charset="utf-8"><title>Laporan ${r.kode}</title>
<style>body{font:14px/1.5 Arial,sans-serif;max-width:760px;margin:30px auto;color:#14231c}h1{font-size:22px;margin:0}table{width:100%;border-collapse:collapse;margin:10px 0}
td,th{border:1px solid #cfdad3;padding:6px 8px;text-align:left}.s{font-weight:bold;color:${ok ? '#1f7a4d' : '#b3261e'}}.r{text-align:right}small{color:#5a6b62}</style>
<h1>Laporan Verifikasi Green Ledger</h1><small>Kode ${r.kode} · diverifikasi ${tgl(r.tanggal)} · ${esc(u.perusahaan || session)}</small>
<h3>${esc(c.nama)}</h3>
<table><tr><th>Kategori</th><td>${k.label}</td></tr><tr><th>Nilai klaim</th><td>${num(c.nilai)} ${k.satuan}</td></tr>
<tr><th>Periode</th><td>${tgl(c.mulai)} – ${tgl(c.akhir)}</td></tr><tr><th>Status</th><td class="s">${r.status} (skor ${r.score}/100)</td></tr></table>
<h3>Catatan audit</h3><ul>${r.issues.map(i => `<li><b>${esc(i.tipe)}.</b> ${esc(i.msg)}</li>`).join('')}</ul>
<h3>Bukti pendukung</h3><table><tr><th>Jenis</th><th>Berkas</th><th>Nilai</th><th>Tanggal</th><th>SHA-256</th></tr>
${c.bukti.map(b => `<tr><td>${esc(b.jenis)}</td><td>${esc(b.nama)}</td><td class="r">${b.nilai !== null ? num(b.nilai) : '-'}</td><td>${tgl(b.tanggal)}</td><td><small>${b.hash.slice(0, 16)}…</small></td></tr>`).join('')}</table>
${qr ? `<h3>QR Code transparansi</h3><img src="${qr}" width="150" height="150" alt="QR Code"><br><small>Tempelkan pada laporan keberlanjutan sebagai bukti transparansi menuju SDGs 2030. Kode integritas: ${r.hash}</small>`
     : '<p><small>QR Code hanya diterbitkan untuk klaim berstatus Terverifikasi.</small></p>'}</html>`;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
  a.download = `laporan-${r.kode}.html`; a.click(); URL.revokeObjectURL(a.href);
  toast('Laporan diunduh.');
}

/* ============ Mulai ============ */
fillSelects();
if (session && db.get('gl_users', {})[session]) enterApp(); else { session = null; show('landing'); }
