# Include Note
Text notes can "include" another note as a read-only widget or an interactive widget, depending on the type of note.

This can be useful for e.g. including a dynamically generated chart (from scripts & "render HTML" note) or other more advanced use cases.

## Including a note

In the <a class="reference-link" href="Formatting%20toolbar.md">Formatting toolbar</a>, look for the <span class="tn-icon cke cke-trilium-note"></span> button. There is also a keyboard shortcut defined for it but it is not allocated by default.

An [attachment](../../Basic%20Concepts%20and%20Features/Notes/Attachments.md) can be included the same way, from the context menu of a link to it (see _Embedding an attachment_ there).

## Opening an included note

To open an included note in a new tab, press the <span class="tn-icon bx bx-link-external"></span> _Open in new tab_ button at the end of its title. An embedded attachment has the same button.

The <span class="tn-icon bx bx-dots-vertical-rounded"></span> _More actions_ button at the end of the title row opens the same menu as right-clicking the title: the other places to open the note in and, for an embedded attachment, the actions on the attachment.

## Included notes in the share functionality

If a [shared note](../../Advanced%20Usage/Sharing.md) contains one or more included notes, they will be displayed in the content of the note as if they were part of the note itself.

For this to work, the included notes must also be shared, otherwise they will not be shown. However, the included notes can still be hidden from the note tree via `#shareHiddenFromTree`.

## Interactive notes

Since v0.104.0, included notes might become interactive depending on their note type:

*   <a class="reference-link" href="../../Collections.md">Collections</a> (e.g. <a class="reference-link" href="../../Collections/Geo%20Map.md">Geo Map</a>) will render fully interactive, including creating new notes.
*   <a class="reference-link" href="../Saved%20Search.md">Saved Search</a> will also display the results.
*   <a class="reference-link" href="../Web%20View.md">Web View</a> provides an interactive preview of the website.