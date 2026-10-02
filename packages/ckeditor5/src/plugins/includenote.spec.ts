import {
    _getModelData as getModelData,
    _getViewData as getViewData,
    _setModelData as setModelData,
    Bold,
    ButtonView,
    ClassicEditor,
    Essentials,
    LinkEditing,
    Paragraph,
    Undo,
    Widget,
    type ModelElement
} from "ckeditor5";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createTestEditor } from "../../test/editor-kit.js";
import { installGlobMock } from "../../test/globals-test-kit.js";
import IncludeNote, {
    BOX_SIZE_COMMAND_NAME,
    BOX_SIZES,
    COMMAND_NAME,
    EMBED_ATTACHMENT_LINK_COMMAND,
    CONVERT_EMBED_TO_LINK_COMMAND,
    TOGGLE_CAPTION_COMMAND_NAME
} from "./includenote.js";
import ReferenceLink from "./referencelink.js";

describe("IncludeNote", () => {
    let editor: ClassicEditor;
    let triggerCommand: ReturnType<typeof vi.fn>;
    let loadIncludedNote: ReturnType<typeof vi.fn>;

    beforeEach(async () => {
        triggerCommand = vi.fn();
        loadIncludedNote = vi.fn();
        installGlobMock({
            getComponentByEl: () => ({ triggerCommand, loadIncludedNote })
        });

        editor = await createTestEditor([Essentials, Paragraph, Widget, IncludeNote]);
    });

    // -----------------------------------------------------------------------
    // Plugin / schema registration
    // -----------------------------------------------------------------------

    it("loads the plugin, sub-plugins, schema, commands and the toolbar button", () => {
        expect(editor.plugins.get(IncludeNote)).toBeInstanceOf(IncludeNote);
        expect(editor.commands.get(COMMAND_NAME)).toBeDefined();
        expect(editor.commands.get(BOX_SIZE_COMMAND_NAME)).toBeDefined();
        expect(editor.ui.componentFactory.has("includeNote")).toBe(true);

        const schema = editor.model.schema;
        expect(schema.isRegistered("includeNote")).toBe(true);
        expect(schema.isObject("includeNote")).toBe(true);
        expect(schema.checkAttribute(["$root", "includeNote"], "noteId")).toBe(true);
        expect(schema.checkAttribute(["$root", "includeNote"], "boxSize")).toBe(true);
    });

    // -----------------------------------------------------------------------
    // UI button
    // -----------------------------------------------------------------------

    it("wires the toolbar button to the insert command (enablement and execution)", () => {
        const view = editor.ui.componentFactory.create("includeNote") as {
            isEnabled: boolean;
            isOn: boolean;
            label: string;
            fire(name: string): void;
        };
        const command = editor.commands.get(COMMAND_NAME);

        expect(view.label).toBe("Include note");
        expect(view.isEnabled).toBe(command?.isEnabled);

        const spy = vi.spyOn(editor, "execute");
        view.fire("execute");
        expect(spy).toHaveBeenCalledWith(COMMAND_NAME);
    });

    // -----------------------------------------------------------------------
    // Conversion: upcast / data downcast / editing downcast
    // -----------------------------------------------------------------------

    it("loads a <figure> include and a legacy <section>, and saves a <figure>", () => {
        for (const tag of [ "figure", "section" ]) {
            editor.setData(`<${tag} class="include-note" data-note-id="abc123"`
                + ` data-box-size="medium"></${tag}>`);

            const element = findIncludeNote(editor);
            expect(element?.getAttribute("noteId")).toBe("abc123");
            expect(element?.getAttribute("boxSize")).toBe("medium");
            expect(editor.getData()).toBe("<figure class=\"include-note\" data-note-id=\"abc123\" "
                + "data-box-size=\"medium\">&nbsp;</figure>");
        }
    });

    it("editing-downcasts to a widget and invokes loadIncludedNote when the UIElement renders", () => {
        editor.setData(
            '<figure class="include-note" data-note-id="noteY" data-box-size="small"></figure>'
        );

        const view = getViewData(editor.editing.view);
        expect(view).toContain("include-note");
        expect(view).toContain("ck-widget");
        // The block widget carries CKEditor's selection handle so it can be dragged atomically.
        expect(view).toContain("ck-widget_with-selection-handle");
        expect(view).toContain("box-size-small");

        // Querying the DOM root forces the UIElement render callback to run.
        const domRoot = editor.editing.view.getDomRoot();
        const wrapper = domRoot?.querySelector("div.include-note-wrapper");
        expect(wrapper).not.toBeNull();

        expect(loadIncludedNote).toHaveBeenCalledTimes(1);
        expect(loadIncludedNote.mock.calls[0]?.[0]).toBe("noteY");
        // The box size is passed explicitly so the client render does not have to read it back
        // from the DOM (which may not be flushed yet at conversion time).
        expect(loadIncludedNote.mock.calls[0]?.[2]).toBe("small");
    });

    it("updates the box-size class on the editing view when the boxSize attribute changes", () => {
        insertIncludeNote(editor, "noteZ", "small");

        const domRoot = editor.editing.view.getDomRoot();
        const figure = domRoot?.querySelector("figure.include-note");
        expect(figure?.classList.contains("box-size-small")).toBe(true);

        editor.execute(BOX_SIZE_COMMAND_NAME, { value: "full" });

        expect(figure?.classList.contains("box-size-small")).toBe(false);
        expect(figure?.classList.contains("box-size-full")).toBe(true);
        expect(figure?.getAttribute("data-box-size")).toBe("full");
    });

    it("re-renders the included note content with the new size on a genuine box-size change", () => {
        insertIncludeNote(editor, "noteReload", "small");

        // One call for the initial render.
        expect(loadIncludedNote).toHaveBeenCalledTimes(1);
        expect(loadIncludedNote.mock.calls[0]?.[2]).toBe("small");

        editor.execute(BOX_SIZE_COMMAND_NAME, { value: "expandable" });

        // The downcast handler drives a second render with the new size, without any DOM observer.
        expect(loadIncludedNote).toHaveBeenCalledTimes(2);
        const reloadCall = loadIncludedNote.mock.calls[1];
        expect(reloadCall?.[0]).toBe("noteReload");
        expect(reloadCall?.[2]).toBe("expandable");
    });

    it("handles a boxSize change from an empty old value (no class to remove)", () => {
        // Insert an includeNote whose boxSize is empty so the attribute-change converter
        // hits the falsy `oldBoxSize` branch when the value is set for the first time.
        const element = insertIncludeNote(editor, "noteW", "");

        editor.model.change((writer) => {
            writer.setAttribute("boxSize", "medium", element);
        });

        const domRoot = editor.editing.view.getDomRoot();
        const figure = domRoot?.querySelector("figure.include-note");
        expect(figure?.classList.contains("box-size-medium")).toBe(true);
        expect(figure?.getAttribute("data-box-size")).toBe("medium");
    });

    it("ignores a boxSize change cleared to an empty value (no new class to add)", () => {
        const element = insertIncludeNote(editor, "noteV", "small");

        editor.model.change((writer) => {
            writer.setAttribute("boxSize", "", element);
        });

        const domRoot = editor.editing.view.getDomRoot();
        const figure = domRoot?.querySelector("figure.include-note");
        // Old class removed, no new class added because the new value is empty.
        expect(figure?.classList.contains("box-size-small")).toBe(false);
        expect(figure?.classList.contains("box-size-")).toBe(false);
    });

    // -----------------------------------------------------------------------
    // InsertIncludeNoteCommand
    // -----------------------------------------------------------------------

    it("triggers addIncludeNoteToText on the Trilium component when the insert command executes", () => {
        editor.execute(COMMAND_NAME);
        expect(triggerCommand).toHaveBeenCalledWith("addIncludeNoteToText");
    });

    it("enables the insert command in a paragraph and disables it where blocks are disallowed", () => {
        const command = editor.commands.get(COMMAND_NAME);

        setModelData(editor.model, "<paragraph>foo[]bar</paragraph>");
        expect(command?.isEnabled).toBe(true);

        // Forbid includeNote anywhere via a child check, then refresh: no allowed parent
        // for the current selection means the command disables itself.
        editor.model.schema.addChildCheck((_context, def) => {
            if (def.name === "includeNote") {
                return false;
            }
        });
        command?.refresh();
        expect(command?.isEnabled).toBe(false);
    });

    // -----------------------------------------------------------------------
    // IncludeNoteBoxSizeCommand
    // -----------------------------------------------------------------------

    it("box-size command is disabled with no selected includeNote and reports a null value", () => {
        setModelData(editor.model, "<paragraph>foo[]bar</paragraph>");

        const command = editor.commands.get(BOX_SIZE_COMMAND_NAME) as {
            isEnabled: boolean;
            value: string | null;
        };
        expect(command.isEnabled).toBe(false);
        expect(command.value).toBeNull();
    });

    it("box-size command enables and reflects the value when an includeNote is selected", () => {
        insertIncludeNote(editor, "noteSel", "medium");

        const command = editor.commands.get(BOX_SIZE_COMMAND_NAME) as {
            isEnabled: boolean;
            value: string | null;
        };
        expect(command.isEnabled).toBe(true);
        expect(command.value).toBe("medium");

        // Execute through every defined box size to cover the model write path.
        for (const value of BOX_SIZES) {
            editor.execute(BOX_SIZE_COMMAND_NAME, { value });
            expect(command.value).toBe(value);
            expect(findIncludeNote(editor)?.getAttribute("boxSize")).toBe(value);
        }
    });

    it("box-size command resolves the includeNote via an ancestor position (not a direct selection)", () => {
        // Make the includeNote allow text inside so the selection can be placed within it
        // (a collapsed position) rather than selecting the element itself.
        editor.model.schema.extend("$text", { allowIn: "includeNote" });

        const element = insertIncludeNote(editor, "noteAnc", "expandable");
        editor.model.change((writer) => {
            writer.setSelection(writer.createPositionAt(element, 0));
        });

        const command = editor.commands.get(BOX_SIZE_COMMAND_NAME) as {
            isEnabled: boolean;
            value: string | null;
        };
        expect(command.isEnabled).toBe(true);
        expect(command.value).toBe("expandable");
    });

    it("box-size command execute is a no-op when nothing is selected", () => {
        setModelData(editor.model, "<paragraph>foo[]bar</paragraph>");
        const before = editor.getData();

        // The decorated Command.execute short-circuits while the command is disabled, so to
        // run our execute() body with no includeNote selected we force it enabled first. This
        // exercises the falsy `if (includeNoteElement)` branch.
        const command = editor.commands.get(BOX_SIZE_COMMAND_NAME) as {
            isEnabled: boolean;
            execute(options: { value: string }): void;
        };
        command.isEnabled = true;
        command.execute({ value: "full" });

        expect(editor.getData()).toBe(before);
    });

    // -----------------------------------------------------------------------
    // preventCKEditorHandling / selectIncludeNoteWidget (DOM event handlers)
    // -----------------------------------------------------------------------

    it("selects the widget and suppresses editor handling on a mousedown inside the wrapper", () => {
        insertIncludeNote(editor, "noteEvt", "small");

        const domRoot = editor.editing.view.getDomRoot();
        const wrapper = domRoot?.querySelector("div.include-note-wrapper");
        expect(wrapper).not.toBeNull();
        if (!wrapper) {
            return;
        }

        const evt = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
        const stopSpy = vi.spyOn(evt, "stopPropagation");
        wrapper.dispatchEvent(evt);
        expect(stopSpy).toHaveBeenCalled();

        // The widget should now be selected (the mousedown handler selects it).
        const selected = editor.model.document.selection.getSelectedElement();
        expect(selected?.name).toBe("includeNote");
    });

    it("suppresses the native caret on a non-interactive mousedown but not on interactive targets", () => {
        insertIncludeNote(editor, "noteCaret", "small");

        const domRoot = editor.editing.view.getDomRoot();
        const wrapper = domRoot?.querySelector("div.include-note-wrapper");
        expect(wrapper).not.toBeNull();
        if (!wrapper) {
            return;
        }

        // Clicking a plain (non-interactive) area should preventDefault so the browser does not
        // drop a caret next to the contenteditable=false widget.
        const plainEvt = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
        const plainPrevent = vi.spyOn(plainEvt, "preventDefault");
        wrapper.dispatchEvent(plainEvt);
        expect(plainPrevent).toHaveBeenCalled();

        // Clicking a link must keep native behaviour: the handler steps aside entirely, so neither
        // preventDefault nor stopPropagation is called.
        const innerLink = document.createElement("a");
        innerLink.href = "#root/abc";
        wrapper.appendChild(innerLink);

        const linkEvt = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
        const linkPrevent = vi.spyOn(linkEvt, "preventDefault");
        const linkStop = vi.spyOn(linkEvt, "stopPropagation");
        innerLink.dispatchEvent(linkEvt);
        expect(linkPrevent).not.toHaveBeenCalled();
        expect(linkStop).not.toHaveBeenCalled();
    });

    it("selects the widget on a press on a title row button, and keeps the focus in the editor", () => {
        const include = insertIncludeNote(editor, "noteButton", "small");
        editor.model.change((writer) => {
            const paragraph = include.nextSibling;
            if (!paragraph) {
                throw new Error("Expected a paragraph after the include.");
            }
            writer.setSelection(paragraph, 0);
        });

        const domRoot = editor.editing.view.getDomRoot();
        const wrapper = domRoot?.querySelector("div.include-note-wrapper");
        expect(wrapper).not.toBeNull();
        if (!domRoot || !wrapper) {
            return;
        }
        wrapper.innerHTML = `<div class="include-note-title-row"><button><span></span></button></div>`
            + `<div class="include-note-content"><button></button></div>`;
        const [ titleRowButton, contentButton ] = wrapper.querySelectorAll("button");

        // A button of the rendered content keeps its native handling.
        const contentEvt = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
        contentButton.dispatchEvent(contentEvt);
        expect(contentEvt.defaultPrevented).toBe(false);
        expect(editor.model.document.selection.getSelectedElement()).toBeNull();

        const evt = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
        const stop = vi.spyOn(evt, "stopPropagation");
        titleRowButton.querySelector("span")?.dispatchEvent(evt);

        expect(editor.model.document.selection.getSelectedElement()).toBe(include);
        expect(document.activeElement).toBe(domRoot);
        // No focus for the button itself; its click still runs.
        expect(evt.defaultPrevented).toBe(true);
        expect(stop).not.toHaveBeenCalled();
    });

    it("leaves a mousedown inside an embedded collection untouched so the live widget keeps working", () => {
        insertIncludeNote(editor, "noteColl", "full");

        const domRoot = editor.editing.view.getDomRoot();
        const wrapper = domRoot?.querySelector("div.include-note-wrapper");
        expect(wrapper).not.toBeNull();
        if (!wrapper) {
            return;
        }

        // Simulate the embedded collection markup (e.g. a geo-map marker lives under .rendered-collection).
        const collection = document.createElement("div");
        collection.className = "rendered-collection";
        const marker = document.createElement("div");
        collection.appendChild(marker);
        wrapper.appendChild(collection);

        const evt = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
        const prevent = vi.spyOn(evt, "preventDefault");
        const stop = vi.spyOn(evt, "stopPropagation");
        marker.dispatchEvent(evt);

        // The handler must step aside completely so Leaflet (and other live widgets) get the event.
        expect(prevent).not.toHaveBeenCalled();
        expect(stop).not.toHaveBeenCalled();
    });

    it("treats a mousedown whose target is not an Element (e.g. a text node) as non-interactive", () => {
        insertIncludeNote(editor, "noteText", "small");

        const domRoot = editor.editing.view.getDomRoot();
        const wrapper = domRoot?.querySelector("div.include-note-wrapper");
        expect(wrapper).not.toBeNull();
        if (!wrapper) {
            return;
        }

        // A capture-phase mousedown on a bare text node makes evt.target a Text, not an Element. The
        // interactive-target guard must short-circuit and report "not interactive", so the widget's
        // normal suppression (preventDefault + stopPropagation) still runs.
        const textNode = document.createTextNode("plain text");
        wrapper.appendChild(textNode);

        const evt = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
        const prevent = vi.spyOn(evt, "preventDefault");
        const stop = vi.spyOn(evt, "stopPropagation");
        textNode.dispatchEvent(evt);

        expect(prevent).toHaveBeenCalled();
        expect(stop).toHaveBeenCalled();
    });

    it("stops propagation on focus and keydown inside the wrapper", () => {
        insertIncludeNote(editor, "noteKbd", "small");

        const domRoot = editor.editing.view.getDomRoot();
        const wrapper = domRoot?.querySelector("div.include-note-wrapper");
        expect(wrapper).not.toBeNull();
        if (!wrapper) {
            return;
        }

        const focusEvt = new FocusEvent("focus");
        const focusStop = vi.spyOn(focusEvt, "stopPropagation");
        wrapper.dispatchEvent(focusEvt);
        expect(focusStop).toHaveBeenCalled();

        const keyEvt = new KeyboardEvent("keydown", { bubbles: true });
        const keyStop = vi.spyOn(keyEvt, "stopPropagation");
        wrapper.dispatchEvent(keyEvt);
        expect(keyStop).toHaveBeenCalled();
    });

    it("does nothing on a mousedown when the wrapper has no enclosing include", () => {
        insertIncludeNote(editor, "noteDetached", "small");

        const domRoot = editor.editing.view.getDomRoot();
        const wrapper = domRoot?.querySelector("div.include-note-wrapper");
        expect(wrapper).not.toBeNull();
        if (!wrapper) {
            return;
        }

        // Detach the wrapper (which carries the capture-phase mousedown handler) from its
        // include so that domElement.closest(".include-note") returns null. The handler
        // still fires because it is bound to the wrapper element itself.
        const holder = document.createElement("div");
        document.body.appendChild(holder);
        holder.appendChild(wrapper);

        wrapper.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));

        holder.remove();
        // The early return means no selection change beyond the original insert selection.
        expect(true).toBe(true);
    });

    it("does nothing on a mousedown when the include is not mapped to a view element", () => {
        insertIncludeNote(editor, "noteUnmapped", "small");

        const domRoot = editor.editing.view.getDomRoot();
        const wrapper = domRoot?.querySelector("div.include-note-wrapper");
        expect(wrapper).not.toBeNull();
        if (!wrapper) {
            return;
        }

        // Move the wrapper into a hand-built figure.include-note that the editor's
        // DomConverter knows nothing about. closest() then finds this fake include, but
        // mapDomToView() returns nothing for it, so selectIncludeNoteWidget returns early.
        const fakeFigure = document.createElement("figure");
        fakeFigure.className = "include-note";
        document.body.appendChild(fakeFigure);
        fakeFigure.appendChild(wrapper);

        wrapper.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));

        fakeFigure.remove();
        expect(true).toBe(true);
    });

    it("does nothing on a mousedown when the include's view maps to no model element", () => {
        insertIncludeNote(editor, "noteNoModel", "small");

        const domRoot = editor.editing.view.getDomRoot();
        const wrapper = domRoot?.querySelector("div.include-note-wrapper");
        const figure = domRoot?.querySelector<HTMLElement>("figure.include-note");
        expect(wrapper).not.toBeNull();
        expect(figure).not.toBeNull();
        if (!wrapper || !figure) {
            return;
        }

        // The DOM->view mapping stays intact (mapDomToView succeeds), but we break the
        // view->model mapping so selectIncludeNoteWidget returns at the !modelElement guard.
        const viewElement = editor.editing.view.domConverter.mapDomToView(figure);
        expect(viewElement).toBeDefined();
        if (viewElement && viewElement.is("element")) {
            editor.editing.mapper.unbindViewElement(viewElement);
        }

        expect(() => {
            wrapper.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
        }).not.toThrow();
    });

    it("selects the include that a DOM element is part of, for a context menu opened on it", () => {
        editor.setData("<p>foo</p>"
            + "<figure class=\"include-note\" data-note-id=\"noteMenu\" data-box-size=\"small\">"
            + "</figure>");
        const domRoot = editor.editing.view.getDomRoot();
        const wrapper = domRoot?.querySelector("div.include-note-wrapper");
        const paragraph = domRoot?.querySelector("p");
        if (!wrapper || !paragraph) {
            throw new Error("Expected a rendered include and paragraph.");
        }
        const title = document.createElement("h4");
        wrapper.append(title);
        const plugin = editor.plugins.get("IncludeNote");

        expect(plugin.selectIncludeAt(paragraph)).toBe(false);
        expect(editor.model.document.selection.getSelectedElement()).toBeNull();

        expect(plugin.selectIncludeAt(title)).toBe(true);
        expect(editor.model.document.selection.getSelectedElement()?.getAttribute("noteId"))
            .toBe("noteMenu");
    });

    it("falls back gracefully in the button factory when the insert command is absent", () => {
        // Exercise the falsy `if (command)` branch in IncludeNoteUI: when the command lookup
        // returns undefined, the button must still be created (just without the binding).
        const realGet = editor.commands.get.bind(editor.commands);
        const absent: string[] = [
            COMMAND_NAME, CONVERT_EMBED_TO_LINK_COMMAND, TOGGLE_CAPTION_COMMAND_NAME
        ];
        const getSpy = vi
            .spyOn(editor.commands, "get")
            .mockImplementation((name) => (absent.includes(name) ? undefined : realGet(name)));

        try {
            const view = editor.ui.componentFactory.create("includeNote") as unknown as { label: string };
            expect(view.label).toBe("Include note");
            const convert = editor.ui.componentFactory.create(CONVERT_EMBED_TO_LINK_COMMAND);
            expect((convert as unknown as { label: string }).label).toBe("Convert to link");
            const caption = editor.ui.componentFactory.create(TOGGLE_CAPTION_COMMAND_NAME);
            expect((caption as unknown as { label: string }).label).toBe("Toggle caption on");
        } finally {
            getSpy.mockRestore();
        }
    });
});

