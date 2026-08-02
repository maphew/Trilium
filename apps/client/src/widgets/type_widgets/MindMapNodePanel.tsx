import "./MindMapNodePanel.css";

/**
 * Floating panel displayed over a mind map while at least one node is selected, meant to host the
 * formatting controls for the selection.
 */
export default function MindMapNodePanel() {
    return (
        <div
            className="mind-map-node-panel"
            /* Keep interactions inside the panel from reaching the map underneath. */
            onMouseDown={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
        >
            Hello world
        </div>
    );
}
