import {
	ButtonView,
	Command,
	type DowncastConversionApi,
	type Editor,
	enableViewPlaceholder,
	IconCaption,
	IconLink,
	IconThreeVerticalDots,
	type MapperModelToViewPositionEvent,
	ModelElement,
	type ModelNode,
	type ModelDocumentFragment,
	type ModelWriter,
	type PlaceholderableViewElement,
	Plugin,
	toWidget,
	toWidgetEditable,
	type ViewEditableElement,
	type ViewElement,
	Widget,
	type Observable
} from 'ckeditor5';
import windowIcon from 'boxicons/svg/regular/bx-window-alt.svg?raw';
import noteIcon from '../icons/note.svg?raw';
import { getAttachmentId } from './referencelink.js';

export const COMMAND_NAME = 'insertIncludeNote';
export const BOX_SIZE_COMMAND_NAME = 'includeNoteBoxSize';
export const EMBED_ATTACHMENT_LINK_COMMAND = 'embedAttachmentLink';
export const CONVERT_EMBED_TO_LINK_COMMAND = 'convertEmbedToLink';
export const TOGGLE_CAPTION_COMMAND_NAME = 'toggleIncludeNoteCaption';
export const TOGGLE_TITLE_COMMAND_NAME = 'toggleIncludeNoteTitle';
/** The toolbar button that opens the context menu of an include whose title is hidden. */
export const INCLUDE_NOTE_MENU = 'includeNoteMenu';

export const BOX_SIZES = [ 'tiny', 'small', 'medium', 'full', 'expandable' ] as const;

export type BoxSizeValue = typeof BOX_SIZES[number];

/** What the toolbar of an include shows of it, for a menu offering the same commands. */
export interface IncludeNoteState {
	boxSize: BoxSizeValue | null;
	/** Whether the title shows, which a Tiny or an Expandable include always does. */
	isTitleShown: boolean;
	isTitleToggleable: boolean;
	hasCaption: boolean;
	isCaptionToggleable: boolean;
	isConvertibleToLink: boolean;
}

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

	/**
	 * The state of the include that `domElement` is part of, as its toolbar shows it with the
	 * include selected, or `null`. The selection is left as it is.
	 */
	getIncludeStateAt( domElement: Element ): IncludeNoteState | null {
		const editor = this.editor;
		const include = getIncludeNoteAt( editor, domElement );
		if ( !include ) {
			return null;
		}

		const isTitleToggleable = isIncludeTitleToggleable( include );
		return {
			boxSize: include.getAttribute( 'boxSize' ) as BoxSizeValue | undefined ?? null,
			isTitleShown: !isTitleToggleable || !include.getAttribute( 'hideTitle' ),
			isTitleToggleable,
			hasCaption: !!getCaption( include ),
			isCaptionToggleable: isIncludeCaptionToggleable( editor, include ),
			isConvertibleToLink: isIncludeConvertibleToLink( editor, include )
		};
	}

	/** The box sizes, with the labels the toolbar gives them. */
	getBoxSizes(): { value: BoxSizeValue; label: string }[] {
		return BOX_SIZES.map( value => ( { value, label: getBoxSizeLabel( this.editor.t, value ) } ) );
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

			// Shown only on an include that names a note or an attachment.
			if ( command ) {
				buttonView.bind( 'isEnabled' ).to( command );
				buttonView.bind( 'isVisible' ).to( command, 'isEnabled' );
			}

			this.listenTo( buttonView, 'execute', () => {
				editor.execute( CONVERT_EMBED_TO_LINK_COMMAND );
			} );

			return buttonView;
		} );

		editor.ui.componentFactory.add( TOGGLE_CAPTION_COMMAND_NAME, locale => {
			const command = editor.commands.get( TOGGLE_CAPTION_COMMAND_NAME );
			const buttonView = new ButtonView( locale );

			buttonView.set( {
				label: t( 'Toggle caption on' ),
				icon: IconCaption,
				tooltip: true,
				isToggleable: true
			} );

			if ( command ) {
				buttonView.bind( 'isOn', 'isEnabled' ).to( command, 'value', 'isEnabled' );
				buttonView.bind( 'label' ).to( command, 'value', value =>
					value ? t( 'Toggle caption off' ) : t( 'Toggle caption on' ) );
			}

			this.listenTo( buttonView, 'execute', () => {
				editor.execute( TOGGLE_CAPTION_COMMAND_NAME, { focusCaptionOnShow: true } );
				editor.editing.view.focus();
			} );

			return buttonView;
		} );

		editor.ui.componentFactory.add( TOGGLE_TITLE_COMMAND_NAME, locale => {
			const command = editor.commands.get( TOGGLE_TITLE_COMMAND_NAME );
			const buttonView = new ButtonView( locale );

			buttonView.set( {
				label: t( 'Show title' ),
				icon: windowIcon,
				tooltip: true,
				isToggleable: true
			} );

			if ( command ) {
				buttonView.bind( 'isOn', 'isEnabled' ).to( command, 'value', 'isEnabled' );
				buttonView.bind( 'isVisible' ).to( command, 'isEnabled' );
			}

			this.listenTo( buttonView, 'execute', () => {
				editor.execute( TOGGLE_TITLE_COMMAND_NAME );
				editor.editing.view.focus();
			} );

			return buttonView;
		} );

		editor.ui.componentFactory.add( INCLUDE_NOTE_MENU, locale => {
			const command = editor.commands.get( TOGGLE_TITLE_COMMAND_NAME );
			const buttonView = new ButtonView( locale );

			buttonView.set( {
				label: t( 'More actions' ),
				icon: IconThreeVerticalDots,
				tooltip: true
			} );

			// Replaces the menu button of the title row while the title is hidden.
			if ( command ) {
				buttonView.bind( 'isEnabled' ).to( command );
				buttonView.bind( 'isVisible' ).to( command, 'isEnabled', command, 'value',
					( isEnabled, isTitleShown ) => isEnabled && !isTitleShown );
			}

			this.listenTo( buttonView, 'execute', () => {
				openIncludeNoteMenu( editor, buttonView.element );
			} );

			return buttonView;
		} );
	}
}