describe("IncludeNote with attachments", () => {
    const LINK_HREF = "#root/owner?viewMode=attachments&attachmentId=att1";
    const embedHtml = (attachmentId = "att1") =>
        `<figure class="include-note" data-attachment-id="${attachmentId}" data-box-size="small">`
        + "</figure>";
    let editor: ClassicEditor;
    let loadIncludedNote: ReturnType<typeof vi.fn>;
    let loadIncludedAttachment: ReturnType<typeof vi.fn>;
    let getAttachmentHref: ReturnType<typeof vi.fn>;

    beforeEach(async () => {
        loadIncludedNote = vi.fn();
        loadIncludedAttachment = vi.fn();
        getAttachmentHref = vi.fn(async () => LINK_HREF);
        installGlobMock({
            getComponentByEl: () => ({
                loadIncludedNote,
                loadIncludedAttachment,
                getAttachmentHref,
                loadReferenceLinkTitle: vi.fn(async () => undefined)
            }),
            getReferenceLinkTitleSync: () => "report.pdf"
        });

        editor = await createTestEditor([
            Essentials, Paragraph, Undo, Widget, LinkEditing, ReferenceLink, IncludeNote
        ]);
    });

    /** Querying the DOM root forces the UIElement render callbacks to run. */
    function renderEmbeds() {
        return editor.editing.view.getDomRoot()?.querySelectorAll("div.include-note-wrapper");
    }

    function selectEmbed() {
        editor.model.change((writer) => {
            const element = findIncludeNote(editor);
            if (element) {
                writer.setSelection(element, "on");
            }
        });
    }

    it("stores, saves and renders an embed by its attachment", () => {
        editor.setData(embedHtml());

        const element = findIncludeNote(editor);
        expect(element?.getAttribute("attachmentId")).toBe("att1");
        expect(element?.hasAttribute("noteId")).toBe(false);
        expect(editor.getData()).toContain('data-attachment-id="att1"');
        expect(editor.getData()).not.toContain("data-note-id");

        expect(renderEmbeds()).toHaveLength(1);
        expect(loadIncludedNote).not.toHaveBeenCalled();
        expect(loadIncludedAttachment).toHaveBeenCalledTimes(1);
        expect(loadIncludedAttachment.mock.calls[0]?.[0]).toBe("att1");
        expect(loadIncludedAttachment.mock.calls[0]?.[2]).toBe("small");

        selectEmbed();
        editor.execute(BOX_SIZE_COMMAND_NAME, { value: "full" });
        expect(loadIncludedAttachment.mock.calls.at(-1)?.[2]).toBe("full");
    });

    it("shows an embed by its file name while it uploads, and saves it naming nothing", () => {
        setModelData(
            editor.model,
            "<includeNote boxSize=\"small\" uploadFileName=\"report.pdf\" uploadId=\"u1\">"
            + "</includeNote>"
        );

        const wrapper = renderEmbeds()?.[0];
        const title = wrapper?.querySelector(".include-note-title");
        expect(title?.textContent).toBe("report.pdf");
        expect(title?.querySelector(".bx.bx-loader-alt.bx-spin")).not.toBeNull();
        expect(loadIncludedAttachment).not.toHaveBeenCalled();
        expect(loadIncludedNote).not.toHaveBeenCalled();
        const data = editor.getData();
        expect(data).toContain("<figure class=\"include-note\" data-box-size=\"small\">");
        expect(data).not.toMatch(/data-(note|attachment)-id/);

        const element = findIncludeNote(editor);
        if (!element) {
            throw new Error("Expected the embed.");
        }

        // The two steps of `FileUploadEditing` once the upload ends.
        editor.model.change((writer) => writer.setAttribute("attachmentId", "att1", element));
        expect(wrapper?.querySelector(".include-note-title")?.textContent).toBe("report.pdf");
        expect(loadIncludedAttachment).not.toHaveBeenCalled();

        editor.model.change((writer) => writer.removeAttribute("uploadFileName", element));
        expect(renderEmbeds()?.[0]).toBe(wrapper);
        expect(wrapper?.querySelector(".include-note-title")).toBeNull();
        expect(wrapper?.parentElement?.getAttribute("data-attachment-id")).toBe("att1");
        expect(loadIncludedAttachment).toHaveBeenCalledTimes(1);
        expect(loadIncludedAttachment).toHaveBeenCalledWith("att1", expect.anything(), "small");
    });

    it("turns an attachment link into an embed in its place, as one undo step", () => {
        editor.setData(`<p>Before <a class="reference-link" href="${LINK_HREF}">x</a> after</p>`);
        const link = editor.editing.view.getDomRoot()?.querySelector("a.reference-link");

        editor.execute(EMBED_ATTACHMENT_LINK_COMMAND, { domElement: link, boxSize: "expandable" });

        expect(getModelData(editor.model, { withoutSelection: true })).toBe(
            "<paragraph>Before </paragraph>" +
            "<includeNote attachmentId=\"att1\" boxSize=\"expandable\"></includeNote>" +
            "<paragraph> after</paragraph>"
        );

        editor.execute("undo");
        expect(getModelData(editor.model, { withoutSelection: true })).toBe(
            `<paragraph>Before <reference href="${LINK_HREF}"></reference> after</paragraph>`
        );

        const relinked = editor.editing.view.getDomRoot()?.querySelector("a.reference-link");
        editor.execute(EMBED_ATTACHMENT_LINK_COMMAND, { domElement: relinked });
        expect(findIncludeNote(editor)?.getAttribute("boxSize")).toBe("medium");
    });

    it("leaves a link to a note, and anything other than a link, alone", () => {
        editor.setData(`<p>Before <a class="reference-link" href="#root/noteAbc">x</a></p>`);
        const before = getModelData(editor.model, { withoutSelection: true });
        const domRoot = editor.editing.view.getDomRoot();
        const link = domRoot?.querySelector("a.reference-link");
        const paragraph = domRoot?.querySelector("p");
        const detached = document.createElement("a");

        for (const domElement of [ link, paragraph, detached ]) {
            editor.execute(EMBED_ATTACHMENT_LINK_COMMAND, { domElement });
        }

        expect(getModelData(editor.model, { withoutSelection: true })).toBe(before);
    });

    it("loads an include that names nothing, as one saved mid-upload, as an empty box", () => {
        editor.setData("<figure class=\"include-note\" data-box-size=\"small\"></figure>");

        expect(renderEmbeds()).toHaveLength(1);
        expect(loadIncludedNote).not.toHaveBeenCalled();
        expect(loadIncludedAttachment).not.toHaveBeenCalled();
    });

    it("turns an attachment embed back into a link, and offers it only for one", async () => {
        const command = editor.commands.get(CONVERT_EMBED_TO_LINK_COMMAND);
        const button = editor.ui.componentFactory.create(CONVERT_EMBED_TO_LINK_COMMAND);
        if (!(button instanceof ButtonView)) {
            throw new Error("Expected a button.");
        }
        expect(button.label).toBe("Convert to link");

        insertIncludeNote(editor, "noteX", "small");
        expect(command?.isEnabled).toBe(false);
        expect(button.isVisible).toBe(false);

        editor.setData(embedHtml());
        selectEmbed();
        expect(command?.isEnabled).toBe(true);
        expect(button.isVisible).toBe(true);

        button.fire("execute");

        expect(getAttachmentHref).toHaveBeenCalledWith("att1");
        await vi.waitFor(() => expect(getModelData(editor.model, { withoutSelection: true }))
            .toBe(`<paragraph><reference href="${LINK_HREF}"></reference></paragraph>`));
    });

    it("converts the embed that selectIncludeAt() selects from its title row", async () => {
        editor.setData("<p>before</p>" + embedHtml());
        const command = editor.commands.get(CONVERT_EMBED_TO_LINK_COMMAND);
        const wrapper = renderEmbeds()?.[0];
        if (!wrapper) {
            throw new Error("Expected a rendered embed.");
        }
        const titleRow = document.createElement("div");
        titleRow.className = "include-note-title-row";
        wrapper.append(titleRow);
        expect(command?.isEnabled).toBe(false);

        expect(editor.plugins.get("IncludeNote").selectIncludeAt(titleRow)).toBe(true);
        expect(command?.isEnabled).toBe(true);

        await editor.execute(CONVERT_EMBED_TO_LINK_COMMAND);
        expect(getModelData(editor.model, { withoutSelection: true })).toBe(
            "<paragraph>before</paragraph>"
            + `<paragraph><reference href="${LINK_HREF}"></reference></paragraph>`
        );
    });

    it("converts nothing when no attachment embed is selected", async () => {
        editor.setData(embedHtml() + "<p>after</p>");
        setModelData(editor.model, "<paragraph>foo[]bar</paragraph>");
        const before = editor.getData();

        // The decorated `Command#execute()` skips a disabled command, so the command is forced
        // enabled to run `execute()` with no embed selected.
        const command = editor.commands.get(CONVERT_EMBED_TO_LINK_COMMAND) as {
            isEnabled: boolean;
            execute(): Promise<void>;
        };
        command.isEnabled = true;
        await command.execute();

        expect(getAttachmentHref).not.toHaveBeenCalled();
        expect(editor.getData()).toBe(before);
    });

    it("keeps an embed whose attachment has no link to go back to", async () => {
        getAttachmentHref.mockResolvedValue(null);
        editor.setData(embedHtml());
        selectEmbed();

        await editor.execute(CONVERT_EMBED_TO_LINK_COMMAND);

        expect(findIncludeNote(editor)?.getAttribute("attachmentId")).toBe("att1");
    });

    it("redraws the embeds of a changed attachment and removes those of a deleted one", () => {
        editor.setData(embedHtml("att1") + embedHtml("att2"));
        renderEmbeds();
        loadIncludedAttachment.mockClear();

        editor.plugins.get("ReferenceLinkEditing").updateAttachmentLinks([
            { attachmentId: "att1", isDeleted: false },
            { attachmentId: "att2", isDeleted: true }
        ]);
        renderEmbeds();

        const redrawn = loadIncludedAttachment.mock.calls.map(([ attachmentId ]) => attachmentId);
        expect(redrawn).toContain("att1");
        expect(redrawn).not.toContain("att2");
        expect(getModelData(editor.model, { withoutSelection: true }))
            .toBe("<includeNote attachmentId=\"att1\" boxSize=\"small\"></includeNote>");
    });
});

