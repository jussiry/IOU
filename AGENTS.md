## Code style
- Make DRY code: find patterns that repeat in code and wrap them into a function or other construct that can be reused to produce the same functionality in many places.
  * Be forward thinking: e.g. when creating commonly used UI components, make them first as a reusable component, and then use that component to implement requested feature.
- At the beginning of each JS file describe that code in few paragraphs.
- In UI modules (or "components") put related JS, HTML and CSS files inside the same folder.
- Avoid single-use variables — inline the expression directly unless the line becomes too long to read comfortably.

---

## Design

[`Design`](/design/assets/pages.js) contains documentation of this project.

- Design is meant to be useful both for AI and humans.
- Before making major implementations read relevant parts related to it from design.

**Update design pages**
- When you notice it to be out of sync with code.
- After implementing a new feature or making making major change to the app.
- Create a new page for new major features that don't yet have a page.
- Be succint in documentation and crosslink pages heavily. Crosslinking is used to avoid repeating same information.

**Glossary** contains the main concepts of the app. Keep it uptodate and link other parts of documentation to it easily.

Note that Tally mainly lives is /app and /server folders. If other files require documentation this mainly goes under Tooling group.