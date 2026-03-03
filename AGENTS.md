
## Code style
- Make DRY code, find patterns that repeat and wrap them into a function to keep code succinct.
- Use modular design:
  * Use dependencies between functions and variables as the main determinant in choosing what parts of the code should go into which module.
  * Modules are hierarchical: it can refer to a single file or to a folder that contains multiple files (=submodules) or to a folder that contains multiple folders.
  * UI modules (or "components") have related JS, HTML and CSS files inside same folder
- At the beginning of each JS file describe that code in one or two paragraphs.