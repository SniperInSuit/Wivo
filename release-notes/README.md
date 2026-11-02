# Release notes ("What's new")

What clinic and lab staff see in the "What's new" window. Write for them: what
changed for their day, where to find it, in plain words. Technical detail goes
in CHANGELOG.md.

## Where

One folder per version, named exactly like `version` in package.json, with one
file per language:

```
release-notes/
  2.0.0/
    en.md   English, the source; also shown in Russian until ru.md exists
    et.md   Estonian
```

Both en.md and et.md are required (a test checks).

## When it shows

- The window opens by itself once per person, after sign-in, the first time
  they use a version that has notes. Desktop and phone share the "seen" mark.
- A version without its own folder (a patch, say 2.0.1) shows nothing new: it
  keeps the notes of the newest version before it, already seen.
- Anyone can reopen it: "What's new" in the sidebar footer (desktop) or in
  Settings (phone).
- While developing (`npm run dev`, `npm run mobile:dev`), the menu also shows
  notes for a version that isn't released yet, so you can read them before the
  version bump.

## Format

A small part of Markdown, nothing else:

- `# Title`: the window's heading (first line)
- `## Heading`
- paragraphs (separate them with a blank line)
- `- ` list items (a long item can continue on an indented next line)
- `**bold**`
- `[link text](https://…)`: only https links

No nesting: a link inside `**bold**` loses its link.
