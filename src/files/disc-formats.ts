/**
 * Disc image / executable format knowledge.
 *
 * Play! accepts uncompressed ISO images, compressed container images (CSO, ISZ, CHD) and
 * raw ELF executables. This module validates the *container*, not the game: it confirms the
 * file is something the emulator can mount, and reports what it can see. It never claims a
 * game is playable.
 */

export type DiscFormat = 'iso' | 'cso' | 'isz' | 'chd' | 'cue' | 'mds' | 'elf' | 'bin' | 'unknown';

export interface FormatInfo {
  format: DiscFormat;
  /** Human-readable label. */
  label: string;
  /** True when Play! can mount this container directly. */
  supported: boolean;
  /** True when the container needs a companion file (.cue/.mds point at .bin tracks). */
  needsCompanion: boolean;
  /** True for compressed containers, which trade CPU for disk space. */
  compressed: boolean;
}

const FORMATS: Record<DiscFormat, FormatInfo> = {
  iso: { format: 'iso', label: 'Imagem ISO (ISO9660/UDF)', supported: true, needsCompanion: false, compressed: false },
  cso: { format: 'cso', label: 'Imagem CSO compactada', supported: true, needsCompanion: false, compressed: true },
  isz: { format: 'isz', label: 'Imagem ISZ compactada', supported: true, needsCompanion: false, compressed: true },
  chd: { format: 'chd', label: 'Imagem CHD (MAME CHD)', supported: true, needsCompanion: false, compressed: true },
  cue: { format: 'cue', label: 'Folha de cues (.cue)', supported: true, needsCompanion: true, compressed: false },
  mds: { format: 'mds', label: 'Descritor Media Descriptor (.mds)', supported: true, needsCompanion: true, compressed: false },
  elf: { format: 'elf', label: 'Executável PS2 ELF', supported: true, needsCompanion: false, compressed: false },
  bin: { format: 'bin', label: 'Faixa binária (.bin)', supported: true, needsCompanion: true, compressed: false },
  unknown: { format: 'unknown', label: 'Formato não reconhecido', supported: false, needsCompanion: false, compressed: false },
};

export function describeFormat(format: DiscFormat): FormatInfo {
  return FORMATS[format];
}

/** All extensions the file picker accepts, derived from the format table. */
export const ACCEPTED_EXTENSIONS = ['.iso', '.cso', '.isz', '.chd', '.cue', '.mds', '.bin', '.elf'];

export function formatFromExtension(fileName: string): DiscFormat {
  const dot = fileName.lastIndexOf('.');
  if (dot < 0) return 'unknown';
  const extension = fileName.slice(dot).toLowerCase();
  switch (extension) {
    case '.iso':
      return 'iso';
    case '.cso':
      return 'cso';
    case '.isz':
      return 'isz';
    case '.chd':
      return 'chd';
    case '.cue':
      return 'cue';
    case '.mds':
      return 'mds';
    case '.bin':
      return 'bin';
    case '.elf':
      return 'elf';
    default:
      return 'unknown';
  }
}

export type ValidationSeverity = 'error' | 'warning' | 'info';

export interface ValidationIssue {
  severity: ValidationSeverity;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  format: DiscFormat;
  /** First bytes, as hex, for diagnostics. */
  signature: string;
  /** ISO9660 primary volume descriptor identifier, when present. */
  volumeDescriptor: string | null;
  /** True when the string "SYSTEM.CNF" appears early in the image (a PS2 disc marker). */
  looksLikePs2Disc: boolean;
  issues: ValidationIssue[];
}

const MAGIC = {
  chd: 'MComprHD',
  cso: 'CISO',
  isz: 'IsZ!',
} as const;

function toAscii(bytes: Uint8Array): string {
  return [...bytes].map((b) => (b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : '.')).join('');
}

function hex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join(' ');
}

/** Read a byte range from a Blob without loading the whole file. */
async function readSlice(blob: Blob, start: number, length: number): Promise<Uint8Array> {
  const end = Math.min(blob.size, start + length);
  if (start >= end) return new Uint8Array(0);
  const buffer = await blob.slice(start, end).arrayBuffer();
  return new Uint8Array(buffer);
}

/** Find an ASCII needle inside a byte range. */
function findAscii(haystack: Uint8Array, needle: string): boolean {
  const target = [...needle].map((c) => c.charCodeAt(0));
  outer: for (let i = 0; i + target.length <= haystack.length; i++) {
    for (let j = 0; j < target.length; j++) {
      if (haystack[i + j] !== target[j]) continue outer;
    }
    return true;
  }
  return false;
}

/**
 * Validate a user-supplied disc image or ELF.
 *
 * Reads only a few small slices, so it is safe for multi-gigabyte files. The returned
 * `valid` flag means "the container is well formed and Play! can try to mount it" — never
 * "the game will run".
 */
