import type { App, AppSnapshot } from '@/app/app';
import { APP_STATES } from '@/app/app-state';
import { describeButtonIndex } from '@/controls/gamepad';
import { PS2_BUTTON_LABELS, PS2_BUTTONS } from '@/controls/keymap';
import { describeFormat } from '@/files/disc-formats';
import { createBackup, downloadBlob, inspectBackup, restoreBackup } from '@/saves/backup';
import type { GamepadAction, PerformanceProfile } from '@/settings/types';
import { formatBytes, formatDate, formatFps } from '@/utils/format';

export type PanelId = 'settings' | 'saves' | 'controls' | 'compatibility' | 'log' | 'gamepad-test';

const PANEL_TITLES: Record<PanelId, string> = {
  settings: 'Configurações',
  saves: 'Salvamentos',
  controls: 'Controles',
  compatibility: 'Compatibilidade',
  log: 'Registro do emulador',
  'gamepad-test': 'Testar controle',
};

/**
 * Renders every secondary screen into the side panel.
 *
 * The panel re-renders from the application snapshot, so it can never show a stale value
 * that contradicts the rest of the interface.
 */
export class Panel {
  private currentId: PanelId | null = null;
  private snapshot: AppSnapshot | null = null;
  private unsubscribe: (() => void) | null = null;

  constructor(
    private readonly app: App,
    private readonly root: HTMLElement,
    private readonly titleElement: HTMLElement,
    private readonly bodyElement: HTMLElement,
    private readonly onClose: () => void,
  ) {}

  get isOpen(): boolean {
    return this.currentId !== null;
  }

  get openId(): PanelId | null {
    return this.currentId;
  }

  open(id: PanelId): void {
    this.currentId = id;
    this.titleElement.textContent = PANEL_TITLES[id];
    this.root.hidden = false;
    this.unsubscribe?.();
    this.unsubscribe = this.app.subscribe((snapshot) => {
      this.snapshot = snapshot;
      this.render();
    });
    this.render();
  }

  close(): void {
    this.currentId = null;
    this.root.hidden = true;
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.onClose();
  }

  private render(): void {
    const id = this.currentId;
    const snapshot = this.snapshot;
    if (!id || !snapshot) return;

    this.bodyElement.replaceChildren();
    switch (id) {
      case 'settings':
        this.renderSettings(snapshot);
        break;
      case 'saves':
        this.renderSaves(snapshot);
        break;
      case 'controls':
        this.renderControls(snapshot);
        break;
      case 'compatibility':
        this.renderCompatibility(snapshot);
        break;
      case 'log':
        this.renderLog(snapshot);
        break;
      case 'gamepad-test':
        this.renderGamepadTest(snapshot);
        break;
    }
  }

  // ---------------------------------------------------------------- settings

