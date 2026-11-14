// IndexedDB persistence: song library (audio blobs), per-song metadata
// (BPM/phase/custom chart), global settings (difficulty/pad mapping/sync
// offset), and per-song-per-difficulty high scores.
(function () {
  "use strict";

  const DB_NAME = "stepfive_db", STORE = "kv";

  function idbOpen() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => { req.result.createObjectStore(STORE); };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  async function idbSet(key, value) {
    const db = await idbOpen();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }
  async function idbGet(key) {
    const db = await idbOpen();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  async function idbDelete(key) {
    const db = await idbOpen();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async function getSongIndex() {
    try { return (await idbGet("songIndex")) || []; } catch (err) { return []; }
  }
  async function setSongIndex(list) {
    try { await idbSet("songIndex", list); } catch (err) { console.warn("index save failed", err); }
  }

  async function addSongToLibrary(file) {
    // ask the browser not to evict the library when disk runs low (granted
    // silently in Chromium for sites in use; asked here, on a user action,
    // so browsers that prompt don't do it on page load)
    try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) { /* ignore */ }
    const id = "s" + Date.now() + Math.random().toString(36).slice(2, 7);
    try {
      await idbSet("song:" + id, { blob: file, name: file.name });
      const index = await getSongIndex();
      index.push({ id, name: file.name, addedAt: Date.now() });
      await setSongIndex(index);
      await idbSet("lastSelectedId", id);
    } catch (err) { console.warn("song save failed", err); }
    return id;
  }

  async function persistGlobalSettings() {
    const s = SF.state;
    try {
      await idbSet("settings", { difficulty: s.difficulty, mapping: s.mapping, syncOffsetMs: s.syncOffsetMs });
    } catch (err) { console.warn("settings save failed", err); }
  }

  async function loadGlobalSettings() {
    try { return await idbGet("settings"); } catch (err) { return null; }
  }

  async function persistSongMeta() {
    const s = SF.state;
    if (!s.currentSongId) return;
    try {
      await idbSet("songMeta:" + s.currentSongId, {
        bpm: parseInt(SF.$("bpmInput").value, 10) || 120,
        phaseOffsetMs: s.phaseOffsetMs,
        useCustomChart: s.useCustomChart,
        customChart: s.customChart,
        analyzed: !!s.songAnalyzed,
      });
    } catch (err) { console.warn("song meta save failed", err); }
  }

  async function getSongMeta(id) {
    try { return await idbGet("songMeta:" + id); } catch (err) { return null; }
  }

  async function deleteSongRecord(id) {
    await idbDelete("song:" + id);
    await idbDelete("songMeta:" + id);
    await idbDelete("scores:" + id);
  }

  // -- high scores: keyed per song, one best entry per difficulty --
  async function getHighScores(songId) {
    if (!songId) return {};
    try { return (await idbGet("scores:" + songId)) || {}; } catch (err) { return {}; }
  }

  // returns {isNewBest, best} where `best` is the stored (possibly unchanged) entry
  async function reportScore(songId, difficulty, entry) {
    if (!songId) return { isNewBest: false, best: entry };
    const scores = await getHighScores(songId);
    const prev = scores[difficulty];
    const isNewBest = !prev || entry.score > prev.score;
    if (isNewBest) {
      scores[difficulty] = entry;
      try { await idbSet("scores:" + songId, scores); } catch (err) { console.warn("score save failed", err); }
    }
    return { isNewBest, best: scores[difficulty] };
  }

  // records are only comparable on the same chart: when the generator's
  // output changes (SF.CHART_VERSION), every stored best is cleared once.
  // Returns true if any records were actually deleted.
  async function resetScoresIfChartChanged() {
    const stored = await idbGet("chartVersion");
    if (stored === SF.CHART_VERSION) return false;
    let cleared = false;
    for (const s of await getSongIndex()) {
      if (await idbGet("scores:" + s.id)) { await idbDelete("scores:" + s.id); cleared = true; }
    }
    await idbSet("chartVersion", SF.CHART_VERSION);
    return cleared;
  }

  async function migrateLegacySingleSong() {
    // migrate the old single-song scheme (from an earlier version) into the library, once
    try {
      const legacySong = await idbGet("song");
      if (legacySong && legacySong.blob) {
        const legacyChart = await idbGet("chart");
        const legacySettings = await idbGet("settings");
        const id = await addSongToLibrary(
          legacySong.blob.name ? legacySong.blob : new File([legacySong.blob], legacySong.name || "song")
        );
        await idbSet("songMeta:" + id, {
          bpm: (legacySettings && legacySettings.bpm) || 120,
          phaseOffsetMs: (legacySettings && legacySettings.phaseOffsetMs) || 0,
          useCustomChart: !!(legacyChart && legacyChart.useCustomChart),
          customChart: (legacyChart && legacyChart.customChart) || null,
        });
        await idbDelete("song");
        await idbDelete("chart");
      }
    } catch (err) { /* nothing to migrate */ }
  }

  SF.storage = {
    idbGet, idbSet, idbDelete,
    getSongIndex, setSongIndex, addSongToLibrary,
    persistGlobalSettings, loadGlobalSettings,
    persistSongMeta, getSongMeta, deleteSongRecord,
    getHighScores, reportScore, resetScoresIfChartChanged,
    migrateLegacySingleSong,
  };
})();
