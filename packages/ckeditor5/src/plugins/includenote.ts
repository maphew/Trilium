import {
	ButtonView,
	Command,
	type Editor,
	IconLink,
	type ModelElement,
	Plugin,
	toWidget,
	type ViewElement,
	Widget,
	type Observable
} from 'ckeditor5';
import noteIcon from '../icons/note.svg?raw';
import { getAttachmentId } from './referencelink.js';

export const COMMAND_NAME = 'insertIncludeNote';
export const BOX_SIZE_COMMAND_NAME = 'includeNoteBoxSize';
export const EMBED_ATTACHMENT_LINK_COMMAND = 'embedAttachmentLink';
export const CONVERT_EMBED_TO_LINK_COMMAND = 'convertEmbedToLink';

export const BOX_SIZES = [ 'tiny', 'small', 'medium', 'full', 'expandable' ] as const;

export type BoxSizeValue = typeof BOX_SIZES[number];

/**
 * The user-facing name of a box size, as shown by the widget toolbar's dropdown.
 *
 * A switch rather than a table of labels, so that each one is written as a literal argument of a
 * `t()` call: that is how the messages this package owns are discovered (see `messages.ts`) and a
 * label tucked away in a table would be invisible to translators.
 *
 * @param t the editor's translation function.
 * @param size the box size; an unrecognized one has no label and is returned as-is.
 */
export function getBoxSizeLabel(t: (message: string) => string, size: BoxSizeValue): string {
	switch (size) {
		case 'tiny':
			return t('Tiny');
		case 'small':
			return t('Small');
		case 'medium':
			return t('Medium');
		case 'full':
			return t('Full');
		case 'expandable':
			return t('Expandable');
		default:
			return size;
	}
}

export default class IncludeNote extends Plugin {
	static get requires() {
		return [ IncludeNoteEditing, IncludeNoteUI ];
	}

	static get pluginName() {
		return 'IncludeNote' as const;
	}

	/**
	 * Selects the include that `domElement` is part of, so that commands act on the include a
	 * context menu is opened on. Returns `false` when `domElement` is not part of an include of
	 * this editor.
	 */
	selectIncludeAt( domElement: Element ): boolean {
		const include = getIncludeNoteAt( this.editor, domElement );
		if ( !include ) {
			return false;
		}

		this.editor.model.enqueueChange( { isUndoable: false }, writer => {
			writer.setSelection( include, 'on' );
		} );
		return true;
	}
}

class IncludeNoteUI extends Plugin {
	init() {
		const editor = this.editor;
		const t = editor.t;

		// The "includeNote" button must be registered among the UI components of the editor
		// to be displayed in the toolbar.
		editor.ui.componentFactory.add( 'includeNote', locale => {
			// The state of the button will be bound to the widget command.
			const command = editor.commands.get( COMMAND_NAME );

			// The button will be an instance of ButtonView.
			const buttonView = new ButtonView( locale );

			buttonView.set( {
				// The t() function helps localize the editor. All strings enclosed in t() can be
				// translated and change when the language of the editor changes.
				label: t( 'Include note' ),
				icon: noteIcon,
				tooltip: true
			} );

			// Bind the state of the button to the command.
            if (command) {
                buttonView.bind( 'isOn', 'isEnabled' ).to( command as Observable & { value: boolean; } & { isEnabled: boolean; }, 'value', 'isEnabled' );
            }

			// Execute the command when the button is clicked (executed).
			this.listenTo( buttonView, 'execute', () => editor.execute( COMMAND_NAME ) );

			return buttonView;
		} );

		editor.ui.componentFactory.add( CONVERT_EMBED_TO_LINK_COMMAND, locale => {
			const command = editor.commands.get( CONVERT_EMBED_TO_LINK_COMMAND );
			const buttonView = new ButtonView( locale );

			buttonView.set( {
				label: t( 'Convert to link' ),
				icon: IconLink,
				tooltip: true
			} );

			// Shown only on an attachment embed, the one include the command applies to.
			if ( command ) {
				buttonView.bind( 'isEnabled' ).to( command );
				buttonView.bind( 'isVisible' ).to( command, 'isEnabled' );
			}

			this.listenTo( buttonView, 'execute', () => {
				editor.execute( CONVERT_EMBED_TO_LINK_COMMAND );
			} );

			return buttonView;
		} );
	}
}

