// node:sqlite is still flagged experimental, so importing it prints a warning to
// stderr on every run. That noise lands in agent transcripts and in the output
// of `next`/`done`, where it reads like a failure. Drop that one warning and
// leave every other warning alone.
//
// Must be called *before* node:sqlite is imported, which is why the modules
// that touch the DB are pulled in with a dynamic import after this runs.
export function silenceSqliteWarning() {
  const emit = process.emitWarning;
  process.emitWarning = (warning, ...rest) => {
    if (String(warning).includes("SQLite is an experimental feature")) return;
    return emit.call(process, warning, ...rest);
  };
}
