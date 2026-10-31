/* Transport-only adapter. Original Godot JS, WASM and PCK bytes are unchanged. */
(function (scope) {
  'use strict';
  function createChunkFetch(nativeFetch, manifest, baseURI, onError) {
    const base = new URL('./', baseURI), entries = new Map();
    for (const [name, item] of Object.entries(manifest)) {
      if (!/^index\.(wasm|pck)$/.test(name) || !Number.isSafeInteger(item.bytes) || item.bytes <= 0 || !Array.isArray(item.parts) || !item.parts.length) throw new Error('Invalid game transport manifest');
      let total = 0;
      for (const part of item.parts) {
        if (!/^[a-zA-Z0-9_.-]+\.part$/.test(part.file) || !Number.isSafeInteger(part.bytes) || part.bytes <= 0 || part.bytes > 20*1024*1024 || !/^[a-f0-9]{64}$/.test(part.sha256)) throw new Error('Invalid game transport part');
        total += part.bytes;
      }
      if (total !== item.bytes) throw new Error('Invalid game transport total');
      entries.set(new URL(name, base).href, item);
    }
    return function chunkFetch(input, init) {
      let url;
      try { url = new URL(input instanceof Request ? input.url : String(input), baseURI); } catch (_) { return nativeFetch(input, init); }
      const request = input instanceof Request ? input : null;
      const method = String(init?.method || request?.method || 'GET').toUpperCase();
      const headers = new Headers(init?.headers || request?.headers);
      const item = entries.get(url.href);
      if (!item || method !== 'GET' || headers.has('range')) return nativeFetch(input, init);
      const abort = new AbortController(), signal = init?.signal || request?.signal;
      if (signal?.aborted) return Promise.reject(signal.reason || new DOMException('Aborted','AbortError'));
      const relay = () => abort.abort(signal.reason);
      signal?.addEventListener('abort', relay, {once:true});
      let next = 0, failed = false;
      const cleanup = () => signal?.removeEventListener('abort', relay);
      const body = new ReadableStream({
        async pull(controller) {
          try {
            if (abort.signal.aborted) throw abort.signal.reason || new DOMException('Aborted','AbortError');
            const part = item.parts[next];
            const response = await nativeFetch(new URL(part.file,base).href, {method:'GET', credentials:'same-origin', redirect:'error', signal:abort.signal});
            if (response.status !== 200) throw new Error(`HTTP ${response.status} for part ${next + 1}`);
            const bytes = await response.arrayBuffer();
            if (bytes.byteLength !== part.bytes) throw new Error(`Size mismatch for part ${next + 1}`);
            const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)), b=>b.toString(16).padStart(2,'0')).join('');
            if (digest !== part.sha256) throw new Error(`SHA-256 mismatch for part ${next + 1}`);
            if (abort.signal.aborted) throw abort.signal.reason || new DOMException('Aborted','AbortError');
            controller.enqueue(new Uint8Array(bytes)); next++;
            if (next === item.parts.length) { cleanup(); controller.close(); }
          } catch (error) {
            cleanup(); abort.abort();
            if (!failed) { failed = true; try { onError?.(new Error(`Game download failed (${url.pathname}): ${error.message || error}`)); } catch (_) {} }
            controller.error(error);
          }
        },
        cancel(reason) { cleanup(); abort.abort(reason); }
      });
      return Promise.resolve(new Response(body, {status:200, headers:{'Content-Type':item.mime,'Content-Length':String(item.bytes)}}));
    };
  }
  function report(error) {
    console.error(error);
    // Godot's progress wrapper does not propagate a rejected reader.read().
    // Show a visible fatal transport error instead of leaving a misleading spinner.
    const notice = document.getElementById('status-notice'), status = document.getElementById('status'), progress = document.getElementById('status-progress');
    if (status) { status.style.display='flex'; status.style.visibility='visible'; }
    if (notice) { notice.style.display='block'; notice.textContent='游戏下载失败，请刷新重试。存档不会因此清除。\n'+error.message; }
    if (progress) progress.style.display='none';
  }
  if (typeof module !== 'undefined' && module.exports) module.exports={createChunkFetch};
  else scope.fetch=createChunkFetch(scope.fetch.bind(scope),scope.GODOT_CHUNK_MANIFEST,document.baseURI,report);
})(globalThis);