class IncludeNoteEditing extends Plugin {
	static get requires() {
		return [ Widget ];
	}

	init() {
		this._defineSchema();
		this._defineConverters();

		const editor = this.editor;
		const commands = editor.commands;
		commands.add( COMMAND_NAME, new InsertIncludeNoteCommand( editor ) );
		commands.add( BOX_SIZE_COMMAND_NAME, new IncludeNoteBoxSizeCommand( editor ) );
		commands.add( EMBED_ATTACHMENT_LINK_COMMAND, new EmbedAttachmentLinkCommand( editor ) );
		commands.add( CONVERT_EMBED_TO_LINK_COMMAND, new ConvertEmbedToLinkCommand( editor ) );
	}

	_defineSchema() {
		const schema = this.editor.model.schema;

		schema.register( 'includeNote', {
			// Behaves like a self-contained object (e.g. an image).
			isObject: true,

			// An include shows either a note or, as an embed, an attachment. An embed that
			// `FileUploadEditing` is uploading carries the upload attributes instead of its id.
			allowAttributes: [
				'noteId', 'attachmentId', 'boxSize', 'uploadId', 'uploadStatus', 'uploadFileName'
			],

			// Allow in places where other blocks are allowed (e.g. directly in the root).
			allowWhere: '$block'
		} );
	}

	_defineConverters() {
		const editor = this.editor;
		const conversion = editor.conversion;

		// <includeNote> converters
		conversion.for( 'upcast' ).elementToElement( {
			model: ( viewElement, { writer: modelWriter } ) => {
				const attachmentId = viewElement.getAttribute( 'data-attachment-id' );
				const included = attachmentId
					? { attachmentId }
					: { noteId: viewElement.getAttribute( 'data-note-id' ) };

				return modelWriter.createElement( 'includeNote', {
					...included,
					boxSize: viewElement.getAttribute( 'data-box-size' ),
				} );
			},
			view: {
				name: 'section',
				classes: 'include-note'
			}
		} );
		conversion.for( 'dataDowncast' ).elementToElement( {
			model: 'includeNote',
			view: ( modelElement, { writer: viewWriter } ) => {
				// it would make sense here to downcast to <iframe>, with this even HTML export can support note inclusion
				return viewWriter.createContainerElement( 'section', {
					class: 'include-note',
					...getIncludedEntityAttributes( modelElement ),
					'data-box-size': modelElement.getAttribute( 'boxSize' ),
				} );
			}
		} );
		conversion.for( 'editingDowncast' ).elementToElement( {
			// Redraws an uploading embed when its upload sets `attachmentId` and clears
			// `uploadFileName`.
			model: { name: 'includeNote', attributes: [ 'attachmentId', 'uploadFileName' ] },
			view: ( modelElement, { writer: viewWriter } ) => {

				const boxSize = modelElement.getAttribute( 'boxSize' ) as string | undefined;
				const uploadFileName = modelElement.getAttribute( 'uploadFileName' ) as
					string | undefined;

				const section = viewWriter.createContainerElement( 'section', {
					class: 'include-note box-size-' + boxSize,
					...getIncludedEntityAttributes( modelElement ),
					'data-box-size': boxSize
				} );

				const includedNoteWrapper = viewWriter.createUIElement( 'div', {
					class: 'include-note-wrapper',
					"data-cke-ignore-events": true
				}, function( domDocument ) {
					const domElement = this.toDomElement( domDocument );

					if ( uploadFileName ) {
						domElement.append( createUploadTitle( domDocument, uploadFileName ) );
					} else {
						loadIncludedContent( editor, modelElement, $( domElement ), boxSize );
					}

					preventCKEditorHandling( domElement, editor );

					return domElement;
				} );

				viewWriter.insert( viewWriter.createPositionAt( section, 0 ), includedNoteWrapper );

				// hasSelectionHandle gives the block widget CKEditor's own drag grip so it moves
				// atomically, instead of the browser's native drag tearing the embedded note apart.
				// The label is announced by screen readers; lowercase to match the "image widget" /
				// "table widget" labels CKEditor gives its own widgets.
				return toWidget( section, viewWriter, { label: editor.t('include note widget'), hasSelectionHandle: true } );
			}
		} );

		// Handle boxSize attribute changes on existing elements
		conversion.for( 'editingDowncast' ).add( dispatcher => {
			dispatcher.on( 'attribute:boxSize:includeNote', ( evt, data, conversionApi ) => {
				const viewElement = conversionApi.mapper.toViewElement( data.item );
				/* v8 ignore next 3 -- defensive guard: when the attribute:boxSize event fires the model item is always mapped to a rendered view element; forcing an unmapped state (mapper.unbindModelElement) crashes the conversion pipeline elsewhere before this guard can be observed, so it is unreachable from a unit test */
				if ( !viewElement ) {
					return;
				}

				const viewWriter = conversionApi.writer;
				const oldBoxSize = data.attributeOldValue as string;
				const newBoxSize = data.attributeNewValue as string;

				// Remove old class and add new class
				if ( oldBoxSize ) {
					viewWriter.removeClass( 'box-size-' + oldBoxSize, viewElement );
				}
				if ( newBoxSize ) {
					viewWriter.addClass( 'box-size-' + newBoxSize, viewElement );
					viewWriter.setAttribute( 'data-box-size', newBoxSize, viewElement );

					// Re-render the included note content with the new box size. We drive this
					// directly from the converter (rather than observing the DOM attribute) so the
					// content is only rebuilt on a genuine box-size change — not whenever CKEditor
					// re-applies unrelated attributes (e.g. `draggable` while selecting the widget).
					reloadIncludedNote( editor, viewElement, data.item as ModelElement, newBoxSize );
				}
			} );
		} );
	}
}

