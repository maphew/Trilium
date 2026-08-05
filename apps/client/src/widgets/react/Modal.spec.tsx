import { render } from "preact";
import { act } from "preact/test-utils";
import { describe, expect, it, vi } from "vitest";

import Modal from "./Modal";

/**
 * Bootstrap's modal events are native events, so they bubble, and a modal opened from inside another
 * one is a DOM descendant of it. The listeners must therefore answer only for their own element.
 */
describe("Modal stacking", () => {
    it("does not report a nested modal's closing as its own", () => {
        const { outer, inner, onOuterHidden, onInnerHidden } = renderNested();

        fire(inner, "hidden.bs.modal");

        expect(onInnerHidden).toHaveBeenCalledOnce();
        expect(onOuterHidden).not.toHaveBeenCalled();

        fire(outer, "hidden.bs.modal");
        expect(onOuterHidden).toHaveBeenCalledOnce();
    });

    it("does not report a nested modal's opening as its own", () => {
        const { inner, onOuterShown, onInnerShown } = renderNested();

        fire(inner, "shown.bs.modal");

        expect(onInnerShown).toHaveBeenCalledOnce();
        expect(onOuterShown).not.toHaveBeenCalled();
    });
});

function renderNested() {
    const container = document.createElement("div");
    document.body.appendChild(container);

    const onOuterHidden = vi.fn();
    const onInnerHidden = vi.fn();
    const onOuterShown = vi.fn();
    const onInnerShown = vi.fn();

    // Kept in the DOM while hidden, so the pair is nested without Bootstrap having to run.
    act(() => render(
        <Modal className="outer-modal" size="lg" title="Outer" show={false} keepInDom onHidden={onOuterHidden} onShown={onOuterShown}>
            <Modal className="inner-modal" size="sm" title="Inner" show={false} keepInDom stackable onHidden={onInnerHidden} onShown={onInnerShown}>
                inner body
            </Modal>
        </Modal>,
        container
    ));

    const outer = container.querySelector<HTMLElement>(".outer-modal");
    const inner = container.querySelector<HTMLElement>(".inner-modal");
    if (!outer || !inner) {
        throw new Error("both modals should be in the DOM");
    }
    expect(outer.contains(inner)).toBe(true);

    return { outer, inner, onOuterHidden, onInnerHidden, onOuterShown, onInnerShown };
}

function fire(element: HTMLElement, type: string) {
    act(() => {
        element.dispatchEvent(new CustomEvent(type, { bubbles: true }));
    });
}
