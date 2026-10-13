// Ambientes do navegador/extensão que o TS não conhece por padrão.
declare var chrome: any;
declare var browser: any;

interface Window {
  webkitAudioContext?: typeof AudioContext;
  Clerk?: any;
}
