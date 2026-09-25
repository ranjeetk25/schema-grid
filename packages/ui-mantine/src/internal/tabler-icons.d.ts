// Typings for @tabler/icons-react per-icon ESM modules (the package only types its
// barrel). Used by ./icons.ts; every icon module default-exports a TablerIcon.
declare module "@tabler/icons-react/dist/esm/icons/*.mjs" {
  const icon: import("@tabler/icons-react").TablerIcon;
  export default icon;
}
