import Mathematics from '../src/math.js';
import AutoMath from '../src/automath.js';
import { ClassicEditor, Clipboard, Paragraph, Undo, Typing, _getModelData as getData, _setModelData as setData } from 'ckeditor5';
import { describe, beforeEach, it, afterEach, vi, expect } from "vitest";

describe( 'AutoMath - integration', () => {
	let editorElement: HTMLDivElement, editor: ClassicEditor;

	beforeEach( async () => {
		editorElement = document.createElement( 'div' );
		document.body.appendChild( editorElement );

		return ClassicEditor
			.create( editorElement, {
				plugins: [ Mathematics, AutoMath, Typing, Paragraph ],
				licenseKey: "GPL",
				math: {
					engine: ( equation, element, display ) => {
						if ( display ) {
							element.innerHTML = '\\[' + equation + '\\]';
						} else {
							element.innerHTML = '\\(' + equation + '\\)';
						}
					}
				}
			} )
			.then( newEditor => {
				editor = newEditor;
			} );
	} );

	afterEach( () => {
		editorElement.remove();

		return editor.destroy();
	} );

	it( 'should load Clipboard plugin', () => {
		expect( editor.plugins.get( Clipboard ) ).to.instanceOf( Clipboard );
	} );

	it( 'should load Undo plugin', () => {
		expect( editor.plugins.get( Undo ) ).to.instanceOf( Undo );
	} );

	it( 'has proper name', () => {
		expect( AutoMath.pluginName ).to.equal( 'AutoMath' );
	} );

	describe( 'converting pasted equations', () => {
		beforeEach( () => {
			vi.useFakeTimers();
		} );

		afterEach( () => {
			vi.useRealTimers();
		} );

		it( 'replaces pasted text with a display equation after 100ms', () => {
			setData( editor.model, '<paragraph>[]</paragraph>' );
			pasteHtml( editor, '\\[x^2\\]' );

			expect( getData( editor.model ) ).to.equal(
				'<paragraph>\\[x^2\\][]</paragraph>'
			);

			vi.advanceTimersByTime( 100 );

			// A display equation is a block element, so it replaces the empty paragraph outright.
			expect( getData( editor.model ) ).to.equal( '[<mathtex-display display="true" equation="x^2" type="script"></mathtex-display>]' );
		} );

		it( 'replaces pasted text with an inline equation after 100ms', () => {
			setData( editor.model, '<paragraph>[]</paragraph>' );
			pasteHtml( editor, '\\(x^2\\)' );

			expect( getData( editor.model ) ).to.equal(
				'<paragraph>\\(x^2\\)[]</paragraph>'
			);

			vi.advanceTimersByTime( 100 );

			expect( getData( editor.model ) ).to.equal( '<paragraph>[<mathtex-inline display="false" equation="x^2" type="script"></mathtex-inline>]</paragraph>' );
		} );

		it( 'does not convert before the delay elapses', () => {
			setData( editor.model, '<paragraph>[]</paragraph>' );
			pasteHtml( editor, '\\(x^2\\)' );

			vi.advanceTimersByTime( 99 );

			expect( getData( editor.model ) ).to.equal( '<paragraph>\\(x^2\\)[]</paragraph>' );
		} );

		it( 'can undo auto-mathing', () => {
			setData( editor.model, '<paragraph>[]</paragraph>' );
			pasteHtml( editor, '\\[x^2\\]' );

			expect( getData( editor.model ) ).to.equal(
				'<paragraph>\\[x^2\\][]</paragraph>'
			);

			vi.advanceTimersByTime( 100 );

			editor.commands.execute( 'undo' );

			expect( getData( editor.model ) ).to.equal(
				'<paragraph>\\[x^2\\][]</paragraph>'
			);
		} );

		it( 'cancels the pending conversion when undo runs first', () => {
			setData( editor.model, '<paragraph>[]</paragraph>' );
			pasteHtml( editor, '\\(x^2\\)' );

			// Undo before the timeout fires: the scheduled conversion must be dropped, not applied.
			editor.commands.execute( 'undo' );
			vi.advanceTimersByTime( 100 );

			expect( getData( editor.model ) ).to.not.contain( 'mathtex' );
		} );

		it( 'works for a non-collapsed selection inside a single element', () => {
			setData( editor.model, '<paragraph>[Foo]</paragraph>' );
			pasteHtml( editor, '\\(x^2\\)' );

			vi.advanceTimersByTime( 100 );

			expect( getData( editor.model ) ).to.equal( '<paragraph>[<mathtex-inline display="false" equation="x^2" type="script"></mathtex-inline>]</paragraph>' );
		} );

		it( 'works for a non-collapsed selection over a few elements', () => {
			setData( editor.model, '<paragraph>Fo[o</paragraph><paragraph>Ba]r</paragraph>' );
			pasteHtml( editor, '\\(x^2\\)' );

			vi.advanceTimersByTime( 100 );

			expect( getData( editor.model ) ).to.equal( '<paragraph>Fo[<mathtex-inline display="false" equation="x^2" type="script"></mathtex-inline>]r</paragraph>' );
		} );

		it( 'inserts an inline equation in-place (collapsed selection)', () => {
			setData( editor.model, '<paragraph>Foo []Bar</paragraph>' );
			pasteHtml( editor, '\\(x^2\\)' );

			vi.advanceTimersByTime( 100 );

			expect( getData( editor.model ) ).to.equal(
				'<paragraph>Foo [<mathtex-inline display="false" equation="x^2" type="script"></mathtex-inline>]Bar</paragraph>'
			);
		} );

		it( 'inserts an inline equation in-place (non-collapsed selection)', () => {
			setData( editor.model, '<paragraph>Foo [Bar] Baz</paragraph>' );
			pasteHtml( editor, '\\(x^2\\)' );

			vi.advanceTimersByTime( 100 );

			expect( getData( editor.model ) ).to.equal(
				'<paragraph>Foo [<mathtex-inline display="false" equation="x^2" type="script"></mathtex-inline>] Baz</paragraph>'
			);
		} );

		it( 'splits the paragraph around a pasted display equation', () => {
			setData( editor.model, '<paragraph>Foo []Bar</paragraph>' );
			pasteHtml( editor, '\\[x^2\\]' );

			vi.advanceTimersByTime( 100 );

			expect( getData( editor.model ) ).to.equal(
				'<paragraph>Foo </paragraph>[<mathtex-display display="true" equation="x^2" type="script"></mathtex-display>]<paragraph>Bar</paragraph>'
			);
		} );

		it( 'does nothing if two equations are pasted as text', () => {
			setData( editor.model, '<paragraph>[]</paragraph>' );
			pasteHtml( editor, '\\[x^2\\] \\[\\sqrt{x}2\\]' );

			vi.advanceTimersByTime( 100 );

			expect( getData( editor.model ) ).to.equal(
				'<paragraph>\\[x^2\\] \\[\\sqrt{x}2\\][]</paragraph>'
			);
		} );

		it( 'does nothing for pasted text without delimiters', () => {
			setData( editor.model, '<paragraph>[]</paragraph>' );
			pasteHtml( editor, 'x^2' );

			vi.advanceTimersByTime( 100 );

			expect( getData( editor.model ) ).to.equal( '<paragraph>x^2[]</paragraph>' );
		} );
	} );

	function pasteHtml( editor: ClassicEditor, html: string ) {
		editor.editing.view.document.fire( 'paste', {
			dataTransfer: createDataTransfer( { 'text/html': html } ),
			preventDefault() {},
			stopPropagation() {}
		} );
	}

	function createDataTransfer( data: Record<string, string> ) {
		return {
			getData( type: string ) {
				return data[ type ];
			}
		};
	}
} );
