/**
 * Application states.
 *
 * These are real states with real transitions, not cosmetic labels. The interface renders
 * exactly one of them at a time and every one has defined user actions.
 */
export type AppState =
  /** First paint: probing the device and reading stored state. */
  | 'booting'
  /** No usable disc is available; the user must supply their own. */
  | 'awaiting-files'
  /** Checking the disc container and the device's capabilities. */
  | 'verifying'
  /** Downloading and instantiating the emulator core. */
  | 'loading-core'
  /** Creating the VM and the WebGL2 context. */
  | 'initializing'
  /** A disc is mounted and the core accepted it; frames have not started yet. */
  | 'starting-game'
  /** Frames are being produced. */
  | 'running'
  /** The user paused the game (input suppressed, rendering continues). */
  | 'paused'
  /** Writing a save state. */
  | 'saving'
  /** Reading a save state back into the core. */
  | 'restoring'
  /** A recoverable error with an explanation and a way forward. */
  | 'error'
  /** The device or browser cannot run the emulator. */
  | 'incompatible'
  /** Storage is unavailable or full. */
  | 'storage-error'
  /** The WebGL context was lost mid-session. */
  | 'context-lost';

export interface AppStateInfo {
  state: AppState;
  /** Short title for the overlay. */
  title: string;
  /** Explanation of what is happening and why. */
  detail: string;
  /** Actions the user can take right now. */
  actions: AppAction[];
  /** True while work is in progress, so the interface shows a spinner. */
  busy: boolean;
}

export type AppAction =
  | 'choose-file'
  | 'start-game'
  | 'pause'
  | 'resume'
  | 'save-state'
  | 'open-saves'
  | 'open-settings'
  | 'retry'
  | 'reload'
  | 'clear-data'
  | 'open-compatibility'
  | 'install-app';

export interface AppStateDefinition extends Omit<AppStateInfo, 'state'> {
  /** States this one may move to. Anything else is a bug and is rejected. */
  next: AppState[];
}

export const APP_STATES: Record<AppState, AppStateDefinition> = {
  booting: {
    title: 'Iniciando',
    detail: 'Verificando o aparelho e os arquivos guardados.',
    actions: [],
    busy: true,
    next: ['awaiting-files', 'verifying', 'loading-core', 'incompatible', 'error'],
  },
  'awaiting-files': {
    title: 'Prepare o jogo',
    detail:
      'Para jogar você precisa fornecer a imagem do disco de GTA: San Andreas de PlayStation 2 que você mesmo possui. Nenhum arquivo de jogo é baixado ou enviado por este site.',
    actions: ['choose-file', 'open-settings', 'open-compatibility'],
    busy: false,
    next: ['verifying', 'loading-core', 'initializing', 'incompatible', 'error'],
  },
  verifying: {
    title: 'Verificando o arquivo',
    detail: 'Conferindo o formato da imagem e as capacidades do aparelho.',
    actions: [],
    busy: true,
    next: ['awaiting-files', 'loading-core', 'error'],
  },
  'loading-core': {
    title: 'Carregando o emulador',
    detail: 'Baixando e preparando o núcleo do Play! em WebAssembly.',
    actions: [],
    busy: true,
    next: ['initializing', 'error', 'awaiting-files'],
  },
  initializing: {
    title: 'Inicializando',
    detail: 'Criando a máquina virtual e o contexto gráfico.',
    actions: [],
    busy: true,
    next: ['starting-game', 'error', 'incompatible'],
  },
  'starting-game': {
    title: 'Carregando o jogo',
    detail:
      'O disco foi entregue ao emulador. GTA: San Andreas leva de 5 a 10 minutos para chegar ao jogo após as telas iniciais; a tela pode ficar preta por vários minutos.',
    actions: ['pause'],
    busy: true,
    next: ['running', 'error', 'paused'],
  },
  running: {
    title: 'Em execução',
    detail: 'O jogo está rodando.',
    actions: ['pause', 'save-state', 'open-saves', 'open-settings'],
    busy: false,
    next: ['paused', 'saving', 'restoring', 'error', 'context-lost', 'awaiting-files'],
  },
  paused: {
    title: 'Pausado',
    detail: 'Os comandos estão desativados. O jogo continua sendo renderizado.',
    actions: ['resume', 'save-state', 'open-saves', 'open-settings'],
    busy: false,
    next: ['running', 'saving', 'restoring', 'awaiting-files'],
  },
  saving: {
    title: 'Salvando',
    detail: 'Gravando o estado no armazenamento local do aparelho.',
    actions: [],
    busy: true,
    next: ['running', 'paused', 'storage-error'],
  },
  restoring: {
    title: 'Restaurando',
    detail: 'Devolvendo o estado salvo ao emulador.',
    actions: [],
    busy: true,
    next: ['running', 'paused', 'error', 'storage-error'],
  },
  error: {
    title: 'Falha na inicialização',
    detail: 'Algo impediu a execução.',
    actions: ['retry', 'reload', 'open-settings'],
    busy: false,
    next: ['verifying', 'loading-core', 'initializing', 'awaiting-files', 'running'],
  },
  incompatible: {
    title: 'Navegador incompatível',
    detail: 'Este navegador não atende aos requisitos mínimos do emulador.',
    actions: ['open-compatibility', 'reload'],
    busy: false,
    next: [],
  },
  'storage-error': {
    title: 'Falha de armazenamento',
    detail: 'Não foi possível gravar os dados no aparelho.',
    actions: ['clear-data', 'open-saves', 'resume'],
    busy: false,
    next: ['running', 'paused', 'awaiting-files', 'error'],
  },
  'context-lost': {
    title: 'Contexto gráfico perdido',
    detail:
      'O navegador recolheu o contexto WebGL, normalmente por falta de memória. A sessão atual não pode continuar.',
    actions: ['reload', 'open-settings'],
    busy: false,
    next: ['booting'],
  },
};

/** States in which the game is live and input must reach the emulator. */
export const INTERACTIVE_STATES: AppState[] = ['running', 'starting-game'];

export function isInteractive(state: AppState): boolean {
  return INTERACTIVE_STATES.includes(state);
}
