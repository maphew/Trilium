import { ButtonView, HighlightedTextView, type Locale, View } from "ckeditor5";

import type { SnippetDefinition } from "./snippetsconfig.js";

/**
 * A single row in the snippet dropdown list: a wide button showing the snippet's icon, its title and
 * (optionally) its description. Both the title and description can be highlighted to reflect the
 * current search query.
 *
 * Mirrors the row rendered by the premium `Template` plugin this replaces, so the visual layout and
 * search behaviour stay familiar.
 */
export default class SnippetListItemButtonView extends ButtonView {

    public readonly definition: SnippetDefinition;

    private textPartView: SnippetTextPartView | null = null;

    constructor(locale: Locale, definition: SnippetDefinition) {
        super(locale);

        this.definition = definition;

        this.set({
            withText: true,
            class: "ck-snippet-button",
            role: "option",
            icon: definition.icon
        });

        // Snippet icons carry the note's own colours (see `buildIcon` in the client), so don't let
        // the button's theme recolour them.
        this.iconView.isColorInherited = false;
    }

    public override render(): void {
        super.render();

        this.textPartView = new SnippetTextPartView(this.locale, this.definition, this.labelView.element?.id);

        // Swap the plain label for the richer title + description block.
        this.children.remove(this.labelView);
        this.children.add(this.textPartView);
    }

    /**
     * Returns whether the snippet matches the given search expression (by title or description),
     * or `null` when it does not match at all.
     */
    public isMatching(regExp: RegExp): { title: boolean; description: boolean } | null {
        const { title, description } = this.definition;
        const titleMatches = !!title.match(regExp);
        const descriptionMatches = !!description?.match(regExp);

        return titleMatches || descriptionMatches
            ? { title: titleMatches, description: descriptionMatches }
            : null;
    }

    public highlightText(regExp: RegExp | null): void {
        this.textPartView?.highlightText(regExp);
    }

    public override destroy(): void {
        super.destroy();
        this.labelView.destroy();
    }
}

/**
 * The title + optional description block placed inside a {@link SnippetListItemButtonView}.
 */
class SnippetTextPartView extends View {

    private readonly titleView: HighlightedTextView;
    private readonly descriptionView: HighlightedTextView | null;

    constructor(locale: Locale | undefined, definition: SnippetDefinition, labelId?: string) {
        super(locale);

        this.titleView = new HighlightedTextView();
        this.titleView.text = definition.title;
        this.titleView.extendTemplate({
            tag: "span",
            attributes: {
                class: ["ck-button__label"],
                id: labelId
            }
        });

        const children: View[] = [this.titleView];

        if (definition.description) {
            this.descriptionView = new HighlightedTextView();
            this.descriptionView.text = definition.description;
            this.descriptionView.extendTemplate({
                tag: "p",
                attributes: {
                    class: ["ck-snippet__description"]
                }
            });
            children.push(this.descriptionView);
        } else {
            this.descriptionView = null;
        }

        this.setTemplate({
            tag: "div",
            attributes: {
                class: ["ck", "ck-snippet__text-part"]
            },
            children
        });
    }

    public highlightText(regExp: RegExp | null): void {
        this.titleView.highlightText(regExp);
        this.descriptionView?.highlightText(regExp);
    }
}
