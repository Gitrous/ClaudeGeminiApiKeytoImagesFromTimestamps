/**
 * Split a script into scenes, one per timestamp.
 *
 * Accepts timestamps anywhere in the text: "00:05", "1:02:03", "[00:05]",
 * "(0:05)", SRT style "00:00:01,000 --> 00:00:04,000" and ranges like
 * "0:00 - 0:05" (the second timestamp is treated as the end of the range,
 * not as a new scene).
 */
(function (root) {
  const TS_RE = /[\[(]?\b(?:(\d{1,2}):)?(\d{1,2}):(\d{2})(?:[.,]\d{1,3})?\b[\])]?/g;
  const RANGE_SEP_RE = /^[ \t]*(?:-{1,2}>|-|–|—|to|a|al|hasta)[ \t]*$/i;

  function toSeconds(h, m, s) {
    return (parseInt(h || '0', 10) * 3600) + parseInt(m, 10) * 60 + parseInt(s, 10);
  }

  function formatTs(sec) {
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    const pad = (n) => String(n).padStart(2, '0');
    return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
  }

  function cleanText(text) {
    return text
      .replace(/\n\s*\d+\s*$/, '')        // trailing SRT cue index
      .replace(/^[\s\-–—:|>.,]+/, '')      // leading separators
      .replace(/\s+/g, ' ')
      .trim();
  }

  function parseScript(input) {
    const text = String(input || '').replace(/\r\n?/g, '\n');
    const matches = [];
    let m;
    TS_RE.lastIndex = 0;
    while ((m = TS_RE.exec(text)) !== null) {
      if (parseInt(m[3], 10) > 59 || (m[1] !== undefined && parseInt(m[2], 10) > 59)) continue;
      matches.push({ start: m.index, end: m.index + m[0].length, seconds: toSeconds(m[1], m[2], m[3]) });
    }

    // Merge "start - end" ranges into a single marker.
    const markers = [];
    for (const cur of matches) {
      const prev = markers[markers.length - 1];
      if (prev && prev.endSeconds === undefined && RANGE_SEP_RE.test(text.slice(prev.end, cur.start))) {
        prev.end = cur.end;
        prev.endSeconds = cur.seconds;
        continue;
      }
      markers.push({ ...cur });
    }

    const scenes = [];
    markers.forEach((mk, i) => {
      const next = markers[i + 1];
      const body = cleanText(text.slice(mk.end, next ? next.start : text.length));
      if (!body) return;
      scenes.push({
        seconds: mk.seconds,
        endSeconds: mk.endSeconds,
        timestamp: formatTs(mk.seconds),
        text: body,
      });
    });
    return scenes;
  }

  const api = { parseScript, formatTs };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ScriptParser = api;
})(typeof window !== 'undefined' ? window : globalThis);
