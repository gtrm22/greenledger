'use strict';
/* Fitur akuntansi Green Ledger: 1) Jurnal umum  2) Buku besar  3) Neraca saldo
   4) Rekonsiliasi & materialitas  5) Jejak audit (rantai hash). Dimuat setelah app.js */
(() => {
const BK = () => db.get('gl_buku_' + session, { jurnal: [], audit: [], profil: { laba: 0, persen: 5 } });
const setBK = b => db.set('gl_buku_' + session, b);
const AKUN = [...new Set(['Kas / Bank (atau Utang Usaha)', ...Object.values(KATEGORI).map(k => k.akun), 'Beban Operasional Umum', 'Utang Usaha', 'Provisi Lingkungan'])];
const normalK = a => /^(Utang|Provisi|Pendapatan|Modal)/.test(a);
const aktif = e => !e.dibalik && !e.pembalikDari;
const tot = e => e.baris.reduce((s, x) => s + x.d, 0);
const P = id => $('#tab-' + id);
const opt = (arr, f) => arr.map(f).join('');
const tabel = h => `<div class="tbl-wrap">${h}</div>`;
const sidikIsi = e => JSON.stringify([e.no, e.tanggal, e.ket, e.klaimId || null, e.pembalikDari || null, e.baris]);

/* ---- jejak audit: setiap catatan memuat hash catatan sebelumnya ---- */
async function catat(b, aksi, rincian) {
  const prev = b.audit.length ? b.audit[b.audit.length - 1].hash : 'GENESIS';
  const e = { no: b.audit.length + 1, waktu: new Date().toISOString(), aksi, rincian, prev };
  e.hash = await sha(JSON.stringify([e.no, e.waktu, e.aksi, e.rincian, e.prev]));
  b.audit.push(e);
}
async function posting(en) {
  const b = BK(); en.no = 'JU-' + String(b.jurnal.length + 1).padStart(3, '0');
  en.sidik = (await sha(sidikIsi(en))).slice(0, 16);
  b.jurnal.push(en);
  await catat(b, en.pembalikDari ? 'PEMBALIK' : 'POSTING', `${en.no} ${en.ket} ${rp(tot(en))} #${en.sidik}`);
  setBK(b);
}
async function balik(no) {
  const b = BK(), e = b.jurnal.find(x => x.no === no); if (!e || !aktif(e)) return;
  e.dibalik = true; setBK(b);
  await posting({ tanggal: new Date().toISOString().slice(0, 10), ket: `Pembalik ${e.no}: ${e.ket}`, klaimId: e.klaimId, pembalikDari: e.no,
    baris: e.baris.map(x => ({ akun: x.akun, d: x.k, k: x.d })) });
  toast('Jurnal pembalik dibuat. Jurnal asli tidak dihapus.'); rJU();
}

/* ---- 1. Jurnal umum ---- */
function rJU() {
  const b = BK(), cs = getClaims(), layak = cs.filter(c => c.hasil && c.biaya > 0), el = P('ju');
  el.innerHTML = `
  <form id="fPost" class="grid">
    <label class="span2">Posting dari asisten jurnal (klaim yang sudah diverifikasi)
      <select id="pKlaim">${layak.length ? opt(layak, c => `<option value="${c.id}">${esc(c.nama)} · ${rp(c.biaya)} · ${c.hasil.status}</option>`) : '<option value="">Belum ada klaim terverifikasi dengan biaya</option>'}</select></label>
    <label>Tanggal transaksi<input id="pTgl" type="date" required></label>
    <div class="span1"><button class="btn" type="submit">Posting jurnal</button></div>
  </form>
  <form id="fMan" class="grid" style="margin-top:16px">
    <label>Tanggal<input id="mTgl" type="date" required></label>
    <label>Keterangan<input id="mKet" required placeholder="Contoh: Pembelian panel surya"></label>
    <label>Akun debit<select id="mD">${opt(AKUN, a => `<option>${esc(a)}</option>`)}</select></label>
    <label>Akun kredit<select id="mK">${opt(AKUN, a => `<option>${esc(a)}</option>`)}</select></label>
    <label>Jumlah (Rp)<input id="mJml" type="number" min="1" step="any" required></label>
    <label>Klaim terkait (opsional)<select id="mKlaim"><option value="">Tidak terkait klaim</option>${opt(cs, c => `<option value="${c.id}">${esc(c.nama)}</option>`)}</select></label>
    <div class="span2"><button class="btn ghost" type="submit">Catat jurnal manual</button></div>
  </form>
  <div class="list">${b.jurnal.length ? tabel(`<table class="jurnal"><tr><th>No</th><th>Tanggal</th><th>Keterangan</th><th>Akun</th><th class="r">Debit</th><th class="r">Kredit</th><th></th></tr>
    ${b.jurnal.map(e => e.baris.map((x, i) => `<tr>${i ? '' : `<td rowspan="${e.baris.length}" class="num">${e.no}</td><td rowspan="${e.baris.length}">${tgl(e.tanggal)}</td><td rowspan="${e.baris.length}">${esc(e.ket)}${e.dibalik ? '<br><small class="meta">Sudah dibalik</small>' : ''}</td>`}
      <td class="${x.k ? 'cr' : ''}">${esc(x.akun)}</td><td class="r">${x.d ? rp(x.d) : ''}</td><td class="r">${x.k ? rp(x.k) : ''}</td>
      ${i ? '' : `<td rowspan="${e.baris.length}">${aktif(e) ? `<button class="btn danger small" data-rev="${e.no}">Balik</button>` : ''}</td>`}</tr>`).join('')).join('')}</table>`)
    : '<div class="empty">Belum ada jurnal. Posting dari asisten jurnal atau catat manual.</div>'}</div>`;
  $('#fPost').onsubmit = async ev => {
    ev.preventDefault();
    const c = cs.find(x => x.id === $('#pKlaim').value), t = $('#pTgl').value;
    if (!c) return toast('Pilih klaim yang sudah diverifikasi.');
    if (t < c.mulai || t > c.akhir) return toast('Tanggal di luar periode klaim. Periksa cut-off dulu.');
    if (BK().jurnal.some(e => e.klaimId === c.id && aktif(e))) return toast('Klaim ini sudah dijurnal. Balik jurnal lama jika perlu koreksi.');
    const j = saranJurnal(c); if (!j.baris.length) return toast('Klaim ini tidak punya jurnal.');
    await posting({ tanggal: t, ket: 'Klaim: ' + c.nama, klaimId: c.id, baris: j.baris.map(x => ({ akun: x.akun, d: x.d || 0, k: x.k || 0 })) });
    toast('Jurnal diposting.'); rJU();
  };
  $('#fMan').onsubmit = async ev => {
    ev.preventDefault();
    const d = $('#mD').value, k = $('#mK').value, j = +$('#mJml').value;
    if (d === k) return toast('Akun debit dan kredit tidak boleh sama.');
    await posting({ tanggal: $('#mTgl').value, ket: $('#mKet').value.trim(), klaimId: $('#mKlaim').value || null,
      baris: [{ akun: d, d: j, k: 0 }, { akun: k, d: 0, k: j }] });
    toast('Jurnal manual dicatat.'); rJU();
  };
  $$('[data-rev]', el).forEach(x => x.onclick = () => balik(x.dataset.rev));
}

/* ---- 2. Buku besar ---- */
let akunBB = '';
function rBB() {
  const b = BK(), el = P('bb'), ada = [...new Set(b.jurnal.flatMap(e => e.baris.map(x => x.akun)))];
  if (!ada.length) return el.innerHTML = '<div class="empty">Belum ada jurnal. Posting jurnal dulu di menu Jurnal umum.</div>';
  if (!ada.includes(akunBB)) akunBB = ada[0];
  const k = normalK(akunBB); let s = 0;
  const rows = b.jurnal.flatMap(e => e.baris.filter(x => x.akun === akunBB).map(x => ({ e, x })))
    .sort((a, c) => a.e.tanggal.localeCompare(c.e.tanggal) || a.e.no.localeCompare(c.e.no));
  el.innerHTML = `<label>Akun<select id="bbAkun">${opt(ada, a => `<option ${a === akunBB ? 'selected' : ''}>${esc(a)}</option>`)}</select></label>
  ${tabel(`<table class="jurnal"><tr><th>Tanggal</th><th>No</th><th>Keterangan</th><th class="r">Debit</th><th class="r">Kredit</th><th class="r">Saldo (${k ? 'kredit' : 'debit'})</th></tr>
  ${rows.map(({ e, x }) => { s += k ? x.k - x.d : x.d - x.k;
    return `<tr><td>${tgl(e.tanggal)}</td><td class="num">${e.no}</td><td>${esc(e.ket)}</td><td class="r">${x.d ? rp(x.d) : ''}</td><td class="r">${x.k ? rp(x.k) : ''}</td><td class="r">${rp(s)}</td></tr>`; }).join('')}</table>`)}`;
  $('#bbAkun').onchange = ev => { akunBB = ev.target.value; rBB(); };
}

/* ---- 3. Neraca saldo ---- */
function rNS() {
  const b = BK(), el = P('ns'), m = {};
  b.jurnal.forEach(e => e.baris.forEach(x => { m[x.akun] = m[x.akun] || { d: 0, k: 0 }; m[x.akun].d += x.d; m[x.akun].k += x.k; }));
  const ak = Object.keys(m).sort();
  if (!ak.length) return el.innerHTML = '<div class="empty">Belum ada jurnal untuk dibuatkan neraca saldo.</div>';
  const sd = a => Math.max(0, m[a].d - m[a].k), sk = a => Math.max(0, m[a].k - m[a].d);
  const TD = ak.reduce((s, a) => s + sd(a), 0), TK = ak.reduce((s, a) => s + sk(a), 0), seimbang = Math.abs(TD - TK) < 1;
  const hijau = ak.filter(a => /^(Aset|Persediaan|Beban Pengelolaan|Beban Sertifikasi)/.test(a)).reduce((s, a) => s + sd(a), 0);
  el.innerHTML = `${tabel(`<table class="jurnal"><tr><th>Akun</th><th class="r">Saldo debit</th><th class="r">Saldo kredit</th></tr>
    ${ak.map(a => `<tr><td>${esc(a)}</td><td class="r">${sd(a) ? rp(sd(a)) : ''}</td><td class="r">${sk(a) ? rp(sk(a)) : ''}</td></tr>`).join('')}
    <tr><th>Total</th><th class="r">${rp(TD)}</th><th class="r">${rp(TK)}</th></tr></table>`)}
  <ul class="issues"><li class="${seimbang ? 'ok' : 'tinggi'}"><b>${seimbang ? 'Seimbang.' : 'Tidak seimbang.'}</b> ${seimbang ? 'Total debit sama dengan total kredit.' : 'Selisih ' + rp(Math.abs(TD - TK)) + '. Periksa jurnal yang tercatat.'}</li>
  <li class="ok"><b>Saldo terkait lingkungan:</b> ${rp(hijau)} pada akun aset, persediaan, dan beban lingkungan. Pastikan seluruhnya didukung klaim yang terverifikasi.</li></ul>`;
}

/* ---- 4. Rekonsiliasi klaim vs buku & materialitas ---- */
function rRM() {
  const b = BK(), cs = getClaims().filter(c => c.biaya > 0), el = P('rm'), pr = b.profil;
  const mat = pr.laba * pr.persen / 100; let salah = 0;
  const rows = cs.map(c => {
    const lin = b.jurnal.filter(e => e.klaimId === c.id && aktif(e)), post = lin.reduce((s, e) => s + tot(e), 0);
    const kap = lin.reduce((s, e) => s + e.baris.filter(x => /^(Aset|Persediaan)/.test(x.akun)).reduce((a, x) => a + x.d, 0), 0);
    const st = c.hasil ? c.hasil.status : 'Belum diverifikasi', risiko = st !== 'Terverifikasi' && kap > 0; if (risiko) salah += kap;
    const rec = !post ? 'Belum diposting' : Math.abs(post - c.biaya) < 1 ? 'Sesuai' : 'Selisih';
    return `<tr><td>${esc(c.nama)}</td><td>${st}</td><td class="r">${rp(c.biaya)}</td><td class="r">${rp(post)}</td><td class="r">${rp(post - c.biaya)}</td>
      <td>${rec}${risiko ? '<br><small class="meta">Dikapitalisasi tanpa verifikasi: ' + rp(kap) + '</small>' : ''}</td></tr>`;
  });
  const ket = !mat ? ['', 'Isi laba sebelum pajak untuk menghitung batas materialitas.']
    : salah > mat ? ['tinggi', `Potensi salah saji ${rp(salah)} melebihi materialitas ${rp(mat)}. Koreksi sebelum laporan diterbitkan.`]
    : salah > 0 ? ['', `Potensi salah saji ${rp(salah)} di bawah materialitas ${rp(mat)}, tetapi tetap catat sebagai salah saji yang belum dikoreksi.`]
    : ['ok', `Tidak ada klaim belum terverifikasi yang dikapitalisasi. Materialitas ${rp(mat)}.`];
  el.innerHTML = `<form id="fProf" class="grid"><label>Laba sebelum pajak (Rp)<input id="pLaba" type="number" min="0" step="any" value="${pr.laba}"></label>
    <label>Persentase materialitas (%)<small> patokan umum 5% laba</small><input id="pPersen" type="number" min="0.1" max="20" step="any" value="${pr.persen}"></label>
    <div class="span2"><button class="btn small" type="submit">Hitung materialitas</button></div></form>
    <ul class="issues" style="margin-top:16px"><li class="${ket[0]}">${ket[1]}</li></ul>
    ${rows.length ? tabel(`<table class="jurnal"><tr><th>Klaim</th><th>Status</th><th class="r">Biaya klaim</th><th class="r">Diposting</th><th class="r">Selisih</th><th>Rekonsiliasi</th></tr>${rows.join('')}</table>`)
      : '<div class="empty">Belum ada klaim dengan biaya terkait.</div>'}`;
  $('#fProf').onsubmit = async ev => {
    ev.preventDefault(); const bb = BK();
    bb.profil = { laba: +$('#pLaba').value || 0, persen: +$('#pPersen').value || 5 };
    await catat(bb, 'MATERIALITAS', `Laba ${rp(bb.profil.laba)}, persentase ${bb.profil.persen}%`); setBK(bb); rRM();
  };
}

/* ---- 5. Jejak audit ---- */
async function cekRantai() {
  const b = BK(); let prev = 'GENESIS';
  for (const e of b.audit) {
    const h = await sha(JSON.stringify([e.no, e.waktu, e.aksi, e.rincian, e.prev]));
    if (e.prev !== prev || h !== e.hash) return `Rantai putus pada catatan #${e.no}. Isi catatan audit telah diubah.`;
    prev = e.hash;
  }
  for (const j of b.jurnal) {
    if ((await sha(sidikIsi(j))).slice(0, 16) !== j.sidik) return `Jurnal ${j.no} tidak cocok dengan sidik saat diposting. Isinya telah diubah.`;
    if (!b.audit.some(a => a.rincian.includes('#' + j.sidik))) return `Jurnal ${j.no} tidak punya catatan audit.`;
  }
  return '';
}
function rJA() {
  const b = BK(), el = P('ja');
  el.innerHTML = `<div class="actions" style="margin:0 0 12px"><button class="btn small" id="cekJA">Periksa integritas</button></div><div id="hasilJA"></div>
  ${b.audit.length ? tabel(`<table class="jurnal"><tr><th>#</th><th>Waktu</th><th>Aksi</th><th>Rincian</th><th>Hash</th></tr>
    ${b.audit.map(e => `<tr><td class="num">${e.no}</td><td>${new Date(e.waktu).toLocaleString('id-ID')}</td><td>${e.aksi}</td><td>${esc(e.rincian)}</td><td class="num">${e.hash.slice(0, 10)}…</td></tr>`).join('')}</table>`)
    : '<div class="empty">Belum ada catatan. Setiap posting, jurnal pembalik, dan perubahan materialitas dicatat di sini.</div>'}`;
  $('#cekJA').onclick = async () => {
    const r = await cekRantai();
    $('#hasilJA').innerHTML = `<ul class="issues"><li class="${r ? 'tinggi' : 'ok'}"><b>${r ? 'Integritas bermasalah.' : 'Integritas terjaga.'}</b> ${r || `${b.audit.length} catatan audit dan ${b.jurnal.length} jurnal saling cocok.`}</li></ul>`;
  };
}

/* ---- pasang tab ke dashboard ---- */
const R = { ju: rJU, bb: rBB, ns: rNS, rm: rRM, ja: rJA };
[['ju', 'Jurnal umum'], ['bb', 'Buku besar'], ['ns', 'Neraca saldo'], ['rm', 'Rekonsiliasi & materialitas'], ['ja', 'Jejak audit']].forEach(([id, l]) => {
  const t = document.createElement('button'); t.className = 'tab'; t.dataset.tab = id; t.textContent = l; t.onclick = () => switchTab(id); $('#appTabs').appendChild(t);
  const p = document.createElement('div'); p.id = 'tab-' + id; p.className = 'panel hidden'; $('#app').appendChild(p);
});
const dasar = switchTab;
switchTab = t => { dasar(t); if (R[t]) R[t](); };
})();
