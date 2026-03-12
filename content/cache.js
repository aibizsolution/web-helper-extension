/**
 * Content Cache Module
 * - IndexedDB 캐시 유틸리티
 * - V2 문자열 캐시 + 페이지 스냅샷 캐시
 */
(function cacheModule() {
  try {
    window.WPT = window.WPT || {};
    const WPT = window.WPT;

    const DB_NAME = 'TranslationCache';
    const DB_VERSION = 2;
    const LEGACY_STORE = 'translations';
    const STRING_STORE = 'translations_v2';
    const SNAPSHOT_STORE = 'page_snapshots_v1';
    const DEFAULT_TTL_MINUTES = 525600;
    const DEFAULT_PIPELINE_VERSION = 'v2';

    let dbPromise = null;
    let ttlPromise = null;

    function toTtlMs(ttlMinutes) {
      const minutes = Number(ttlMinutes);
      if (!Number.isFinite(minutes) || minutes <= 0) {
        return DEFAULT_TTL_MINUTES * 60 * 1000;
      }
      return minutes * 60 * 1000;
    }

    function normalizeText(text) {
      return typeof text === 'string' ? text.replace(/\s+/g, ' ').trim() : '';
    }

    function getContext(context) {
      return {
        provider: context && context.provider ? context.provider : 'openrouter',
        model: context && context.model ? context.model : '',
        profile: context && context.profile ? context.profile : 'fast',
        kind: context && context.kind ? context.kind : 'page',
        pipelineVersion: context && context.pipelineVersion ? context.pipelineVersion : DEFAULT_PIPELINE_VERSION
      };
    }

    async function openDB() {
      if (dbPromise) {
        return dbPromise;
      }

      dbPromise = new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = (event) => {
          const db = event.target.result;
          if (!db.objectStoreNames.contains(LEGACY_STORE)) {
            db.createObjectStore(LEGACY_STORE, { keyPath: 'hash' });
          }
          if (!db.objectStoreNames.contains(STRING_STORE)) {
            db.createObjectStore(STRING_STORE, { keyPath: 'hash' });
          }
          if (!db.objectStoreNames.contains(SNAPSHOT_STORE)) {
            db.createObjectStore(SNAPSHOT_STORE, { keyPath: 'hash' });
          }
        };
        request.onsuccess = (event) => {
          const db = event.target.result;
          db.onversionchange = () => {
            db.close();
            dbPromise = null;
          };
          resolve(db);
        };
        request.onerror = () => reject(request.error);
      });

      try {
        return await dbPromise;
      } catch (error) {
        dbPromise = null;
        throw error;
      }
    }

    async function sha1Hash(str) {
      const encoder = new TextEncoder();
      const data = encoder.encode(str);
      const hashBuffer = await crypto.subtle.digest('SHA-1', data);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      return hashArray.map((byte) => byte.toString(16).padStart(2, '0')).join('');
    }

    async function getTTL(forceRefresh) {
      if (!forceRefresh && ttlPromise) {
        return ttlPromise;
      }

      ttlPromise = chrome.storage.local.get(['cacheTTL'])
        .then((result) => toTtlMs(result.cacheTTL))
        .catch(() => toTtlMs(DEFAULT_TTL_MINUTES));
      return ttlPromise;
    }

    async function buildTranslationHash(text, context) {
      const ctx = getContext(context);
      return await sha1Hash(JSON.stringify({
        normalizedText: normalizeText(text),
        provider: ctx.provider,
        model: ctx.model,
        profile: ctx.profile,
        kind: ctx.kind,
        pipelineVersion: ctx.pipelineVersion
      }));
    }

    async function buildSnapshotHash(url, domSignature, context) {
      const ctx = getContext(context);
      return await sha1Hash(JSON.stringify({
        url,
        domSignature,
        provider: ctx.provider,
        model: ctx.model,
        profile: ctx.profile,
        pipelineVersion: ctx.pipelineVersion
      }));
    }

    async function readStoreRecords(storeName, hashes) {
      if (!Array.isArray(hashes) || hashes.length === 0) {
        return [];
      }

      const db = await openDB();
      const tx = db.transaction([storeName], 'readonly');
      const store = tx.objectStore(storeName);

      return await Promise.all(hashes.map((hash) => new Promise((resolve, reject) => {
        const request = store.get(hash);
        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => reject(request.error);
      })));
    }

    async function writeStoreRecords(storeName, records) {
      if (!Array.isArray(records) || records.length === 0) {
        return;
      }

      const db = await openDB();
      const tx = db.transaction([storeName], 'readwrite');
      const store = tx.objectStore(storeName);

      records.forEach((record) => store.put(record));
      await new Promise((resolve, reject) => {
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
    }

    async function getCachedTranslation(text, context) {
      const results = await getCachedTranslations([text], context);
      return results[0] || null;
    }

    async function getCachedTranslations(texts, context) {
      if (!Array.isArray(texts) || texts.length === 0) {
        return [];
      }

      try {
        const ttl = await getTTL();
        const hashes = await Promise.all(texts.map((text) => buildTranslationHash(text, context)));
        const records = await readStoreRecords(STRING_STORE, hashes);
        const now = Date.now();
        const values = records.map((record) => {
          if (!record || now - record.ts > ttl) {
            return null;
          }
          return record.translation || null;
        });

        if (values.some((value) => value !== null)) {
          return values;
        }

        if (!context || (!context.provider && !context.model && !context.profile && !context.kind)) {
          const legacyHashes = await Promise.all(texts.map((text) => sha1Hash(normalizeText(text))));
          const legacyRecords = await readStoreRecords(LEGACY_STORE, legacyHashes);
          return legacyRecords.map((record) => {
            if (!record || now - record.ts > ttl) {
              return null;
            }
            return record.translation || null;
          });
        }

        return values;
      } catch (_) {
        return texts.map(() => null);
      }
    }

    async function setCachedTranslation(text, translation, model, context) {
      await setCachedTranslations([{ text, translation, model }], model, context);
    }

    async function setCachedTranslations(entries, defaultModel, context) {
      if (!Array.isArray(entries) || entries.length === 0) {
        return;
      }

      const validEntries = entries.filter((entry) => {
        return entry && typeof entry.text === 'string' && typeof entry.translation === 'string' && entry.translation.trim();
      });
      if (validEntries.length === 0) {
        return;
      }

      const ctx = getContext(context);
      const now = Date.now();
      const records = await Promise.all(validEntries.map(async (entry) => ({
        hash: await buildTranslationHash(entry.text, {
          provider: entry.provider || ctx.provider,
          model: entry.model || defaultModel || ctx.model,
          profile: entry.profile || ctx.profile,
          kind: entry.kind || ctx.kind,
          pipelineVersion: entry.pipelineVersion || ctx.pipelineVersion
        }),
        normalizedText: normalizeText(entry.text),
        translation: entry.translation,
        ts: now,
        provider: entry.provider || ctx.provider,
        model: entry.model || defaultModel || ctx.model,
        profile: entry.profile || ctx.profile,
        kind: entry.kind || ctx.kind,
        pipelineVersion: entry.pipelineVersion || ctx.pipelineVersion
      })));

      try {
        await writeStoreRecords(STRING_STORE, records);
      } catch (_) {
        // ignore
      }
    }

    async function getPageSnapshot(url, domSignature, context) {
      try {
        const ttl = await getTTL();
        const hash = await buildSnapshotHash(url, domSignature, context);
        const records = await readStoreRecords(SNAPSHOT_STORE, [hash]);
        const record = records[0];
        if (!record || Date.now() - record.ts > ttl) {
          return null;
        }
        return record.payload || null;
      } catch (_) {
        return null;
      }
    }

    async function setPageSnapshot(url, domSignature, payload, context) {
      if (!payload) {
        return;
      }

      const ctx = getContext(context);
      try {
        const hash = await buildSnapshotHash(url, domSignature, ctx);
        await writeStoreRecords(SNAPSHOT_STORE, [{
          hash,
          url,
          domSignature,
          provider: ctx.provider,
          model: ctx.model,
          profile: ctx.profile,
          pipelineVersion: ctx.pipelineVersion,
          ts: Date.now(),
          payload
        }]);
      } catch (_) {
        // ignore
      }
    }

    async function clearAllCache() {
      try {
        const db = await openDB();
        const stores = [LEGACY_STORE, STRING_STORE, SNAPSHOT_STORE].filter((storeName) => db.objectStoreNames.contains(storeName));
        if (stores.length === 0) {
          return true;
        }

        const tx = db.transaction(stores, 'readwrite');
        stores.forEach((storeName) => {
          tx.objectStore(storeName).clear();
        });
        await new Promise((resolve, reject) => {
          tx.oncomplete = resolve;
          tx.onerror = () => reject(tx.error);
          tx.onabort = () => reject(tx.error);
        });
        return true;
      } catch (_) {
        return false;
      }
    }

    async function clearPageCache() {
      return await clearAllCache();
    }

    async function getCacheStatus() {
      try {
        const db = await openDB();
        const stores = [LEGACY_STORE, STRING_STORE, SNAPSHOT_STORE].filter((storeName) => db.objectStoreNames.contains(storeName));
        let totalCount = 0;
        let totalSize = 0;

        await Promise.all(stores.map((storeName) => new Promise((resolve, reject) => {
          const tx = db.transaction([storeName], 'readonly');
          const store = tx.objectStore(storeName);
          const request = store.getAll();
          request.onsuccess = () => {
            const items = request.result || [];
            totalCount += items.length;
            totalSize += items.reduce((sum, item) => sum + JSON.stringify(item).length, 0);
            resolve();
          };
          request.onerror = () => reject(request.error);
        })));

        return { success: true, count: totalCount, size: totalSize };
      } catch (error) {
        return { success: false, count: 0, size: 0, error: error.message };
      }
    }

    async function handleClearCacheForDomain() {
      try {
        const success = await clearPageCache();
        return success ? { success: true } : { success: false, error: '캐시 삭제 실패' };
      } catch (error) {
        return { success: false, error: error.message };
      }
    }

    async function hasCachedData() {
      try {
        const status = await getCacheStatus();
        return status.success && status.count > 0;
      } catch (_) {
        return false;
      }
    }

    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes.cacheTTL) {
        ttlPromise = Promise.resolve(toTtlMs(changes.cacheTTL.newValue));
      }
    });

    WPT.Cache = {
      openDB,
      getTTL,
      getCachedTranslation,
      getCachedTranslations,
      setCachedTranslation,
      setCachedTranslations,
      getPageSnapshot,
      setPageSnapshot,
      clearAllCache,
      clearPageCache,
      getCacheStatus,
      handleClearCacheForDomain,
      hasCachedData,
      normalizeText
    };
  } catch (_) {
    // no-op
  }
})();
