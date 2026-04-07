## Shortcuts
"deploy": add and commit all file changes and push

## Code style
- Make DRY code: find patterns that repeat in code and wrap them into a function or other construct that can be reused to produce the same functionality in many places.
  * Also do this thinking forwards: e.g. when creating commonly used UI components, make them first as a reusable component, and then use that component to implement requested feature.
- At the beginning of each JS file describe that code in one or two paragraphs.
- Use modular design:
  * Use dependencies between functions and variables as the main determinant in choosing what parts of the code should go into which module.
  * Modules are hierarchical: it can refer to a single file or to a folder that contains multiple files (=submodules) or to a folder that contains multiple folders.
  * In UI modules (or "components") put related JS, HTML and CSS files inside the same folder.