  private renderSettings(snapshot: AppSnapshot): void {
    const { settings } = snapshot;

    this.section('Perfil de desempenho', (section) => {
      const note = el('p', 'panel-note');
      note.textContent =
        'O perfil ajusta apenas o que o emulador realmente oferece. O renderizador do Play! não desce abaixo da resolução nativa, então não existe um modo "sub-nativo".';
      section.append(note);

      const group = el('div', 'segmented');
      const profiles: Array<{ id: PerformanceProfile; label: string; hint: string }> = [
        { id: 'eco', label: 'Econômico', hint: 'Prioriza o desempenho: resolução nativa e estabilização de campo.' },
        { id: 'balanced', label: 'Equilibrado', hint: 'Resolução nativa com o campo entrelaçado original.' },
        { id: 'quality', label: 'Qualidade', hint: 'Resolução interna 2×. Mais nítido, mais pesado.' },
      ];
      for (const profile of profiles) {
        const button = el('button', 'segmented-item') as HTMLButtonElement;
        button.type = 'button';
        button.textContent = profile.label;
        button.title = profile.hint;
        if (settings.profile === profile.id) button.classList.add('active');
        button.addEventListener('click', () => this.app.applyProfile(profile.id));
        group.append(button);
      }
      section.append(group);

      const current = profiles.find((p) => p.id === settings.profile);
      if (current) {
        const hint = el('p', 'panel-note');
        hint.textContent = current.hint;
        section.append(hint);
      }
    });

    this.section('Vídeo', (section) => {
      section.append(
        this.toggleRow('Resolução interna 2×', settings.resolutionFactor === 2, (checked) =>
          this.app.setResolutionFactor(checked ? 2 : 1),
        ),
      );
      section.append(this.toggleRow('Limitador de 60 FPS', settings.frameLimiter, (checked) => this.app.setFrameLimiter(checked)));
      section.append(
        this.toggleRow('Estabilização de campo (anti-tremor)', settings.fieldStabilization, (checked) =>
          this.app.setFieldStabilization(checked),
        ),
      );
      const note = el('p', 'panel-note');
      note.textContent =
        'A estabilização de campo remove a oscilação vertical de uma linha em jogos entrelaçados. É experimental.';
      section.append(note);
    });

    this.section('Controles na tela', (section) => {
      section.append(
        this.toggleRow('Mostrar controles de toque', settings.showTouchControls, (checked) =>
          this.app.settings.update({ showTouchControls: checked }),
        ),
      );
      section.append(
        this.toggleRow('Ocultar quando houver controle físico', settings.hideTouchWhenGamepad, (checked) =>
          this.app.settings.update({ hideTouchWhenGamepad: checked }),
        ),
      );
      section.append(
        this.sliderRow('Transparência', settings.touchOpacity, 0.1, 1, 0.05, (value) =>
          this.app.settings.update({ touchOpacity: value }),
        ),
      );
      section.append(
        this.sliderRow('Tamanho', settings.touchScale, 0.7, 1.6, 0.05, (value) => this.app.settings.update({ touchScale: value })),
      );
    });

    this.section('Tela e orientação', (section) => {
      section.append(
        this.toggleRow('Pedir orientação horizontal ao entrar em tela cheia', settings.requestLandscape, (checked) =>
          this.app.settings.update({ requestLandscape: checked }),
        ),
      );
      const note = el('p', 'panel-note');
      note.textContent =
        'A API de orientação só funciona em tela cheia e não é suportada por todos os navegadores. Quando ela falha, gire o aparelho manualmente.';
      section.append(note);
    });

    this.section('Armazenamento', (section) => {
      const info = el('p', 'panel-note');
      const quota = snapshot.capabilities?.storageQuotaBytes;
      info.textContent = quota
        ? `Cota estimada do navegador: ${formatBytes(quota)}.`
        : 'O navegador não informou a cota de armazenamento.';
      section.append(info);

      const row = el('div', 'panel-row');
      const exportButton = el('button', 'button-small') as HTMLButtonElement;
      exportButton.type = 'button';
      exportButton.textContent = 'Exportar backup completo';
      exportButton.addEventListener('click', () => void this.exportBackup());
      const importButton = el('button', 'button-small') as HTMLButtonElement;
      importButton.type = 'button';
      importButton.textContent = 'Importar backup';
      importButton.addEventListener('click', () => this.importBackup());
      row.append(exportButton, importButton);
      section.append(row);

      const clearButton = el('button', 'button-small button-danger') as HTMLButtonElement;
      clearButton.type = 'button';
      clearButton.textContent = 'Apagar todos os dados locais';
      clearButton.addEventListener('click', () => {
        if (confirm('Apagar disco guardado, estados de salvamento e cartão de memória? Esta ação não pode ser desfeita.')) {
          void this.app.clearAllData();
        }
      });
      section.append(clearButton);
    });

    this.section('Aplicativo', (section) => {
      const note = el('p', 'panel-note');
      note.textContent = snapshot.installState === 'installed' ? 'O aplicativo já está instalado.' : this.app.installPrompt.instructions();
      section.append(note);
      if (snapshot.installState === 'available') {
        const install = el('button', 'button-small') as HTMLButtonElement;
        install.type = 'button';
        install.textContent = 'Instalar aplicativo';
        install.addEventListener('click', () => void this.app.installPrompt.prompt());
        section.append(install);
      }

      const offline = el('p', 'panel-note');
      offline.textContent = snapshot.offlineReady
        ? 'Os recursos essenciais estão guardados: o aplicativo abre sem conexão.'
        : 'Os recursos essenciais ainda não estão totalmente guardados. Abra o jogo uma vez com internet para preparar o modo offline.';
      section.append(offline);
    });
  }

