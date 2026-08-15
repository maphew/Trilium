import type { ComponentChildren } from "preact";

import openService from "../../services/open.js";
import { isElectron } from "../../services/utils.js";

interface DirectoryLinkProps {
    directory: string;
    /**
     * What to show in place of the path itself, for a link that stands for something inside the
     * directory it opens — a file, named in full, with the file manager landing on its folder.
     */
    children?: ComponentChildren;
}

/**
 * A filesystem location, opened in the OS file manager on click. Only the desktop application can
 * open anything, so everywhere else the path is shown as plain (selectable) text.
 */
export default function DirectoryLink({ directory, children }: DirectoryLinkProps) {
    const label = children ?? directory;

    if (isElectron()) {
        const onClick = (e: MouseEvent) => {
            e.preventDefault();
            openService.openDirectory(directory);
        };

        return <a className="tn-link selectable-text" href="#" onClick={onClick}>{label}</a>;
    }
    return <span className="selectable-text">{label}</span>;
}
