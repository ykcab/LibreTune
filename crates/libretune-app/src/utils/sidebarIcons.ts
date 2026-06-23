/**
 * Semantic icon resolver for INI-driven sidebar navigation.
 * Maps menu labels/ids to icon keys rendered by SidebarNodeIcon.
 */

export type SidebarIconKey =
  | 'fuel'
  | 'injection'
  | 'injector'
  | 've-table'
  | 'afr'
  | 'target-afr'
  | 'warmup'
  | 'iat'
  | 'dfco'
  | 'fuel-trim'
  | 'enrichment'
  | 'acceleration'
  | 'throttle'
  | 'wall-wetting'
  | 'ignition'
  | 'cranking'
  | 'priming'
  | 'idle'
  | 'timing'
  | 'sensors'
  | 'can'
  | 'controller'
  | 'advanced'
  | 'expert'
  | 'boost'
  | 'egt'
  | 'lambda'
  | 'correction'
  | 'switch'
  | 'table'
  | 'dialog'
  | 'dashboard'
  | 'log'
  | 'help'
  | 'folder'
  | 'settings'
  | 'tools'
  | 'diagnostics'
  | 'load'
  | 'network'
  | 'curve'
  | 'vehicle'
  | 'battery'
  | 'alternator'
  | 'sd-card'
  | 'fan'
  | 'pump'
  | 'fuel-pump'
  | 'check-engine'
  | 'trigger';

export interface SidebarIconContext {
  id: string;
  label: string;
  type?: string;
  /** Top-level INI menu id, e.g. fuelMenu */
  menuRoot?: string;
}

/** Top-level INI [Menu] sections */
const ROOT_MENU_ICONS: Record<string, SidebarIconKey> = {
  fuelmenu: 'fuel',
  fuel: 'fuel',
  ignmenu: 'ignition',
  ignition: 'ignition',
  ign: 'ignition',
  cranking: 'cranking',
  crank: 'cranking',
  idle: 'idle',
  advanced: 'advanced',
  sensors: 'sensors',
  sensor: 'sensors',
  canmenu: 'can',
  canbus: 'can',
  can: 'can',
  controllermenu: 'controller',
  controller: 'controller',
  expertmenu: 'expert',
  expert: 'expert',
  extra: 'expert',
  helpmenu: 'help',
  help: 'help',
  basicmenu: 'load',
  basic: 'load',
  load: 'load',
  toolsmenu: 'tools',
  tools: 'tools',
  diagnostics: 'diagnostics',
  diag: 'diagnostics',
  boost: 'boost',
  launch: 'acceleration',
  antilag: 'ignition',
  nitrous: 'acceleration',
};

