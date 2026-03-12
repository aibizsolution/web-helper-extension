/**
 * Content DOM Module
 * - 페이지 세그먼트 분석
 * - 우선순위 분류
 * - placeholder 기반 직렬화/복원
 */
(function domModule() {
  try {
    window.WPT = window.WPT || {};
    const WPT = window.WPT;

    let env = {
      getProgressStatus: null,
      originalTextsRef: null,
      translatedElementsRef: null,
      capturePreview: null,
      setCachedTranslations: null,
      progressPush: null,
      logDebug: null
    };

    const EXCLUDE_TAGS = ['SCRIPT', 'STYLE', 'NOSCRIPT', 'IFRAME', 'SVG', 'CANVAS', 'CODE', 'PRE'];
    const BLOCK_TAGS = ['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI', 'TD', 'TH', 'BUTTON', 'A', 'LABEL', 'FIGCAPTION', 'CAPTION', 'SUMMARY', 'BLOCKQUOTE', 'DIV', 'SPAN', 'SECTION', 'ARTICLE'];
    const parentBlockCache = new WeakMap();

    function setEnv(newEnv) {
      env = Object.assign({}, env, newEnv || {});
    }

    function getAllTextNodes() {
      if (!document.body) {
        return [];
      }

      const nodes = [];
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
          if (!node.parentElement) {
            return NodeFilter.FILTER_REJECT;
          }

          const text = (node.textContent || '').trim();
          if (!text || text.length > 2000) {
            return NodeFilter.FILTER_REJECT;
          }

          let current = node.parentElement;
          while (current && current !== document.body) {
            if (EXCLUDE_TAGS.includes(current.tagName)) {
              return NodeFilter.FILTER_REJECT;
            }
            current = current.parentElement;
          }

          return NodeFilter.FILTER_ACCEPT;
        }
      });

      let currentNode = walker.nextNode();
      while (currentNode) {
        nodes.push(currentNode);
        currentNode = walker.nextNode();
      }

      return nodes;
    }

    function findParentBlock(textNode) {
      const directParent = textNode.parentElement;
      if (!directParent) {
        return null;
      }

      const cached = parentBlockCache.get(directParent);
      if (cached) {
        return cached;
      }

      let current = directParent;
      while (current && current !== document.body) {
        if (BLOCK_TAGS.includes(current.tagName)) {
          parentBlockCache.set(directParent, current);
          return current;
        }
        current = current.parentElement;
      }

      parentBlockCache.set(directParent, directParent);
      return directParent;
    }

    function groupByBlock(textNodes) {
      const blockMap = new Map();
      const groups = [];

      textNodes.forEach((node) => {
        const block = findParentBlock(node);
        if (!block) {
          return;
        }

        if (!blockMap.has(block)) {
          const group = {
            block,
            nodes: [],
            texts: []
          };
          blockMap.set(block, group);
          groups.push(group);
        }

        const group = blockMap.get(block);
        group.nodes.push(node);
        group.texts.push((node.textContent || '').trim());
      });

      return groups.filter((group) => group.texts.some(Boolean));
    }

    function isInViewport(element) {
      if (!element || typeof element.getBoundingClientRect !== 'function') {
        return false;
      }
      const rect = element.getBoundingClientRect();
      return rect.bottom >= 0 && rect.top <= window.innerHeight * 1.2;
    }

    function inferPriority(block) {
      if (!block) {
        return 3;
      }
      if (block.closest('nav, footer, aside')) {
        return 3;
      }
      if (block.closest('article, main, [role="main"]')) {
        return isInViewport(block) || /^H[1-3]$/.test(block.tagName) ? 1 : 2;
      }
      if (isInViewport(block)) {
        return 1;
      }
      if (block.closest('header')) {
        return 3;
      }
      return 3;
    }

    function serializeGroup(group) {
      const clone = group.block.cloneNode(true);
      const originalWalker = document.createTreeWalker(group.block, NodeFilter.SHOW_TEXT);
      const cloneWalker = document.createTreeWalker(clone, NodeFilter.SHOW_TEXT);
      const nodeIndexMap = new Map(group.nodes.map((node, index) => [node, index]));

      let originalNode = originalWalker.nextNode();
      let cloneNode = cloneWalker.nextNode();

      while (originalNode && cloneNode) {
        if (nodeIndexMap.has(originalNode)) {
          const index = nodeIndexMap.get(originalNode);
          cloneNode.textContent = `[[${index}::${normalizeTextContent(originalNode.textContent)}]]`;
        }
        originalNode = originalWalker.nextNode();
        cloneNode = cloneWalker.nextNode();
      }

      return clone.innerHTML.replace(/\s+/g, ' ').trim();
    }

    function normalizeTextContent(text) {
      return typeof text === 'string' ? text.replace(/\s+/g, ' ').trim() : '';
    }

    function inferSegmentRole(block) {
      if (!block) {
        return 'body';
      }

      if (/^H[1-6]$/.test(block.tagName)) {
        return 'heading';
      }
      if (block.tagName === 'FIGCAPTION' || block.closest('figure')) {
        return 'caption';
      }
      if (block.tagName === 'BLOCKQUOTE' || block.closest('blockquote')) {
        return 'quote';
      }
      if (block.closest('nav, footer, aside, header')) {
        return 'ui';
      }
      return 'body';
    }

    function createSegment(group, index) {
      const plainText = normalizeTextContent(group.texts.join(' '));
      const serializedText = group.nodes.length > 1 ? serializeGroup(group) : plainText;
      return {
        id: `segment-${index}`,
        priority: inferPriority(group.block),
        role: inferSegmentRole(group.block),
        plainText,
        normalizedText: serializedText || plainText,
        serializedText: serializedText || plainText,
        targets: [group]
      };
    }

    function mergeDuplicateSegments(groups) {
      const deduped = new Map();
      const ordered = [];

      groups.forEach((group, index) => {
        const segment = createSegment(group, index);
        const key = segment.normalizedText;
        if (!key) {
          return;
        }

        if (!deduped.has(key)) {
          deduped.set(key, segment);
          ordered.push(segment);
          return;
        }

        const existing = deduped.get(key);
        existing.targets.push(group);
        existing.priority = Math.min(existing.priority, segment.priority);
      });

      ordered.sort((a, b) => a.priority - b.priority);
      return ordered;
    }

    function analyzePageSegments() {
      const textNodes = getAllTextNodes();
      const groups = groupByBlock(textNodes);
      const segments = mergeDuplicateSegments(groups);
      const visibleSegments = segments.filter((segment) => segment.priority === 1).length;
      const domSignature = segments.map((segment) => segment.normalizedText).join('\n');

      return {
        textNodes,
        groups,
        segments,
        visibleSegments,
        domSignature
      };
    }

    function extractTexts(textNodes) {
      const groups = groupByBlock(textNodes);
      return {
        texts: groups.map((group) => normalizeTextContent(group.texts.join(' '))),
        elements: groups
      };
    }

    function applyPlaceholderTranslation(group, translation) {
      const matches = Array.from(String(translation || '').matchAll(/\[\[(\d+)::([\s\S]*?)\]\]/g));
      if (matches.length === 0) {
        if (group.nodes[0]) {
          group.nodes[0].textContent = translation;
          for (let index = 1; index < group.nodes.length; index += 1) {
            group.nodes[index].textContent = '';
          }
        }
        return;
      }

      const textByIndex = new Map();
      matches.forEach((match) => {
        textByIndex.set(Number(match[1]), match[2]);
      });

      group.nodes.forEach((node, index) => {
        node.textContent = textByIndex.has(index) ? textByIndex.get(index) : '';
      });
    }

    async function applyTranslationsToDom(batch, options) {
      const getStatus = env.getProgressStatus || (() => ({}));
      const originalTexts = env.originalTextsRef;
      const translatedElements = env.translatedElementsRef;
      const cacheEntries = [];
      const shouldApply = options && typeof options.shouldApply === 'function' ? options.shouldApply : null;
      const segments = Array.isArray(batch.segments)
        ? batch.segments
        : (batch.elements || []).map((group, index) => ({
          normalizedText: (batch.texts || [])[index] || '',
          serializedText: (batch.texts || [])[index] || '',
          targets: group && group.targets ? group.targets : [group]
        }));

      await new Promise((resolve) => {
        requestAnimationFrame(() => {
          if (shouldApply && !shouldApply()) {
            resolve();
            return;
          }

          segments.forEach((segment, index) => {
            if (shouldApply && !shouldApply()) {
              return;
            }

            const translation = batch.translations[index];
            if (!translation) {
              return;
            }

            const targets = segment.targets || [];
            targets.forEach((group) => {
              group.nodes.forEach((node) => {
                if (originalTexts && !originalTexts.has(node)) {
                  originalTexts.set(node, node.textContent);
                }
                if (translatedElements) {
                  translatedElements.add(node);
                }
              });
              applyPlaceholderTranslation(group, translation);
            });

            if (typeof env.capturePreview === 'function') {
              env.capturePreview(translation);
            }

            const status = getStatus();
            if (status) {
              status.translatedSegments = (status.translatedSegments || 0) + Math.max(1, targets.length);
              status.translatedCount = status.translatedSegments;
            }

            if (options && options.writeCache !== false) {
              cacheEntries.push({
                text: segment.normalizedText || segment.serializedText,
                translation,
                model: options.model,
                provider: options.provider,
                profile: options.profile,
                kind: 'page',
                pipelineVersion: options.pipelineVersion || 'v2'
              });
            }
          });

          if (typeof env.progressPush === 'function') {
            env.progressPush();
          }
          resolve();
        });
      });

      if (shouldApply && !shouldApply()) {
        return;
      }

      if (cacheEntries.length > 0 && typeof env.setCachedTranslations === 'function') {
        env.setCachedTranslations(cacheEntries, options && options.model, {
          provider: options && options.provider,
          model: options && options.model,
          profile: options && options.profile,
          kind: 'page',
          pipelineVersion: options && options.pipelineVersion
        });
      }
    }

    WPT.Dom = {
      setEnv,
      getAllTextNodes,
      extractTexts,
      analyzePageSegments,
      applyTranslationsToDom
    };
  } catch (_) {
    // no-op
  }
})();
