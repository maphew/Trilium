# Include Note
Text notes can "include" another note as a read-only widget or an interactive widget, depending on the type of note.

This can be useful for e.g. including a dynamically generated chart (from scripts & "render HTML" note) or other more advanced use cases.

## Including a note

In the <a class="reference-link" href="Formatting%20toolbar.md">Formatting toolbar</a>, look for the <span class="tn-icon cke cke-trilium-note"></span> button. There is also a keyboard shortcut defined for it but it is not allocated by default.

An [attachment](../../Basic%20Concepts%20and%20Features/Notes/Attachments.md) can be included the same way, from the context menu of a link to it (see _Embedding an attachment_ there).

## Box sizes

The box size sets how much of the included note is shown.

*   _Tiny_ shows a single row instead of the content: the note's icon, its title with the path to the note above it, and buttons to act on the note.
*   _Small_ and _Medium_ show the content in a box of limited height. Text scrolls inside the box, while a picture, a diagram or a video is scaled down to fit it.
*   _Full_ shows the whole content.
*   _Expandable_ shows only the title until its <span class="tn-icon bx bx-chevron-right"></span> arrow is pressed.

A new include gets the size that suits what it shows:

*   _Tiny_ for a note or an attachment that has no preview, such as a relation map or an archive.
*   _Small_ for audio.
*   _Full_ for a code note.
*   _Medium_ for anything else.

The dialog that includes a note selects that size once the note is picked, and you can choose another one there. To change the size later, select the include and use the _Box size_ menu in its toolbar, or the _Size_ submenu of its _More actions_ menu.

## Caption

An include can have a caption, shown centered at the bottom of its box. The caption is part of the text note, so it can be formatted like the rest of the text, for example in bold or with a link.

*   To add a caption, select the include, press the <span class="tn-icon cke cke-caption"></span> _Toggle caption on_ button in its toolbar and type the caption.
*   To remove the caption, press the same button again. Pressing it once more brings back the text it had, as long as the note stays open.
*   A _Tiny_ include has no caption. Switching an include to _Tiny_ removes its caption, and switching it back to a larger size restores the caption, as long as the note stays open.
*   An _Expandable_ include shows its caption under the title while the content is collapsed, and under the content once it is expanded.

## Title

The title row of an include links to the included note and holds its buttons. To show only the content, select the include and press the <span class="tn-icon bx bx-window-alt"></span> _Show title_ button in its toolbar. Pressing it again shows the title.

*   While the title is hidden, the <span class="tn-icon cke cke-three-vertical-dots"></span> _More actions_ button in the toolbar of the include opens the menu of the included note.
*   A _Tiny_ or _Expandable_ include always shows its title, and its toolbar has no _Show title_ button.

## Opening an included note

To open an included note in a new tab, press the <span class="tn-icon bx bx-link-external"></span> _Open in new tab_ button at the end of its title. An embedded attachment has the same button.

The <span class="tn-icon bx bx-dots-vertical-rounded"></span> _More actions_ button at the end of the title row opens the same menu as right-clicking anywhere on the title row: the other places to open the note in and, for an embedded attachment, the actions on the attachment.

In a note being edited, the menu also has the commands of the include's toolbar: the _Size_ submenu, _Show title_ and _Show caption_, each checked while it is in effect, and _Convert to link_ at the end. For an embedded attachment they follow its first group of actions; for an included note they end the menu.

To show an include of size _Medium_ or _Full_ on the whole screen, press the <span class="tn-icon bx bx-fullscreen"></span> _Fullscreen_ button at the end of its title. To return, press <span class="tn-icon bx bx-exit"></span> _Exit fullscreen_ in the top-right corner, or <kbd>Esc</kbd>.

A _Tiny_ include has these buttons instead, followed by the same _More actions_ button:

*   For a note, <span class="tn-icon bx bx-edit"></span> _Quick edit_ opens the note in <a class="reference-link" href="../../Basic%20Concepts%20and%20Features/Navigation/Quick%20edit.md">Quick edit</a>, and <span class="tn-icon bx bx-link-external"></span> _Open in new tab_ opens it in a new tab.
*   For an embedded attachment, <span class="tn-icon bx bx-file-find"></span> _Open externally_ opens the file in another application, and <span class="tn-icon bx bx-download"></span> _Download_ downloads it. The size of the file is shown under its title.

## Converting an include to a link

To replace an include with a link to the included note, select it and press the <span class="tn-icon cke cke-link"></span> _Convert to link_ button in its toolbar, or choose _Convert to link_ at the end of its _More actions_ menu. An embedded attachment turns into a link to the attachment the same way.

## Included notes in the share functionality

If a [shared note](../../Advanced%20Usage/Sharing.md) contains one or more included notes, they will be displayed in the content of the note as if they were part of the note itself. The caption of an include is shown under the included content.

For this to work, the included notes must also be shared, otherwise they will not be shown. However, the included notes can still be hidden from the note tree via `#shareHiddenFromTree`.

## Interactive notes

Since v0.104.0, included notes might become interactive depending on their note type:

*   <a class="reference-link" href="../../Collections.md">Collections</a> (e.g. <a class="reference-link" href="../../Collections/Geo%20Map.md">Geo Map</a>) will render fully interactive, including creating new notes.
*   <a class="reference-link" href="../Saved%20Search.md">Saved Search</a> will also display the results.
*   <a class="reference-link" href="../Web%20View.md">Web View</a> provides an interactive preview of the website.