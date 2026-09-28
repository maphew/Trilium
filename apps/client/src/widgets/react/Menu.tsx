import "./Menu.css";

import { useLayoutEffect, useRef, useState } from "preact/hooks";

export interface MenuProps {
    /** Where the menu opens, in viewport coordinates. */
    x: number;
    y: number;
}

/** How many pixels the menu keeps from the edges of the viewport. */
const VIEWPORT_PADDING = 5;

export default function Menu({ x, y }: MenuProps) {
    const menuRef = useRef<HTMLDivElement>(null);
    const [ position, setPosition ] = useState({ left: x, top: y });

    useLayoutEffect(() => {
        const menu = menuRef.current;
        if (!menu) return;

        const { width, height } = menu.getBoundingClientRect();
        const { clientWidth, clientHeight } = document.documentElement;
        setPosition({
            left: clampToViewport(x, clientWidth - width),
            top: clampToViewport(y, clientHeight - height)
        });
    }, [ x, y ]);

    return (
        <div ref={menuRef} className="tn-menu" role="menu" style={position}>
            Hello world
        </div>
    );
}

function clampToViewport(value: number, max: number) {
    return Math.max(VIEWPORT_PADDING, Math.min(value, max - VIEWPORT_PADDING));
}
