/**
 * symbol-editor.js — a small read-only CodeMirror 6 editor used inside the hover
 * card to show a module's exported functions or constants.
 *
 * One editor instance is reused across nodes/modes: `setDoc(code)` swaps its
 * content and folds every foldable range, so multi-line functions collapse to
 * their signature line and multi-line constants to their first line. Single-line
 * entries (a plain value, a one-line arrow) show in full. There are no line
 * numbers — only a fold gutter so the user can expand a symbol.
 *
 * Read-only for now; editing (which will drive cross-file refactors of exported
 * names) is a later phase. CodeMirror is vendored as a single bundle — see
 * scripts/cm-entry.mjs and `npm run vendor:cm`.
 */

import {
  EditorState, EditorView,
  codeFolding, foldGutter, foldAll,
  syntaxHighlighting, HighlightStyle,
  javascript, tags,
} from '../../vendor/codemirror.js';

// Compact dark syntax palette, tuned to the app's card colours.
const highlight = HighlightStyle.define([
  { tag: tags.keyword, color: '#c678dd' },
  { tag: [tags.function(tags.variableName), tags.function(tags.propertyName)], color: '#61afef' },
  { tag: [tags.definition(tags.variableName), tags.definition(tags.propertyName)], color: '#61afef' },
  { tag: [tags.string, tags.special(tags.string)], color: '#98c379' },
  { tag: [tags.number, tags.bool, tags.null], color: '#d19a66' },
  { tag: [tags.typeName, tags.className], color: '#56b6c2' },
  { tag: tags.propertyName, color: '#e06c75' },
  { tag: [tags.comment, tags.lineComment, tags.blockComment], color: '#5c6370', fontStyle: 'italic' },
  { tag: [tags.operator, tags.punctuation, tags.separator], color: '#8a93a0' },
]);

const theme = EditorView.theme({
  '&': { fontSize: '11px', backgroundColor: 'transparent', color: '#c3cad3' },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { overflow: 'auto', lineHeight: '1.5', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace' },
  '.cm-gutters': { backgroundColor: 'transparent', border: 'none', color: '#4b5563' },
  '.cm-foldGutter .cm-gutterElement': { cursor: 'pointer', padding: '0 2px' },
  '.cm-activeLine, .cm-activeLineGutter': { backgroundColor: 'transparent' },
  '.cm-foldPlaceholder': { backgroundColor: 'rgba(255,255,255,0.06)', border: 'none', color: '#8a93a0', margin: '0 2px', padding: '0 4px', borderRadius: '3px' },
}, { dark: true });

export function createSymbolEditor(parent) {
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc: '',
      extensions: [
        javascript({ typescript: true }),
        codeFolding(),
        foldGutter({ markerDOM: markerFor }),
        syntaxHighlighting(highlight),
        theme,
        EditorView.editable.of(false),
        EditorState.readOnly.of(true),
      ],
    }),
  });

  function setDoc(code) {
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: code } });
    foldAll(view); // collapse every multi-line symbol to its first line
  }

  return { dom: view.dom, setDoc, view };
}

// Minimal fold arrows (▸ folded / ▾ open) instead of CM's default SVGs.
function markerFor(open) {
  const span = document.createElement('span');
  span.textContent = open ? '▾' : '▸';
  span.style.opacity = '0.6';
  return span;
}
