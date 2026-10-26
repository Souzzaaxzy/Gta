#!/usr/bin/env python3
"""
Gera a imagem de disco de teste usada pelos testes de navegador.

A imagem tem um sistema de arquivos ISO9660 real, com SYSTEM.CNF apontando para o
executavel de boot, exatamente como um disco de PlayStation 2. Ela NAO contem o jogo:
o executavel e um arquivo de 4 KB que nao e um ELF valido.

Isso e proposital. O nucleo do emulador percorre a cadeia inteira
(ISO9660 -> SYSTEM.CNF -> alvo do BOOT2 -> carga como ELF) e falha no ultimo passo,
porque o arquivo nao e um jogo. A falha prova que todos os passos anteriores
funcionaram. Uma imagem sintetica nao pode ser um jogo jogavel.

Uso:
    python3 scripts/make-test-iso.py tests/fixtures/ps2-disc-test.iso
"""
import io
import sys

try:
    import pycdlib
except ImportError:
    sys.exit("pycdlib nao instalado. Rode: python3 -m pip install pycdlib")


def build(path: str) -> None:
    iso = pycdlib.PyCdlib()
    iso.new(interchange_level=1, vol_ident="PS2-TEST-DISC")

    # SYSTEM.CNF de um disco de PS2: nomeia o executavel de boot.
    # SLUS_209.46 e o identificador da versao americana de GTA: San Andreas.
    system_cnf = b"BOOT2 = cdrom0:\\SLUS_209.46;1\r\nVER = 1.00\r\nVMODE = NTSC\r\n"
    iso.add_fp(io.BytesIO(system_cnf), len(system_cnf), iso_path="/SYSTEM.CNF;1")

    # Espaco reservado no lugar do executavel real. Apenas a assinatura ELF.
    placeholder = b"\x7fELF" + bytes(4092)
    iso.add_fp(io.BytesIO(placeholder), len(placeholder), iso_path="/SLUS_209.46;1")

    readme = b"Imagem de teste. Nao contem o jogo.\n"
    iso.add_fp(io.BytesIO(readme), len(readme), iso_path="/README.TXT;1")

    iso.write(path)
    iso.close()
    print(f"gerado: {path}")


if __name__ == "__main__":
    target = sys.argv[1] if len(sys.argv) > 1 else "tests/fixtures/ps2-disc-test.iso"
    build(target)
