(() => {
  'use strict';

  const API = 'https://generativelanguage.googleapis.com/v1beta';
  const CFG_KEY = 'tsimg.config.v1';
  const KEY_KEY = 'tsimg.apikey';
  const MAX_REFS = 3;

  const $ = (sel, el = document) => el.querySelector(sel);
  const els = {
    apiKey: $('#apiKey'), toggleKey: $('#toggleKey'), rememberKey: $('#rememberKey'),
    imageModel: $('#imageModel'), textModel: $('#textModel'), aspect: $('#aspect'),
    concurrency: $('#concurrency'), enhance: $('#enhance'), noText: $('#noText'),
    loadModels: $('#loadModels'), modelsStatus: $('#modelsStatus'),
    style: $('#style'), stylePresets: $('#stylePresets'), presetPrompt: $('#presetPrompt'),
    styleLabel: $('#styleLabel'), characters: $('#characters'), addChar: $('#addChar'),
    exportCfg: $('#exportCfg'), importCfg: $('#importCfg'),
    script: $('#script'), preview: $('#preview'), generate: $('#generate'), stop: $('#stop'),
    downloadAll: $('#downloadAll'), progress: $('#progress'), results: $('#results'),
  };

  /** @type {{name:string, aliases:string, desc:string, always:boolean, refs:{mimeType:string,data:string}[]}[]} */
  let characters = [];
  let jobs = [];
  let stylePreset = 'custom';
  let abort = null;

  // ---------- storage ----------
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); return true; } catch { return false; } },
    del(k) { try { localStorage.removeItem(k); } catch { /* ignore */ } },
  };

  function currentConfig() {
    return {
      stylePreset,
      style: els.style.value,
      imageModel: els.imageModel.value.trim(),
      textModel: els.textModel.value.trim(),
      aspect: els.aspect.value,
      concurrency: els.concurrency.value,
      enhance: els.enhance.checked,
      noText: els.noText.checked,
      script: els.script.value,
      characters,
    };
  }

  function applyConfig(cfg) {
    if (!cfg) return;
    if (cfg.style != null) els.style.value = cfg.style;
    stylePreset = STYLE_PRESETS.some((p) => p.id === cfg.stylePreset) ? cfg.stylePreset : 'custom';
    renderPresets();
    if (cfg.imageModel) els.imageModel.value = cfg.imageModel;
    if (cfg.textModel) els.textModel.value = cfg.textModel;
    if (cfg.aspect) els.aspect.value = cfg.aspect;
    if (cfg.concurrency) els.concurrency.value = cfg.concurrency;
    if (cfg.enhance != null) els.enhance.checked = cfg.enhance;
    if (cfg.noText != null) els.noText.checked = cfg.noText;
    if (cfg.script != null) els.script.value = cfg.script;
    if (Array.isArray(cfg.characters)) {
      characters = cfg.characters.map((c) => ({
        name: c.name || '', aliases: c.aliases || '', desc: c.desc || '',
        always: !!c.always, refs: Array.isArray(c.refs) ? c.refs.slice(0, MAX_REFS) : [],
      }));
    }
    renderCharacters();
    renderPreview();
  }

  let saveTimer = null;
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      if (!store.set(CFG_KEY, JSON.stringify(currentConfig()))) {
        // Probably quota exceeded by reference images: save without them.
        const slim = { ...currentConfig(), characters: characters.map((c) => ({ ...c, refs: [] })) };
        store.set(CFG_KEY, JSON.stringify(slim));
      }
      if (els.rememberKey.checked) store.set(KEY_KEY, els.apiKey.value.trim());
    }, 300);
  }

  // ---------- style presets ----------
  function styleText() {
    const preset = STYLE_PRESETS.find((p) => p.id === stylePreset);
    return [preset?.prompt, els.style.value.trim()].filter(Boolean).join(', ');
  }

  function renderPresets() {
    els.stylePresets.textContent = '';
    STYLE_PRESETS.forEach((p) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'preset' + (p.id === stylePreset ? ' active' : '');
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', String(p.id === stylePreset));
      b.innerHTML = `<span class="icon" aria-hidden="true">${p.icon}</span><span>${escapeHtml(p.label)}</span>`;
      b.addEventListener('click', () => { stylePreset = p.id; renderPresets(); save(); });
      els.stylePresets.appendChild(b);
    });
    const preset = STYLE_PRESETS.find((p) => p.id === stylePreset);
    const custom = !preset?.prompt;
    els.presetPrompt.textContent = custom ? '' : `Se añade a cada imagen: “${preset.prompt}”`;
    els.presetPrompt.hidden = custom;
    els.styleLabel.textContent = custom ? 'Tu estilo visual' : 'Detalles extra de estilo (opcional)';
    els.style.placeholder = custom
      ? 'Describe el estilo: ej. voxel art 3D, colores vibrantes, iluminación dramática, humor negro'
      : 'Ej: colores vibrantes, iluminación dramática, humor negro';
  }

  // ---------- characters ----------
  function renderCharacters() {
    els.characters.textContent = '';
    characters.forEach((c, i) => {
      const node = $('#charTpl').content.firstElementChild.cloneNode(true);
      const bind = (sel, prop, evt = 'input', getter = (e) => e.target.value) => {
        const input = $(sel, node);
        if (input.type === 'checkbox') input.checked = c[prop]; else input.value = c[prop];
        input.addEventListener(evt, (e) => { c[prop] = getter(e); save(); renderPreview(); });
      };
      bind('.cName', 'name');
      bind('.cAliases', 'aliases');
      bind('.cDesc', 'desc');
      bind('.cAlways', 'always', 'change', (e) => e.target.checked);
      $('.cRemove', node).addEventListener('click', () => {
        characters.splice(i, 1); renderCharacters(); renderPreview(); save();
      });
      const thumbs = $('.thumbs', node);
      c.refs.forEach((r, ri) => {
        const t = document.createElement('button');
        t.type = 'button';
        t.className = 'thumb';
        t.title = 'Quitar referencia';
        t.style.backgroundImage = `url(data:${r.mimeType};base64,${r.data})`;
        t.addEventListener('click', () => { c.refs.splice(ri, 1); renderCharacters(); save(); });
        thumbs.appendChild(t);
      });
      $('.cFile', node).addEventListener('change', async (e) => {
        for (const file of [...e.target.files].slice(0, MAX_REFS - c.refs.length)) {
          try { c.refs.push(await shrinkImage(file)); } catch (err) { alert('No se pudo leer la imagen: ' + err.message); }
        }
        renderCharacters(); save();
      });
      els.characters.appendChild(node);
    });
  }

  function shrinkImage(file, max = 768) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, max / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(url);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
        resolve({ mimeType: 'image/jpeg', data: dataUrl.split(',')[1] });
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('formato no soportado')); };
      img.src = url;
    });
  }

  const norm = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

  function charactersFor(sceneText) {
    const t = norm(sceneText);
    return characters.filter((c) => {
      if (!c.name.trim() && !c.desc.trim()) return false;
      if (c.always) return true;
      const names = [c.name, ...c.aliases.split(',')].map((s) => norm(s.trim())).filter(Boolean);
      return names.some((n) => t.includes(n));
    });
  }

  // ---------- preview ----------
  function renderPreview() {
    const scenes = ScriptParser.parseScript(els.script.value);
    if (!els.script.value.trim()) { els.preview.textContent = ''; return; }
    if (!scenes.length) {
      els.preview.innerHTML = '<p class="warn">No se detectó ningún timestamp.</p>';
      return;
    }
    const rows = scenes.map((s) => {
      const who = charactersFor(s.text).map((c) => c.name || 'sin nombre').join(', ');
      return `<li><span class="ts">${s.timestamp}</span> ${escapeHtml(truncate(s.text, 90))}${who ? ` <em>· ${escapeHtml(who)}</em>` : ''}</li>`;
    });
    els.preview.innerHTML = `<p><b>${scenes.length}</b> escena${scenes.length === 1 ? '' : 's'} → ${scenes.length} ${scenes.length === 1 ? 'imagen' : 'imágenes'}</p><ol>${rows.join('')}</ol>`;
  }

  const truncate = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
  const escapeHtml = (s) => s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

  // ---------- Gemini API ----------
  async function callApi(path, body, signal) {
    const key = els.apiKey.value.trim();
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(`${API}/${path}`, {
        method: body ? 'POST' : 'GET',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        body: body ? JSON.stringify(body) : undefined,
        signal,
      });
      if (res.ok) return res.json();
      let msg = `HTTP ${res.status}`;
      try { msg = (await res.json()).error?.message || msg; } catch { /* keep status */ }
      if (res.status === 429 && /limit:\s*0\b/.test(msg)) {
        // No free-tier quota for this model: retrying can never succeed.
        const model = (msg.match(/model:\s*([\w.-]+)/) || [])[1] || path.split(/[/:]/)[1];
        const err = new Error(
          `Tu API key no tiene cuota para el modelo "${model}" (límite 0 en el plan gratuito). ` +
          'Google solo permite generar imágenes por API con la facturación activada: ' +
          'actívala en https://aistudio.google.com/apikey (Set up billing) o usa una key de un proyecto con facturación.');
        err.fatal = true;
        throw err;
      }
      const retryable = res.status === 429 || res.status >= 500;
      if (retryable && attempt < 3) {
        const hinted = parseFloat((msg.match(/retry in ([\d.]+)s/i) || [])[1]);
        const wait = hinted ? Math.min(hinted * 1000 + 500, 65000) : 2000 * 2 ** attempt;
        await sleep(wait, signal);
        continue;
      }
      throw new Error(msg);
    }
  }

  function sleep(ms, signal) {
    return new Promise((resolve, reject) => {
      const t = setTimeout(resolve, ms);
      signal?.addEventListener('abort', () => { clearTimeout(t); reject(new DOMException('Aborted', 'AbortError')); }, { once: true });
    });
  }

  const modelPath = (m) => (m.startsWith('models/') ? m : `models/${m}`);

  async function enhancePrompt(sceneText, cast, signal) {
    const castText = cast.length
      ? cast.map((c) => `- ${c.name}: ${c.desc}`).join('\n')
      : '(no hay personajes fijos en esta escena)';
    const system = [
      'Eres director de arte de un canal de vídeo. Conviertes una línea del guion en un prompt para un generador de imágenes.',
      'Responde SOLO con el prompt, en inglés, en un párrafo de 60-120 palabras, sin explicaciones.',
      'Describe composición, acción, encuadre, fondo e iluminación de forma concreta y visual. Exagera lo dramático o cómico para captar atención.',
      'Personajes que deben aparecer (respeta exactamente su aspecto, refiérete a ellos por su descripción visual):',
      castText,
      styleText() ? `Estilo visual del canal: ${styleText()}` : '',
    ].filter(Boolean).join('\n');

    const data = await callApi(`${modelPath(els.textModel.value.trim())}:generateContent`, {
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: sceneText }] }],
      generationConfig: { temperature: 0.9 },
    }, signal);
    const out = data.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('').trim();
    if (!out) throw new Error('El modelo de texto no devolvió prompt');
    return out;
  }

  function buildPrompt(base, cast, { raw }) {
    const aspect = els.aspect.value;
    const parts = [];
    parts.push(raw ? `Illustrate this scene from a video script (the script may be in Spanish): "${base}"` : base);
    if (cast.length) {
      parts.push('Recurring characters of the channel, keep their appearance exactly consistent:\n' +
        cast.map((c) => `- ${c.name || 'Character'}: ${c.desc}`).join('\n'));
    }
    if (styleText()) parts.push(`Visual style: ${styleText()}.`);
    parts.push(`Aspect ratio ${aspect}${aspect === '9:16' ? ', vertical composition' : ''}.`);
    if (els.noText.checked) parts.push('Do not include any text, captions, letters, logos or watermarks unless they are part of a character description.');
    return parts.join('\n\n');
  }

  async function generateImage(prompt, cast, signal) {
    const model = els.imageModel.value.trim();
    const aspect = els.aspect.value;

    if (/(^|\/)imagen/i.test(model)) {
      const data = await callApi(`${modelPath(model)}:predict`, {
        instances: [{ prompt }],
        parameters: { sampleCount: 1, aspectRatio: aspect },
      }, signal);
      const p = data.predictions?.[0];
      if (!p?.bytesBase64Encoded) throw new Error('Imagen no devolvió imagen (¿bloqueada por filtros de seguridad?)');
      return { mimeType: p.mimeType || 'image/png', data: p.bytesBase64Encoded };
    }

    const parts = [];
    for (const c of cast) {
      if (!c.refs.length) continue;
      parts.push({ text: `Reference image(s) of the character "${c.name}":` });
      c.refs.forEach((r) => parts.push({ inlineData: { mimeType: r.mimeType, data: r.data } }));
    }
    parts.push({ text: prompt });

    const data = await callApi(`${modelPath(model)}:generateContent`, {
      contents: [{ role: 'user', parts }],
      generationConfig: { responseModalities: ['TEXT', 'IMAGE'], imageConfig: { aspectRatio: aspect } },
    }, signal);
    const cand = data.candidates?.[0];
    const img = cand?.content?.parts?.find((p) => p.inlineData?.data);
    if (!img) {
      const why = cand?.finishReason || data.promptFeedback?.blockReason || 'sin imagen en la respuesta';
      throw new Error(`El modelo no devolvió imagen (${why})`);
    }
    return { mimeType: img.inlineData.mimeType || 'image/png', data: img.inlineData.data };
  }

  // ---------- jobs ----------
  function makeCard(job) {
    const node = $('#cardTpl').content.firstElementChild.cloneNode(true);
    $('.ts', node).textContent = job.scene.endSeconds != null
      ? `${job.scene.timestamp} – ${ScriptParser.formatTs(job.scene.endSeconds)}`
      : job.scene.timestamp;
    $('.imgWrap', node).style.aspectRatio = els.aspect.value.replace(':', ' / ');
    $('.text', node).textContent = job.scene.text;
    $('.who', node).textContent = job.cast.length ? 'Personajes: ' + job.cast.map((c) => c.name).join(', ') : '';
    $('.regen', node).addEventListener('click', () => runJobs([job], { single: true }));
    job.el = node;
    return node;
  }

  function setJobState(job, state, detail) {
    job.state = state;
    const wrap = $('.imgWrap', job.el);
    const regen = $('.regen', job.el);
    regen.disabled = state === 'working';
    if (state === 'done') {
      wrap.textContent = '';
      const img = document.createElement('img');
      img.src = job.url;
      img.alt = job.scene.text;
      img.loading = 'lazy';
      wrap.appendChild(img);
      const dl = $('.dl', job.el);
      dl.href = job.url;
      dl.download = job.filename;
      dl.hidden = false;
    } else {
      wrap.innerHTML = `<div class="status ${state}">${escapeHtml(detail || '')}</div>`;
    }
    if (job.prompt) $('.prompt', job.el).textContent = job.prompt;
  }

  async function processJob(job, signal) {
    job.fatal = null;
    try {
      setJobState(job, 'working', els.enhance.checked ? 'Escribiendo prompt…' : 'Generando imagen…');
      let prompt;
      if (els.enhance.checked) {
        const enhanced = await enhancePrompt(job.scene.text, job.cast, signal);
        prompt = buildPrompt(enhanced, job.cast, { raw: false });
      } else {
        prompt = buildPrompt(job.scene.text, job.cast, { raw: true });
      }
      job.prompt = prompt;
      setJobState(job, 'working', 'Generando imagen…');
      const img = await generateImage(prompt, job.cast, signal);
      const bytes = Uint8Array.from(atob(img.data), (ch) => ch.charCodeAt(0));
      if (job.url) URL.revokeObjectURL(job.url);
      job.blob = new Blob([bytes], { type: img.mimeType });
      job.url = URL.createObjectURL(job.blob);
      const ext = img.mimeType.includes('jpeg') ? 'jpg' : img.mimeType.split('/')[1] || 'png';
      job.filename = `${String(job.index).padStart(2, '0')}_${job.scene.timestamp.replace(/:/g, '-')}.${ext}`;
      setJobState(job, 'done');
    } catch (err) {
      if (err.fatal) job.fatal = err;
      if (err.name === 'AbortError') setJobState(job, 'error', 'Detenido');
      else setJobState(job, 'error', 'Error: ' + err.message);
    }
  }

  async function runJobs(list, { single = false } = {}) {
    if (!els.apiKey.value.trim()) { alert('Pega primero tu API key de Gemini.'); els.apiKey.focus(); return; }
    if (abort && !single) return;
    const controller = single && abort ? abort : new AbortController();
    const owner = !abort;
    if (owner) {
      abort = controller;
      els.generate.disabled = true;
      els.stop.hidden = false;
    }

    list.forEach((j) => setJobState(j, 'queued', 'En cola'));
    let done = 0;
    updateProgress(0, list.length);
    const queue = [...list];
    const workers = Array.from({ length: Math.min(+els.concurrency.value || 1, queue.length) }, async () => {
      while (queue.length && !controller.signal.aborted) {
        const job = queue.shift();
        await processJob(job, controller.signal);
        updateProgress(++done, list.length);
        if (job.fatal && !controller.signal.aborted) {
          // Same error would hit every remaining scene: stop and explain once.
          controller.abort();
          alert(job.fatal.message);
        }
      }
    });
    await Promise.all(workers);
    queue.forEach((j) => setJobState(j, 'error', 'Detenido'));

    if (owner) {
      abort = null;
      els.generate.disabled = false;
      els.stop.hidden = true;
    }
    els.downloadAll.disabled = !jobs.some((j) => j.state === 'done');
  }

  function updateProgress(done, total) {
    els.progress.hidden = false;
    $('.bar', els.progress).style.width = total ? `${(done / total) * 100}%` : '0';
    $('.label', els.progress).textContent = `${done} / ${total}`;
  }

  function startAll() {
    const scenes = ScriptParser.parseScript(els.script.value);
    if (!scenes.length) { alert('No se detectó ningún timestamp en el guion.'); return; }
    jobs.forEach((j) => j.url && URL.revokeObjectURL(j.url));
    els.results.textContent = '';
    jobs = scenes.map((scene, i) => ({ index: i + 1, scene, cast: charactersFor(scene.text) }));
    jobs.forEach((j) => els.results.appendChild(makeCard(j)));
    els.downloadAll.disabled = true;
    runJobs(jobs);
  }

  async function downloadZip() {
    if (typeof JSZip === 'undefined') { alert('No se pudo cargar JSZip. Descarga las imágenes una a una.'); return; }
    const zip = new JSZip();
    const manifest = [];
    for (const j of jobs) {
      if (j.state === 'done') zip.file(j.filename, j.blob);
      manifest.push({
        index: j.index, timestamp: j.scene.timestamp, seconds: j.scene.seconds,
        endSeconds: j.scene.endSeconds ?? null, text: j.scene.text,
        characters: j.cast.map((c) => c.name), prompt: j.prompt || null,
        image: j.state === 'done' ? j.filename : null,
      });
    }
    zip.file('manifest.json', JSON.stringify(manifest, null, 2));
    const blob = await zip.generateAsync({ type: 'blob' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'imagenes_timestamps.zip';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  }

  async function loadModels() {
    if (!els.apiKey.value.trim()) { alert('Pega primero tu API key.'); return; }
    els.modelsStatus.textContent = 'Cargando…';
    try {
      const names = [];
      let pageToken = '';
      do {
        const data = await callApi(`models?pageSize=1000${pageToken ? `&pageToken=${pageToken}` : ''}`);
        (data.models || []).forEach((m) => names.push({ name: m.name.replace(/^models\//, ''), methods: m.supportedGenerationMethods || [] }));
        pageToken = data.nextPageToken || '';
      } while (pageToken);
      const image = names.filter((m) => /image/i.test(m.name) && (m.methods.includes('generateContent') || m.methods.includes('predict')));
      const text = names.filter((m) => /^gemini/i.test(m.name) && !/image|tts|embed|audio|live/i.test(m.name) && m.methods.includes('generateContent'));
      fillDatalist('#imageModels', image.map((m) => m.name));
      fillDatalist('#textModels', text.map((m) => m.name));
      els.modelsStatus.textContent = `${image.length} modelos de imagen, ${text.length} de texto. Borra el campo para ver la lista.`;
    } catch (err) {
      els.modelsStatus.textContent = 'Error: ' + err.message;
    }
  }

  function fillDatalist(sel, values) {
    const dl = $(sel);
    dl.textContent = '';
    values.forEach((v) => { const o = document.createElement('option'); o.value = v; dl.appendChild(o); });
  }

  // ---------- wiring ----------
  els.toggleKey.addEventListener('click', () => {
    const show = els.apiKey.type === 'password';
    els.apiKey.type = show ? 'text' : 'password';
    els.toggleKey.textContent = show ? 'Ocultar' : 'Mostrar';
  });
  els.rememberKey.addEventListener('change', () => {
    if (els.rememberKey.checked) store.set(KEY_KEY, els.apiKey.value.trim());
    else store.del(KEY_KEY);
  });
  els.addChar.addEventListener('click', () => {
    characters.push({ name: '', aliases: '', desc: '', always: characters.length === 0, refs: [] });
    renderCharacters(); save();
    const last = els.characters.lastElementChild;
    last && $('.cName', last).focus();
  });
  els.exportCfg.addEventListener('click', () => {
    const { script, ...cfg } = currentConfig();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(cfg, null, 2)], { type: 'application/json' }));
    a.download = 'canal_config.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  });
  els.importCfg.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try { applyConfig(JSON.parse(await file.text())); save(); } catch (err) { alert('Archivo no válido: ' + err.message); }
    e.target.value = '';
  });
  [els.apiKey, els.style, els.imageModel, els.textModel, els.script].forEach((el) => el.addEventListener('input', save));
  [els.aspect, els.concurrency, els.enhance, els.noText].forEach((el) => el.addEventListener('change', save));
  els.script.addEventListener('input', renderPreview);
  els.loadModels.addEventListener('click', loadModels);
  els.generate.addEventListener('click', startAll);
  els.stop.addEventListener('click', () => abort?.abort());
  els.downloadAll.addEventListener('click', downloadZip);

  // ---------- init ----------
  try { applyConfig(JSON.parse(store.get(CFG_KEY) || 'null')); } catch { /* ignore corrupt config */ }
  renderPresets();
  const savedKey = store.get(KEY_KEY);
  if (savedKey) { els.apiKey.value = savedKey; els.rememberKey.checked = true; }
  if (!characters.length) {
    characters = [{ name: '', aliases: '', desc: '', always: true, refs: [] }];
    renderCharacters();
  }
  renderPreview();
})();