export async function validateDiscFile(file: File): Promise<ValidationResult> {
  const format = formatFromExtension(file.name);
  const issues: ValidationIssue[] = [];
  const head = await readSlice(file, 0, 512);
  const signature = hex(head.subarray(0, Math.min(16, head.length)));

  if (file.size === 0) {
    issues.push({ severity: 'error', message: 'O arquivo está vazio.' });
    return { valid: false, format, signature, volumeDescriptor: null, looksLikePs2Disc: false, issues };
  }

  let volumeDescriptor: string | null = null;
  let looksLikePs2Disc = false;

  switch (format) {
    case 'chd': {
      if (toAscii(head.subarray(0, 8)) !== MAGIC.chd) {
        issues.push({ severity: 'error', message: 'A assinatura CHD ("MComprHD") não foi encontrada.' });
      }
      break;
    }
    case 'cso': {
      if (toAscii(head.subarray(0, 4)) !== MAGIC.cso) {
        issues.push({ severity: 'error', message: 'A assinatura CSO ("CISO") não foi encontrada.' });
      }
      issues.push({
        severity: 'info',
        message: 'Imagem compactada: descomprimir consome CPU. Uma ISO sem compressão tende a rodar melhor.',
      });
      break;
    }
    case 'isz': {
      if (toAscii(head.subarray(0, 4)) !== MAGIC.isz) {
        issues.push({ severity: 'error', message: 'A assinatura ISZ ("IsZ!") não foi encontrada.' });
      }
      issues.push({
        severity: 'info',
        message: 'Imagem compactada: descomprimir consome CPU. Uma ISO sem compressão tende a rodar melhor.',
      });
      break;
    }
    case 'iso': {
      // ISO9660 primary volume descriptor lives at sector 16 (offset 0x8000).
      const pvd = await readSlice(file, 0x8000, 8);
      const identifier = toAscii(pvd.subarray(1, 6));
      volumeDescriptor = identifier || null;
      if (identifier !== 'CD001') {
        issues.push({
          severity: 'error',
          message: 'O descritor de volume ISO9660 ("CD001") não foi encontrado no setor 16. O arquivo pode não ser uma imagem de disco válida.',
        });
      } else {
        issues.push({ severity: 'info', message: 'Descritor de volume ISO9660 "CD001" confirmado.' });
      }
      // SYSTEM.CNF sits in the root directory, which is always near the start of the image.
      const scan = await readSlice(file, 0x8000, 2 * 1024 * 1024);
      looksLikePs2Disc = findAscii(scan, 'SYSTEM.CNF');
      if (looksLikePs2Disc) {
        issues.push({ severity: 'info', message: 'Marcador "SYSTEM.CNF" encontrado: a imagem parece ser de um disco de PlayStation 2.' });
      } else {
        issues.push({
          severity: 'warning',
          message: 'Não encontrei "SYSTEM.CNF" nos primeiros 2 MB. A imagem pode não ser um disco de PS2 (ou o diretório raiz está mais adiante).',
        });
      }
      break;
    }
    case 'cue': {
      const text = new TextDecoder().decode(await readSlice(file, 0, 64 * 1024));
      if (!/^\s*FILE\s+/im.test(text)) {
        issues.push({ severity: 'error', message: 'A folha .cue não contém nenhuma diretiva FILE.' });
      }
      issues.push({
        severity: 'warning',
        message: 'Um .cue depende do arquivo .bin correspondente. Selecione o .cue; o navegador precisa que o .bin esteja acessível (veja a documentação).',
      });
      break;
    }
    case 'mds': {
      if (toAscii(head.subarray(0, 7)) !== 'MEDIA D') {
        issues.push({ severity: 'warning', message: 'O cabeçalho .mds esperado ("MEDIA DESCRIPTOR") não foi reconhecido.' });
      }
      issues.push({ severity: 'warning', message: 'Um .mds depende do arquivo .mdf correspondente.' });
      break;
    }
    case 'bin': {
      issues.push({
        severity: 'warning',
        message: 'Um .bin normalmente é uma faixa de um .cue/.mds. Selecionar a folha (.cue/.mds) é mais seguro.',
      });
      break;
    }
    case 'elf': {
      const isElf = head[0] === 0x7f && head[1] === 0x45 && head[2] === 0x4c && head[3] === 0x46;
      if (!isElf) {
        issues.push({ severity: 'error', message: 'A assinatura ELF (7F 45 4C 46) não foi encontrada.' });
      } else {
        const littleEndian = head[5] === 1;
        const machine = littleEndian ? head[18] | (head[19] << 8) : (head[18] << 8) | head[19];
        // 0x08 = MIPS, the PlayStation 2's architecture.
        if (machine !== 0x08) {
          issues.push({
            severity: 'error',
            message: `O ELF é para a arquitetura 0x${machine.toString(16)}, não MIPS (0x08). Não é um executável de PS2.`,
          });
        } else {
          issues.push({ severity: 'info', message: 'ELF MIPS válido (arquitetura do PlayStation 2).' });
        }
      }
      break;
    }
    default: {
      issues.push({
        severity: 'error',
        message: `Extensão não suportada. Formatos aceitos: ${ACCEPTED_EXTENSIONS.join(', ')}.`,
      });
      break;
    }
  }

  if (format !== 'elf' && format !== 'unknown' && file.size < 100 * 1024 * 1024) {
    issues.push({
      severity: 'warning',
      message: `O arquivo tem apenas ${(file.size / 1048576).toFixed(1)} MB. Discos de PlayStation 2 normalmente têm entre 700 MB e 8 GB.`,
    });
  }

  const valid = !issues.some((issue) => issue.severity === 'error');
  return { valid, format, signature, volumeDescriptor, looksLikePs2Disc, issues };
}