class IncludeNoteEditing extends Plugin {
	static get requires() {
		return [ Widget ];
	}

	static get pluginName() {
		return 'IncludeNoteEditing' as const;
	}

	/** The captions that were hidden or that a Tiny box size removed, by include. */
	private readonly savedCaptions = new WeakMap<ModelElement, unknown>();

	/** The includes whose saved caption a Tiny box size removed. */
	private readonly tinyIncludes = new WeakSet<ModelElement>();

	init() {
		this._defineSchema();
		this._defineConverters();

		const editor = this.editor;
		const commands = editor.commands;
		commands.add( COMMAND_NAME, new InsertIncludeNoteCommand( editor ) );
		commands.add( BOX_SIZE_COMMAND_NAME, new IncludeNoteBoxSizeCommand( editor ) );
		commands.add( EMBED_ATTACHMENT_LINK_COMMAND, new EmbedAttachmentLinkCommand( editor ) );
		commands.add( CONVERT_EMBED_TO_LINK_COMMAND, new ConvertEmbedToLinkCommand( editor ) );
		commands.add( TOGGLE_CAPTION_COMMAND_NAME, new ToggleIncludeNoteCaptionCommand( editor ) );
		commands.add( TOGGLE_TITLE_COMMAND_NAME, new ToggleIncludeNoteTitleCommand( editor ) );

		editor.model.document.registerPostFixer( writer => this.removeTinyCaptions( writer ) );
	}

	/** Keeps a copy of `caption`, for `include` to show again. */
	saveCaption( include: ModelElement, caption: ModelElement ) {
		this.savedCaptions.set( include, caption.toJSON() );
		this.tinyIncludes.delete( include );
	}

	/** A copy of the caption last saved for `include`, or `null`. */
	getSavedCaption( include: ModelElement ): ModelElement | null {
		const json = this.savedCaptions.get( include );
		return json ? ModelElement.fromJSON( json ) : null;
	}

	/** A copy of the caption that a Tiny box size removed from `include`, or `null`. */
	takeTinyCaption( include: ModelElement ): ModelElement | null {
		return this.tinyIncludes.delete( include ) ? this.getSavedCaption( include ) : null;
	}