  // ---------------------------------------------------------------- saves

  private renderSaves(snapshot: AppSnapshot): void {
    const card = snapshot.memoryCard;
    const slots = snapshot.saveSlots;

    this.section('Como o progresso é guardado', (section) => {
      const note = el('p', 'panel-note');
      note.textContent =
        'Existem três mecanismos distintos, e é importante não confundi-los:\n' +
        '• Salvamento do jogo: feito pelo próprio GTA em um cartão de memória virtual, dentro do jogo (no mapa, nas casas seguras).\n' +
        '• Cartão de memória virtual: a pasta que o emulador expõe como "mc0". É ela que guarda os salvamentos do jogo entre sessões.\n' +
        '• Estado de salvamento: uma fotografia instantânea da máquina inteira, feita pelo emulador. Serve para voltar exatamente ao ponto em que você estava.';
      section.append(note);
    });

    this.section('Cartão de memória virtual', (section) => {
      const info = el('p', 'panel-note');
      if (!card?.present) {
        info.textContent = 'Nenhum cartão guardado ainda. Ele é capturado automaticamente durante o jogo.';
      } else {
        info.textContent = `Guardado em ${formatDate(card.savedAt ?? '')} — ${card.fileCount} arquivos, ${formatBytes(
          card.totalBytes,
        )}.${card.saveFolders.length > 0 ? ` Salvamentos encontrados: ${card.saveFolders.join(', ')}.` : ''}`;
      }
      section.append(info);

      const row = el('div', 'panel-row');
      const save = el('button', 'button-small') as HTMLButtonElement;
      save.type = 'button';
      save.textContent = 'Guardar agora';
      save.addEventListener('click', () => void this.app.saveMemoryCard());
      const exportButton = el('button', 'button-small') as HTMLButtonElement;
      exportButton.type = 'button';
      exportButton.textContent = 'Exportar (.json)';
      exportButton.addEventListener('click', () => void this.exportMemoryCard());
      const importLabel = el('label', 'button-small') as HTMLLabelElement;
      importLabel.textContent = 'Importar';
      const importInput = document.createElement('input');
      importInput.type = 'file';
      importInput.accept = '.json';
      importInput.addEventListener('change', () => {
        const file = importInput.files?.[0];
        if (file) void this.importMemoryCard(file);
      });
      importLabel.append(importInput);
      row.append(save, exportButton, importLabel);
      section.append(row);

      const compat = el('p', 'panel-note');
      compat.textContent =
        'O formato exportado é o pacote JSON deste projeto. Imagens .ps2 do PCSX2 não são lidas aqui: elas exigem uma camada de sistema de arquivos com superbloco, FAT e ECC que não faz parte deste projeto.';
      section.append(compat);
    });

    this.section('Estados de salvamento', (section) => {
      for (const slot of slots) {
        const item = el('div', 'save-slot');
        const head = el('div', 'save-slot-head');
        const name = el('span', 'save-slot-name');
        name.textContent = `Slot ${slot.slot + 1}`;
        const meta = el('span', 'save-slot-meta');
        meta.textContent = slot.present
          ? `${formatBytes(slot.sizeBytes)} · ${formatDate(slot.savedAt ?? '')}`
          : 'vazio';
        head.append(name, meta);
        item.append(head);

        const row = el('div', 'panel-row');
        const saveButton = el('button', 'button-small') as HTMLButtonElement;
        saveButton.type = 'button';
        saveButton.textContent = 'Salvar';
        saveButton.disabled = !snapshot.state.actions.includes('save-state');
        saveButton.addEventListener('click', () => void this.app.saveState(slot.slot));

        const loadButton = el('button', 'button-small') as HTMLButtonElement;
        loadButton.type = 'button';
        loadButton.textContent = 'Carregar';
        loadButton.disabled = !slot.present;
        loadButton.addEventListener('click', () => void this.app.loadState(slot.slot));

        const exportButton = el('button', 'button-small') as HTMLButtonElement;
        exportButton.type = 'button';
        exportButton.textContent = 'Exportar';
        exportButton.disabled = !slot.present;
        exportButton.addEventListener('click', () => void this.exportSlot(slot.slot));

        const importLabel = el('label', 'button-small') as HTMLLabelElement;
        importLabel.textContent = 'Importar';
        const importInput = document.createElement('input');
        importInput.type = 'file';
        importInput.accept = '.state,.bin';
        importInput.addEventListener('change', () => {
          const file = importInput.files?.[0];
          if (file) void this.importSlot(slot.slot, file);
        });
        importLabel.append(importInput);

        const deleteButton = el('button', 'button-small button-danger') as HTMLButtonElement;
        deleteButton.type = 'button';
        deleteButton.textContent = 'Apagar';
        deleteButton.disabled = !slot.present;
        deleteButton.addEventListener('click', () => void this.app.deleteState(slot.slot));

        row.append(saveButton, loadButton, exportButton, importLabel, deleteButton);
        item.append(row);
        section.append(item);
      }

      const note = el('p', 'panel-note');
      note.textContent =
        'Um estado de salvamento pertence a um disco específico. Carregar um estado feito com outro jogo pode travar o emulador.';
      section.append(note);
    });
  }

