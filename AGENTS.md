
## Code style
- Make DRY code, find patterns that repeat and wrap them into a function to keep code succinct.
- At the beginning of each JS file describe that code in one or two paragraphs.
- Use modular design:
  * Use dependencies between functions and variables as the main determinant in choosing what parts of the code should go into which module.
  * Modules are hierarchical: it can refer to a single file or to a folder that contains multiple files (=submodules) or to a folder that contains multiple folders.
  * In UI modules (or "components") put related JS, HTML and CSS files inside the same folder.