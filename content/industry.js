/**
 * Content Industry Module
 * - 산업군 컨텍스트 추론 및 프롬프트 지시문 생성
 */
(function industryModule(){
  try {
    window.WPT = window.WPT || {};
    const WPT = window.WPT;

    let industryContext = null;

    function reset(){ industryContext = null; }
    function hasContext(){ return Boolean(industryContext); }
    function getContext(){ return industryContext; }

    function buildIndustrySampleSegments(texts, maxSegments = 24, maxChars = 2500){
      if(!Array.isArray(texts) || texts.length === 0) return [];
      const segments = []; let totalChars = 0;
      for(const text of texts){
        if(segments.length >= maxSegments || totalChars >= maxChars) break;
        if(typeof text !== 'string') continue;
        const trimmed = text.replace(/\s+/g, ' ').trim();
        if(!trimmed) continue;
        const limited = trimmed.slice(0, 220);
        segments.push(limited); totalChars += limited.length;
      }
      return segments;
    }

    function parseIndustryContext(responseText){
      if(typeof responseText !== 'string' || responseText.trim().length === 0) return null;
      const startIdx = responseText.indexOf('{');
      const endIdx = responseText.lastIndexOf('}');
      if(startIdx === -1 || endIdx === -1 || endIdx <= startIdx) return null;
      try{
        const parsed = JSON.parse(responseText.slice(startIdx, endIdx + 1));
        const industry = typeof parsed.industry === 'string' ? parsed.industry.trim() : '';
        if(!industry) return null;
        const keywords = Array.isArray(parsed.keywords) ? parsed.keywords.map((x)=>String(x).trim()).filter(Boolean) : [];
        const tone = typeof parsed.tone === 'string' ? parsed.tone.trim() : '';
        const rationale = typeof parsed.summary === 'string' ? parsed.summary.trim() : (typeof parsed.rationale === 'string' ? parsed.rationale.trim() : '');
        return { industry, keywords, tone, rationale };
      }catch{ return null; }
    }

    function buildIndustryInstruction(context){
      if(typeof context === 'undefined') context = industryContext;
      if(!context){
        return '- 페이지의 내용을 고려하여 자연스럽고 정확한 한국어로 번역해주세요.';
      }
      const keywordLine = context.keywords && context.keywords.length > 0 ? `- 핵심 용어: ${context.keywords.slice(0,8).join(', ')}.` : '';
      const toneLine = context.tone ? `- 권장 어조: ${context.tone}.` : '';
      const rationaleLine = context.rationale ? `- 근거: ${context.rationale}` : '';
      return [
        `- 산업군: ${context.industry}`,
        keywordLine,
        toneLine,
        rationaleLine,
        '- 산업군 특유의 전문 용어와 뉘앙스를 유지하면서 자연스럽게 번역해주세요.'
      ].filter(Boolean).join('\n');
    }

    async function ensureIndustryContext(texts, provider, apiKey, model, signal){
      const samples = buildIndustrySampleSegments(texts);
      if(samples.length === 0){ industryContext = null; return; }
      try{
        const response = await (WPT.Provider && WPT.Provider.detectContext
          ? WPT.Provider.detectContext({ provider, apiKey, model, samples, signal })
          : Promise.resolve(''));
        const parsed = parseIndustryContext(response);
        industryContext = parsed || null;
      }catch{ industryContext = null; }
    }

    WPT.Industry = { ensureIndustryContext, buildIndustryInstruction, reset, hasContext, getContext };
  } catch(_) { /* no-op */ }
})();