  // ---------------------------------------------------------------- controls

  private renderControls(snapshot: AppSnapshot): void {
    const pads = snapshot.gamepads;

    this.section('Controle físico (Bluetooth)', (section) => {
      const status = el('p', 'panel-note');
      status.textContent =
        pads.length === 0
          ? 'Nenhum controle detectado. Conecte o controle nas configurações de Bluetooth do aparelho e depois pressione um botão para que o navegador o reconheça.'
          : `${pads.length} controle(s) detectado(s):\n` +
            pads.map((pad) => `• ${pad.id} — ${pad.buttons} botões, ${pad.axes} eixos (mapeamento: ${pad.mapping})`).join('\n');
      section.append(status);

      const testButton = el('button', 'button-small') as HTMLButtonElement;
      testButton.type = 'button';
      testButton.textContent = 'Testar botões';
      testButton.addEventListener('click', () => this.open('gamepad-test'));
      section.append(testButton);

      const help = el('p', 'panel-note');
      help.textContent =
        'Como conectar: ative o Bluetooth do aparelho, coloque o controle em modo de pareamento e conecte-o nas configurações do sistema. Um site não pode parear um controle Bluetooth por conta própria; o navegador só enxerga o controle depois que o sistema operacional o conectou.';
      section.append(help);
    });

    this.section('Mapeamento dos botões', (section) => {
      const table = el('div', 'mapping-table');
      for (const action of Object.keys(snapshot.settings.gamepadMapping) as GamepadAction[]) {
        const row = el('div', 'mapping-row');
        const label = el('span', 'mapping-label');
        label.textContent = PS2_BUTTON_LABELS[action as keyof typeof PS2_BUTTON_LABELS] ?? action;
        const select = document.createElement('select');
        select.className = 'mapping-select';
        for (let index = 0; index < 20; index++) {
          const option = document.createElement('option');
          option.value = String(index);
          option.textContent = `${index} — ${describeButtonIndex(index)}`;
          if (snapshot.settings.gamepadMapping[action] === index) option.selected = true;
          select.append(option);
        }
        select.addEventListener('change', () => this.app.setGamepadBinding(action, Number(select.value)));
        row.append(label, select);
        table.append(row);
      }
      section.append(table);

      const reset = el('button', 'button-small') as HTMLButtonElement;
      reset.type = 'button';
      reset.textContent = 'Restaurar mapeamento padrão';
      reset.addEventListener('click', () => this.app.resetGamepadMapping());
      section.append(reset);
    });

    this.section('Controles de toque', (section) => {
      const list = el('p', 'panel-note');
      list.textContent =
        'O emulador só aceita teclado, então cada controle é traduzido para a tecla que o Play! espera. Mapeamento verificado no código do núcleo:\n' +
        PS2_BUTTONS.map((button) => `${PS2_BUTTON_LABELS[button]} → tecla do núcleo`).join(' · ');
      section.append(list);

      const note = el('p', 'panel-note');
      note.textContent =
        'O analógico esquerdo é simulado por pares de teclas. Ele é progressivo na tela: quanto mais longe do centro, mais fundo o comando.';
      section.append(note);
    });
  }

