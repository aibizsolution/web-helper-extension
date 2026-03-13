export const PANEL_SESSION_KEY = 'lastActiveTab';

export const GITHUB_REPO_URL = 'https://github.com/park-youngtack/chrome_ext_yt_ai';

export const DEFAULT_MAIN_TAB = 'translate';
export const DEFAULT_TRANSLATE_PANEL = 'page';

export const PANEL_TITLES = {
  translate: '번역',
  geo: '페이지 진단',
  tools: '도구',
  search: '검색',
  recurring: '반복관리',
  errors: '오류 센터',
  settings: '설정'
};

export const CONTENT_SCRIPT_FILES = [
  'content/bootstrap.js',
  'content/api.js',
  'content/provider.js',
  'content/cache.js',
  'content/industry.js',
  'content/dom.js',
  'content/title.js',
  'content/progress.js',
  'content/selection.js',
  'content.js'
];
