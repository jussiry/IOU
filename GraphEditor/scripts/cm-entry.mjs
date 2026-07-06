/**
 * cm-entry.mjs — the single entry point bundled into vendor/codemirror.js.
 *
 * CodeMirror 6 ships as many small ESM packages that share singleton core state
 * (facets, StateFields keyed by module identity). If those core packages get
 * duplicated across separately-bundled files everything breaks with
 * "unrecognized extension" errors. So we bundle *one* file, from this one entry,
 * re-exporting exactly what the app needs — guaranteeing a single shared core.
 *
 * Rebuild with:  npm run vendor:cm   (see package.json)
 */

export { EditorState, Compartment } from '@codemirror/state';
export { EditorView, keymap } from '@codemirror/view';
export {
  foldGutter,
  codeFolding,
  foldAll,
  unfoldAll,
  syntaxHighlighting,
  HighlightStyle,
} from '@codemirror/language';
export { javascript } from '@codemirror/lang-javascript';
export { tags } from '@lezer/highlight';