  // ---------------------------------------------------------------- compatibility

  private renderCompatibility(snapshot: AppSnapshot): void {
    const { capabilities, compatibility } = snapshot;

    this.section('Requisitos do navegador', (section) => {
      if (!capabilities) {
        section.append(el('p', 'panel-note', 'Ainda verificando.'));
        return;
      }
      const list = el('ul', 'check-list');
      list.append(
        checkItem('WebAssembly', capabilities.webAssembly, true),
        checkItem('WebGL2', capabilities.webgl2, true),
        checkItem('SharedArrayBuffer', capabilities.sharedArrayBuffer, true),
        checkItem('Contexto isolado (COOP/COEP)', capabilities.crossOriginIsolated, true),
        checkItem('SIMD128', capabilities.webAssemblySimd, false),
        checkItem('Threads em WebAssembly', capabilities.webAssemblyThreads, false),
      );
      section.append(list);

      if (compatibility && compatibility.blockers.length > 0) {
        const blockers = el('div', 'callout callout-error');
        blockers.textContent = compatibility.blockers.join('\n');
        section.append(blockers);
      }
      if (compatibility && compatibility.warnings.length > 0) {
        const warnings = el('div', 'callout callout-warn');
        warnings.textContent = compatibility.warnings.join('\n');
        section.append(warnings);
      }
    });

    this.section('Aparelho', (section) => {
      const list = el('ul', 'check-list');
      const memory = capabilities?.deviceMemoryGb;
      const cores = capabilities?.hardwareConcurrency;
      list.append(
        infoItem(`RAM informada pelo navegador: ${memory !== null && memory !== undefined ? `${memory} GB` : 'não informada'}`),
        infoItem(`Núcleos lógicos: ${cores ?? 'não informado'}`),
        infoItem(`Modo instalado: ${capabilities?.standalone ? 'sim' : 'não'}`),
        infoItem(`Entrada principal: ${capabilities?.touchPrimary ? 'toque' : 'ponteiro'}`),
      );
      section.append(list);

      const note = el('p', 'panel-note');
      note.textContent =
        'A memória informada pelo navegador é arredondada e limitada, e não substitui o teste real. A meta do projeto é 2 GB de RAM ou mais, mas o desempenho depende também do processador, da GPU e do navegador.';
      section.append(note);
    });

    this.section('Estado da compatibilidade com GTA: San Andreas', (section) => {
      const note = el('p', 'panel-note');
      note.textContent =
        'Os relatórios oficiais do Play! classificam GTA: San Andreas como "InGame": o jogo inicia, carrega e salva, mas é pesado e apresenta falhas visuais.\n\n' +
        '• Em computador (i5-2500K, GTX 480): 15 a 30 FPS, com quedas momentâneas.\n' +
        '• O jogo leva de 5 a 10 minutos para sair das telas iniciais, com a tela preta por vários minutos.\n' +
        '• Falhas conhecidas: texturas incorretas, uma linha colorida na borda direita da tela e, em versões antigas, travamento ao carregar a missão "Big Smoke".\n' +
        '• Em celulares modestos, a taxa de quadros tende a ficar bem abaixo de 30 FPS.\n\n' +
        'Este projeto não testou o jogo em um celular físico com 2 GB de RAM. A taxa de quadros real depende do seu aparelho.';
      section.append(note);
    });
  }

