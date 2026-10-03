export const site = {
  name: 'Anchoa',
  title: 'Anchoa — Satu kawanan untuk semua urusan harianmu',
  description:
    'Dashboard pribadi dengan asisten suara. Tugas, jadwal, keuangan, jurnal, habit, dan file bergerak bersama dalam satu kawanan. Tersedia untuk Fedora Linux.',
  author: 'Anchoa',
  repository: 'https://github.com/Syharipf/Anchoa',
  releases: 'https://github.com/Syharipf/Anchoa/releases/latest',
  profile: 'https://github.com/Syharipf/Anchoa',
  version: '0.18.0',
  installCommand: 'sudo dnf install ./Anchoa-*.x86_64.rpm',
  coprCommand:
    'sudo dnf config-manager addrepo --from-repofile=https://syharipf.github.io/Anchoa/anchoa.repo',
  flatpakCommand: '# Flatpak: planned',
  linkedin: 'https://www.linkedin.com/',
} as const;

export function assetPath(path: string): string {
  return `${import.meta.env.BASE_URL.replace(/\/$/, '')}/${path.replace(/^\//, '')}`;
}