class InsertIncludeNoteCommand extends Command {
	override execute() {
		const editorEl = this.editor.editing.view.getDomRoot();
		const component = glob.getComponentByEl(editorEl);

		component.triggerCommand('addIncludeNoteToText');
	}

	override refresh() {
		const model = this.editor.model;
		const selection = model.document.selection;
        const firstPosition = selection.getFirstPosition();
		const allowedIn = firstPosition && model.schema.findAllowedParent( firstPosition, 'includeNote' );

		this.isEnabled = allowedIn !== null;
	}
}

class IncludeNoteBoxSizeCommand extends Command {
	declare value: BoxSizeValue | null;

	override execute( options: { value: BoxSizeValue } ) {
		const model = this.editor.model;
		const includeNoteElement = getSelectedIncludeNote( this.editor );

		if ( includeNoteElement ) {
			model.change( writer => {
				writer.setAttribute( 'boxSize', options.value, includeNoteElement );
			} );
		}
	}

	override refresh() {
		const includeNoteElement = getSelectedIncludeNote( this.editor );

		this.isEnabled = !!includeNoteElement;
		this.value = includeNoteElement?.getAttribute( 'boxSize' ) as BoxSizeValue | null ?? null;
	}
}

/** Replaces an attachment link with an embed of the attachment, in the same place. */
class EmbedAttachmentLinkCommand extends Command {
	/**
	 * @param options.domElement the link, as the editing view renders it.
	 * @param options.boxSize the size of the embed, `medium` when not given.
	 */
	override execute( { domElement, boxSize }: { domElement: HTMLElement; boxSize?: string } ) {
		const editor = this.editor;
		const viewElement = editor.editing.view.domConverter.mapDomToView( domElement );
		const reference = viewElement?.is( 'element' )
			? editor.editing.mapper.toModelElement( viewElement )
			: undefined;
		const attachmentId = reference?.is( 'element', 'reference' )
			? getAttachmentId( reference.getAttribute( 'href' ) )
			: null;
		if ( !reference || !attachmentId ) {
			return;
		}

		editor.model.change( writer => {
			const embed = writer.createElement( 'includeNote', {
				attachmentId,
				boxSize: boxSize ?? 'medium'
			} );
			const range = writer.createRangeOn( reference );
			editor.model.insertObject( embed, range, null, { setSelection: 'on' } );
		} );
	}
}

/** Replaces the selected attachment embed with a link to the attachment. */
class ConvertEmbedToLinkCommand extends Command {
	override refresh() {
		const embed = getSelectedIncludeNote( this.editor );
		const canHoldLink = this.editor.model.schema.isRegistered( 'reference' );

		this.isEnabled = !!embed?.hasAttribute( 'attachmentId' ) && canHoldLink;
	}