  // ---------------------------------------------------------------- log

  private renderLog(snapshot: AppSnapshot): void {
    this.section('Registro', (section) => {
      const pre = el('pre', 'log-view');
      pre.textContent = snapshot.log.map((entry) => `${new Date(entry.at).toLocaleTimeString()} [${entry.level}] ${entry.message}`).join('\n');
      section.append(pre);

      const row = el('div', 'panel-row');
      const copy = el('button', 'button-small') as HTMLButtonElement;
      copy.type = 'button';
      copy.textContent = 'Copiar';
      copy.addEventListener('click', () => {
        void navigator.clipboard?.writeText(pre.textContent ?? '');
      });
      const clear = el('button', 'button-small') as HTMLButtonElement;
      clear.type = 'button';
      clear.textContent = 'Limpar';
      clear.addEventListener('click', () => {
        this.app.log.clear();
      });
      row.append(copy, clear);
      section.append(row);
    });

    const emulator = snapshot.state;
    this.section('Estado atual', (section) => {
      const list = el('ul', 'check-list');
      list.append(infoItem(`Estado: ${APP_STATES[emulator.state].title} (${emulator.state})`));
      list.append(infoItem(`Arquivo: ${snapshot.game.info?.name ?? 'nenhum'}`));
      if (snapshot.stats) {
        list.append(infoItem(`Desempenho: ${formatFps(snapshot.stats.fps)} · EE ${snapshot.stats.eeUsage.toFixed(0)}% · IOP ${snapshot.stats.iopUsage.toFixed(0)}%`));
      }
      section.append(list);
    });
  }

  // ---------------------------------------------------------------- gamepad test

  private renderGamepadTest(snapshot: AppSnapshot): void {
    this.section('Teste de botões', (section) => {
      const note = el('p', 'panel-note');
      note.textContent =
        'Pressione os botões e mova os analógicos. Os valores abaixo vêm diretamente da API de controle do navegador. Se um botão aparecer com o número errado, ajuste o mapeamento na seção Controles.';
      section.append(note);

      if (snapshot.gamepads.length === 0) {
        const empty = el('p', 'panel-note');
        empty.textContent = 'Nenhum controle conectado.';
        section.append(empty);
        return;
      }

      const output = el('pre', 'log-view');
      output.id = 'gamepad-test-output';
      output.textContent = 'Aguardando entrada…';
      section.append(output);

      const read = () => {
        const pads = navigator.getGamepads?.() ?? [];
        const lines: string[] = [];
        for (const pad of pads) {
          if (!pad?.connected) continue;
          const pressed = pad.buttons
            .map((button, index) => (button.pressed ? index : null))
            .filter((index): index is number => index !== null);
          lines.push(`${pad.id}`);
          lines.push(`  botões pressionados: ${pressed.length > 0 ? pressed.join(', ') : '—'}`);
          lines.push(`  eixos: ${pad.axes.map((axis) => axis.toFixed(2)).join(', ')}`);
        }
        output.textContent = lines.length > 0 ? lines.join('\n') : 'Nenhum controle conectado.';
        if (this.currentId === 'gamepad-test') requestAnimationFrame(read);
      };
      requestAnimationFrame(read);
    });
  }