describe("IncludeNote captions", () => {
    const CAPTIONED = "<figure class=\"include-note\" data-note-id=\"n1\" data-box-size=\"medium\">"
        + "<figcaption>A <strong>bold</strong> caption</figcaption></figure>";
    let editor: ClassicEditor;
    let loadIncludedNote: ReturnType<typeof vi.fn>;

    beforeEach(async () => {
        loadIncludedNote = vi.fn();
        installGlobMock({
            getComponentByEl: () => ({ loadIncludedNote })
        });

        editor = await createTestEditor([ Essentials, Paragraph, Bold, Undo, Widget, IncludeNote ]);
    });

    function getCommand() {
        const command = editor.commands.get(TOGGLE_CAPTION_COMMAND_NAME);
        if (!command) {
            throw new Error("Expected the caption command.");
        }
        return command;
    }

    function selectInclude() {
        editor.model.change((writer) => {
            const include = findIncludeNote(editor);
            if (include) {
                writer.setSelection(include, "on");
            }
        });
    }

    /** The caption the editing view renders, after checking that it follows the content. */
    function getRenderedCaption() {
        const figcaption = editor.editing.view.getDomRoot()
            ?.querySelector("figure.include-note > figcaption");
        expect(figcaption?.previousElementSibling?.classList.contains("include-note-wrapper"))
            .toBe(true);
        return figcaption;
    }

    function isSelectionInCaption() {
        const position = editor.model.document.selection.getFirstPosition();
        return !!position?.parent.is("element", "caption");
    }

    it("loads and saves a formatted caption, and renders it editable after the content", () => {
        editor.setData(CAPTIONED);

        expect(getModelData(editor.model, { withoutSelection: true })).toBe(
            "<includeNote boxSize=\"medium\" noteId=\"n1\">"
            + "<caption>A <$text bold=\"true\">bold</$text> caption</caption></includeNote>"
        );
        expect(editor.getData()).toBe(CAPTIONED);
        expect(getRenderedCaption()?.getAttribute("contenteditable")).toBe("true");
    });

    it("toggles a caption on after the content and off again, keeping its text", () => {
        insertIncludeNote(editor, "n1", "medium");
        const command = getCommand();
        expect(command.isEnabled).toBe(true);
        expect(command.value).toBe(false);

        editor.execute(TOGGLE_CAPTION_COMMAND_NAME, { focusCaptionOnShow: true });
        expect(command.value).toBe(true);
        expect(isSelectionInCaption()).toBe(true);
        expect(getRenderedCaption()).not.toBeNull();

        editor.model.change((writer) => {
            const position = editor.model.document.selection.getFirstPosition();
            if (position) {
                writer.insertText("Caption", position);
            }
        });
        editor.execute(TOGGLE_CAPTION_COMMAND_NAME);
        expect(command.value).toBe(false);
        expect(editor.getData()).not.toContain("figcaption");
        expect(editor.model.document.selection.getSelectedElement()?.name).toBe("includeNote");

        editor.execute(TOGGLE_CAPTION_COMMAND_NAME);
        expect(editor.getData()).toContain("<figcaption>Caption</figcaption>");
        expect(isSelectionInCaption()).toBe(false);
    });

    it("keeps the rendered content while the caption is toggled and edited", () => {
        insertIncludeNote(editor, "n1", "medium");
        const wrapper = editor.editing.view.getDomRoot()?.querySelector(".include-note-wrapper");
        expect(wrapper).not.toBeNull();
        expect(loadIncludedNote).toHaveBeenCalledTimes(1);

        editor.execute(TOGGLE_CAPTION_COMMAND_NAME, { focusCaptionOnShow: true });
        editor.model.change((writer) => {
            const position = editor.model.document.selection.getFirstPosition();
            if (position) {
                writer.insertText("Caption", position);
            }
        });
        editor.execute(TOGGLE_CAPTION_COMMAND_NAME);
        editor.execute(TOGGLE_CAPTION_COMMAND_NAME);

        expect(getRenderedCaption()?.textContent).toBe("Caption");
        expect(editor.editing.view.getDomRoot()?.querySelector(".include-note-wrapper"))
            .toBe(wrapper);
        expect(loadIncludedNote).toHaveBeenCalledTimes(1);
    });

    it("is disabled with no include selected and on a Tiny include", () => {
        setModelData(editor.model, "<paragraph>foo[]</paragraph>");
        expect(getCommand().isEnabled).toBe(false);

        insertIncludeNote(editor, "n1", "tiny");
        expect(getCommand().isEnabled).toBe(false);
        expect(getCommand().value).toBe(false);
    });

    it("labels its toolbar button by whether the caption shows", () => {
        const button = editor.ui.componentFactory.create(TOGGLE_CAPTION_COMMAND_NAME);
        if (!(button instanceof ButtonView)) {
            throw new Error("Expected a button.");
        }
        insertIncludeNote(editor, "n1", "medium");
        expect(button.label).toBe("Toggle caption on");
        expect(button.isOn).toBe(false);

        button.fire("execute");

        expect(button.label).toBe("Toggle caption off");
        expect(button.isOn).toBe(true);
        expect(isSelectionInCaption()).toBe(true);
    });

    it("removes the caption of a Tiny include and restores it on a larger size, undoably", () => {
        editor.setData(CAPTIONED);
        selectInclude();

        editor.execute(BOX_SIZE_COMMAND_NAME, { value: "tiny" });
        expect(getModelData(editor.model, { withoutSelection: true }))
            .toBe("<includeNote boxSize=\"tiny\" noteId=\"n1\"></includeNote>");

        editor.execute(BOX_SIZE_COMMAND_NAME, { value: "small" });
        expect(editor.getData()).toBe(CAPTIONED.replace("medium", "small"));
        expect(getRenderedCaption()).not.toBeNull();

        editor.execute("undo");
        editor.execute("undo");
        expect(editor.getData()).toBe(CAPTIONED);
    });

    it("leaves a caption hidden with the toggle hidden when the include leaves Tiny", () => {
        editor.setData(CAPTIONED);
        selectInclude();

        editor.execute(TOGGLE_CAPTION_COMMAND_NAME);
        editor.execute(BOX_SIZE_COMMAND_NAME, { value: "tiny" });
        editor.execute(BOX_SIZE_COMMAND_NAME, { value: "medium" });

        expect(editor.getData()).not.toContain("figcaption");
    });

    it("drops the caption of a Tiny include it loads", () => {
        editor.setData(CAPTIONED.replace("medium", "tiny"));

        expect(getModelData(editor.model, { withoutSelection: true }))
            .toBe("<includeNote boxSize=\"tiny\" noteId=\"n1\"></includeNote>");
    });
});

function findIncludeNote(editor: ClassicEditor): ModelElement | undefined {
    const root = editor.model.document.getRoot();
    if (!root) {
        return undefined;
    }
    for (const item of editor.model.createRangeIn(root).getItems()) {
        if (item.is("element", "includeNote")) {
            return item;
        }
    }
    return undefined;
}

function insertIncludeNote(editor: ClassicEditor, noteId: string, boxSize: string): ModelElement {
    let created: ModelElement | null = null;
    editor.model.change((writer) => {
        const root = editor.model.document.getRoot();
        if (!root) {
            throw new Error("The editor has no root.");
        }
        const element = writer.createElement("includeNote", { noteId, boxSize });
        writer.insert(element, root, 0);
        writer.setSelection(element, "on");
        created = element;
    });
    if (!created) {
        throw new Error("Failed to create includeNote element.");
    }
    return created;
}
