import "ckeditor5";

declare global {
    interface Component {
        componentId: string;
        triggerCommand(command: string): void;
    }

    interface LinkEmbedMetadata {
        url: string;
        embedType: string;
        title?: string;
        description?: string;
        favicon?: string;
        siteName?: string;
        image?: string;
        /**
         * True when the host could not read the page (network error, bot challenge, non-HTML
         * response, or a page with no title of its own) and the fields above hold nothing but a
         * hostname-derived placeholder. Mirrors `LinkEmbedMetadata.unresolved` in
         * `@triliumnext/commons`, which is what the host actually returns.
         */
        unresolved?: boolean;
    }

    interface IconPickerRequest {
        /** The element to paint the picker into, which the editor owns and places. */
        container: HTMLElement;
        /** Receives the class of the icon picked, e.g. `bx bx-star`. */
        onSelect(iconClass: string): void;
    }

    /** A button that the content of an embed adds to the toolbar of the embed. */
    interface ContentEmbedTool {
        id: string;
        /** The text of the button. */
        label: string;
        /** The name of what the button does, shown as its tooltip. */
        tooltip: string;
        isOn: boolean;
    }

    /** The buttons that the content of an embed, such as a canvas drawing, adds to its toolbar. */
    interface ContentEmbedToolProvider {
        getTools(): ContentEmbedTool[];
        execute(id: string): void;
        /** Calls `callback` when `getTools()` changes, until the returned function is called. */
        subscribe(callback: () => void): () => void;
    }

    interface EditorComponent extends Component {
        /**
         * Paints the host's icon picker into `container`, and answers with the way to take it down
         * again. A host that shows the picker somewhere of its own — a phone, which has no room for
         * a balloon — leaves `container` alone and answers `null`.
         */
        showIconPicker(request: IconPickerRequest): (() => void) | null;
        /**
         * Formats `date` for insertion in the Day.js `format`, or in the user's
         * `customDateTimeFormat` when none is given.
         */
        formatDateTime(date: Date, format?: string): string;
        loadReferenceLinkTitle($el: JQuery<HTMLElement>, href: string): Promise<void>;
        createNoteForReferenceLink(title: string, intoInbox: boolean): Promise<string | undefined>;
        loadEmbeddedNote(noteId: string, $el: JQuery<HTMLElement>, boxSize?: string): void;
        loadEmbeddedAttachment(
            attachmentId: string,
            $el: JQuery<HTMLElement>,
            boxSize?: string
        ): void;
        /** The href of a reference link to the attachment, or `null` once it is deleted. */
        getAttachmentHref(attachmentId: string): Promise<string | null>;
        /** The note the editor holds. Hosts without a note of their own leave it out. */
        getNoteId?(): string | undefined;
        /**
         * The box size of a new embed of a file being uploaded, from its media type. Hosts without
         * embeds leave it out.
         */
        getEmbedBoxSize?(mime: string): string;
        /**
         * Opens the context menu of what `embed` shows, below `anchor`. Hosts without embeds
         * leave it out.
         */
        openContentEmbedMenu?(embed: HTMLElement, anchor: HTMLElement): void;
        /**
         * The buttons that what `embed` shows adds to the toolbar of the embed, or `null`. Hosts
         * without embeds leave it out.
         */
        getContentEmbedTools?(embed: HTMLElement): ContentEmbedToolProvider | null;
        /**
         * Gives the focus to what the embed of the attachment shows, once it renders. Hosts
         * without embeds leave it out.
         */
        focusContentEmbed?(attachmentId: string): void;
        /**
         * Reads a page's preview metadata through the host. Never rejects: any failure — network
         * error, HTTP error, unparseable page — resolves as `{ unresolved: true }` with
         * hostname-derived placeholders, so callers branch on `unresolved` instead of catching.
         */
        fetchLinkMetadata(url: string): Promise<LinkEmbedMetadata>;
        detectEmbedType(url: string): string;
        renderLinkEmbed(container: HTMLElement, metadata: LinkEmbedMetadata, editable?: boolean): void;
        renderLinkMention(container: HTMLElement, metadata: Pick<LinkEmbedMetadata, "url" | "title" | "favicon">, editable?: boolean): void;
    }

    var glob: {
        getComponentByEl<T extends Component>(el: unknown): T;
        getActiveContextNote(): {
            noteId: string;
        };
        /** The headers of a request to the server, with `headers` added to them. */
        getHeaders(headers?: Record<string, string | undefined>): Promise<Record<string, string>>;
        getReferenceLinkTitle(href: string): Promise<string>;
        getReferenceLinkTitleSync(href: string): string;
    };
}
