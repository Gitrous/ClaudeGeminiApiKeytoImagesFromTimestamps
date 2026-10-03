(() => {
  'use strict';

  const API = 'https://generativelanguage.googleapis.com/v1beta';
  const CFG_KEY = 'tsimg.config.v1';
  const KEY_KEY = 'tsimg.apikey';
  const EXTRA_KEYS_KEY = 'tsimg.keys';
  const PROVIDERS = ['pollinations', 'huggingface', 'gemini', 'local'];
  const DIRECTOR_CHUNK = 40;
  const MAX_REFS = 3;
  const CFG_VERSION = 5;
  const DEFAULT_POLL_MODEL = 'black-forest-labs/flux.1-schnell';
  const DEFAULT_IMAGE_MODEL = 'gemini-3.1-flash-image';
  // Director models, most free quota first (free tier, per Google's quotas:
  // 3.1 Flash-Lite ~500 req/day, 2.5 Flash-Lite and 2.5 Flash ~20 req/day).
  const TEXT_MODEL_FALLBACKS = ['gemini-3.1-flash-lite-preview', 'gemini-3.1-flash-lite', 'gemini-2.5-flash-lite', 'gemini-2.5-flash'];
  const DEFAULT_TEXT_MODEL = TEXT_MODEL_FALLBACKS[0];

  const $ = (sel, el = document) => el.querySelector(sel);
  const els = {
    apiKey: $('#apiKey'), toggleKey: $('#toggleKey'), rememberKey: $('#rememberKey'),
    imageModel: $('#imageModel'), textModel: $('#textModel'), aspect: $('#aspect'),
    concurrency: $('#concurrency'), enhance: $('#enhance'), noText: $('#noText'),
    loadModels: $('#loadModels'), modelsStatus: $('#modelsStatus'),
    providers: $('#providers'), pollKey: $('#pollKey'), pollModel: $('#pollModel'),
    hfKey: $('#hfKey'), hfModel: $('#hfModel'), localUrl: $('#localUrl'),
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
  let provider = 'pollinations';
  let abort = null;

  // ---------- storage ----------
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); return true; } catch { return false; } },
    del(k) { try { localStorage.removeItem(k); } catch { /* ignore */ } },
  };

  function currentConfig() {
    return {
      v: CFG_VERSION,
      provider,
      pollModel: els.pollModel.value.trim(),
      hfModel: els.hfModel.value.trim(),
      localUrl: els.localUrl.value.trim(),
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
    // v1 configs saved the old default model; move them to the new default.
    const oldDefault = !(cfg.v >= 2) && cfg.imageModel === 'gemini-2.5-flash-image';
    els.imageModel.value = cfg.imageModel && !oldDefault ? cfg.imageModel : DEFAULT_IMAGE_MODEL;
    // Before v5 the default director was gemini-2.5-flash (only ~20 free requests/day).
    const oldTextDefault = !(cfg.v >= 5) && cfg.textModel === 'gemini-2.5-flash';
    els.textModel.value = cfg.textModel && !oldTextDefault ? cfg.textModel : DEFAULT_TEXT_MODEL;
    provider = PROVIDERS.includes(cfg.provider) ? cfg.provider : 'pollinations';
    // v3 configs saved the old default alias 'flux'; move them to the new default.
    const oldPollDefault = !(cfg.v >= 4) && cfg.pollModel === 'flux';
    els.pollModel.value = cfg.pollModel && !oldPollDefault ? cfg.pollModel : DEFAULT_POLL_MODEL;
    if (cfg.hfModel) els.hfModel.value = cfg.hfModel;
    if (cfg.localUrl != null) els.localUrl.value = cfg.localUrl;
    renderProvider();
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
      if (els.rememberKey.checked) saveKeys();
    }, 300);
  }

  function saveKeys() {
    store.set(KEY_KEY, els.apiKey.value.trim());
    store.set(EXTRA_KEYS_KEY, JSON.stringify({ pollinations: els.pollKey.value.trim(), huggingface: els.hfKey.value.trim() }));
  }

  // ---------- provider ----------
  function renderProvider() {
    els.providers.querySelectorAll('.provider').forEach((b) => {
      const on = b.dataset.provider === provider;
      b.classList.toggle('active', on);
      b.setAttribute('aria-checked', String(on));
    });
    document.querySelectorAll('.pBlock').forEach((el) => { el.hidden = el.dataset.for !== provider; });
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
  async function callApi(path, body, signal, { retry = true } = {}) {
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
          (/image/i.test(model)
            ? 'Google solo permite generar imágenes por API con la facturación activada: ' +
              'actívala en https://aistudio.google.com/apikey (Set up billing) o usa una key de un proyecto con facturación.'
            : 'Prueba con otro modelo de texto.'));
        err.fatal = true;
        err.status = res.status;
        throw err;
      }
      const retryable = res.status === 429 || res.status >= 500;
      if (retry && retryable && attempt < 3) {
        const hinted = parseFloat((msg.match(/retry in ([\d.]+)s/i) || [])[1]);
        const wait = hinted ? Math.min(hinted * 1000 + 500, 65000) : 2000 * 2 ** attempt;
        await sleep(wait, signal);
        continue;
      }
      const err = new Error(msg);
      err.status = res.status;
      throw err;
    }
  }

  // Calls the director model; if it is out of free quota or does not exist,
  // tries the next model in TEXT_MODEL_FALLBACKS and remembers the one that worked.
  async function generateText(body, signal) {
    const chosen = els.textModel.value.trim() || DEFAULT_TEXT_MODEL;
    const models = [...new Set([chosen, ...TEXT_MODEL_FALLBACKS])];
    let lastErr;
    for (const [i, model] of models.entries()) {
      try {
        const last = i === models.length - 1;
        const data = await callApi(`${modelPath(model)}:generateContent`, body, signal, { retry: last });
        if (model !== chosen) { els.textModel.value = model; save(); }
        return data;
      } catch (err) {
        if (err.name === 'AbortError') throw err;
        lastErr = err;
        // Quota exhausted (429) or unknown model (404/400 "not found"): try the next one.
        const skippable = err.status === 429 || err.status === 404 || (err.status === 400 && /not found|not supported/i.test(err.message));
        if (!skippable) throw err;
      }
    }
    throw lastErr;
  }

  function sleep(ms, signal) {
    return new Promise((resolve, reject) => {
      const t = setTimeout(resolve, ms);
      signal?.addEventListener('abort', () => { clearTimeout(t); reject(new DOMException('Aborted', 'AbortError')); }, { once: true });
    });
  }

  const modelPath = (m) => (m.startsWith('models/') ? m : `models/${m}`);

  // Spaces out requests to services with per-IP limits (e.g. anonymous Pollinations).
  let nextSlot = 0;
  async function throttle(ms, signal, onWait) {
    const now = Date.now();
    const wait = Math.max(0, nextSlot - now);
    nextSlot = Math.max(now, nextSlot) + ms;
    if (wait) { onWait?.(wait); await sleep(wait, signal); }
  }

  const SIZES = {
    '9:16': [768, 1344], '16:9': [1344, 768], '1:1': [1024, 1024],
    '4:5': [896, 1120], '3:4': [864, 1152], '4:3': [1152, 864],
  };

  // ---------- Gemini as director: reads the whole script, writes every prompt ----------
  const castLine = (c) => `- ${c.name || 'Character'}${c.aliases.trim() ? ` (alias: ${c.aliases.trim()})` : ''}${c.always ? ' [appears in every scene]' : ''}: ${c.desc}`;

  async function directPrompts(scenes, signal) {
    const cast = characters.filter((c) => c.name.trim() || c.desc.trim());
    const fullScript = scenes.map((s, i) => `#${i + 1} [${s.timestamp}] ${s.text}`).join('\n');
    const external = provider !== 'gemini';
    const system = [
      'You are the art director of a video channel. You receive a full video script split by timestamps.',
      'Read the WHOLE script first to understand the story, then write one image prompt for EACH numbered scene.',
      'Rules:',
      '- Write prompts in English, 50-110 words each, concrete and visual: subject, action, setting, camera framing, lighting, mood.',
      '- Each image is generated independently by a model with NO memory of other images, so every prompt must be self-contained:',
      '  whenever a character appears, repeat its full fixed visual description exactly; describe recurring locations the same way every time.',
      '- Keep continuity across scenes (same outfits, same places, consistent story progression). Use context from surrounding scenes to decide what to show when a line is abstract.',
      '- Characters marked [appears in every scene] must appear in every prompt. Other characters appear only when the scene involves them.',
      `- Composition for aspect ratio ${els.aspect.value}${els.aspect.value === '9:16' ? ' (vertical, subject centered, readable on a phone)' : ''}.`,
      styleText() ? `- End every prompt with this visual style: ${styleText()}.` : '',
      els.noText.checked ? '- Never ask for text, captions, letters or watermarks in the image.' : '',
      external ? '- The image model is a diffusion model (FLUX-like): prefer clear descriptive phrases over instructions; put the most important subject first.' : '',
      provider === 'local' ? '- HARD LIMIT: keep each prompt under 55 words; this model only reads about 75 tokens.' : '',
      cast.length ? 'Fixed characters of the channel:\n' + cast.map(castLine).join('\n') : 'There are no fixed characters.',
      'Return JSON: an array with one object per scene: {"index": scene number, "characters": [names of fixed characters in the image], "prompt": "..."}.',
    ].filter(Boolean).join('\n');

    const out = new Map();
    for (let from = 0; from < scenes.length; from += DIRECTOR_CHUNK) {
      const to = Math.min(scenes.length, from + DIRECTOR_CHUNK);
      const ask = scenes.length > DIRECTOR_CHUNK
        ? `FULL SCRIPT (for context):\n${fullScript}\n\nWrite prompts ONLY for scenes #${from + 1} to #${to}.`
        : `FULL SCRIPT:\n${fullScript}`;
      const data = await generateText({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: [{ text: ask }] }],
        generationConfig: {
          temperature: 0.8,
          responseMimeType: 'application/json',
          responseSchema: {
            type: 'ARRAY',
            items: {
              type: 'OBJECT',
              properties: {
                index: { type: 'INTEGER' },
                characters: { type: 'ARRAY', items: { type: 'STRING' } },
                prompt: { type: 'STRING' },
              },
              required: ['index', 'prompt'],
            },
          },
        },
      }, signal);
      const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '[]';
      for (const item of JSON.parse(text)) {
        if (item && Number.isInteger(item.index) && item.prompt) out.set(item.index, item);
      }
    }
    return out;
  }

  function castFromNames(names, fallback) {
    if (!Array.isArray(names)) return fallback;
    const wanted = names.map((n) => norm(String(n)));
    const picked = characters.filter((c) => c.always || (c.name.trim() && wanted.includes(norm(c.name.trim()))));
    return picked.length || !fallback.length ? picked : fallback;
  }

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

    const data = await generateText({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: sceneText }] }],
      generationConfig: { temperature: 0.9 },
    }, signal);
    const out = data.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('').trim();
    if (!out) throw new Error('El modelo de texto no devolvió prompt');
    return out;
  }

  function buildPrompt(base, cast, { raw }) {
    if (provider !== 'gemini') {
      // Diffusion models do best with one compact descriptive paragraph.
      if (!raw) return base;
      return [
        base,
        ...cast.map((c) => c.desc),
        styleText(),
        els.noText.checked ? 'no text, no watermark' : '',
      ].filter(Boolean).join(', ');
    }
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

  function b64ToBlob(data, mimeType) {
    return new Blob([Uint8Array.from(atob(data), (ch) => ch.charCodeAt(0))], { type: mimeType });
  }

  function fatal(message) {
    const err = new Error(message);
    err.fatal = true;
    return err;
  }

  async function responseError(res) {
    let msg = `HTTP ${res.status}`;
    try {
      const t = await res.text();
      try { const j = JSON.parse(t); msg = j.error?.message || j.error || j.detail || j.message || t || msg; } catch { msg = t || msg; }
    } catch { /* keep status */ }
    return typeof msg === 'string' ? msg.slice(0, 300) : JSON.stringify(msg).slice(0, 300);
  }

  async function asImage(res) {
    const blob = await res.blob();
    if (!blob.type.startsWith('image/')) throw new Error('El servicio no devolvió una imagen');
    return blob;
  }

  // Public catalogue of Pollinations image models; `paid` ones need purchased pollen.
  let pollCatalog = null;
  async function pollinationsModels() {
    if (pollCatalog) return pollCatalog;
    const res = await fetch('https://gen.pollinations.ai/image/models');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const list = Array.isArray(data) ? data : data.data || data.models || [];
    pollCatalog = list.map((m) => (typeof m === 'string'
      ? { name: m, aliases: [], paid: false }
      : { name: m.name || m.id, aliases: m.aliases || [], paid: !!(m.paid_only ?? m.paidOnly) }))
      .filter((m) => m.name);
    return pollCatalog;
  }

  function fillPollModels(catalog) {
    const dl = $('#pollModels');
    dl.textContent = '';
    [...catalog.filter((m) => !m.paid), ...catalog.filter((m) => m.paid)].forEach((m) => {
      const o = document.createElement('option');
      o.value = m.name;
      o.textContent = m.paid ? 'de pago (pollen comprado)' : 'vale con pollen gratuito';
      dl.appendChild(o);
    });
  }

  async function explainPoll402(model, key, serverMsg) {
    const lines = [`Pollinations respondió "sin saldo" (402): ${serverMsg}`];
    try {
      const catalog = await pollinationsModels();
      fillPollModels(catalog);
      const m = catalog.find((x) => x.name === model || x.aliases.includes(model));
      if (m?.paid) lines.push(`El modelo "${model}" es de pago: solo funciona con pollen comprado, no con el gratuito.`);
      const free = catalog.filter((x) => !x.paid).map((x) => x.name);
      if (free.length) lines.push(`Modelos que valen con pollen gratuito: ${free.slice(0, 6).join(', ')}.`);
    } catch { /* catalogue unavailable: keep the generic advice */ }
    if (key.startsWith('pk_')) {
      lines.push('Tu key es "pk_" (antigua): Pollinations la limita a 1 pollen por hora. Crea una "Secret key" (sk_) en enter.pollinations.ai.');
    }
    lines.push('Revisa también en enter.pollinations.ai que la key no tenga un presupuesto (budget) agotado o a 0.');
    return fatal(lines.join('\n\n'));
  }

  async function pollinationsImage(prompt, signal, onStatus) {
    const key = els.pollKey.value.trim();
    const [width, height] = SIZES[els.aspect.value] || SIZES['1:1'];
    const seed = Math.floor(Math.random() * 2 ** 31);
    const text = encodeURIComponent(prompt.replace(/\s+/g, ' ').slice(0, 1800));
    const model = els.pollModel.value.trim() || DEFAULT_POLL_MODEL;
    const q = new URLSearchParams({ model, width, height, seed, nologo: 'true' });
    const secret = key.startsWith('sk_');
    // Secret keys go in the Authorization header; publishable keys in ?key=.
    const tries = [];
    if (!key) {
      tries.push({ url: `https://gen.pollinations.ai/image/${text}?${q}` });
      // Legacy anonymous endpoint, used when the new one asks for a key.
      tries.push({ url: `https://image.pollinations.ai/prompt/${text}?${new URLSearchParams({ model: 'flux', width, height, seed, nologo: 'true' })}` });
    } else if (secret) {
      tries.push({ url: `https://gen.pollinations.ai/image/${text}?${q}`, headers: { Authorization: `Bearer ${key}` } });
    } else {
      q.set('key', key);
      tries.push({ url: `https://gen.pollinations.ai/image/${text}?${q}` });
    }
    for (let attempt = 0; ; attempt++) {
      await throttle(key ? 1000 : 16000, signal, (ms) => onStatus(`Esperando turno gratuito (${Math.ceil(ms / 1000)} s)…`));
      onStatus('Generando imagen…');
      let lastStatus = 0; let lastMsg = '';
      for (const t of tries) {
        let res;
        try {
          res = await fetch(t.url, { signal, headers: t.headers });
        } catch (err) {
          if (err.name === 'AbortError' || !t.headers) throw err;
          // Header blocked (CORS): fall back to the query-string key.
          const u = new URL(t.url); u.searchParams.set('key', key);
          res = await fetch(u, { signal });
        }
        if (res.ok) return asImage(res);
        lastStatus = res.status; lastMsg = await responseError(res);
        if (![401, 402, 403].includes(res.status)) break;
      }
      if (lastStatus === 402 && key) throw await explainPoll402(model, key, lastMsg);
      if ([401, 402, 403].includes(lastStatus)) {
        throw fatal(key
          ? `Pollinations rechazó tu key: ${lastMsg}\n\nRevisa que esté bien copiada.`
          : 'Pollinations pide una key gratuita: créala en https://enter.pollinations.ai y pégala en "Key de Pollinations".');
      }
      if ((lastStatus === 429 || lastStatus >= 500) && attempt < 3) {
        await sleep(15000 * (attempt + 1), signal);
        continue;
      }
      throw new Error(`Pollinations: ${lastMsg}`);
    }
  }

  async function huggingfaceImage(prompt, signal, onStatus) {
    const token = els.hfKey.value.trim();
    if (!token) throw fatal('Pega tu token de Hugging Face (https://huggingface.co/settings/tokens).');
    const model = els.hfModel.value.trim() || 'black-forest-labs/FLUX.1-schnell';
    const [width, height] = SIZES[els.aspect.value] || SIZES['1:1'];
    for (let attempt = 0; ; attempt++) {
      onStatus('Generando imagen…');
      const res = await fetch(`https://router.huggingface.co/hf-inference/models/${model}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'image/png' },
        body: JSON.stringify({ inputs: prompt, parameters: { width, height } }),
        signal,
      });
      if (res.ok) return asImage(res);
      const msg = await responseError(res);
      if (res.status === 401 || res.status === 403) throw fatal(`Hugging Face rechazó tu token (${msg}). Necesita permiso de Inference.`);
      if (res.status === 402) throw fatal('Se acabaron los créditos gratuitos de Hugging Face de este mes. Prueba con Pollinations.');
      if ((res.status === 429 || res.status === 503 || res.status >= 500) && attempt < 3) {
        onStatus('El modelo se está cargando, reintentando…');
        await sleep(10000 * (attempt + 1), signal);
        continue;
      }
      throw new Error(`Hugging Face: ${msg}`);
    }
  }

  // ---------- local Stable Diffusion (local-sd/app.py) ----------
  const LOCAL_SIZES = {
    '9:16': [512, 896], '16:9': [896, 512], '1:1': [512, 512],
    '4:5': [512, 640], '3:4': [512, 680], '4:3': [680, 512],
  };

  function localBase() {
    const custom = els.localUrl.value.trim().replace(/\/+$/, '').replace(/\/sd(\/generate)?$/, '');
    if (custom) return custom;
    // Served by local-sd itself (Codespaces port 7860 or localhost): same origin.
    if (location.protocol.startsWith('http') && !location.hostname.endsWith('github.io') && location.port !== '8000') return location.origin;
    return 'http://localhost:7860';
  }

  const localHelp = (base) => `No se encontró el servidor de Stable Diffusion en ${base}.\n\n` +
    'Arráncalo con: bash local-sd/start.sh\n' +
    'y abre la web desde el puerto 7860 (en Codespaces: pestaña Ports → 7860), no desde el 8000.';

  async function localImage(prompt, signal, onStatus) {
    const base = localBase();
    const [width, height] = LOCAL_SIZES[els.aspect.value] || LOCAL_SIZES['1:1'];
    const seed = Math.floor(Math.random() * 2 ** 31);
    for (let attempt = 0; ; attempt++) {
      onStatus('Generando en tu servidor local…');
      let res;
      try {
        res = await fetch(`${base}/sd/generate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt, width, height, seed }),
          signal,
        });
      } catch (err) {
        if (err.name === 'AbortError') throw err;
        throw fatal(localHelp(base));
      }
      if (res.ok) return asImage(res);
      if (res.status === 503 && attempt < 90) {
        onStatus('El modelo se está descargando o cargando (solo la primera vez)…');
        await sleep(10000, signal);
        continue;
      }
      if ([404, 405, 501].includes(res.status)) throw fatal(localHelp(base));
      const msg = await responseError(res);
      if (res.status === 500 && /cargar el modelo/.test(msg)) throw fatal(msg);
      throw new Error(`Servidor local: ${msg}`);
    }
  }

  async function generateImage(prompt, cast, signal, onStatus = () => {}) {
    if (provider === 'pollinations') return pollinationsImage(prompt, signal, onStatus);
    if (provider === 'huggingface') return huggingfaceImage(prompt, signal, onStatus);
    if (provider === 'local') return localImage(prompt, signal, onStatus);
    onStatus('Generando imagen…');
    const img = await geminiImage(prompt, cast, signal);
    return b64ToBlob(img.data, img.mimeType);
  }

  async function geminiImage(prompt, cast, signal) {
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
    $('.regen', node).addEventListener('click', () => {
      const edited = $('.prompt', node).value.trim();
      job.override = edited && edited !== job.prompt ? edited : job.override || null;
      job.retried = true;
      runJobs([job], { single: true });
    });
    job.el = node;
    renderWho(job);
    return node;
  }

  function renderWho(job) {
    $('.who', job.el).textContent = job.cast.length ? 'Personajes: ' + job.cast.map((c) => c.name).join(', ') : '';
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
    if (job.prompt) $('.prompt', job.el).value = job.override || job.prompt;
  }

  const useDirector = () => els.enhance.checked && !!els.apiKey.value.trim();

  async function processJob(job, signal) {
    job.fatal = null;
    const status = (msg) => setJobState(job, 'working', msg);
    try {
      let prompt = job.override;
      if (!prompt) {
        if (!job.base && useDirector() && job.retried) {
          // Regenerating a scene the director never covered: ask for just this one.
          status('Gemini escribe el prompt…');
          try { job.base = await enhancePrompt(job.scene.text, job.cast, signal); } catch (err) { if (err.name === 'AbortError') throw err; }
        }
        prompt = buildPrompt(job.base || job.scene.text, job.cast, { raw: !job.base });
      }
      job.prompt = prompt;
      status('Generando imagen…');
      const blob = await generateImage(prompt, job.cast, signal, status);
      if (job.url) URL.revokeObjectURL(job.url);
      job.blob = blob;
      job.url = URL.createObjectURL(blob);
      const ext = blob.type.includes('jpeg') ? 'jpg' : blob.type.split('/')[1] || 'png';
      job.filename = `${String(job.index).padStart(2, '0')}_${job.scene.timestamp.replace(/:/g, '-')}.${ext}`;
      setJobState(job, 'done');
    } catch (err) {
      if (err.fatal) job.fatal = err;
      if (err.name === 'AbortError') setJobState(job, 'error', 'Detenido');
      else setJobState(job, 'error', 'Error: ' + err.message);
    }
  }

  function checkKeys() {
    if (provider === 'gemini' && !els.apiKey.value.trim()) return ['Pega tu API key de Gemini para usar Nano Banana.', els.apiKey];
    if (provider === 'huggingface' && !els.hfKey.value.trim()) return ['Pega tu token de Hugging Face.', els.hfKey];
    return null;
  }

  async function runJobs(list, { single = false, direct = false } = {}) {
    const missing = checkKeys();
    if (missing) { alert(missing[0]); missing[1].focus(); return; }
    if (abort && !single) return;
    const controller = single && abort ? abort : new AbortController();
    const owner = !abort;
    if (owner) {
      abort = controller;
      els.generate.disabled = true;
      els.stop.hidden = false;
    }

    list.forEach((j) => setJobState(j, 'queued', 'En cola'));
    if (direct && useDirector()) {
      updateProgress(0, list.length, 'Gemini está leyendo el guion completo…');
      try {
        const plan = await directPrompts(list.map((j) => j.scene), controller.signal);
        list.forEach((j) => {
          const item = plan.get(j.index);
          if (!item) return;
          j.base = item.prompt;
          j.cast = castFromNames(item.characters, j.cast);
          renderWho(j);
        });
      } catch (err) {
        if (err.name !== 'AbortError') {
          alert(`Gemini no pudo escribir los prompts (${err.message}).\nSe usará directamente el texto de cada escena.`);
        }
      }
    }

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

  function updateProgress(done, total, label) {
    els.progress.hidden = false;
    $('.bar', els.progress).style.width = total ? `${(done / total) * 100}%` : '0';
    $('.label', els.progress).textContent = label || `${done} / ${total}`;
  }

  function startAll() {
    const scenes = ScriptParser.parseScript(els.script.value);
    if (!scenes.length) { alert('No se detectó ningún timestamp en el guion.'); return; }
    jobs.forEach((j) => j.url && URL.revokeObjectURL(j.url));
    els.results.textContent = '';
    jobs = scenes.map((scene, i) => ({ index: i + 1, scene, cast: charactersFor(scene.text) }));
    jobs.forEach((j) => els.results.appendChild(makeCard(j)));
    els.downloadAll.disabled = true;
    runJobs(jobs, { direct: true });
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
        characters: j.cast.map((c) => c.name), prompt: j.prompt || null, provider,
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
    if (els.rememberKey.checked) saveKeys();
    else { store.del(KEY_KEY); store.del(EXTRA_KEYS_KEY); }
  });
  els.providers.addEventListener('click', (e) => {
    const b = e.target.closest('.provider');
    if (!b) return;
    provider = b.dataset.provider;
    renderProvider(); save();
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
  [els.apiKey, els.pollKey, els.hfKey, els.pollModel, els.hfModel, els.localUrl, els.style, els.imageModel, els.textModel, els.script].forEach((el) => el.addEventListener('input', save));
  [els.aspect, els.concurrency, els.enhance, els.noText].forEach((el) => el.addEventListener('change', save));
  els.script.addEventListener('input', renderPreview);
  els.loadModels.addEventListener('click', loadModels);
  $('#localCheck').addEventListener('click', async () => {
    const st = $('#localStatus');
    const base = localBase();
    st.textContent = `Comprobando ${base}…`;
    try {
      const res = await fetch(`${base}/sd/health`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const h = await res.json();
      st.textContent = h.error ? `Error al cargar ${h.model}: ${h.error}`
        : h.ready ? `✔ Listo: ${h.model} en ${h.device === 'cuda' ? 'GPU' : 'CPU'}`
          : `Conectado. Descargando/cargando ${h.model}… vuelve a comprobar en un rato.`;
    } catch {
      st.textContent = `No responde en ${base}. Arráncalo con: bash local-sd/start.sh`;
    }
  });
  $('#pollLoad').addEventListener('click', async () => {
    const st = $('#pollStatus');
    st.textContent = 'Cargando…';
    try {
      const catalog = await pollinationsModels();
      fillPollModels(catalog);
      const free = catalog.filter((m) => !m.paid).length;
      st.textContent = `${catalog.length} modelos (${free} valen con pollen gratuito). Borra el campo Modelo para ver la lista.`;
    } catch (err) {
      st.textContent = 'No se pudo cargar la lista: ' + err.message;
    }
  });
  els.generate.addEventListener('click', startAll);
  els.stop.addEventListener('click', () => abort?.abort());
  els.downloadAll.addEventListener('click', downloadZip);

  // ---------- init ----------
  try { applyConfig(JSON.parse(store.get(CFG_KEY) || 'null')); } catch { /* ignore corrupt config */ }
  renderPresets();
  const savedKey = store.get(KEY_KEY);
  if (savedKey) { els.apiKey.value = savedKey; els.rememberKey.checked = true; }
  try {
    const extra = JSON.parse(store.get(EXTRA_KEYS_KEY) || 'null');
    if (extra) {
      els.pollKey.value = extra.pollinations || '';
      els.hfKey.value = extra.huggingface || '';
      els.rememberKey.checked = true;
    }
  } catch { /* ignore */ }
  renderProvider();
  if (!characters.length) {
    characters = [{ name: '', aliases: '', desc: '', always: true, refs: [] }];
    renderCharacters();
  }
  renderPreview();
})();