  // ---------------------------------------------------------------- helpers

  private async exportBackup(): Promise<void> {
    const { blob } = await createBackup({ ...this.app.settings.value });
    downloadBlob(blob, `gta-backup-${new Date().toISOString().slice(0, 10)}.json`);
  }

  private importBackup(): void {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const preview = await inspectBackup(file);
        const ok = confirm(
          `Backup de ${formatDate(preview.createdAt)}.\nEstados: ${preview.saveStateCount}\nArquivos de cartão: ${preview.memoryCardFiles}\n\nRestaurar agora? Os dados atuais serão substituídos.`,
        );
        if (!ok) return;
        const summary = await restoreBackup(file);
        await this.app.refreshSaves();
        alert(`Backup restaurado: ${summary.saveStateCount} estados e ${summary.memoryCardFiles} arquivos de cartão.`);
      } catch (error) {
        alert(error instanceof Error ? error.message : String(error));
      }
    });
    input.click();
  }

  private async exportMemoryCard(): Promise<void> {
    const blob = await this.app.memoryCard.exportBundle();
    if (!blob) {
      alert('Ainda não há cartão de memória guardado.');
      return;
    }
    downloadBlob(blob, `gta-memcard-${new Date().toISOString().slice(0, 10)}.json`);
  }

  private async importMemoryCard(file: File): Promise<void> {
    try {
      const summary = await this.app.memoryCard.importBundle(file);
      alert(`Cartão importado: ${summary.fileCount} arquivos. Reinicie o jogo para que ele use o cartão.`);
    } catch (error) {
      alert(error instanceof Error ? error.message : String(error));
    }
  }

  private async exportSlot(slot: number): Promise<void> {
    const blob = await this.app.saveStates.exportSlot(slot);
    if (!blob) {
      alert('Slot vazio.');
      return;
    }
    downloadBlob(blob, `gta-slot-${slot + 1}.state`);
  }

  private async importSlot(slot: number, file: File): Promise<void> {
    try {
      await this.app.saveStates.importSlot(slot, file);
      await this.app.refreshSaves();
      alert(`Estado importado no slot ${slot + 1}.`);
    } catch (error) {
      alert(error instanceof Error ? error.message : String(error));
    }
  }

  private section(title: string, build: (section: HTMLElement) => void): void {
    const wrapper = el('section', 'panel-section');
    const heading = el('h3');
    heading.textContent = title;
    wrapper.append(heading);
    build(wrapper);
    this.bodyElement.append(wrapper);
  }

  private toggleRow(label: string, checked: boolean, onChange: (checked: boolean) => void): HTMLElement {
    const row = el('label', 'toggle-row');
    const text = el('span', 'toggle-label');
    text.textContent = label;
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = checked;
    input.addEventListener('change', () => onChange(input.checked));
    const track = el('span', 'toggle-track');
    row.append(text, input, track);
    return row;
  }

  private sliderRow(
    label: string,
    value: number,
    min: number,
    max: number,
    step: number,
    onChange: (value: number) => void,
  ): HTMLElement {
    const row = el('div', 'slider-row');
    const text = el('span', 'toggle-label');
    text.textContent = label;
    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.value = String(value);
    input.addEventListener('input', () => onChange(Number(input.value)));
    row.append(text, input);
    return row;
  }
}

function el(tag: string, className?: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function checkItem(label: string, ok: boolean, required: boolean): HTMLElement {
  const item = document.createElement('li');
  item.className = ok ? 'ok' : required ? 'error' : 'warn';
  item.textContent = `${label}: ${ok ? 'disponível' : required ? 'ausente (obrigatório)' : 'ausente (opcional)'}`;
  return item;
}

function infoItem(label: string): HTMLElement {
  const item = document.createElement('li');
  item.textContent = label;
  return item;
}

export { describeFormat };