	_defineSchema() {
		const schema = this.editor.model.schema;

		schema.register( 'includeNote', {
			// Behaves like a self-contained object (e.g. an image).
			isObject: true,

			// An include shows either a note or, as an embed, an attachment. An embed that
			// `FileUploadEditing` is uploading carries the upload attributes instead of its id.
			allowAttributes: [
				'noteId', 'attachmentId', 'boxSize', 'hideTitle', 'uploadId', 'uploadStatus',
				'uploadFileName'
			],

			// Allow in places where other blocks are allowed (e.g. directly in the root).
			allowWhere: '$block'
		} );

		// `ImageCaptionEditing` and `TableCaptionEditing` share the same `caption` element.
		if ( schema.isRegistered( 'caption' ) ) {
			schema.extend( 'caption', { allowIn: 'includeNote' } );
		} else {
			schema.register( 'caption', {
				allowIn: 'includeNote',
				allowContentOf: '$block',
				isLimit: true
			} );
		}
	}

	_defineConverters() {
		const editor = this.editor;
		const conversion = editor.conversion;
		const t = editor.t;

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
					...( viewElement.getAttribute( 'data-hide-title' ) === 'true'
						? { hideTitle: true }
						: {} )
				} );
			},
			// Includes saved before captions existed are `<section>` elements.
			view: {
				name: /^(?:figure|section)$/,
				classes: 'include-note'
			}
		} );
		conversion.for( 'dataDowncast' ).elementToElement( {
			model: 'includeNote',
			view: ( modelElement, { writer: viewWriter } ) => {
				return viewWriter.createContainerElement( 'figure', {
					class: 'include-note',
					...getIncludedEntityAttributes( modelElement ),
					'data-box-size': modelElement.getAttribute( 'boxSize' ),
					...getTitleAttributes( modelElement )
				} );
			}
		} );
		conversion.for( 'editingDowncast' ).elementToElement( {
			model: 'includeNote',
			view: ( modelElement, { writer: viewWriter } ) => {

				const boxSize = modelElement.getAttribute( 'boxSize' ) as string | undefined;

				const figure = viewWriter.createContainerElement( 'figure', {
					class: 'include-note box-size-' + boxSize,
					...getIncludedEntityAttributes( modelElement ),
					'data-box-size': boxSize,
					...getTitleAttributes( modelElement )
				} );

				const includedNoteWrapper = viewWriter.createUIElement( 'div', {
					class: 'include-note-wrapper',
					"data-cke-ignore-events": true
				}, function( domDocument ) {
					const domElement = this.toDomElement( domDocument );

					showIncludedContent( editor, modelElement, domElement );
					preventCKEditorHandling( domElement, editor );

					return domElement;
				} );

				viewWriter.insert( viewWriter.createPositionAt( figure, 0 ), includedNoteWrapper );

				// hasSelectionHandle gives the block widget CKEditor's own drag grip so it moves
				// atomically, instead of the browser's native drag tearing the embedded note apart.
				// The label is announced by screen readers; lowercase to match the "image widget" /
				// "table widget" labels CKEditor gives its own widgets.
				return toWidget( figure, viewWriter, {
					label: editor.t( 'include note widget' ),
					hasSelectionHandle: true
				} );
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

			// Shows or hides the title without drawing the content again.
			dispatcher.on( 'attribute:hideTitle:includeNote', ( _evt, data, conversionApi ) => {
				const viewElement = conversionApi.mapper.toViewElement( data.item as ModelElement );
				if ( !viewElement ) {
					return;
				}

				if ( data.attributeNewValue ) {
					conversionApi.writer.setAttribute( 'data-hide-title', 'true', viewElement );
				} else {
					conversionApi.writer.removeAttribute( 'data-hide-title', viewElement );
				}
			} );

			// Redraws the content in place when an upload ends. A converter that lists
			// `attributes` also reconverts the include on every change of its children, such as
			// a caption toggle.
			for ( const attribute of [ 'attachmentId', 'uploadFileName' ] ) {
				dispatcher.on( `attribute:${ attribute }:includeNote`, ( _evt, data, api ) => {
					redrawIncludedEntity( editor, data.item as ModelElement, api );
				} );
			}
		} );

		// <caption> converters, for the caption of an include only
		conversion.for( 'upcast' ).elementToElement( {
			view: element => isIncludeNoteCaptionView( element ) ? { name: true } : null,
			model: 'caption'
		} );
		conversion.for( 'dataDowncast' ).elementToElement( {
			model: 'caption',
			view: ( modelElement, { writer: viewWriter } ) => isIncludeNote( modelElement.parent )
				? viewWriter.createContainerElement( 'figcaption' )
				: null
		} );
		conversion.for( 'editingDowncast' ).elementToElement( {
			model: 'caption',
			view: ( modelElement, { writer: viewWriter } ) => {
				if ( !isIncludeNote( modelElement.parent ) ) {
					return null;
				}

				const figcaption: ViewEditableElement & PlaceholderableViewElement =
					viewWriter.createEditableElement( 'figcaption' );
				figcaption.placeholder = t( 'Enter caption' );
				enableViewPlaceholder( {
					view: editor.editing.view,
					element: figcaption,
					keepOnFocus: true
				} );

				return toWidgetEditable( figcaption, viewWriter, {
					label: t( 'Caption for the included note' )
				} );
			}
		} );

		// The default mapping places model offset 0 before the content wrapper, which has no model
		// length. The caption goes after it.
		editor.editing.mapper.on<MapperModelToViewPositionEvent>(
			'modelToViewPosition',
			( _evt, data ) => {
				const parent = data.modelPosition.parent;
				const viewElement = parent.is( 'element', 'includeNote' )
					? data.mapper.toViewElement( parent )
					: undefined;
				const wrapperIndex = viewElement ? getWrapperIndex( viewElement ) : null;
				if ( !viewElement || wrapperIndex === null ) {
					return;
				}

				const offset = wrapperIndex + 1 + data.modelPosition.offset;
				data.viewPosition = editor.editing.view.createPositionAt(
					viewElement, Math.min( offset, viewElement.childCount ) );
			}
		);
	}

	/**
	 * Removes the caption of every Tiny include that a change touched, keeping a copy for when
	 * the include gets a larger box size.
	 */
	private removeTinyCaptions( writer: ModelWriter ) {
		const includes = new Set<ModelElement>();
		for ( const change of this.editor.model.document.differ.getChanges() ) {
			if ( change.type === 'attribute' && change.attributeKey === 'boxSize' ) {
				addIncludeNotes( includes, change.range.start.nodeAfter );
			} else if ( change.type === 'insert' && change.name === 'caption' ) {
				addIncludeNotes( includes, change.position.parent );
			} else if ( change.type === 'insert' && change.name !== '$text' ) {
				addIncludeNotes( includes, change.position.nodeAfter );
			}
		}

		let isChanged = false;
		for ( const include of includes ) {
			const caption = getCaption( include );
			if ( caption && include.getAttribute( 'boxSize' ) === 'tiny' ) {
				this.saveCaption( include, caption );
				this.tinyIncludes.add( include );
				writer.remove( caption );
				isChanged = true;
			}
		}

		return isChanged;
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

	/**
	 * Sets the box size of the selected include. Tiny takes the caption away, and a larger size
	 * shows it again.
	 */
	override execute( options: { value: BoxSizeValue } ) {
		const editor = this.editor;
		const includeNoteElement = getSelectedIncludeNote( editor );

		if ( includeNoteElement ) {
			editor.model.change( writer => {
				const wasTiny = includeNoteElement.getAttribute( 'boxSize' ) === 'tiny';
				writer.setAttribute( 'boxSize', options.value, includeNoteElement );

				if ( options.value === 'tiny' ) {
					writer.setSelection( includeNoteElement, 'on' );
				} else if ( wasTiny && !getCaption( includeNoteElement ) ) {
					const caption = editor.plugins.get( IncludeNoteEditing )
						.takeTinyCaption( includeNoteElement );
					if ( caption ) {
						writer.append( caption, includeNoteElement );
					}
				}
			} );
		}
	}

	override refresh() {
		const includeNoteElement = getSelectedIncludeNote( this.editor );

		this.isEnabled = !!includeNoteElement;
		this.value = includeNoteElement?.getAttribute( 'boxSize' ) as BoxSizeValue | null ?? null;
	}
}