/** Label keyword patterns — most specific first */
const LABEL_PATTERNS: Array<{ test: RegExp; icon: SidebarIconKey }> = [
  { test: /\bcheck\s*engine\b|\bcel\b|\bmil\b/i, icon: 'check-engine' },
  { test: /\bvehicle\s*info\b|\bvehicle\s*settings\b|\bvehicle\b/i, icon: 'vehicle' },
  { test: /\bsd\s*card\b|\bsd\s*logging\b|\bsd\s*log\b/i, icon: 'sd-card' },
  { test: /\balternator\b/i, icon: 'alternator' },
  { test: /\bbattery\b|\bvbat\b|\bvbatt\b/i, icon: 'battery' },
  { test: /\bfuel\s*pump\b|\blpfp\b|\bhpfp\b|\bhigh\s*pressure\s*fuel\b|\blow\s*pressure\s*fuel\b/i, icon: 'fuel-pump' },
  { test: /\bwater\s*pump\b|\bcoolant\s*pump\b/i, icon: 'pump' },
  { test: /\bfan\s*\d?\b|\bcooling\s*fan\b|\bradiator\s*fan\b/i, icon: 'fan' },
  { test: /\btrigger\s*wheel\b|\btrigger\s*setup\b|\btrigger\s*settings\b|\btooth\b|\bcam\s*sync\b/i, icon: 'trigger' },
  { test: /\btrigger\b/i, icon: 'trigger' },
  { test: /\bve\s*table\b/i, icon: 've-table' },
  { test: /\btarget\s*afr\b|\bafr\s*target\b/i, icon: 'target-afr' },
  { test: /\blong\s*term\s*fuel\s*trim\b|\bltft\b/i, icon: 'fuel-trim' },
  { test: /\bshort\s*term\s*fuel\s*trim\b|\bstft\b/i, icon: 'fuel-trim' },
  { test: /\bfuel\s*trim\b/i, icon: 'fuel-trim' },
  { test: /\buser\s*switchable\s*lambda\b/i, icon: 'lambda' },
  { test: /\bwall\s*wetting\b/i, icon: 'wall-wetting' },
  { test: /\badvanced\s*tps\b|\btps\s*acceleration\b/i, icon: 'throttle' },
  { test: /\bacceleration\s*enrichment\b|\bae\b/i, icon: 'acceleration' },
  { test: /\bthrottle\s*model\b|\btps\s*->/i, icon: 'throttle' },
  { test: /\bthrottle\b|\btps\b/i, icon: 'throttle' },
  { test: /\bdfco\b|\bdeceleration\s*fuel\s*cut/i, icon: 'dfco' },
  { test: /\bwarmup\b|\bclt\b|\bcoolant\b/i, icon: 'warmup' },
  { test: /\biat\b|\bintake\s*air\b/i, icon: 'iat' },
  { test: /\blambda\b|\bafr\b/i, icon: 'afr' },
  { test: /\binjection\s*config/i, icon: 'injection' },
  { test: /\binjector\b/i, icon: 'injector' },
  { test: /\bstaged\s*injection\b/i, icon: 'injector' },
  { test: /\binjection\b|\binject\b/i, icon: 'injection' },
  { test: /\bfuel\s*correction\b|\bcorrection\b/i, icon: 'correction' },
  { test: /\benrichment\b/i, icon: 'enrichment' },
  { test: /\btable\s*switch\b|\bswitch\b/i, icon: 'switch' },
  { test: /\bcranking\s*ignition\b|\bcranking\s*advance\b/i, icon: 'timing' },
  { test: /\bcranking\s*idle\b/i, icon: 'idle' },
  { test: /\bcranking\s*fuel\b|\bcranking\s*base\b/i, icon: 'fuel' },
  { test: /\bcranking\s*settings\b|\bcranking\b/i, icon: 'cranking' },
  { test: /\bpriming\s*pulse\b|\bpriming\b/i, icon: 'priming' },
  { test: /\bafter[- ]?start\b/i, icon: 'enrichment' },
  { test: /\bignition\s*advance\b|\badvance\s*table\b|\btiming\b/i, icon: 'timing' },
  { test: /\bignition\b|\bspark\b/i, icon: 'ignition' },
  { test: /\bidle\b/i, icon: 'idle' },
  { test: /\bcan\s*bus\b|\bcan\b/i, icon: 'can' },
  { test: /\bsensor\b|\bthermistor\b|\bcalibrat/i, icon: 'sensors' },
  { test: /\bcontroller\b|\becu\b/i, icon: 'controller' },
  { test: /\bexpert\b|\bextra\b/i, icon: 'expert' },
  { test: /\badvanced\b/i, icon: 'advanced' },
  { test: /\bboost\b|\bmap\b/i, icon: 'boost' },
  { test: /\begt\b|\bexhaust\s*gas\b/i, icon: 'egt' },
  { test: /\bcurve\b/i, icon: 'curve' },
  { test: /\bhelp\b/i, icon: 'help' },
  { test: /\bsettings\b|\bconfiguration\b|\bconfig\b/i, icon: 'settings' },
  { test: /\bfuel\b/i, icon: 'fuel' },
];

function normalizeKey(value: string): string {
  return value.toLowerCase().replace(/^&/, '').replace(/[^a-z0-9]/g, '');
}

export function resolveSidebarIcon(ctx: SidebarIconContext): SidebarIconKey {
  const { id, label, type, menuRoot } = ctx;
  const normId = normalizeKey(id);
  const normLabel = label.toLowerCase();

  // Explicit type fallbacks for leaves
  if (type === 'help') return 'help';
  if (type === 'table') {
    for (const { test, icon } of LABEL_PATTERNS) {
      if (test.test(normLabel)) return icon;
    }
    return 'table';
  }
  if (type === 'dashboard') return 'dashboard';
  if (type === 'log') return 'log';

  // Top-level menu roots
  if (menuRoot) {
    const rootKey = normalizeKey(menuRoot);
    if (ROOT_MENU_ICONS[rootKey]) return ROOT_MENU_ICONS[rootKey];
  }
  if (ROOT_MENU_ICONS[normId]) return ROOT_MENU_ICONS[normId];

  // Label keyword matching
  for (const { test, icon } of LABEL_PATTERNS) {
    if (test.test(normLabel) || test.test(normId)) return icon;
  }

  // Leaf vs folder defaults
  if (type === 'dialog') return 'dialog';
  if (type === 'folder') return 'folder';

  return 'folder';
}

/** Attach resolved icons to a sidebar tree */
export function withSidebarIcons<T extends { id: string; label: string; type?: string; icon?: string; children?: T[] }>(
  nodes: T[],
  menuRoot?: string,
): T[] {
  return nodes.map((node) => {
    const root = menuRoot ?? node.id;
    const icon = resolveSidebarIcon({
      id: node.id,
      label: node.label,
      type: node.type,
      menuRoot: menuRoot ?? (node.children?.length ? root : menuRoot),
    });
    const children = node.children ? withSidebarIcons(node.children, undefined) : undefined;
    return { ...node, icon, children };
  });
}
