export const site = {
  name: 'Anchoa',
  title: 'Anchoa — Satu kawanan untuk semua urusan harianmu',
  description:
    'Dashboard pribadi dengan asisten suara. Tugas, jadwal, keuangan, jurnal, habit, dan file bergerak bersama dalam satu kawanan. Tersedia untuk Fedora Linux.',
  author: 'Syharipf',
  repository: 'https://github.com/Syharipf/Anchoa',
  releases: 'https://github.com/Syharipf/Anchoa/releases/latest',
  profile: 'https://github.com/Syharipf',
  version: '0.1',
  installCommand: 'sudo dnf install ./anchoa-*.x86_64.rpm',
  coprCommand: 'sudo dnf copr enable syharipf/anchoa',
  flatpakCommand: 'flatpak install flathub io.github.syharipf.Anchoa',
  linkedin: 'https://www.linkedin.com/',
} as const;

export function assetPath(path: string): string {
  return `${import.meta.env.BASE_URL.replace(/\/$/, '')}/${path.replace(/^\//, '')}`;
}