/** Shows or hides the caption of the selected include. A Tiny include has none. */
export class ToggleIncludeNoteCaptionCommand extends Command {
	declare value: boolean;

	override refresh() {
		const include = getSelectedIncludeNote( this.editor );

		this.isEnabled = !!include && isIncludeCaptionToggleable( this.editor, include );
		this.value = !!include && !!getCaption( include );
	}

	/**
	 * @param options.focusCaptionOnShow whether a caption that the command shows takes the
	 * selection.
	 */
	override execute( { focusCaptionOnShow = false }: { focusCaptionOnShow?: boolean } = {} ) {
		const editor = this.editor;
		const include = getSelectedIncludeNote( editor );
		if ( !include ) {
			return;
		}

		const editing = editor.plugins.get( IncludeNoteEditing );
		editor.model.change( writer => {
			const caption = getCaption( include );
			if ( caption ) {
				editing.saveCaption( include, caption );
				writer.setSelection( include, 'on' );
				writer.remove( caption );
				return;
			}

			const shown = editing.getSavedCaption( include ) ?? writer.createElement( 'caption' );
			writer.append( shown, include );
			if ( focusCaptionOnShow ) {
				writer.setSelection( shown, 'in' );
			}
		} );
	}
}

/**
 * Shows or hides the title row of the selected include. A Tiny or an Expandable include always
 * shows it.
 */
