import { Clipboard, ClipboardPipeline, Plugin, type Editor, ModelLivePosition, ModelLiveRange, Undo } from 'ckeditor5';
import { extractDelimiters, hasDelimiters, delimitersCounts } from './utils.js';

export default class AutoMath extends Plugin {
	public static get requires() {
		return [ Clipboard, ClipboardPipeline, Undo ] as const;
	}

	public static get pluginName() {
		return 'AutoMath' as const;
	}

	private _timeoutId: null | number;
	private _positionToInsert: null | ModelLivePosition;

	constructor( editor: Editor ) {
		super( editor );

		this._timeoutId = null;

		this._positionToInsert = null;
	}

	public init(): void {
		const editor = this.editor;
		const modelDocument = editor.model.document;

		// `inputTransformation` is emitted by ClipboardPipeline, not by the Clipboard facade.
		// Listening on Clipboard silently never fires, which left this whole feature dead.
		this.listenTo( editor.plugins.get( ClipboardPipeline ), 'inputTransformation', () => {
			const firstRange = modelDocument.selection.getFirstRange();
			/* v8 ignore next 3 -- defensive: the document selection always has at least one range */
			if ( !firstRange ) {
				return;
			}

			const leftLivePosition = ModelLivePosition.fromPosition( firstRange.start );
			leftLivePosition.stickiness = 'toPrevious';

			const rightLivePosition = ModelLivePosition.fromPosition( firstRange.end );
			rightLivePosition.stickiness = 'toNext';

			modelDocument.once( 'change:data', () => {
				this._mathBetweenPositions(
					leftLivePosition,
					rightLivePosition
				);

				leftLivePosition.detach();
				rightLivePosition.detach();
			},
			{ priority: 'high' }
			);
		}
		);

		editor.commands.get( 'undo' )?.on( 'execute', () => {
			if ( this._timeoutId ) {
				window.clearTimeout( this._timeoutId );
				this._positionToInsert?.detach();

				this._timeoutId = null;
				this._positionToInsert = null;
			}
		}, { priority: 'high' } );
	}

	private _mathBetweenPositions(
		leftPosition: ModelLivePosition,
		rightPosition: ModelLivePosition
	) {
		const editor = this.editor;

		// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
		const mathConfig = this.editor.config.get( 'math' );

		const equationRange = new ModelLiveRange( leftPosition, rightPosition );
		const walker = equationRange.getWalker( { ignoreElementEnd: true } );

		let text = '';

		// Get equation text
		for ( const node of walker ) {
			if ( node.item.is( '$textProxy' ) ) {
				text += node.item.data;
			}
		}

		text = text.trim();

		// Skip if don't have delimiters
		if ( !hasDelimiters( text ) || delimitersCounts( text ) !== 2 ) {
			return;
		}

		const mathCommand = editor.commands.get( 'math' );

		// Do not anything if math element cannot be inserted at the current position
		if ( !mathCommand?.isEnabled ) {
			return;
		}

		this._positionToInsert = ModelLivePosition.fromPosition( leftPosition );

		// With timeout user can undo conversation if want use plain text
		this._timeoutId = window.setTimeout( () => {
			editor.model.change( writer => {
				this._timeoutId = null;

				writer.remove( equationRange );

				let insertPosition: ModelLivePosition | null;

				// Check if position where the math element should be inserted is still valid.
				/* v8 ignore next -- defensive: reachable only if the document is rewritten under the 100ms timer */
				if ( this._positionToInsert?.root.rootName !== '$graveyard' ) {
					insertPosition = this._positionToInsert;
				}

				editor.model.change( innerWriter => {
					const params = Object.assign( extractDelimiters( text ), {
						type: mathConfig?.outputType
					} );
					const mathElement = innerWriter.createElement( params.display ? 'mathtex-display' : 'mathtex-inline', params
					);

					editor.model.insertContent( mathElement, insertPosition );

					innerWriter.setSelection( mathElement, 'on' );
				} );

				this._positionToInsert?.detach();
				this._positionToInsert = null;
			} );
		}, 100 );
	}
}
