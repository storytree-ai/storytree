/**
 * Capability 6 · Make a folder a project. The `.storytree` folder a project's setup leaves at its root (ADR-1191), named
 * here with no Node import so the app's views can say it too.
 */

/** The folder in a project's root holding every file storytree keeps there. */
export const STORYTREE_FOLDER = ".storytree";

/** What keeps that folder's machine-local files out of git, without touching the repository's own .gitignore (D2). */
export const IGNORE_FILE = ".storytree/.gitignore";

/** What a project's setup tells the user about the folder it left (D3), in one line. */
export const COMMIT_STORYTREE = "Commit the .storytree folder: git worktrees and fresh clones of this repository find the project through it, and its .gitignore keeps the machine-local files out.";