export class ToggleIncludeNoteTitleCommand extends Command {
	/** Whether the title shows. */
	declare value: boolean;

	override refresh() {
		const include = getSelectedIncludeNote( this.editor );

		this.isEnabled = !!include && isIncludeTitleToggleable( include );
		this.value = !include?.getAttribute( 'hideTitle' );
	}

	override execute() {
		const include = getSelectedIncludeNote( this.editor );
		if ( !include ) {
			return;
		}

		this.editor.model.change( writer => {
			if ( include.getAttribute( 'hideTitle' ) ) {
				writer.removeAttribute( 'hideTitle', include );
			} else {
				writer.setAttribute( 'hideTitle', true, include );
			}
		} );
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

/** Replaces the selected include with a link to the note or attachment it shows. */
class ConvertEmbedToLinkCommand extends Command {
	override refresh() {
		const embed = getSelectedIncludeNote( this.editor );

		this.isEnabled = !!embed && isIncludeConvertibleToLink( this.editor, embed );
	}

	override async execute() {
		const editor = this.editor;
		const embed = getSelectedIncludeNote( editor );
		const attachmentId = embed?.getAttribute( 'attachmentId' ) as string | undefined;
		const noteId = embed?.getAttribute( 'noteId' ) as string | undefined;
		if ( !embed || ( !attachmentId && !noteId ) ) {
			return;
		}

		const editorEl = editor.editing.view.getDomRoot();
		const component = glob.getComponentByEl<EditorComponent>( editorEl );
		const href = attachmentId
			? await component.getAttachmentHref( attachmentId )
			: `#root/${ noteId }`;

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
	const includeElement = domElement.closest<HTMLElement>( '.include-note' );
	const viewElement = includeElement
		&& editor.editing.view.domConverter.mapDomToView( includeElement );
	if ( !viewElement?.is( 'element' ) ) {
		return null;
	}

	return editor.editing.mapper.toModelElement( viewElement ) ?? null;
}

function isIncludeNote( node: ModelNode | ModelDocumentFragment | null ): node is ModelElement {
	return !!node?.is( 'element', 'includeNote' );
}

/** Whether the title of `include` can be hidden: a Tiny or an Expandable one always shows it. */
function isIncludeTitleToggleable( include: ModelElement ) {
	const boxSize = include.getAttribute( 'boxSize' );
	return boxSize !== 'tiny' && boxSize !== 'expandable';
}

/** Whether `include` can have a caption. A Tiny include has none. */
function isIncludeCaptionToggleable( editor: Editor, include: ModelElement ) {
	return include.getAttribute( 'boxSize' ) !== 'tiny'
		&& editor.model.schema.checkChild( include, 'caption' );
}

/** Whether `include` names a note or an attachment, which a link can then point to. */
function isIncludeConvertibleToLink( editor: Editor, include: ModelElement ) {
	return ( !!include.getAttribute( 'attachmentId' ) || !!include.getAttribute( 'noteId' ) )
		&& editor.model.schema.isRegistered( 'reference' );
}

/** The caption of `include`, or `null`. */
function getCaption( include: ModelElement ) {
	for ( const child of include.getChildren() ) {
		if ( child.is( 'element', 'caption' ) ) {
			return child;
		}
	}

	return null;
}

/** Whether `element` is the `<figcaption>` of an include. */
function isIncludeNoteCaptionView( element: ViewElement ) {
	const parent = element.parent;
	return element.name === 'figcaption' && !!parent?.is( 'element' )
		&& parent.hasClass( 'include-note' );
}

/** The index of the content wrapper among the children of an include's view, or `null`. */
function getWrapperIndex( viewElement: ViewElement ) {
	for ( const [ index, child ] of Array.from( viewElement.getChildren() ).entries() ) {
		if ( child.is( 'uiElement' ) && child.hasClass( 'include-note-wrapper' ) ) {
			return index;
		}
	}

	return null;
}

/** Adds `node`, when it is an include, and every include inside it to `includes`. */
function addIncludeNotes(
	includes: Set<ModelElement>,
	node: ModelNode | ModelDocumentFragment | null
) {
	if ( isIncludeNote( node ) ) {
		includes.add( node );
	} else if ( node?.is( 'element' ) ) {
		for ( const descendant of node.getChildren() ) {
			addIncludeNotes( includes, descendant );
		}
	}
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

/** The `data-hide-title` attribute of an include whose title is hidden. */
function getTitleAttributes( element: ModelElement ): Record<string, string> {
	return element.getAttribute( 'hideTitle' ) ? { 'data-hide-title': 'true' } : {};
}

/** Has the host open the context menu of the selected include, below `anchor`. */
function openIncludeNoteMenu( editor: Editor, anchor: HTMLElement | null ) {
	const include = getSelectedIncludeNote( editor );
	const viewElement = include && editor.editing.mapper.toViewElement( include );
	const domElement = viewElement && editor.editing.view.domConverter.mapViewToDom( viewElement );
	if ( !anchor || !( domElement instanceof HTMLElement ) ) {
		return;
	}

	const component = glob.getComponentByEl<EditorComponent>( editor.editing.view.getDomRoot() );
	component.openIncludeNoteMenu?.( domElement, anchor );
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

/** What each content wrapper shows, so that it is drawn again only when that changes. */
const shownContents = new WeakMap<HTMLElement, string>();

/**
 * Draws what an include shows into its content wrapper: the file name while an upload is under
 * way, then the attachment or note.
 */
function showIncludedContent( editor: Editor, element: ModelElement, wrapper: HTMLElement ) {
	const uploadFileName = element.getAttribute( 'uploadFileName' ) as string | undefined;
	const shown = uploadFileName
		? `upload:${ uploadFileName }`
		: JSON.stringify( getIncludedEntityAttributes( element ) );
	const previous = shownContents.get( wrapper );
	if ( previous === shown ) {
		return;
	}
	shownContents.set( wrapper, shown );

	if ( uploadFileName ) {
		wrapper.replaceChildren( createUploadTitle( wrapper.ownerDocument, uploadFileName ) );
		return;
	}

	if ( previous?.startsWith( 'upload:' ) ) {
		wrapper.replaceChildren();
	}
	const boxSize = element.getAttribute( 'boxSize' ) as string | undefined;
	loadIncludedContent( editor, element, $( wrapper ), boxSize );
}

/** Updates the `data-*` attribute of an include's view to what it shows, and redraws it. */
function redrawIncludedEntity(
	editor: Editor,
	include: ModelElement,
	conversionApi: DowncastConversionApi
) {
	const viewElement = conversionApi.mapper.toViewElement( include );
	if ( !viewElement ) {
		return;
	}

	const viewWriter = conversionApi.writer;
	viewWriter.removeAttribute( 'data-attachment-id', viewElement );
	viewWriter.removeAttribute( 'data-note-id', viewElement );
	for ( const [ key, value ] of Object.entries( getIncludedEntityAttributes( include ) ) ) {
		viewWriter.setAttribute( key, value, viewElement );
	}

	const wrapper = getWrapperDom( editor, viewElement );
	if ( wrapper ) {
		showIncludedContent( editor, include, wrapper );
	}
}

/** The content wrapper of a rendered include, or `null` before the include is rendered. */
function getWrapperDom( editor: Editor, viewElement: ViewElement ) {
	return editor.editing.view.domConverter.mapViewToDom( viewElement )
		?.querySelector<HTMLElement>( ':scope > .include-note-wrapper' ) ?? null;
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
	const wrapperDom = getWrapperDom( editor, viewElement );

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

		// Suppress the browser's native caret on non-interactive areas. The widget's <figure> is
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

	interface CommandsMap {
		toggleIncludeNoteCaption: ToggleIncludeNoteCaptionCommand;
		toggleIncludeNoteTitle: ToggleIncludeNoteTitleCommand;
	}
}