	override async execute() {
		const editor = this.editor;
		const embed = getSelectedIncludeNote( editor );
		const attachmentId = embed?.getAttribute( 'attachmentId' ) as string | undefined;
		if ( !embed || !attachmentId ) {
			return;
		}

		const editorEl = editor.editing.view.getDomRoot();
		const component = glob.getComponentByEl<EditorComponent>( editorEl );
		const href = await component.getAttachmentHref( attachmentId );

		// The embed can be removed while the host looks the link up.
		const root = embed.root;
		if ( !href || !root.is( 'rootElement' ) || root.rootName === '$graveyard' ) {
			return;
		}

		editor.model.change( writer => {
			const reference = writer.createElement( 'reference', { href } );
			const paragraph = writer.createElement( 'paragraph' );
			writer.append( reference, paragraph );
			writer.insert( paragraph, writer.createPositionBefore( embed ) );
			writer.remove( embed );
			writer.setSelection( reference, 'after' );
		} );
	}
}

/** The include the selection is on or inside, or `null`. */
function getSelectedIncludeNote( editor: Editor ) {
	const selection = editor.model.document.selection;
	const selectedElement = selection.getSelectedElement();

	if ( selectedElement?.name === 'includeNote' ) {
		return selectedElement;
	}

	return selection.getFirstPosition()?.findAncestor( 'includeNote' ) ?? null;
}

/** The include whose rendering contains `domElement`, or `null`. */
function getIncludeNoteAt( editor: Editor, domElement: Element ) {
	const sectionElement = domElement.closest<HTMLElement>( 'section.include-note' );
	const viewElement = sectionElement
		&& editor.editing.view.domConverter.mapDomToView( sectionElement );
	if ( !viewElement?.is( 'element' ) ) {
		return null;
	}

	return editor.editing.mapper.toModelElement( viewElement ) ?? null;
}

/**
 * The `data-*` attribute naming what an include shows: an attachment, or a note. An embed whose
 * upload has not ended names nothing.
 */
function getIncludedEntityAttributes( element: ModelElement ): Record<string, string> {
	const attachmentId = element.getAttribute( 'attachmentId' ) as string | undefined;
	const noteId = element.getAttribute( 'noteId' ) as string | undefined;

	if ( attachmentId ) {
		return { 'data-attachment-id': attachmentId };
	}

	return noteId ? { 'data-note-id': noteId } : {};
}

/** The title of an embed whose upload is under way: a spinner and the name of the file. */
function createUploadTitle( domDocument: Document, fileName: string ) {
	const title = domDocument.createElement( 'h4' );
	const label = domDocument.createElement( 'span' );
	const spinner = domDocument.createElement( 'span' );
	title.className = 'include-note-title';
	spinner.className = 'bx bx-loader-alt bx-spin';
	label.append( spinner, fileName );
	title.append( label );

	return title;
}

/** Has the host render what an include shows into its wrapper. */
function loadIncludedContent(
	editor: Editor,
	element: ModelElement,
	$wrapper: JQuery<HTMLElement>,
	boxSize: string | undefined
) {
	const editorEl = editor.editing.view.getDomRoot();
	const component = glob.getComponentByEl<EditorComponent>( editorEl );
	const attachmentId = element.getAttribute( 'attachmentId' ) as string | undefined;
	const noteId = element.getAttribute( 'noteId' ) as string | undefined;

	if ( attachmentId ) {
		component.loadIncludedAttachment( attachmentId, $wrapper, boxSize );
	} else if ( noteId ) {
		component.loadIncludedNote( noteId, $wrapper, boxSize );
	}
}

/**
 * Re-renders the included note content of an already-rendered widget after its box size changed.
 *
 * The wrapper is a `UIElement` whose DOM is opaque to CKEditor, so we reach into it directly to
 * trigger the client-side render. The box size is passed explicitly because, at conversion time,
 * the updated `data-box-size` attribute may not yet be flushed to the DOM.
 *
 * On the initial insert the attribute converter runs before the widget has been rendered to the
 * DOM, so `mapViewToDom()` returns nothing and this is a no-op — the `UIElement` render callback
 * performs that first paint instead. It only does work on a subsequent, genuine box-size change.
 */
function reloadIncludedNote( editor: Editor, viewElement: ViewElement, modelElement: ModelElement, boxSize: string ) {
	const sectionDom = editor.editing.view.domConverter.mapViewToDom( viewElement );
	const wrapperDom = sectionDom?.querySelector<HTMLElement>( '.include-note-wrapper' );

	if ( wrapperDom ) {
		loadIncludedContent( editor, modelElement, $( wrapperDom ), boxSize );
	}
}

/**
 * Hack coming from https://github.com/ckeditor/ckeditor5/issues/4465
 * Source issue: https://github.com/zadam/trilium/issues/1117
 */
function preventCKEditorHandling( domElement: HTMLElement, editor: Editor ) {
	// Prevent the editor from listening on below events in order to stop rendering selection.

	// commenting out click events to allow link click handler to still work
	//domElement.addEventListener( 'click', stopEventPropagationAndHackRendererFocus, { capture: true } );

	domElement.addEventListener( 'mousedown', ( evt: MouseEvent ) => {
		// A button of the title row selects the include. Preventing the default keeps the focus
		// in the editor instead of the button, and the click still fires.
		if ( isTitleRowButton( evt.target ) ) {
			evt.preventDefault();
			selectIncludeNoteWidget( domElement, editor );
			return;
		}

		// Interactive embedded content — links, form controls, and live widgets such as collections
		// (geo map, calendar, board, table) — needs the browser's native event handling to remain
		// usable, e.g. dragging a geo-map marker relies on the mousedown reaching Leaflet. Leave those
		// events completely alone: don't stop propagation, suppress the default, or steal selection.
		if ( isInteractiveTarget( evt.target, domElement ) ) {
			return;
		}

		evt.stopPropagation();

		// Suppress the browser's native caret on non-interactive areas. The widget's <section> is
		// contenteditable=false inside an editable root, so the default mousedown action drops a caret
		// next to it that visibly moves as the user clicks around.
		evt.preventDefault();

		// This prevents rendering changed view selection thus preventing to changing DOM selection while inside a widget.
		//@ts-expect-error: We are accessing a private field.
		editor.editing.view._renderer.isFocused = false;

		// Select the widget so the toolbar can appear
		selectIncludeNoteWidget( domElement, editor );
	}, { capture: true } );

	domElement.addEventListener( 'focus', stopEventPropagationAndHackRendererFocus, { capture: true } );

	// Prevents TAB handling or other editor keys listeners which might be executed on editors selection.
	domElement.addEventListener( 'keydown', stopEventPropagationAndHackRendererFocus, { capture: true } );

	function stopEventPropagationAndHackRendererFocus( evt: Event ) {
		evt.stopPropagation();
		// This prevents rendering changed view selection thus preventing to changing DOM selection while inside a widget.
        //@ts-expect-error: We are accessing a private field.
		editor.editing.view._renderer.isFocused = false;
	}
}

/**
 * Whether a mousedown target needs the browser's native handling to keep working — so the widget's
 * event interception should step aside. Covers form controls, links and media (which need focus,
 * caret or their own controls) and, crucially, live embedded widgets: web views and collection views
 * (geo map, calendar, board, table) whose own drag/click handlers rely on the native event.
 *
 * The match is bounded to within `boundary` (the widget wrapper) so the editable editor root — an
 * ancestor with `contenteditable="true"` — is never mistaken for an interactive target.
 */
function isInteractiveTarget( target: EventTarget | null, boundary: HTMLElement ): boolean {
	if ( !( target instanceof Element ) ) {
		return false;
	}

	const match = target.closest(
		'.rendered-collection, .note-detail-web-view, ' +
		'a, button, input, textarea, select, label, audio, video, ' +
		'[role="button"], [role="textbox"], [contenteditable]:not([contenteditable="false"])'
	);

	return !!match && boundary.contains( match );
}

/** Whether `target` is in a button of the title row that the host renders above the content. */
function isTitleRowButton( target: EventTarget | null ): boolean {
	return target instanceof Element && !!target.closest( '.include-note-title-row button' );
}

function selectIncludeNoteWidget( domElement: HTMLElement, editor: Editor ) {
	const modelElement = getIncludeNoteAt( editor, domElement );
	if ( !modelElement ) {
		return;
	}

	// Focus the editor view first to ensure selection sync works
	editor.editing.view.focus();

	// Select the model element using a non-undoable batch so it doesn't affect undo
	editor.model.enqueueChange( { isUndoable: false }, writer => {
		writer.setSelection( modelElement, 'on' );
	} );
}

declare module 'ckeditor5' {
	interface PluginsMap {
		[ IncludeNote.pluginName ]: IncludeNote;
	}
}
